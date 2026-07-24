"""
Authentication and authorization helpers for the Backoffice REST API.

Strategy (see docs/authentication_and_authorization.md for the full
justification):
- Session-based authentication: Flask's signed-cookie session stores only
  the user id. The cookie is cryptographically signed with app.secret_key,
  so a client cannot forge or tamper with it without invalidating the
  signature.
- Authorization is enforced here, in backend decorators, never only in the
  frontend. Every protected route must be wrapped with @login_required and,
  when relevant, @admin_required or @common_required.
"""

import functools

from flask import session, jsonify, g

from database import SessionLocal
from models import User


def get_current_user() -> User | None:
    """
    Return the authenticated user for this request, or None.

    Cached on flask.g for the lifetime of the request so repeated calls
    don't re-hit the database.
    """
    if "user" in g:
        return g.user

    user_id = session.get("user_id")
    if user_id is None:
        g.user = None
        return None

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        # Reject deleted users even if their session cookie is still valid:
        # a soft-deleted account must lose access immediately.
        if user is None or not user.is_active:
            g.user = None
            return None
        db.expunge(user)  # detach: usable after the session below closes
        g.user = user
        return user
    finally:
        db.close()


def login_required(view):
    """Reject anonymous access to a route. Must succeed before role checks."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if get_current_user() is None:
            return jsonify(error="authentication required"), 401
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    """Reject any non-admin, non-authenticated caller."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user()
        if user is None:
            return jsonify(error="authentication required"), 401
        if user.role != "admin":
            return jsonify(error="admin role required"), 403
        return view(*args, **kwargs)
    return wrapped


def common_required(view):
    """Reject any non-common, non-authenticated caller (stock routes)."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user()
        if user is None:
            return jsonify(error="authentication required"), 401
        if user.role != "common":
            return jsonify(error="common user role required"), 403
        return view(*args, **kwargs)
    return wrapped