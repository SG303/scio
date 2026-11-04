from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Literal, Optional


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
    parent_document_id: Optional[int] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ChapterDetectRequest(BaseModel):
    # None: free detection only (PDF bookmarks, DOCX/Markdown headings);
    # set: let this AI model find the chapters of a PDF
    ai_model_id: Optional[int] = None


class ChapterProposalItem(BaseModel):
    title: str
    start: int  # 1-based PDF page (unit "page") or section (unit "section")


class ChapterProposal(BaseModel):
    method: Literal["outline", "headings", "ai", "none"]
    unit: Literal["page", "section"]
    unit_count: int
    ai_available: bool  # AI detection works for PDFs only
    ai_input_tokens: Optional[int] = None  # rough prompt size of the AI detection
    chapters: List[ChapterProposalItem]


class ChapterRange(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class ChapterSplitRequest(BaseModel):
    chapters: List[ChapterRange] = Field(min_length=1, max_length=300)
