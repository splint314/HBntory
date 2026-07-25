"""
Shared pytest fixtures for the Backoffice test suite.

The app's modules (database.py, models.py, ...) build their SQLAlchemy
engine/session once, at import time, from the DATABASE_URL environment
variable. To get a fresh, isolated SQLite file per test, we set the env
var *then* force a re-import of every backoffice module before each test.
"""

import sys
import pathlib

import pytest

BACKOFFICE_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKOFFICE_DIR))

BACKOFFICE_MODULES = [
    "database", "models", "auth", "security", "validation",
    "stock_service", "user_service", "product_client", "app",
]


@pytest.fixture()
def app_ctx(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")

    for name in BACKOFFICE_MODULES:
        sys.modules.pop(name, None)

    import database
    import models  # noqa: F401 — registers tables on database.Base.metadata
    database.Base.metadata.create_all(database.engine)

    import stock_service
    # Never hit the real Product API in tests: every SKU is treated as valid.
    monkeypatch.setattr(stock_service, "product_exists", lambda sku: True)

    import app as app_module
    app_module.app.config.update(TESTING=True)

    return app_module, database


@pytest.fixture()
def db_session(app_ctx):
    _, database = app_ctx
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(app_ctx):
    app_module, _ = app_ctx
    return app_module.app.test_client()


@pytest.fixture()
def seed(db_session):
    """Two branches (Lyon, Paris), one admin, one common user in Lyon."""
    from models import Branch, User
    from security import hash_password

    lyon = Branch(name="Lyon")
    paris = Branch(name="Paris")
    db_session.add_all([lyon, paris])
    db_session.commit()

    admin = User(
        username="admin",
        password_hash=hash_password("AdminPass123!"),
        role="admin",
        branch_id=None,
    )
    alice = User(
        username="alice",
        password_hash=hash_password("AlicePass123!"),
        role="common",
        branch_id=lyon.id,
    )
    db_session.add_all([admin, alice])
    db_session.commit()

    return {
        "lyon_id": lyon.id,
        "paris_id": paris.id,
        "admin_id": admin.id,
        "alice_id": alice.id,
    }


def login(client, username, password):
    return client.post(
        "/api/login", json={"username": username, "password": password}
    )
