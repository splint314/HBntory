"""
User management operations, reserved for the admin.

Mirrors stock_service.py: these functions are the only recommended entry
point for touching the users table, so every business rule (soft-delete
instead of DELETE, a common user always has a branch, the admin is never
assigned stock duties) is enforced in one place.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Branch, User
from security import hash_password, validate_password_strength


def _validate_branch_id(branch_id) -> int:
    """
    Reject anything that isn't a plain int before it reaches the database.

    Without this, session.get(Branch, None) silently returns None instead
    of raising, which would surface as a confusing "Branch None does not
    exist" instead of a clear input error.
    """
    if isinstance(branch_id, bool) or not isinstance(branch_id, int):
        raise ValueError("branch_id must be an integer.")
    return branch_id


def _get_branch_or_raise(session: Session, branch_id: int) -> Branch:
    _validate_branch_id(branch_id)
    branch = session.get(Branch, branch_id)
    if branch is None:
        raise ValueError(f"Branch {branch_id} does not exist.")
    return branch


def _get_user_or_raise(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id} does not exist.")
    return user


def list_users(session: Session) -> list[User]:
    """List every user, including soft-deleted ones (admin needs full
    visibility)."""
    return list(session.scalars(select(User)))


def create_common_user(
    session: Session, username: str, password: str, branch_id: int,
) -> User:
    """
    Create a new common user assigned to a branch.

    Only common users can be created here: the subject states there is a
    single admin account and no requirement to create more.
    """
    if not isinstance(username, str) or not username:
        raise ValueError("username is required.")
    validate_password_strength(password)

    _get_branch_or_raise(session, branch_id)

    existing = session.scalars(
        select(User).where(User.username == username)
    ).first()
    if existing is not None:
        raise ValueError(f"Username {username!r} is already taken.")

    user = User(
        username=username,
        password_hash=hash_password(password),
        role="common",
        branch_id=branch_id,
        is_active=True,
    )
    session.add(user)
    session.commit()
    return user


def soft_delete_user(session: Session, user_id: int) -> User:
    """Deactivate a user without removing the row (soft-delete)."""
    user = _get_user_or_raise(session, user_id)
    user.is_active = False
    session.commit()
    return user


def update_user(
    session: Session, user_id: int, username: str | None = None,
) -> User:
    """Modify basic user fields (currently: username)."""
    user = _get_user_or_raise(session, user_id)

    if username:
        existing = session.scalars(
            select(User).where(User.username == username, User.id != user_id)
        ).first()
        if existing is not None:
            raise ValueError(f"Username {username!r} is already taken.")
        user.username = username

    session.commit()
    return user


def change_password(session: Session, user_id: int, new_password: str) -> User:
    """Change a user's password. The plain-text value never touches the
    database."""
    validate_password_strength(new_password)
    user = _get_user_or_raise(session, user_id)
    user.password_hash = hash_password(new_password)
    session.commit()
    return user


def change_branch(session: Session, user_id: int, branch_id: int) -> User:
    """
    Reassign a common user to another branch.

    Refuses to touch the admin: the admin has no branch by design
    (branch_rule_by_role constraint in models.py).
    """
    user = _get_user_or_raise(session, user_id)
    if user.role == "admin":
        raise ValueError("The admin user has no branch to change.")
    _get_branch_or_raise(session, branch_id)
    user.branch_id = branch_id
    session.commit()
    return user
