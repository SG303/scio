import logging
import os
import uuid
from collections.abc import Collection, Sequence

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import AIModel, Document, FlashcardDeck, Subject, TestConfig
from app.schemas.document import (
    ChapterDetectRequest,
    ChapterProposal,
    ChapterProposalItem,
    ChapterSplitRequest,
    DocumentCreate,
    DocumentResponse,
    DocumentUpdate,
)
from app.services import document_chapters
from app.services.document_parser import parse_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])
settings = get_settings()

# Maximum file upload size: 300 MB
MAX_FILE_SIZE = 300 * 1024 * 1024


@router.get("", response_model=list[DocumentResponse])
async def list_documents(db: AsyncSession = Depends(get_db)):
    """List all documents"""
    result = await db.execute(select(Document).order_by(Document.created_at.desc()))
    documents = result.scalars().all()
    return documents


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific document"""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.post("", response_model=DocumentResponse)
async def create_document(document: DocumentCreate, db: AsyncSession = Depends(get_db)):
    """Create a new document with text content"""
    db_document = Document(
        title=document.title, doc_type=document.doc_type, content=document.content
    )
    db.add(db_document)
    await db.commit()
    await db.refresh(db_document)
    return db_document


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    title: str = Form(...),
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document file (PDF, DOCX, TXT)"""
    # Validate file type
    allowed_extensions = {".pdf", ".docx", ".doc", ".txt", ".md"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}",
        )

    # Read file content and check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB",
        )

    # Create uploads directory if it doesn't exist
    os.makedirs(settings.uploads_path, exist_ok=True)

    # Generate unique filename
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(settings.uploads_path, unique_filename)

    # Save file (content already read above)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Parse document content
    try:
        text_content = await parse_document(file_path, file_ext)
    except Exception as e:
        # Clean up file if parsing fails
        os.remove(file_path)
        raise HTTPException(status_code=400, detail=f"Failed to parse document: {str(e)}")

    # Create database record
    db_document = Document(
        title=title,
        doc_type=doc_type,
        content=text_content,
        file_path=file_path,
        file_name=file.filename,
    )
    db.add(db_document)
    await db.commit()
    await db.refresh(db_document)

    return db_document


@router.put("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int, document: DocumentUpdate, db: AsyncSession = Depends(get_db)
):
    """Update a document"""
    result = await db.execute(select(Document).where(Document.id == document_id))
    db_document = result.scalar_one_or_none()
    if not db_document:
        raise HTTPException(status_code=404, detail="Document not found")

    update_data = document.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_document, key, value)

    await db.commit()
    await db.refresh(db_document)
    return db_document


async def _get_splittable_document(db: AsyncSession, document_id: int) -> Document:
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.parent_document_id is not None:
        raise HTTPException(status_code=400, detail="This document is already a chapter.")
    has_chapters = (
        await db.execute(
            select(Document.id).where(Document.parent_document_id == document_id).limit(1)
        )
    ).first()
    if has_chapters:
        raise HTTPException(
            status_code=409,
            detail="This document is already split into chapters.",
        )
    return document


@router.post("/{document_id}/chapters/detect", response_model=ChapterProposal)
async def detect_chapters(
    document_id: int, request: ChapterDetectRequest, db: AsyncSession = Depends(get_db)
):
    """Propose the main chapters of a document. Nothing is stored.

    Without ai_model_id only the free detection runs (PDF bookmarks, DOCX or
    Markdown headings). With it, the AI finds the chapters of a PDF.
    """
    document = await _get_splittable_document(db, document_id)
    source = await document_chapters.load_units(document.file_path, document.content)
    ai_available = source.kind == "pdf"

    if request.ai_model_id is None:
        method, chapters = document_chapters.detect_chapters(source)
    else:
        if not ai_available:
            raise HTTPException(
                status_code=400, detail="AI chapter detection works for PDF files only."
            )
        ai_model = await db.get(AIModel, request.ai_model_id)
        if ai_model is None or not ai_model.is_enabled:
            raise HTTPException(status_code=400, detail="AI model not available")
        try:
            chapters = await document_chapters.detect_chapters_with_ai(
                source.units, ai_model.openrouter_id
            )
        except ValueError as e:
            logger.error("Chapter detection failed for document %s: %s", document_id, e)
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            logger.error(
                "Chapter detection failed for document %s: %s", document_id, e, exc_info=True
            )
            raise HTTPException(
                status_code=500, detail="Chapter detection failed. Please try again."
            )
        method = "ai"

    return ChapterProposal(
        method=method,
        unit="page" if source.kind == "pdf" else "section",
        unit_count=len(source.units),
        ai_available=ai_available,
        ai_input_tokens=(
            len(document_chapters.build_ai_prompt(source.units)) // 4 if ai_available else None
        ),
        chapters=[ChapterProposalItem(title=c.title, start=c.start) for c in chapters],
    )


@router.post("/{document_id}/chapters", response_model=list[DocumentResponse])
async def split_into_chapters(
    document_id: int, request: ChapterSplitRequest, db: AsyncSession = Depends(get_db)
):
    """Create one document per chapter range; the book itself is kept."""
    document = await _get_splittable_document(db, document_id)
    source = await document_chapters.load_units(document.file_path, document.content)
    is_pdf = source.kind == "pdf"
    unit_count = len(source.units)

    chapters = []
    for item in request.chapters:
        if item.start > item.end or item.end > unit_count:
            raise HTTPException(
                status_code=400,
                detail=f'"{item.title}": the range {item.start}–{item.end} is outside '
                f"the document (1–{unit_count}).",
            )
        text = document_chapters.chapter_text(source, item.start, item.end)
        if not text:
            raise HTTPException(
                status_code=400,
                detail=f'"{item.title}" contains no text (scanned pages cannot be read).',
            )
        chapters.append(
            Document(
                title=item.title.strip(),
                doc_type=document.doc_type,
                content=text,
                parent_document_id=document.id,
                page_start=item.start if is_pdf else None,
                page_end=item.end if is_pdf else None,
            )
        )

    db.add_all(chapters)
    await db.commit()
    for chapter in chapters:
        await db.refresh(chapter)
    return chapters


@router.delete("/{document_id}")
async def delete_document(document_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a document; a book is deleted together with its chapters."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    db_document = result.scalar_one_or_none()
    if not db_document:
        raise HTTPException(status_code=404, detail="Document not found")

    chapter_ids = (
        (await db.execute(select(Document.id).where(Document.parent_document_id == document_id)))
        .scalars()
        .all()
    )

    # Referential integrity: SQLite runs with foreign_keys=OFF, and the
    # document ID is referenced by ID (not FK) inside the document_ids JSON
    # lists of test configs, flashcard decks and subjects. Stale references
    # would silently break later generations (the material would be missing).
    await _scrub_document_references(
        [TestConfig, FlashcardDeck, Subject], {document_id, *chapter_ids}, db
    )
    if chapter_ids:
        await db.execute(delete(Document).where(Document.id.in_(chapter_ids)))

    # Delete file if it exists
    if db_document.file_path and os.path.exists(db_document.file_path):
        os.remove(db_document.file_path)

    await db.delete(db_document)
    await db.commit()
    return {"message": "Document deleted successfully"}


async def _scrub_document_references(
    models_with_document_ids: Sequence[type], document_ids: Collection[int], db: AsyncSession
):
    """Remove deleted documents' IDs from all document_ids JSON lists.

    One aggregated SELECT per table, then a single bulk UPDATE per table —
    no per-row queries. Idempotent: rows already without the ID are not
    touched.
    """
    for model_cls in models_with_document_ids:
        result = await db.execute(
            select(model_cls.id, model_cls.document_ids).where(model_cls.document_ids.isnot(None))
        )
        rows = [
            {"id": row_id, "document_ids": [d for d in doc_ids if d not in document_ids]}
            for row_id, doc_ids in result.fetchall()
            if doc_ids and any(d in document_ids for d in doc_ids)
        ]
        if rows:
            await db.execute(update(model_cls), rows)
