"""
Read-only access to the Backoffice's stock data, for the MCP stock tools.

Per docs/architecture_and_planning.md §1.6/3.1, the agent reads stock
quantities "through controlled stock tools exposed by the MCP server"
(extension of the Product MCP server, not a separate service). This module
opens the Backoffice's SQLite file in read-only mode (`mode=ro`) — it can
never write, and a missing/locked file surfaces as StockAPIError rather
than crashing silently.

Only branches, users' branch assignment, and stock rows exist here; this
module never touches product metadata (that stays in product_client.py /
the external Product API).
"""

import os
import sqlite3
from contextlib import contextmanager

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///../backoffice/hbntory.db")


class StockAPIError(Exception):
    """The Backoffice database could not be read."""


class BranchNotFoundError(Exception):
    """No branch with the given name exists."""


def _db_path() -> str:
    if not DATABASE_URL.startswith("sqlite:///"):
        raise StockAPIError(
            f"Unsupported DATABASE_URL for stock tools: {DATABASE_URL!r} "
            "(only sqlite:/// is supported)."
        )
    return DATABASE_URL[len("sqlite:///"):]


@contextmanager
def _connection():
    path = _db_path()
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        raise StockAPIError(
            f"Could not open the Backoffice database at {path!r}: {e}"
        ) from e
    try:
        yield conn
    except sqlite3.Error as e:
        raise StockAPIError(f"Backoffice database read failed: {e}") from e
    finally:
        conn.close()


def list_branches() -> list[str]:
    """All branch names, sorted."""
    with _connection() as conn:
        rows = conn.execute("SELECT name FROM branches ORDER BY name").fetchall()
        return [name for (name,) in rows]


def get_stock_by_branch(branch_name: str) -> list[dict]:
    """
    Stock of every product held in one branch (quantity > 0), as a list of
    {"product_sku": str, "quantity": int}.

    Raises BranchNotFoundError if no branch has this exact name.
    """
    with _connection() as conn:
        row = conn.execute(
            "SELECT id FROM branches WHERE name = ?", (branch_name,)
        ).fetchone()
        if row is None:
            raise BranchNotFoundError(f"No branch named {branch_name!r}.")
        branch_id = row[0]

        rows = conn.execute(
            "SELECT product_sku, quantity FROM stock "
            "WHERE branch_id = ? AND quantity > 0 ORDER BY product_sku",
            (branch_id,),
        ).fetchall()
        return [{"product_sku": sku, "quantity": qty} for sku, qty in rows]


def get_branches_with_product(product_sku: str) -> list[dict]:
    """
    Every branch that currently holds stock (quantity > 0) of one product,
    as a list of {"branch_name": str, "quantity": int}.
    """
    with _connection() as conn:
        rows = conn.execute(
            """
            SELECT b.name, s.quantity
            FROM stock s
            JOIN branches b ON b.id = s.branch_id
            WHERE s.product_sku = ? AND s.quantity > 0
            ORDER BY b.name
            """,
            (product_sku,),
        ).fetchall()
        return [{"branch_name": name, "quantity": qty} for name, qty in rows]
