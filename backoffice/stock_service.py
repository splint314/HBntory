"""
Stock business operations.

These functions are the ONLY recommended entry point for modifying stock: they
apply every validation rule before writing to the database. The backoffice
(later) will call these functions instead of manipulating Stock objects
directly.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Branch, Stock
from validation import validate_positive_int, product_exists


def _get_branch_or_raise(session: Session, branch_id: int) -> Branch:
    """Check that the branch exists (rule: operate on a valid branch)."""
    branch = session.get(Branch, branch_id)
    if branch is None:
        raise ValueError(f"Branch {branch_id} does not exist.")
    return branch


def add_stock(
    session: Session, branch_id: int, product_sku: str, quantity: int,
    check_product_api: bool = True,
) -> Stock:
    """
    Add a quantity to a product's stock in a branch.
    Creates the stock row if it does not exist yet.

    check_product_api: set to False for offline tests only.
    """
    validate_positive_int(quantity)
    _get_branch_or_raise(session, branch_id)

    if check_product_api and not product_exists(product_sku):
        raise ValueError(
            f"Product {product_sku!r} does not exist in the Product API."
        )

    # Look for an existing row for this (branch, product) pair.
    stmt = select(Stock).where(
        Stock.branch_id == branch_id, Stock.product_sku == product_sku
    )
    stock = session.scalars(stmt).first()

    if stock is None:
        stock = Stock(
            branch_id=branch_id, product_sku=product_sku, quantity=quantity
        )
        session.add(stock)
    else:
        stock.quantity += quantity

    session.commit()
    return stock


def remove_stock(
    session: Session, branch_id: int, product_sku: str, quantity: int,
) -> Stock:
    """
    Remove a quantity from stock. Refuses if the result would be negative.
    """
    validate_positive_int(quantity)
    _get_branch_or_raise(session, branch_id)

    stmt = select(Stock).where(
        Stock.branch_id == branch_id, Stock.product_sku == product_sku
    )
    stock = session.scalars(stmt).first()

    if stock is None:
        raise ValueError(
            f"No stock of {product_sku!r} in branch {branch_id}."
        )

    if stock.quantity - quantity < 0:
        raise ValueError(
            f"Insufficient stock: {stock.quantity} available, "
            f"{quantity} requested."
        )

    stock.quantity -= quantity
    session.commit()
    return stock
