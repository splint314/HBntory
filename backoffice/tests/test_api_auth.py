"""
Authentication/authorization API scenarios (Task 7.2): admin creates a
user, soft-delete, a deleted user cannot log in, and role boundaries.
"""

from conftest import login


def test_login_valid_credentials(client, seed):
    resp = login(client, "alice", "AlicePass123!")
    assert resp.status_code == 200
    assert resp.get_json()["username"] == "alice"


def test_login_invalid_password(client, seed):
    resp = login(client, "alice", "wrong-password")
    assert resp.status_code == 401


def test_admin_can_create_common_user(client, seed):
    login(client, "admin", "AdminPass123!")
    resp = client.post(
        "/api/users",
        json={
            "username": "bob",
            "password": "BobPassword1!",
            "branch_id": seed["paris_id"],
        },
    )
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["username"] == "bob"
    assert body["role"] == "common"


def test_admin_can_soft_delete_user_and_deleted_user_cannot_login(client, seed):
    login(client, "admin", "AdminPass123!")
    resp = client.delete(f"/api/users/{seed['alice_id']}")
    assert resp.status_code == 200
    assert resp.get_json()["is_active"] is False

    client.post("/api/logout")
    login_resp = login(client, "alice", "AlicePass123!")
    assert login_resp.status_code == 401


def test_common_user_cannot_access_admin_routes(client, seed):
    login(client, "alice", "AlicePass123!")
    resp = client.get("/api/users")
    assert resp.status_code == 403


def test_anonymous_user_cannot_access_protected_routes(client, seed):
    resp = client.get("/api/stock")
    assert resp.status_code == 401
