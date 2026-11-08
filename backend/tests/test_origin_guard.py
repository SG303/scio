"""Reject foreign form writes while keeping LAN and development access."""

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize("origin", ["https://evil.invalid", "null"])
def test_foreign_forms_are_blocked_before_handlers(origin):
    from app.main import app

    response = TestClient(app).post(
        "/api/providers/claude/logout", headers={"Origin": origin}, data={}
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    "base_url", ["http://192.168.1.3:8001", "http://scio.tailnet:8001", "https://scio.example"]
)
def test_same_origin_network_access_is_allowed(base_url):
    from app.main import app

    client = TestClient(app, base_url=base_url)
    response = client.post("/api/does-not-exist", headers={"Origin": base_url})
    assert response.status_code == 404


def test_cli_and_explicit_dev_origins_still_work():
    from app.main import app

    client = TestClient(app)
    assert client.post("/api/does-not-exist").status_code == 404
    assert (
        client.post("/api/does-not-exist", headers={"Origin": "http://localhost:3000"}).status_code
        == 404
    )
    assert (
        client.post("/api/does-not-exist", headers={"Sec-Fetch-Site": "cross-site"}).status_code
        == 403
    )
    assert client.get("/api/health", headers={"Origin": "https://evil.invalid"}).status_code == 200


def test_cors_wildcard_does_not_enable_foreign_writes(monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "cors_origins", ["*"])
    assert (
        TestClient(main.app)
        .post("/api/does-not-exist", headers={"Origin": "https://evil.invalid"})
        .status_code
        == 403
    )
