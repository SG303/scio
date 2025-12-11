from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DocumentCreate(BaseModel):
    title: str
    doc_type: str  # exam_objectives, study_guide, example_questions
    content: Optional[str] = None


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    doc_type: Optional[str] = None
    content: Optional[str] = None


class DocumentResponse(BaseModel):
    id: int
    title: str
    doc_type: str
    content: Optional[str] = None
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

