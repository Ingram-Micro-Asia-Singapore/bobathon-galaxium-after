# Stretch goal: filter flights

Finished the refund preview? Add optional query filters to `GET /flights`.

## What to build

`GET /flights` accepts any combination of:

| Query param | Type | Meaning |
|---|---|---|
| `origin` | string | Exact match, case-insensitive (`earth` matches `Earth`) |
| `destination` | string | Exact match, case-insensitive |
| `max_price` | number | Only flights with `price <= max_price` |

No parameters means the current behaviour: every flight, soonest first.

Examples against the seed data:

- `/flights?origin=Earth` returns flights 2, 1 and 5 (in that order: soonest first)
- `/flights?destination=earth&max_price=500` returns flight 4 only
- `/flights?max_price=-1` returns `[]` (an empty list, not an error)

## Done means

- Filters are applied in SQL (parameterised `?` placeholders, never string
  formatting) inside `app/services/flights.py`.
- The route keeps `operation_id="list_flights"`, so the MCP tool gains the new
  parameters automatically. Check: Bob can answer "which flights leave Earth
  for under 1000?" using the MCP tool.
- New tests cover each filter, a combination, and the empty result.
- `pytest -q` is green and the commit hook lets you commit.

Suggested Bob flow: Plan mode to write `plans/flight-filters.md`, Agent mode to
implement it, then switch to the Reviewer mode for a review.
