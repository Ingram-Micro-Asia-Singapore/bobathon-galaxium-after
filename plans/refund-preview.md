# Refund Preview

## Overview

Add a read-only `GET /bookings/{booking_id}/refund-preview` endpoint that returns the
refund amount a user would receive if they cancelled right now — without performing the
cancellation. The refund is calculated from the flight's `price` field and the time
remaining until departure.

**Refund tiers:**

| Time to departure | Refund |
|---|---|
| > 7 days | 100% of flight price |
| 1 – 7 days (inclusive of the 1-day boundary) | 50% of flight price |
| < 24 hours | 0% |
| Booking already cancelled | 0% (not an error — preview is always valid) |

**Non-goals:**
- No change to the actual cancel flow.
- No stored refund amounts in the database.
- No authentication.

---

## Sub-Tasks

---

### 1 — Add `refund_preview` to `app/services/bookings.py`

**Intent:**
Implement the pure refund calculation as a service function, keeping all
business logic out of the route layer. Follows the existing pattern: accept an
explicit `now: datetime` so tests can pin the clock.

**Expected Outcomes:**
- A new function `refund_preview(conn, booking_id, now) -> dict` exists in
  `app/services/bookings.py`.
- Returns a plain `dict` with at least `booking_id`, `status`, `refund_amount`,
  and `refund_pct` (integer percentage: 100, 50, or 0).
- Already-cancelled bookings return `refund_amount=0.0`, `refund_pct=0` — no error raised.
- Raises `NotFoundError` if the booking or its flight does not exist.
- Uses `db.from_iso()` to parse `departure_time`; uses `flight["price"]` as the basis.

**Todo List:**
- [ ] Add `refund_preview(conn, booking_id, now)` to `app/services/bookings.py`.
- [ ] Implement tier logic: compute `delta = departure_time - now` in total seconds.
  - `delta > 7 days` → `pct = 100`
  - `1 day <= delta <= 7 days` → `pct = 50`
  - `delta < 1 day` OR status is `cancelled` → `pct = 0`
- [ ] Compute `refund_amount = round(flight["price"] * pct / 100, 2)`.
- [ ] Return `{"booking_id": ..., "status": ..., "refund_pct": pct, "refund_amount": ...}`.

**Relevant Context:**
- `app/services/bookings.py` — `cancel_booking` shows the pattern for fetching a
  booking + its flight and using `db.from_iso()` for the time comparison.
- `app/services/__init__.py` — `NotFoundError` is the only error type needed here.
- `app/db.py` — `from_iso()` for parsing departure_time strings.

**Status:** [ ] pending

---

### 2 — Add `RefundPreview` schema to `app/schemas.py`

**Intent:**
Define the Pydantic response model for the new endpoint, consistent with the
existing schema style (plain fields, no nested objects).

**Expected Outcomes:**
- A `RefundPreview` class exists in `app/schemas.py`.
- Fields: `booking_id: int`, `status: BookingStatus`, `refund_pct: int`,
  `refund_amount: float`.
- Reuses the existing `BookingStatus` type alias.

**Todo List:**
- [ ] Add `RefundPreview(BaseModel)` to `app/schemas.py` with the four fields above.

**Relevant Context:**
- `app/schemas.py` — follow the same `BaseModel` style as `Booking` and `Flight`.
- `BookingStatus` is already defined in that file; import/reuse it.

**Status:** [ ] pending

---

### 3 — Add the route to `app/main.py`

**Intent:**
Expose the refund preview as a GET endpoint so it is naturally read-only (no
side effects) and becomes an MCP tool automatically.

**Expected Outcomes:**
- `GET /bookings/{booking_id}/refund-preview` returns a `RefundPreview` response
  with HTTP 200.
- The route has `operation_id="preview_refund"` and `tags=["Bookings"]`.
- Returns 404 if the booking does not exist (uses the existing `NOT_FOUND` dict).
- The route is placed before `mcp = FastApiMCP(app, ...)` so it becomes an MCP tool.
- `now` is injected via `Depends(get_now)` following the pattern of `cancel_booking`.

**Todo List:**
- [ ] Import `RefundPreview` from `app.schemas` in `main.py`.
- [ ] Add the GET route using `response_model=RefundPreview`, `responses=NOT_FOUND`,
  `operation_id="preview_refund"`, `tags=["Bookings"]`.
- [ ] Call `bookings.refund_preview(conn, booking_id, now)` and return the result.
- [ ] Verify the route is above the `mcp = FastApiMCP(app, ...)` line.

**Relevant Context:**
- `app/main.py:91-100` — `list_user_bookings` is the closest structural match for
  a read-only bookings route.
- `app/main.py:103-116` — `cancel_booking` shows how `now` is injected.
- `app/main.py:119-122` — MCP registration; new route must appear before this.

**Status:** [ ] pending

---

### 4 — Write tests in `tests/test_bookings.py`

**Intent:**
Cover all four refund tiers plus the 404 case using the existing fixtures.
The pinned clock `NOW = 2030-01-01T12:00:00Z` and seeded data give deterministic
departure offsets for each tier.

**Expected Outcomes:**
- 5 new tests, all passing with `pytest tests/test_bookings.py`.
- Each tier is covered by at least one test using a real seeded booking.
- The unknown-booking case returns 404.

**Seeded bookings and their refund tiers at NOW:**

| Booking | Flight | Departure offset | Tier |
|---|---|---|---|
| 1 | 1 | +10 days | 100% |
| 2 | 2 | +3 days | 50% |
| 3 | 3 | +12 hours | 0% |
| 4 | 4 | +5 days (cancelled) | 0% |

**Todo List:**
- [ ] `test_refund_preview_100pct` — booking 1 (10 days out): expect `refund_pct=100`,
  `refund_amount=1200.0`.
- [ ] `test_refund_preview_50pct` — booking 2 (3 days out): expect `refund_pct=50`,
  `refund_amount=150.0`.
- [ ] `test_refund_preview_0pct_under_24h` — booking 3 (12 hours out): expect
  `refund_pct=0`, `refund_amount=0.0`.
- [ ] `test_refund_preview_0pct_already_cancelled` — booking 4 (already cancelled):
  expect `refund_pct=0`, `refund_amount=0.0`, HTTP 200 (not an error).
- [ ] `test_refund_preview_unknown_booking_is_404` — booking 999: expect HTTP 404.

**Relevant Context:**
- `tests/conftest.py` — `client` fixture with pinned `NOW`; `conn` fixture for
  direct service calls.
- `tests/test_bookings.py` — follow the existing assertion style.
- `app/db.py:seed()` — seeded flight prices: flight 1 = 1200.0, flight 2 = 300.0,
  flight 3 = 2500.0, flight 4 = 280.0.

**Status:** [ ] pending
