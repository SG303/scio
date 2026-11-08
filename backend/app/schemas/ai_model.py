from datetime import datetime

from pydantic import BaseModel


class AIModelCreate(BaseModel):
    name: str
    openrouter_id: str
    description: str | None = None
    is_enabled: bool = True


class AIModelUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_enabled: bool | None = None


class AIModelResponse(BaseModel):
    id: int
    name: str
    openrouter_id: str
    description: str | None = None
    is_enabled: bool
    is_default: bool = False
    created_at: datetime

    class Config:
        from_attributes = True
