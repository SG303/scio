"""Finishing a lecture: AI formatting of the notes.

- The result replaces the notes, the previous text is kept for compare/restore.
- A failed or unusable AI result changes nothing (Landmine 4 pattern).
- Images must survive unchanged; otherwise the result is discarded.
- The migration upgrades lectures tables created before formatting existed.
"""

import json
import sqlite3

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.migrations.add_lecture_formatting import migrate
from app.routers import lectures as lectures_router
from app.schemas.lecture import LectureFormatRequest
from app.services import lecture_formatter

IMAGE = "![1.00](/api/lectures/1/images/" + "a" * 32 + '.png "Slide 3")'
NOTES = f"marketing mix\n- prodcut\n- price\n\n{IMAGE}\n"


def _ai_returns(markdown):
    async def fake_completion(**kwargs):
        fake_completion.prompt = kwargs["user_prompt"]
        return json.dumps({"markdown": markdown})

    return fake_completion


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as session:
            model = models.AIModel(name="Test", openrouter_id="test/model")
            session.add(model)
            await session.flush()
            session.add(models.Subject(title="Marketing", ai_model_id=model.id))
            await session.flush()
            session.add(models.Lecture(subject_id=1, title="Week 1", content=NOTES))
            await session.commit()
            yield session
    finally:
        await engine.dispose()


# ============== Service ==============


async def test_prompt_contains_notes_and_rules(monkeypatch):
    fake = _ai_returns(f"## Marketing mix\n\n- Product\n- Price\n\n{IMAGE}")
    monkeypatch.setattr(lecture_formatter, "chat_completion_json", fake)

    result = await lecture_formatter.format_lecture(NOTES, "test/model")

    assert result.startswith("## Marketing mix")
    assert NOTES in fake.prompt
    assert "Do not add information" in fake.prompt
    assert "Keep the language of the notes" in fake.prompt


@pytest.mark.parametrize(
    "formatted",
    [
        "## Marketing mix\n\n- Product\n- Price",  # image dropped
        "## Marketing mix\n\n![1.00](/api/lectures/1/images/other.png)",  # image swapped
        f"{IMAGE}\n\n{IMAGE}",  # image duplicated
    ],
)
async def test_changed_images_discard_the_result(monkeypatch, formatted):
    monkeypatch.setattr(lecture_formatter, "chat_completion_json", _ai_returns(formatted))

    with pytest.raises(ValueError, match="images"):
        await lecture_formatter.format_lecture(NOTES, "test/model")


@pytest.mark.parametrize(
    "response", ["not json", json.dumps({"markdown": "  "}), json.dumps(["x"])]
)
def test_unusable_responses_raise(response):
    with pytest.raises(ValueError):
        lecture_formatter.parse_format_response(response)


def test_code_fenced_json_is_accepted():
    fenced = '```json\n{"markdown": "# Notes"}\n```'
    assert lecture_formatter.parse_format_response(fenced) == "# Notes\n"


# ============== Endpoint ==============


async def test_format_replaces_notes_and_keeps_original(db, monkeypatch):
    seen = {}

    async def fake_format(markdown, model_id):
        seen["model"] = model_id
        return "## Marketing mix\n"

    monkeypatch.setattr(lectures_router, "format_lecture", fake_format)

    lecture = await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)

    assert seen["model"] == "test/model"  # subject default
    assert lecture.content == "## Marketing mix\n"
    assert lecture.original_content == NOTES
    assert lecture.formatted_at is not None


async def test_failed_formatting_changes_nothing(db, monkeypatch):
    async def failing_format(markdown, model_id):
        raise ValueError("The AI changed or dropped images")

    monkeypatch.setattr(lectures_router, "format_lecture", failing_format)

    with pytest.raises(HTTPException) as exc:
        await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)

    assert "images" in exc.value.detail
    lecture = await db.get(models.Lecture, 1)
    await db.refresh(lecture)
    assert (lecture.content, lecture.original_content, lecture.formatted_at) == (NOTES, None, None)


async def test_empty_notes_are_rejected_before_any_ai_call(db, monkeypatch):
    async def must_not_run(markdown, model_id):
        raise AssertionError("AI must not be called")

    monkeypatch.setattr(lectures_router, "format_lecture", must_not_run)
    lecture = await db.get(models.Lecture, 1)
    lecture.content = "  \n"
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)
    assert exc.value.status_code == 400


async def test_without_any_model_the_request_is_rejected(db):
    subject = await db.get(models.Subject, 1)
    subject.ai_model_id = None
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await lectures_router.format_lecture_notes(1, LectureFormatRequest(), db)
    assert exc.value.status_code == 400


# ============== Migration ==============


def test_migration_adds_columns_once(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE lectures (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL, "
        "title VARCHAR(255) NOT NULL, content TEXT NOT NULL)"
    )
    conn.execute("INSERT INTO lectures VALUES (1, 1, 'Week 1', 'notes')")
    conn.commit()
    conn.close()

    migrate(str(path))
    migrate(str(path))  # idempotent

    conn = sqlite3.connect(path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(lectures)")}
    row = conn.execute("SELECT content, original_content FROM lectures").fetchone()
    conn.close()
    assert {"original_content", "formatted_at"} <= columns
    assert row == ("notes", None)
