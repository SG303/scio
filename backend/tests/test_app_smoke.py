"""Smoke test: the FastAPI app must import cleanly.

The module-level import of app.main builds the router wiring; name clashes
there (e.g. a router shadowed by the settings object) only surface at
startup. Importing the module catches them in CI.
"""


def test_app_module_imports():
    import app.main  # noqa: F401

    assert app.main.app.title
