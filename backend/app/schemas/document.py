from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DocumentCreate(BaseModel):
    title: str
    doc_type: str  # exam_objectives, study_guide, example_questions
    content: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = None
    doc_type: str | None = None
    content: str | None = None


class DocumentResponse(BaseModel):
    id: int
    title: str
    doc_type: str
    content: str | None = None
    file_path: str | None = None
    file_name: str | None = None
    parent_document_id: int | None = None
    page_start: int | None = None
    page_end: int | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChapterDetectRequest(BaseModel):
    # None: free detection only (PDF bookmarks, DOCX/Markdown headings);
    # set: let this AI model find the chapters of a PDF
    ai_model_id: int | None = None


class ChapterProposalItem(BaseModel):
    title: str
    start: int  # 1-based PDF page (unit "page") or section (unit "section")


class ChapterProposal(BaseModel):
    method: Literal["outline", "headings", "ai", "none"]
    unit: Literal["page", "section"]
    unit_count: int
    ai_available: bool  # AI detection works for PDFs only
    ai_input_tokens: int | None = None  # rough prompt size of the AI detection
    chapters: list[ChapterProposalItem]


class ChapterRange(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class ChapterSplitRequest(BaseModel):
    chapters: list[ChapterRange] = Field(min_length=1, max_length=300)
