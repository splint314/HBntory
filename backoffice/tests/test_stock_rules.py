"""
Unit tests for stock_service.py's validation rules (Task 7.2 scenarios:
add/remove valid stock, cannot remove more than available).
"""

import pytest


def test_add_stock_creates_row(db_session, seed):
    from stock_service import add_stock

    stock = add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 5)
    assert stock.quantity == 5


def test_add_stock_accumulates(db_session, seed):
    from stock_service import add_stock

    add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 5)
    stock = add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 3)
    assert stock.quantity == 8


def test_remove_stock_valid_amount(db_session, seed):
    from stock_service import add_stock, remove_stock

    add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 10)
    stock = remove_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 4)
    assert stock.quantity == 6


def test_remove_more_than_available_is_rejected(db_session, seed):
    from stock_service import add_stock, remove_stock

    add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 5)
    with pytest.raises(ValueError, match="Insufficient stock"):
        remove_stock(db_session, seed["lyon_id"], "HB-LAP-1001", 6)


@pytest.mark.parametrize("bad_quantity", [-3, 0, 2.5, True])
def test_non_positive_int_quantity_is_rejected(db_session, seed, bad_quantity):
    from stock_service import add_stock

    with pytest.raises(ValueError):
        add_stock(db_session, seed["lyon_id"], "HB-LAP-1001", bad_quantity)


def test_unknown_branch_is_rejected(db_session, seed):
    from stock_service import add_stock

    with pytest.raises(ValueError, match="does not exist"):
        add_stock(db_session, 99999, "HB-LAP-1001", 5)
