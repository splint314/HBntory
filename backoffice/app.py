"""
Backoffice REST API (Flask), plus the static HTML/CSS/JS frontend that
consumes it (backoffice/static/).

Routes are grouped in four families:
- /api/login, /api/logout, /api/me       -> authentication (anyone)
- /api/users*, /api/branches              -> admin only (user management)
- /api/stock*                             -> common users only (their branch)
- /api/products*                          -> any authenticated user
                                              (read-only proxy to the
                                              external Product API, no
                                              local storage of product data)

Authorization is enforced with the @admin_required / @common_required
decorators from auth.py, on the backend, regardless of what the frontend
shows or hides.
"""

import os

from flask import Flask, request, jsonify, session

from database import SessionLocal
from models import Branch, Stock, User
from security import verify_password
from auth import (
    login_required, admin_required, common_required, get_current_user,
)
from stock_service import add_stock, remove_stock
from product_client import get_product, list_products
import user_service

app = Flask(__name__)
# In production this MUST come from the environment; a random fallback means
# every restart invalidates existing sessions, which is acceptable for dev.
app.secret_key = os.getenv("SECRET_KEY", os.urandom(32))
# Explicit, defense-in-depth session cookie flags: HttpOnly blocks any
# access to the cookie from JavaScript (mitigates session theft via XSS),
# SameSite="Lax" stops the cookie from being sent on cross-site requests
# (mitigates CSRF). SSL/TLS is out of scope for this project (subject
# requirement), so Secure=True is not set here.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

# client_web's catalog is gated behind a real Backoffice login (see
# client_web/app.js): it calls /api/login and /api/me cross-origin, with
# the session cookie, so it can tell whether the visitor actually holds a
# Backoffice account. 127.0.0.1 and localhost on any port are "same-site"
# (site = scheme + registrable domain, port doesn't count), so the
# SameSite="Lax" cookie above is still sent on these requests — this only
# needs CORS to allow the browser to read the response. Scoped to the three
# auth routes only: the rest of the API (stock, users) is never meant to be
# called cross-origin, even by a legitimate client_web session.
_CORS_ORIGINS = {
    o.strip() for o in os.getenv(
        "CLIENT_WEB_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
    ).split(",") if o.strip()
}
_CORS_PATHS = {"/api/login", "/api/logout", "/api/me"}


@app.after_request
def _add_cors_headers(response):
    origin = request.headers.get("Origin")
    if request.path in _CORS_PATHS and origin in _CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Vary"] = "Origin"
    return response


def _user_json(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "branch_id": user.branch_id,
        "is_active": user.is_active,
    }


def _stock_json(stock: Stock) -> dict:
    return {
        "branch_id": stock.branch_id,
        "product_sku": stock.product_sku,
        "quantity": stock.quantity,
    }


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify(error="username and password are required"), 400

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(username=username).first()
        # Same generic error whether the user is unknown, deleted, or the
        # password is wrong: don't reveal which one to an attacker.
        if user is None or not user.is_active:
            return jsonify(error="invalid credentials"), 401
        if not verify_password(user.password_hash, password):
            return jsonify(error="invalid credentials"), 401

        session.clear()
        session["user_id"] = user.id
        return jsonify(_user_json(user))
    finally:
        db.close()


@app.post("/api/logout")
def logout():
    session.clear()
    return "", 204


@app.get("/api/me")
@login_required
def me():
    current = get_current_user()
    payload = _user_json(current)
    # The frontend needs the branch NAME (not just its id) to make it
    # unambiguous which branch a common user is operating on.
    payload["branch_name"] = None
    if current.branch_id is not None:
        db = SessionLocal()
        try:
            branch = db.get(Branch, current.branch_id)
            payload["branch_name"] = branch.name if branch else None
        finally:
            db.close()
    return jsonify(payload)


# ---------------------------------------------------------------------------
# Admin: user management (admin cannot manage stock)
# ---------------------------------------------------------------------------

@app.get("/api/branches")
@admin_required
def list_branches():
    db = SessionLocal()
    try:
        branches = db.query(Branch).all()
        return jsonify([{"id": b.id, "name": b.name} for b in branches])
    finally:
        db.close()


@app.get("/api/users")
@admin_required
def list_users():
    db = SessionLocal()
    try:
        users = user_service.list_users(db)
        return jsonify([_user_json(u) for u in users])
    finally:
        db.close()


@app.post("/api/users")
@admin_required
def create_user():
    data = request.get_json(silent=True) or {}
    db = SessionLocal()
    try:
        user = user_service.create_common_user(
            db,
            username=data.get("username"),
            password=data.get("password"),
            branch_id=data.get("branch_id"),
        )
        return jsonify(_user_json(user)), 201
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


@app.patch("/api/users/<int:user_id>")
@admin_required
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    db = SessionLocal()
    try:
        user = user_service.update_user(
            db, user_id, username=data.get("username")
        )
        return jsonify(_user_json(user))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


@app.delete("/api/users/<int:user_id>")
@admin_required
def delete_user(user_id):
    db = SessionLocal()
    try:
        user = user_service.soft_delete_user(db, user_id)
        return jsonify(_user_json(user))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


@app.patch("/api/users/<int:user_id>/password")
@admin_required
def change_user_password(user_id):
    data = request.get_json(silent=True) or {}
    db = SessionLocal()
    try:
        user = user_service.change_password(db, user_id, data.get("password"))
        return jsonify(_user_json(user))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


@app.patch("/api/users/<int:user_id>/branch")
@admin_required
def change_user_branch(user_id):
    data = request.get_json(silent=True) or {}
    db = SessionLocal()
    try:
        user = user_service.change_branch(db, user_id, data.get("branch_id"))
        return jsonify(_user_json(user))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Common users: stock management, scoped to their own branch only
# ---------------------------------------------------------------------------

@app.get("/api/stock")
@common_required
def list_stock():
    """List products currently in stock for the caller's own branch."""
    current = get_current_user()
    db = SessionLocal()
    try:
        items = db.query(Stock).filter_by(branch_id=current.branch_id).all()
        return jsonify([_stock_json(s) for s in items])
    finally:
        db.close()


@app.get("/api/stock/<string:product_sku>")
@common_required
def get_stock(product_sku):
    """Consult the stock of one product in the caller's own branch."""
    current = get_current_user()
    db = SessionLocal()
    try:
        item = db.query(Stock).filter_by(
            branch_id=current.branch_id, product_sku=product_sku
        ).first()
        quantity = item.quantity if item else 0
        return jsonify(
            branch_id=current.branch_id,
            product_sku=product_sku,
            quantity=quantity,
        )
    finally:
        db.close()


@app.post("/api/stock/add")
@common_required
def stock_add():
    current = get_current_user()
    data = request.get_json(silent=True) or {}
    product_sku = data.get("product_sku")
    if not isinstance(product_sku, str) or not product_sku:
        return jsonify(error="product_sku is required"), 400

    db = SessionLocal()
    try:
        # branch_id is never taken from the request body: a common user can
        # only ever act on their own assigned branch, enforced server-side.
        stock = add_stock(
            db, current.branch_id, product_sku, data.get("quantity")
        )
        return jsonify(_stock_json(stock))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


@app.post("/api/stock/remove")
@common_required
def stock_remove():
    current = get_current_user()
    data = request.get_json(silent=True) or {}
    product_sku = data.get("product_sku")
    if not isinstance(product_sku, str) or not product_sku:
        return jsonify(error="product_sku is required"), 400

    db = SessionLocal()
    try:
        stock = remove_stock(
            db, current.branch_id, product_sku, data.get("quantity")
        )
        return jsonify(_stock_json(stock))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Product catalog: read-only proxy to the external Product API.
#
# Nothing here is ever written to our database: every response is fetched
# live from the Product API so the Backoffice never duplicates product
# names, descriptions or prices locally (see docs/database_design.md).
# ---------------------------------------------------------------------------

@app.get("/api/products")
@login_required
def products_list():
    q = request.args.get("q")
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        limit = 50
    return jsonify(list_products(q=q, limit=limit))


@app.get("/api/products/<string:sku>")
@login_required
def product_detail(sku):
    product = get_product(sku)
    if product is None:
        return jsonify(error=f"Product {sku!r} not found"), 404
    return jsonify(product)


# ---------------------------------------------------------------------------
# Frontend: a single static page (backoffice/static/) that talks to the
# REST API above via fetch(). Flask serves /static/<file> automatically;
# this route only covers the root document.
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
