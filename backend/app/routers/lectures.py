"""Lecture notes inside a subject: CRUD for the Markdown editor plus image
upload/serving. Images are stored per lecture under ``<uploads>/lectures/<id>/``
so deleting a lecture removes its images with it."""
import logging
import os
import re
import shutil
import uuid
from typing import List

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import AIModel, Lecture, Subject, utc_now
from app.schemas.lecture import (
    LectureCreate,
    LectureFormatRequest,
    LectureImageResponse,
    LectureListItem,
    LectureResponse,
    LectureUpdate,
)
from app.services.lecture_formatter import format_lecture
from app.services.subject_materials import ensure_subject_exists

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["lectures"])

MAX_IMAGE_SIZE = 20 * 1024 * 1024
# No SVG: it can carry scripts and is served from the app's own origin
IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}
_IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|gif|webp)$")


def lecture_images_dir(lecture_id: int) -> str:
    return os.path.join(get_settings().uploads_path, "lectures", str(lecture_id))


def remove_lecture_images(lecture_id: int) -> None:
    shutil.rmtree(lecture_images_dir(lecture_id), ignore_errors=True)


async def _get_lecture(db: AsyncSession, lecture_id: int) -> Lecture:
    lecture = await db.get(Lecture, lecture_id)
    if lecture is None:
        raise HTTPException(status_code=404, detail="Lecture not found")
    return lecture


@router.get("/subjects/{subject_id}/lectures", response_model=List[LectureListItem])
async def list_lectures(subject_id: int, db: AsyncSession = Depends(get_db)):
    """Lectures of a subject, newest first."""
    await ensure_subject_exists(db, subject_id)
    result = await db.execute(
        select(Lecture)
        .where(Lecture.subject_id == subject_id)
        .order_by(Lecture.created_at.desc(), Lecture.id.desc())
    )
    return [
        LectureListItem(
            id=lecture.id,
            subject_id=lecture.subject_id,
            title=lecture.title,
            word_count=len(lecture.content.split()),
            formatted_at=lecture.formatted_at,
            created_at=lecture.created_at,
            updated_at=lecture.updated_at,
        )
        for lecture in result.scalars().all()
    ]


@router.post("/subjects/{subject_id}/lectures", response_model=LectureResponse)
async def create_lecture(
    subject_id: int, data: LectureCreate, db: AsyncSession = Depends(get_db)
):
    await ensure_subject_exists(db, subject_id)
    lecture = Lecture(subject_id=subject_id, title=data.title.strip() or "Untitled lecture", content="")
    db.add(lecture)
    await db.commit()
    await db.refresh(lecture)
    return lecture


@router.get("/lectures/{lecture_id}", response_model=LectureResponse)
async def get_lecture(lecture_id: int, db: AsyncSession = Depends(get_db)):
    return await _get_lecture(db, lecture_id)


@router.patch("/lectures/{lecture_id}", response_model=LectureResponse)
async def update_lecture(
    lecture_id: int, data: LectureUpdate, db: AsyncSession = Depends(get_db)
):
    """Autosave target of the editor: title and/or content."""
    lecture = await _get_lecture(db, lecture_id)
    if data.title is not None:
        lecture.title = data.title.strip() or lecture.title
    if data.content is not None:
        lecture.content = data.content
    await db.commit()
    await db.refresh(lecture)
    return lecture


@router.post("/lectures/{lecture_id}/format", response_model=LectureResponse)
async def format_lecture_notes(
    lecture_id: int, request: LectureFormatRequest, db: AsyncSession = Depends(get_db)
):
    """Finish a lecture: AI fixes spelling and structures the Markdown.

    The text before formatting is kept in original_content (compare/restore).
    Reads → AI call → one write, so a failed call changes nothing.
    """
    lecture = await _get_lecture(db, lecture_id)
    source = lecture.content
    if not source.strip():
        raise HTTPException(status_code=400, detail="Write some notes before formatting them.")

    ai_model_id = request.ai_model_id
    if ai_model_id is None:
        ai_model_id = (
            await db.execute(select(Subject.ai_model_id).where(Subject.id == lecture.subject_id))
        ).scalar_one_or_none()
    if ai_model_id is None:
        raise HTTPException(status_code=400, detail="Choose an AI model to format the notes.")
    ai_model = await db.get(AIModel, ai_model_id)
    if ai_model is None or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")

    try:
        formatted = await format_lecture(source, ai_model.openrouter_id)
    except ValueError as e:
        logger.error("Failed to format lecture %s: %s", lecture_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error("Failed to format lecture %s: %s", lecture_id, e, exc_info=True)
        raise HTTPException(
            status_code=500, detail="Formatting failed. Your notes are unchanged. Please try again."
        )

    lecture.original_content = source
    lecture.content = formatted
    lecture.formatted_at = utc_now()
    await db.commit()
    await db.refresh(lecture)
    return lecture


@router.delete("/lectures/{lecture_id}")
async def delete_lecture(lecture_id: int, db: AsyncSession = Depends(get_db)):
    lecture = await _get_lecture(db, lecture_id)
    await db.delete(lecture)
    await db.commit()
    remove_lecture_images(lecture_id)
    return {"message": "Lecture deleted"}


@router.post("/lectures/{lecture_id}/images", response_model=LectureImageResponse)
async def upload_lecture_image(
    lecture_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db)
):
    """Store a pasted/dropped image and return the URL the Markdown links to."""
    await _get_lecture(db, lecture_id)
    ext = IMAGE_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=400, detail="Unsupported image type. Use PNG, JPEG, GIF or WebP."
        )
    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Maximum size is {MAX_IMAGE_SIZE // (1024 * 1024)} MB",
        )

    directory = lecture_images_dir(lecture_id)
    os.makedirs(directory, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    async with aiofiles.open(os.path.join(directory, name), "wb") as f:
        await f.write(content)
    return LectureImageResponse(url=f"/api/lectures/{lecture_id}/images/{name}")


@router.get("/lectures/{lecture_id}/images/{name}")
async def get_lecture_image(lecture_id: int, name: str):
    # Strict name pattern: no path traversal, only files this API wrote
    if not _IMAGE_NAME_RE.match(name):
        raise HTTPException(status_code=404, detail="Image not found")
    path = os.path.join(lecture_images_dir(lecture_id), name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Image not found")
    # File names are random and never reused, so the content never changes
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
