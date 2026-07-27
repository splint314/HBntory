"""
HBntory database models: Branch, User, Stock.

Data boundary reminder: we NEVER store a product's name, price or description.
The Stock table only keeps the `product_sku` (e.g. "HB-LAP-1001") as a link to
the external Product API.
"""

from datetime import datetime
from sqlalchemy import (
    String, Integer, Boolean, DateTime,
    ForeignKey, UniqueConstraint, CheckConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Branch(Base):
    """A branch = a physical store of the company."""
    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)

    # Timestamps: filled automatically by the database.
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    # Relationships: the Python convenience layer. They let us write
    # branch.users (the branch's users) or branch.stock_items
    # (the branch's stock rows) without writing the query by hand.
    users: Mapped[list["User"]] = relationship(back_populates="branch")
    stock_items: Mapped[list["Stock"]] = relationship(back_populates="branch")

    def __repr__(self) -> str:
        return f"<Branch id={self.id} name={self.name!r}>"


class User(Base):
    """
    A backoffice user.

    Two possible roles:
    - 'admin': manages users, has NO branch, does not manage stock.
    - 'common': belongs to exactly ONE branch, manages that branch's stock.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False
    )

    # Only the hash is stored, never the plain-text password.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="common"
    )

    # nullable=True because the admin has no branch.
    # The rule "a common user always has a branch" is enforced by the CHECK
    # below, and re-checked in the application layer.
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id"), nullable=True
    )

    # Soft-delete: we never physically remove a row.
    # A "deleted" user simply has is_active = False.
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    branch: Mapped["Branch | None"] = relationship(back_populates="users")

    __table_args__ = (
        # Role can only be 'admin' or 'common'.
        CheckConstraint("role IN ('admin', 'common')", name="valid_role"),
        # Key guardrail: an admin has no branch, a common user must have one.
        CheckConstraint(
            "(role = 'admin' AND branch_id IS NULL) "
            "OR (role = 'common' AND branch_id IS NOT NULL)",
            name="branch_rule_by_role",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<User id={self.id} username={self.username!r} "
            f"role={self.role}>"
        )


class Stock(Base):
    """
    The stock of a product in a branch.

    Identified by the pair (branch_id, product_sku). There cannot be two rows
    for the same product in the same branch (UNIQUE constraint).
    """
    __tablename__ = "stock"

    id: Mapped[int] = mapped_column(primary_key=True)
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False
    )

    # External product identifier (the API's sku). NO other product data is
    # stored here.
    product_sku: Mapped[str] = mapped_column(String(50), nullable=False)

    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    branch: Mapped["Branch"] = relationship(back_populates="stock_items")

    __table_args__ = (
        # Only one stock row per product and per branch.
        UniqueConstraint("branch_id", "product_sku", name="uq_branch_product"),
        # Stock can never go negative, even if the application has a bug.
        CheckConstraint("quantity >= 0", name="quantity_non_negative"),
    )

    def __repr__(self) -> str:
        return (
            f"<Stock branch_id={self.branch_id} "
            f"sku={self.product_sku!r} qty={self.quantity}>"
        )
