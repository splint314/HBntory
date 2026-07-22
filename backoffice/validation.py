"""
Stock operation validation rules.

WHERE TO PLACE VALIDATION? (answer to exercise 4)

We use TWO complementary layers:

1. The database (in models.py): CHECK, FK and UNIQUE constraints.
   -> The ultimate guardrail. Even with a bug, the database refuses a negative
      quantity or a non-existent branch.

2. The application layer (this file): business validations checked BEFORE
   writing to the database.
   -> This is where everything the database CANNOT check on its own goes.
      Key example: "does the sku exist in the Product API?" requires an
      external HTTP call, impossible with a SQL constraint. So it must live
      in the application code.

Decision rule: the database guarantees the integrity of local data; the
application guarantees business rules and anything depending on external
services.
"""

from product_client import get_product


def validate_positive_int(quantity) -> None:
    """
    Rule: a stock change requires a strictly positive integer.
    Raises ValueError if the quantity is invalid.

    Note: in Python, bool is a subtype of int (True == 1). We explicitly reject
    booleans to avoid accepting True as a quantity.
    """
    if isinstance(quantity, bool) or not isinstance(quantity, int):
        raise ValueError("Quantity must be an integer.")
    if quantity <= 0:
        raise ValueError("Quantity must be strictly positive.")


def product_exists(sku: str) -> bool:
    """
    Check that a sku exists in the external Product API.

    Robustness (required by the API contract): if the API is slow or
    unavailable, we don't crash and we don't assume the product exists.
    product_client.get_product() already returns None for a 404, a
    timeout, or any unreachable/unexpected response, so "doesn't exist"
    and "couldn't check" are both treated as reject.
    """
    return get_product(sku) is not None
