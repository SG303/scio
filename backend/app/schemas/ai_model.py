from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class AIModelCreate(BaseModel):
    name: str
    openrouter_id: str
    description: Optional[str] = None
    is_enabled: bool = True


class AIModelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_enabled: Optional[bool] = None


class AIModelResponse(BaseModel):
    id: int
    name: str
    openrouter_id: str
    description: Optional[str] = None
    is_enabled: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

