"""Smoke test: the FastAPI app must import cleanly.

The module-level import of app.main builds the router wiring; name clashes
there (e.g. a router shadowed by the settings object) only surface at
startup. Importing the module catches them in CI.
"""


def test_app_module_imports():
    import app.main  # noqa: F401

    assert app.main.app.title


def test_unknown_api_path_returns_404():
    """Regression: unknown /api/* paths must return a real 404 (JSON
    detail body) instead of the SPA catch-all's HTTP 200."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_unknown_api_path_post_returns_404():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    response = client.post("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_health_endpoint_still_available():
    """The /api/* fallback must not shadow real API routes registered
    before it."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
