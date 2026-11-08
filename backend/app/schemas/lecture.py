from datetime import datetime

from pydantic import BaseModel, Field


class LectureCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class LectureUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None


class LectureFormatRequest(BaseModel):
    ai_model_id: int | None = None  # default: the subject's model


class LectureListItem(BaseModel):
    """Lecture in the subject's list (without the full content)."""

    id: int
    subject_id: int
    title: str
    word_count: int
    formatted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LectureResponse(BaseModel):
    id: int
    subject_id: int
    title: str
    content: str
    original_content: str | None = None
    formatted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LectureImageResponse(BaseModel):
    url: str
