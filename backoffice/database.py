"""
Database connection setup.

Creates the three objects used everywhere else:
- engine: the actual connection to the database.
- SessionLocal: a session factory. A session is a conversation with the
  database (add, read, commit).
- Base: the parent class all models inherit from (see models.py).
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# SQLite = a single local file, no server to install. Great for development.
# To switch to PostgreSQL later, just change this URL
# (e.g. "postgresql://user:pass@localhost/hbntory").
# Read from an environment variable so it can change without editing the code.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///hbntory.db")

# echo=False: don't print every SQL query. Set to True to see what SQLAlchemy
# actually generates (useful for learning).
engine = create_engine(DATABASE_URL, echo=False)

# SQLite only enforces FOREIGN KEY and CHECK constraints if we turn them on at
# every connection. Without this, the database guardrails are silently ignored.
# (Not needed for PostgreSQL, and harmless there.)
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_conn, _connection_record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    """All tables inherit from this class."""
    pass
