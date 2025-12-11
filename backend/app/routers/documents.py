from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
import os
import uuid
import aiofiles

from app.database import get_db
from app.models import Document
from app.schemas.document import DocumentCreate, DocumentUpdate, DocumentResponse
from app.services.document_parser import parse_document
from app.config import get_settings

router = APIRouter(prefix="/api/documents", tags=["documents"])
settings = get_settings()

# Maximum file upload size: 100 MB
MAX_FILE_SIZE = 100 * 1024 * 1024


@router.get("", response_model=List[DocumentResponse])
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
        title=document.title,
        doc_type=document.doc_type,
        content=document.content
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
    db: AsyncSession = Depends(get_db)
):
    """Upload a document file (PDF, DOCX, TXT)"""
    # Validate file type
    allowed_extensions = {".pdf", ".docx", ".doc", ".txt", ".md"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}"
        )
    
    # Read file content and check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB"
        )
    
    # Create uploads directory if it doesn't exist
    os.makedirs(settings.uploads_path, exist_ok=True)
    
    # Generate unique filename
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(settings.uploads_path, unique_filename)
    
    # Save file (content already read above)
    async with aiofiles.open(file_path, 'wb') as f:
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
        file_name=file.filename
    )
    db.add(db_document)
    await db.commit()
    await db.refresh(db_document)
    
    return db_document


@router.put("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: int,
    document: DocumentUpdate,
    db: AsyncSession = Depends(get_db)
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


@router.delete("/{document_id}")
async def delete_document(document_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a document"""
    result = await db.execute(select(Document).where(Document.id == document_id))
    db_document = result.scalar_one_or_none()
    if not db_document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete file if it exists
    if db_document.file_path and os.path.exists(db_document.file_path):
        os.remove(db_document.file_path)
    
    await db.delete(db_document)
    await db.commit()
    return {"message": "Document deleted successfully"}

