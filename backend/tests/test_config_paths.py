"""Local defaults must not override environment or dotenv paths."""

import pytest


@pytest.mark.parametrize("docker", [False, True])
@pytest.mark.parametrize("source", ["env", "dotenv", "default"])
def test_configured_paths_override_local_defaults(tmp_path, monkeypatch, docker, source):
    from app.config import get_settings
    import app.config as config

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.delenv("UPLOADS_PATH", raising=False)
    original_exists = config.os.path.exists
    monkeypatch.setattr(
        config.os.path,
        "exists",
        lambda path: docker if path == "/app/data" else original_exists(path),
    )
    if source == "env":
        monkeypatch.setenv("DATABASE_PATH", "/tmp/selected.db")
        monkeypatch.setenv("UPLOADS_PATH", "/tmp/selected-uploads")
    elif source == "dotenv":
        (tmp_path / ".env").write_text(
            "DATABASE_PATH=/tmp/selected.db\nUPLOADS_PATH=/tmp/selected-uploads\n"
        )
    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.database_path == (
            "/tmp/selected.db"
            if source != "default"
            else "/app/data/scio.db"
            if docker
            else "./data/scio.db"
        )
        assert settings.uploads_path == (
            "/tmp/selected-uploads"
            if source != "default"
            else "/app/uploads"
            if docker
            else "./uploads"
        )
    finally:
        get_settings.cache_clear()
