/* Galaxium Lite demo page: runs this repo's own app/ (FastAPI + SQLite) in the browser with Pyodide, and drives it
   through the app's HTTP routes, the same ones Swagger UI and Bob's MCP tools call. Nothing is sent to a server. */
"use strict";

const PYODIDE_VERSION = "314.0.7";  // keep in step with the pyodide.js URL in index.html
const APP_FILES = [
  "app/__init__.py", "app/db.py", "app/main.py", "app/schemas.py",
  "app/services/__init__.py", "app/services/bookings.py", "app/services/flights.py", "app/services/users.py",
];
// The app has no users endpoint, so the page names travellers itself: ids and names match the seed in app/db.py.
const TRAVELLERS = { 1: "Sally Ride", 2: "Yuri Gagarin", 3: "Valentina Tereshkova" };
const AFTER = document.body.dataset.version === "after";

// Python run once at start-up. app/main.py is imported as committed; only the two browser stand-ins differ.
const BOOT = `
import json, os, platform, sys, types

# Browsers can't host the MCP endpoint: a no-op FastApiMCP lets app/main.py run unchanged.
mcp_stub = types.ModuleType("fastapi_mcp")
class FastApiMCP:
    def __init__(self, app, **kwargs): pass
    def mount_http(self, *args, **kwargs): pass
mcp_stub.FastApiMCP = FastApiMCP
sys.modules["fastapi_mcp"] = mcp_stub

# Browsers have no threads: run FastAPI's sync routes and dependencies inline.
import anyio.to_thread
async def _run_sync(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
    return func(*args)
anyio.to_thread.run_sync = _run_sync

DB = "/tmp/galaxium.db"
os.environ["GALAXIUM_DB"] = DB
sys.path.insert(0, "/home/pyodide/site")

import fastapi, httpx, sqlite3
from app.main import app

client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://galaxium.local")

async def start_over():
    """Fresh demo data: delete the database, then run the app's own start-up, which reseeds it relative to now."""
    if os.path.exists(DB):
        os.remove(DB)
    async with app.router.lifespan_context(app):
        pass

async def call(method, path, body):
    r = await client.request(method, path, json=json.loads(body) if body else None)
    try:
        payload = r.json()
    except ValueError:
        payload = {"detail": r.text}
    return json.dumps({"status": r.status_code, "body": payload})

def versions():
    return json.dumps({"python": platform.python_version(), "fastapi": fastapi.__version__,
                       "sqlite": sqlite3.sqlite_version})
`;

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
let pyCall, pyStartOver;
let flights = new Map();
let bookings = [];
let pending = null;  // the booking the cancel dialog is about

class ApiError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

async function api(method, path, body) {
  const res = JSON.parse(await pyCall(method, path, body ? JSON.stringify(body) : null));
  if (res.status >= 400) throw new ApiError(res.status, (res.body && res.body.detail) || `HTTP ${res.status}`);
  return res.body;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function departs(iso) {
  const hours = (Date.parse(iso) - Date.now()) / 3.6e6;
  if (hours <= 0) return "departed";
  if (hours < 48) {
    const h = Math.max(1, Math.round(hours));
    return `departs in ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  return `departs in ${Math.round(hours / 24)} days`;
}

function trip(f) {
  return `${f.origin} → ${f.destination} · ${departs(f.departure_time)} · ${money.format(f.price)}`;
}

function notice(text, kind = "ok") {
  const n = $("notice");
  n.textContent = text;
  n.className = `notice ${kind}`;
  n.hidden = false;
}

async function busy(work) {
  const controls = () => document.querySelectorAll("#app button, #app select");
  controls().forEach((c) => (c.disabled = true));
  try {
    await work();
  } catch (err) {
    notice(err.message, "error");
  } finally {
    controls().forEach((c) => (c.disabled = false));
  }
}

async function refresh() {
  flights = new Map((await api("GET", "/flights")).map((f) => [f.id, f]));
  bookings = [];
  for (const id of Object.keys(TRAVELLERS)) bookings.push(...(await api("GET", `/users/${id}/bookings`)));
  bookings.sort((a, b) => a.id - b.id);
  $("bookings").replaceChildren(...(bookings.length
    ? bookings.map(bookingCard)
    : [el("li", { className: "empty", textContent: "No bookings yet. Book a flight below." })]));
  renderBookForm();
}

function bookingCard(b) {
  const f = flights.get(b.flight_id);
  const card = el("li", { className: `booking ${b.status}` },
    el("div", { className: "booking-head" },
      el("span", { className: "booking-id", textContent: `Booking ${b.id}` }),
      el("span", { className: `pill pill-${b.status}`, textContent: b.status === "booked" ? "Booked" : "Cancelled" })),
    el("p", { className: "booking-who", textContent: TRAVELLERS[b.user_id] || `Traveller ${b.user_id}` }),
    el("p", { className: "booking-trip", textContent: `${f.origin} → ${f.destination} · ${departs(f.departure_time)}` }),
    el("p", { className: "booking-price", textContent: money.format(f.price) }));
  if (b.status === "booked") {
    const button = el("button", { className: "btn btn-quiet", type: "button", textContent: "Cancel" });
    button.setAttribute("aria-label", `Cancel booking ${b.id}`);
    button.addEventListener("click", () => openCancel(b));
    card.append(button);
  }
  return card;
}

function renderBookForm() {
  const user = $("book-user");
  const flight = $("book-flight");
  if (!user.options.length) {
    user.append(...Object.entries(TRAVELLERS).map(([id, name]) => new Option(name, id)));
  }
  const keep = flight.value;
  flight.replaceChildren(...[...flights.values()].map((f) => new Option(trip(f), f.id)));
  if (keep) flight.value = keep;
}

async function openCancel(b) {
  const f = flights.get(b.flight_id);
  const dialog = $("cancel-dialog");
  const refund = $("cancel-refund");
  const source = $("cancel-source");
  pending = b;
  dialog.returnValue = "";
  $("cancel-title").textContent = `Cancel booking ${b.id}?`;
  $("cancel-trip").replaceChildren(
    `${TRAVELLERS[b.user_id]} · ${f.origin} → ${f.destination}`, el("br"),
    `${departs(f.departure_time)} · paid ${money.format(f.price)}`);
  if (!AFTER) {
    refund.className = "dialog-refund unknown";
    refund.textContent = "This version of the app can't tell you what you'd get back.";
    source.textContent = "";
    dialog.showModal();
    return;
  }
  refund.className = "dialog-refund";
  refund.textContent = "Checking your refund…";
  source.textContent = `From Bob's new refund preview: GET /bookings/${b.id}/refund-preview`;
  dialog.showModal();
  try {
    const preview = await api("GET", `/bookings/${b.id}/refund-preview`);
    refund.textContent = `You'd get ${preview.refund_pct}% back: ${money.format(preview.refund_amount)}`;
  } catch (err) {
    refund.className = "dialog-refund unknown";
    refund.textContent = `No preview: ${err.message}`;
  }
}

$("cancel-dialog").addEventListener("close", () => {
  const b = pending;
  pending = null;
  if (!b || $("cancel-dialog").returnValue !== "confirm") return;
  busy(async () => {
    await api("POST", `/bookings/${b.id}/cancel`);
    await refresh();
    notice(`Booking ${b.id} cancelled.`);
  });
});

$("book-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(async () => {
    const b = await api("POST", "/bookings", {
      user_id: Number($("book-user").value),
      flight_id: Number($("book-flight").value),
    });
    await refresh();
    const f = flights.get(b.flight_id);
    notice(`Booked: booking ${b.id} for ${TRAVELLERS[b.user_id]}, ${f.origin} → ${f.destination}.`);
  });
});

$("start-over").addEventListener("click", () => busy(async () => {
  await pyStartOver();
  await refresh();
  notice("Fresh demo data. Departure times count from now.");
}));

async function boot() {
  const step = (text) => { $("loading-step").textContent = text; };
  step("Downloading Python…");
  const pyodide = await loadPyodide();
  step("Loading FastAPI…");
  await pyodide.loadPackage(["fastapi", "httpx"]);
  step("Starting the app…");
  for (const file of APP_FILES) {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Couldn't load ${file} (HTTP ${res.status})`);
    const path = `/home/pyodide/site/${file}`;
    pyodide.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    pyodide.FS.writeFile(path, await res.text());
  }
  await pyodide.runPythonAsync(BOOT);
  pyCall = pyodide.globals.get("call");
  pyStartOver = pyodide.globals.get("start_over");
  const v = JSON.parse(pyodide.globals.get("versions")());
  $("under-the-hood").textContent =
    `Running in your browser: Python ${v.python}, FastAPI ${v.fastapi} and SQLite ${v.sqlite} on Pyodide ${PYODIDE_VERSION}.`;
  await pyStartOver();
  await refresh();
  $("loading").hidden = true;
  $("app").hidden = false;
  document.body.dataset.ready = "true";
}

boot().catch((err) => {
  console.error(err);
  $("loading").classList.add("failed");
  $("loading-step").textContent = "Couldn't start the app in this browser.";
  $("loading-note").textContent =
    `${err.message}. Try reloading, or open the page in a recent Chrome, Edge, Safari or Firefox.`;
});
