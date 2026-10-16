# Galaxium Lite

A small interplanetary flight booking API, used for the IBM Bob hands-on lab.
It is a cut-down cousin of IBM's Galaxium Travels demo: FastAPI, plain
`sqlite3` (no ORM), pydantic models and a pytest suite. The same API is also
exposed as **MCP tools** at `/mcp`, so Bob can call it directly.

## Run it

Requires Python 3.11+ (tested on 3.13).

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS:    source .venv/bin/activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
```

- Swagger UI: http://localhost:8000/docs
- MCP endpoint (streamable HTTP): http://localhost:8000/mcp

On first start the app creates `galaxium.db` and seeds demo data. Departure
times are relative to **when the data was seeded**, so if you come back to it
later, stop the server, delete `galaxium.db` and start again.

## Run the tests

```bash
pytest -q
```

Tests use a temporary database and a fixed clock, so they never touch
`galaxium.db` and give the same result whatever the time.

## Endpoints

Each route has an explicit `operation_id`, which is also its MCP tool name.

| Method | Path | operation_id | What it does |
|---|---|---|---|
| GET | `/flights` | `list_flights` | All flights, soonest departure first |
| GET | `/flights/{flight_id}` | `get_flight` | One flight |
| POST | `/bookings` | `book_flight` | Book a flight: `{"user_id": 1, "flight_id": 5}` |
| GET | `/users/{user_id}/bookings` | `list_user_bookings` | A user's bookings |
| POST | `/bookings/{booking_id}/cancel` | `cancel_booking` | Cancel a booking |

Errors return `{"detail": "..."}` with 404 (not found) or 409 (not allowed in
the current state, e.g. already cancelled).

## Seed data

| Booking | User | Flight | Departs | Status |
|---|---|---|---|---|
| 1 | 1 Sally Ride | 1 Earth to Mars (1200) | in ~10 days | booked |
| 2 | 1 Sally Ride | 2 Earth to Moon (300) | in ~3 days | booked |
| 3 | 2 Yuri Gagarin | 3 Mars to Europa (2500) | in ~12 hours | booked |
| 4 | 3 Valentina Tereshkova | 4 Moon to Earth (280) | in ~5 days | cancelled |

Flights 5 (Earth to Titan) and 6 (Venus to Earth) have no bookings.

## Layout

```
app/
  main.py              routes, error handlers, MCP mount (keep the mount last)
  db.py                schema, connection, seed data, ISO-8601 time helpers
  schemas.py           pydantic request/response models
  services/            business logic; raise NotFoundError / ConflictError
    flights.py  bookings.py  users.py
tests/                 pytest; conftest.py gives a temp DB and a fixed clock
plans/                 put implementation plans here
fallback/              a ready-made plan if you fall behind in the lab
docs/STRETCH.md        stretch goal
.bob/                  Bob configuration (see below)
```

Conventions: services take a `sqlite3.Connection` and return plain dicts;
anything time-dependent takes an explicit `now` (routes get it from the
`get_now` dependency, tests override it). Times are stored as ISO-8601 UTC
strings like `2030-01-01T12:00:00Z`.

## Bob configuration (`.bob/`)

| File | What it does |
|---|---|
| `custom_modes.yaml` | A read-only **Reviewer** mode: reviews code, never edits |
| `mcp.json` | Connects Bob to this app's MCP endpoint at `http://localhost:8000/mcp` |
| `skills/verify/SKILL.md` | A `verify` skill: run pytest and summarise the result |

The MCP server only works while the app is running (`uvicorn ...` above).

This kit is ours, not built into Bob. Bob's own `/review` command is built in.
