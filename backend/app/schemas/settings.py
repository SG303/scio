from pydantic import BaseModel, Field


class AppSettingsResponse(BaseModel):
    """Effective app settings (stored values with config fallbacks applied)."""
    verification_model: str


class AppSettingsUpdate(BaseModel):
    verification_model: str = Field(min_length=1, max_length=255)
