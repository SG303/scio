from pydantic_settings import BaseSettings
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
    # P5.3c: lightweight model used for question verification
    verification_model: str = "google/gemini-2.5-flash-lite"
    
    # CORS - comma-separated list of allowed origins
    # Use "*" for allow all (development), or specific origins for production
    allowed_origins: str = "http://localhost:3000,http://localhost:5173,http://localhost:8000"
    
    # Paths
    database_path: str = "/app/data/scio.db"
    uploads_path: str = "/app/uploads"
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    # Check if running in Docker or locally
    if os.path.exists("/app/data"):
        return Settings()
    else:
        # Local development paths
        return Settings(
            database_path="./data/scio.db",
            uploads_path="./uploads"
        )

