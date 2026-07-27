"""
Password hashing with Argon2id.

We never store a plain-text password, only its hash. On login, we verify
the submitted password against the stored hash without ever being able to
"unhash".
"""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

# PasswordHasher applies Argon2id with safe defaults (memory cost, time cost,
# and a salt generated automatically for each hash).
_ph = PasswordHasher()

MIN_PASSWORD_LENGTH = 8


def validate_password_strength(plain_password: str) -> None:
    """
    Minimal password policy, checked before hashing.

    Argon2id protects against fast offline cracking, but it cannot
    compensate for a trivially short password like "a". Raises ValueError
    if the password does not meet the minimum requirement.
    """
    too_short = (
        not isinstance(plain_password, str)
        or len(plain_password) < MIN_PASSWORD_LENGTH
    )
    if too_short:
        raise ValueError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} "
            "characters long."
        )


def hash_password(plain_password: str) -> str:
    """Return the Argon2id hash of a plain-text password."""
    return _ph.hash(plain_password)


def verify_password(stored_hash: str, plain_password: str) -> bool:
    """Check that a password matches the stored hash."""
    try:
        return _ph.verify(stored_hash, plain_password)
    except (VerifyMismatchError, InvalidHashError):
        return False
