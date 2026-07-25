"""
API-level stock scenarios (Task 7.2): valid add/remove, over-removal
rejected, a common user can only ever act on their own branch, and an
admin cannot touch stock at all.
"""

from conftest import login


def test_common_user_adds_valid_stock(client, seed):
    login(client, "alice", "AlicePass123!")
    resp = client.post(
        "/api/stock/add", json={"product_sku": "HB-LAP-1001", "quantity": 5}
    )
    assert resp.status_code == 200
    assert resp.get_json()["quantity"] == 5


def test_common_user_removes_valid_stock(client, seed):
    login(client, "alice", "AlicePass123!")
    client.post(
        "/api/stock/add", json={"product_sku": "HB-LAP-1001", "quantity": 10}
    )
    resp = client.post(
        "/api/stock/remove", json={"product_sku": "HB-LAP-1001", "quantity": 4}
    )
    assert resp.status_code == 200
    assert resp.get_json()["quantity"] == 6


def test_common_user_cannot_remove_more_than_available(client, seed):
    login(client, "alice", "AlicePass123!")
    client.post(
        "/api/stock/add", json={"product_sku": "HB-LAP-1001", "quantity": 5}
    )
    resp = client.post(
        "/api/stock/remove", json={"product_sku": "HB-LAP-1001", "quantity": 6}
    )
    assert resp.status_code == 400
    assert "Insufficient stock" in resp.get_json()["error"]


def test_stock_routes_never_accept_branch_id_from_the_client(client, seed):
    """
    A common user can only ever act on their own branch: the stock routes
    always use the branch of the currently authenticated user and never
    read a branch_id from the request body, so a common user cannot
    operate on another branch even by trying to smuggle one in.
    """
    login(client, "alice", "AlicePass123!")
    resp = client.post(
        "/api/stock/add",
        json={
            "product_sku": "HB-LAP-1001",
            "quantity": 5,
            "branch_id": seed["paris_id"],
        },
    )
    assert resp.status_code == 200

    # Confirm it landed in Alice's own branch (Lyon), not Paris.
    stock_resp = client.get("/api/stock/HB-LAP-1001")
    assert stock_resp.get_json()["branch_id"] == seed["lyon_id"]


def test_admin_cannot_manage_stock(client, seed):
    login(client, "admin", "AdminPass123!")
    resp = client.post(
        "/api/stock/add", json={"product_sku": "HB-LAP-1001", "quantity": 5}
    )
    assert resp.status_code == 403
