"""Lecture notes as study material for tests and flashcard decks.

- create-and-generate passes the selected lectures to the generator (images
  stripped) and remembers them on the config/deck.
- Later generations of the same config/deck use the remembered lectures.
- A missing lecture is a 404 before any AI call; nothing is written.
- Deleting a lecture removes it from the configs/decks that used it.
- The migration adds lecture_ids to existing tables.
"""

import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.migrations.add_lecture_sources import migrate
from app.routers import flashcards as flashcards_router
from app.routers import lectures as lectures_router
from app.routers import subjects as subjects_router
from app.routers import tests as tests_router
from app.schemas.flashcard import CreateAndGenerateDeckRequest, GenerateFlashcardsRequest
from app.schemas.subject import AddCardsRequest
from app.schemas.test import CreateAndGenerateRequest

FAKE_QUESTIONS = [
    {"question": "New question", "choices": ["A", "B", "C", "D"], "correct_answer": 0}
]
FAKE_CARDS = [{"front": "New front", "back": "Back"}]
NOTES = (
    "# 4P\n\n- Product\n- Price\n\n![1.00](/api/lectures/1/images/" + "a" * 32 + '.png "Slide")\n'
)


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


def _capture(seen, result):
    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return result

    return fake_generate


async def test_test_from_lecture_uses_text_without_images(db, monkeypatch):
    seen = {}
    monkeypatch.setattr(tests_router, "generate_test_questions", _capture(seen, FAKE_QUESTIONS))

    response = await tests_router.create_and_generate_test(
        CreateAndGenerateRequest(
            title="T",
            num_questions=1,
            ai_model_id=1,
            document_ids=[],
            lecture_ids=[1],
            subject_id=1,
        ),
        db,
        progress_token=None,
    )

    [source] = seen["documents"]
    assert source.title == "Week 1" and source.doc_type == "lecture_notes"
    assert source.content == "# 4P\n\n- Product\n- Price"
    config = await db.get(models.TestConfig, response.config_id)
    assert config.lecture_ids == [1]


async def test_deck_remembers_lectures_for_later_generations(db, monkeypatch):
    seen = {}
    monkeypatch.setattr(flashcards_router, "generate_flashcards", _capture(seen, FAKE_CARDS))
    created = await flashcards_router.create_and_generate_deck(
        CreateAndGenerateDeckRequest(
            title="D", num_cards=1, ai_model_id=1, lecture_ids=[1], subject_id=1
        ),
        db,
    )
    assert [d.title for d in seen["documents"]] == ["Week 1"]

    seen.clear()
    await flashcards_router.generate_cards_for_deck(
        created.deck.id, GenerateFlashcardsRequest(num_cards=1), db
    )
    assert [d.title for d in seen["documents"]] == ["Week 1"]

    seen.clear()
    monkeypatch.setattr(subjects_router, "generate_flashcards", _capture(seen, FAKE_CARDS))
    await subjects_router.add_cards_to_deck(1, created.deck.id, AddCardsRequest(num_cards=1), db)
    assert [d.title for d in seen["documents"]] == ["Week 1"]


async def test_deleting_a_lecture_removes_it_from_decks(db, monkeypatch, tmp_path):
    monkeypatch.setattr(
        lectures_router, "get_settings", lambda: SimpleNamespace(uploads_path=str(tmp_path))
    )
    monkeypatch.setattr(flashcards_router, "generate_flashcards", _capture({}, FAKE_CARDS))
    created = await flashcards_router.create_and_generate_deck(
        CreateAndGenerateDeckRequest(
            title="D", num_cards=1, ai_model_id=1, lecture_ids=[1], subject_id=1
        ),
        db,
    )

    await lectures_router.delete_lecture(1, db)

    deck = await db.get(models.FlashcardDeck, created.deck.id)
    await db.refresh(deck)
    assert deck.lecture_ids == []


async def test_missing_lecture_is_404_and_writes_nothing(db, monkeypatch):
    async def must_not_run(**kwargs):
        raise AssertionError("AI must not be called")

    monkeypatch.setattr(tests_router, "generate_test_questions", must_not_run)

    with pytest.raises(HTTPException) as exc:
        await tests_router.create_and_generate_test(
            CreateAndGenerateRequest(
                title="T", num_questions=1, ai_model_id=1, document_ids=[], lecture_ids=[99]
            ),
            db,
            progress_token=None,
        )

    assert exc.value.status_code == 404
    count = (await db.execute(select(func.count()).select_from(models.TestConfig))).scalar_one()
    assert count == 0


def test_migration_adds_lecture_ids_once(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE test_configs (id INTEGER PRIMARY KEY, document_ids JSON)")
    conn.execute("CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, document_ids JSON)")
    conn.commit()
    conn.close()

    migrate(str(path))
    migrate(str(path))  # idempotent

    conn = sqlite3.connect(path)
    for table in ("test_configs", "flashcard_decks"):
        assert "lecture_ids" in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    conn.close()
