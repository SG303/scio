from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
import os


class Settings(BaseSettings):
    app_name: str = "Scio"
    debug: bool = False
    
    # OpenRouter
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # P5.3c: sent as HTTP-Referer to OpenRouter instead of a hardcoded URL
    http_referer: str = "http://localhost:8000"
    # Lightweight model used for question verification. This is only the
    # fallback: the active model is stored in the settings table and can be
    # changed in the app's settings UI (GET/PUT /api/settings).
    verification_model: str = "anthropic/claude-haiku-5.5"

    # Claude subscription: HOME directory for the Claude Code CLI (binary,
    # login and updates live below it). Empty = use the current user's HOME
    # and the `claude` found on PATH (local development).
    claude_cli_home: str = ""

    # CORS - comma-separated list of allowed origins
    # Use "*" for allow all (development), or specific origins for production
    allowed_origins: str = "http://localhost:3000,http://localhost:5173,http://localhost:8000"
    
    # Paths
    database_path: str = Field(default_factory=lambda: "/app/data/scio.db" if os.path.exists("/app/data") else "./data/scio.db")
    uploads_path: str = Field(default_factory=lambda: "/app/uploads" if os.path.exists("/app/data") else "./uploads")
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
