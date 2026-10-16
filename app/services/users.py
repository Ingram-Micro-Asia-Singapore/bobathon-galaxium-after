"""User queries."""

import sqlite3

from app.services import NotFoundError


def get_user(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"User {user_id} not found")
    return dict(row)
