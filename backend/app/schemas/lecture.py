from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LectureCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class LectureUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    content: Optional[str] = None


class LectureFormatRequest(BaseModel):
    ai_model_id: Optional[int] = None  # default: the subject's model


class LectureListItem(BaseModel):
    """Lecture in the subject's list (without the full content)."""
    id: int
    subject_id: int
    title: str
    word_count: int
    formatted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class LectureResponse(BaseModel):
    id: int
    subject_id: int
    title: str
    content: str
    original_content: Optional[str] = None
    formatted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LectureImageResponse(BaseModel):
    url: str
