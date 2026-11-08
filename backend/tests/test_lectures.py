"""Lecture notes: CRUD, image upload/serving and subject-delete protection."""

import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers

from app import models
from app.database import Base
from app.routers import lectures as lectures_router
from app.routers import subjects as subjects_router
from app.schemas.lecture import LectureCreate, LectureUpdate


@pytest.fixture
async def db(tmp_path, monkeypatch):
    monkeypatch.setattr(
        lectures_router, "get_settings", lambda: SimpleNamespace(uploads_path=str(tmp_path))
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            session.add(models.Subject(title="Marketing"))
            await session.commit()
            yield session
    finally:
        await engine.dispose()


def _image(content_type="image/png", data=b"\x89PNG fake"):
    return UploadFile(
        file=io.BytesIO(data), filename="paste.png", headers=Headers({"content-type": content_type})
    )


async def test_create_autosave_and_list(db):
    lecture = await lectures_router.create_lecture(1, LectureCreate(title="  Week 1  "), db)
    assert lecture.title == "Week 1" and lecture.content == ""

    await lectures_router.update_lecture(
        lecture.id, LectureUpdate(content="# 4P\n\nProduct price place promotion"), db
    )
    listed = await lectures_router.list_lectures(1, db)

    assert [(item.title, item.word_count) for item in listed] == [("Week 1", 6)]
    assert (await lectures_router.get_lecture(lecture.id, db)).content.startswith("# 4P")


async def test_update_title_only_keeps_content(db):
    lecture = await lectures_router.create_lecture(1, LectureCreate(title="A"), db)
    await lectures_router.update_lecture(lecture.id, LectureUpdate(content="notes"), db)

    updated = await lectures_router.update_lecture(lecture.id, LectureUpdate(title="B"), db)

    assert (updated.title, updated.content) == ("B", "notes")


async def test_unknown_subject_is_rejected(db):
    with pytest.raises(HTTPException) as exc:
        await lectures_router.create_lecture(99, LectureCreate(title="A"), db)
    assert exc.value.status_code == 404


async def test_image_upload_is_served_and_deleted_with_lecture(db, tmp_path):
    lecture = await lectures_router.create_lecture(1, LectureCreate(title="A"), db)

    result = await lectures_router.upload_lecture_image(lecture.id, _image(), db)
    name = result.url.rsplit("/", 1)[1]
    assert result.url == f"/api/lectures/{lecture.id}/images/{name}"
    response = await lectures_router.get_lecture_image(lecture.id, name)
    assert isinstance(response, FileResponse)

    await lectures_router.delete_lecture(lecture.id, db)

    assert not (tmp_path / "lectures" / str(lecture.id)).exists()
    with pytest.raises(HTTPException):
        await lectures_router.get_lecture(lecture.id, db)


async def test_svg_and_unknown_types_are_rejected(db):
    lecture = await lectures_router.create_lecture(1, LectureCreate(title="A"), db)
    with pytest.raises(HTTPException) as exc:
        await lectures_router.upload_lecture_image(lecture.id, _image("image/svg+xml"), db)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("name", ["../../scio.db", "x.png", "a" * 32 + ".svg"])
async def test_image_names_outside_the_pattern_are_404(db, name):
    with pytest.raises(HTTPException) as exc:
        await lectures_router.get_lecture_image(1, name)
    assert exc.value.status_code == 404


async def test_subject_with_lectures_cannot_be_deleted(db):
    lecture = await lectures_router.create_lecture(1, LectureCreate(title="A"), db)

    with pytest.raises(HTTPException) as exc:
        await subjects_router.delete_subject(1, cascade=False, db=db)
    assert exc.value.status_code == 409

    await lectures_router.delete_lecture(lecture.id, db)
    await subjects_router.delete_subject(1, cascade=False, db=db)
    assert await db.get(models.Subject, 1) is None
