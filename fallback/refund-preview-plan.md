# Plan: refund preview on cancel

Fallen behind? Copy this file to `plans/refund-preview.md` and ask Bob
(Agent mode): "Build the feature in @/plans/refund-preview.md, then run the tests."

## Goal

Before cancelling, a traveller can ask what refund they would get.
`GET /bookings/{booking_id}/cancel-preview` returns the refund **without
changing the booking**.

```json
{
  "booking_id": 2,
  "status": "booked",
  "hours_to_departure": 72.0,
  "refund_percent": 50,
  "refund_amount": 150.0
}
```

## Rules

Let `t = departure_time - now`.

| Condition | refund_percent |
|---|---|
| booking status is `cancelled` | 0 |
| `t` > 7 days | 100 |
| 24 hours <= `t` <= 7 days | 50 |
| `t` < 24 hours (including already departed, `t` < 0) | 0 |

Boundaries: exactly 7 days is **50**, exactly 24 hours is **50**.

- `hours_to_departure` = `t` in hours, rounded to 2 decimals (negative once departed).
- `refund_amount` = `price * refund_percent / 100`, rounded to 2 decimals.
- Unknown booking id: 404 `{"detail": "Booking 999 not found"}`.

## Changes

1. **`app/schemas.py`**: add

   ```python
   class RefundPreview(BaseModel):
       booking_id: int
       status: BookingStatus
       hours_to_departure: float
       refund_percent: int
       refund_amount: float
   ```

2. **`app/services/bookings.py`**: add (follow the existing pattern: take
   `conn` and an explicit `now`, return a plain dict, raise `NotFoundError`
   via `get_booking`)

   - `refund_percent(status: str, time_to_departure: timedelta) -> int`
     implementing the table above (a pure function, easy to test).
   - `preview_refund(conn, booking_id, now) -> dict` that loads the booking
     and its flight, computes `t` with `from_iso(...) - now`, and returns the
     five fields. Read-only: no `UPDATE`, no `commit`.

3. **`app/main.py`**: add the route **above** the `FastApiMCP(...)` lines
   (routes defined after it do not become MCP tools):

   ```python
   @app.get(
       "/bookings/{booking_id}/cancel-preview",
       response_model=RefundPreview,
       responses=NOT_FOUND,
       tags=["Bookings"],
       operation_id="preview_refund",
   )
   def preview_refund(
       booking_id: int,
       conn: sqlite3.Connection = Depends(db.get_conn),
       now: datetime = Depends(get_now),
   ):
       """Preview the refund for cancelling a booking now. Does not cancel it."""
       return bookings.preview_refund(conn, booking_id, now)
   ```

4. **`tests/test_refund_preview.py`**: the fixtures in `tests/conftest.py`
   pin the clock to `NOW` (2030-01-01 12:00 UTC), so against seed data:

   | Test | Expect |
   |---|---|
   | booking 1 (departs NOW + 10 days, price 1200) | 100%, 1200.0, 240.0 hours |
   | booking 2 (NOW + 3 days, price 300) | 50%, 150.0, 72.0 hours |
   | booking 3 (NOW + 12 hours, price 2500) | 0%, 0.0, 12.0 hours |
   | booking 4 (cancelled) | 0%, 0.0, status `cancelled` |
   | booking 999 | 404 |
   | preview does not cancel | booking 1 still `booked` afterwards |

   Boundary tests call `bookings.preview_refund(conn, 1, now=...)` with `now`
   chosen relative to flight 1's departure (`NOW + 10 days`):

   | `t` | Expect |
   |---|---|
   | 7 days + 1 second | 100 |
   | exactly 7 days | 50 |
   | exactly 24 hours | 50 |
   | 24 hours - 1 second | 0 |
   | -1 hour (departed) | 0, `hours_to_departure` = -1.0 |

## Done means

- `pytest -q` is green (the 11 existing tests plus the new ones).
- With the server running, `GET /bookings/2/cancel-preview` returns 50%.
- `/docs` lists the new endpoint, and the MCP tool list includes `preview_refund`.
- The commit goes through the `gate_commit` hook.
