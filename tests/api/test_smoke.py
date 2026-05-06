"""Smoke tests — vérifient que l'API démarre et que l'auth Bearer fonctionne."""

from __future__ import annotations


def test_unauthenticated_request_is_rejected(api_client) -> None:
    """Sans header Authorization, l'API doit renvoyer 401."""
    response = api_client.get("/users")
    assert response.status_code == 401


def test_request_with_wrong_token_is_rejected(api_client) -> None:
    """Avec un Bearer invalide, l'API doit renvoyer 401."""
    response = api_client.get(
        "/users",
        headers={"Authorization": "Bearer not-the-real-token"},
    )
    assert response.status_code == 401


def test_authenticated_users_listing_is_empty_by_default(api_client, auth_headers) -> None:
    """Sur une DB vide, GET /users renvoie une liste vide."""
    response = api_client.get("/users", headers=auth_headers)
    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {"users": []}
