from pydantic import BaseModel, Field


class BackupInfo(BaseModel):
    """A single automatic database backup file."""

    file_name: str
    size_bytes: int
    # ISO 8601 with explicit UTC offset ("...+00:00"), as agreed with the
    # frontend contract (pydantic would serialize datetimes as "...Z").
    created_at: str


class BackupListResponse(BaseModel):
    """All database backups, newest first."""

    backups: list[BackupInfo]


class BackupCreateResponse(BaseModel):
    """The backup that was just created."""

    backup: BackupInfo


class AppSettingsResponse(BaseModel):
    """Effective app settings (stored values with config fallbacks applied)."""

    verification_model: str
    # Global default AI model (None = not set)
    default_ai_model_id: int | None = None


class AppSettingsUpdate(BaseModel):
    """Partial update: only the fields that are sent are changed.

    ``default_ai_model_id: null`` clears the default.
    """

    verification_model: str | None = Field(default=None, min_length=1, max_length=255)
    default_ai_model_id: int | None = None
