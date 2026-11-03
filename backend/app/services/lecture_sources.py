"""Lecture notes as study material for test and flashcard generation.

The generators take document-like objects (title, doc_type, content);
lectures are adapted to that shape. Image links are dropped — the AI only
sees text, and the URLs would just be noise.
"""
from dataclasses import dataclass
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Lecture
from app.services.lecture_formatter import IMAGE_RE


@dataclass
class LectureSource:
    title: str
    content: str
    doc_type: str = "lecture_notes"


async def load_lecture_sources(
    db: AsyncSession, lecture_ids: Optional[List[int]]
) -> List[LectureSource]:
    """Lectures in the requested order; 404 if one no longer exists, so a
    deleted lecture never silently turns into generation without material."""
    if not lecture_ids:
        return []
    result = await db.execute(select(Lecture).where(Lecture.id.in_(lecture_ids)))
    by_id = {lecture.id: lecture for lecture in result.scalars().all()}
    missing = set(lecture_ids) - set(by_id)
    if missing:
        raise HTTPException(status_code=404, detail=f"Lecture(s) not found: {missing}")
    return [
        LectureSource(title=by_id[i].title, content=IMAGE_RE.sub("", by_id[i].content).strip())
        for i in lecture_ids
    ]
