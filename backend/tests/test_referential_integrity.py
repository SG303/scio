"""Referential integrity tests for delete paths (SQLite foreign_keys=OFF).

SQLite runs with PRAGMA foreign_keys=OFF, so dangling foreign keys are never
enforced by the database. These tests verify that the ORM cascades and the
router cleanup logic keep children consistent when parents are deleted:
- Delete a config/template -> tests and questions are gone
- Delete a deck -> study sessions and their reviews are gone
- Delete a document -> document_ids JSON lists in TestConfig, FlashcardDeck
  and Subject no longer reference it
- Delete a test -> flashcards no longer point at its questions
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app import models
from app.routers import documents as documents_router
from app.routers import flashcards as flashcards_router
from app.routers import tests as tests_router


@pytest.fixture
async def integrity_db():
    """In-memory DB with fresh tables."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as db:
            yield db
    finally:
        await engine.dispose()


async def _row_count(db, model_cls):
    result = await db.execute(select(func.count()).select_from(model_cls))
    return result.scalar_one()


async def _build_test_tree(db, is_template=False):
    """Persist a config, a test and one question. Returns both rows."""
    model = models.AIModel(name="Model", openrouter_id="test/model")
    config = models.TestConfig(
        title="Config",
        num_questions=1,
        num_choices=4,
        ai_model=model,
        document_ids=[],
        is_template=is_template,
    )
    test = models.Test(config=config, status="generated", total_questions=1)
    question = models.Question(
        test=test,
        question_number=1,
        question_text="Q1",
        choices=[{"index": 0, "text": "A"}, {"index": 1, "text": "B"}],
        correct_answer=0,
        explanation="",
    )
    db.add_all([model, test])
    await db.commit()
    return test, question


async def test_delete_config_cascades_tests_and_questions(integrity_db):
    """db.delete(config) removes its tests and questions (ORM cascade)."""
    db = integrity_db
    test, _ = await _build_test_tree(db)

    config = test.config
    await db.delete(config)
    await db.commit()

    assert await _row_count(db, models.TestConfig) == 0
    assert await _row_count(db, models.Test) == 0
    assert await _row_count(db, models.Question) == 0


async def test_delete_template_cascades_and_clears_flashcard_source(integrity_db):
    """Deleting a template deletes its tests/questions and clears
    Flashcard.source_question_id instead of leaving a dangling FK."""
    db = integrity_db
    _, question = await _build_test_tree(db, is_template=True)
    deck = models.FlashcardDeck(title="Deck", ai_model_id=None)
    card = models.Flashcard(
        deck=deck,
        front="Front",
        back="Back",
        source_type="from_test",
        source_question_id=question.id,
    )
    db.add(card)
    await db.commit()

    await tests_router.delete_test_template(question.test.config_id, db)

    assert await _row_count(db, models.TestConfig) == 0
    assert await _row_count(db, models.Test) == 0
    assert await _row_count(db, models.Question) == 0
    # Card survives, but without a dangling source reference
    assert await _row_count(db, models.Flashcard) == 1
    result = await db.execute(
        select(models.Flashcard.source_question_id).where(
            models.Flashcard.source_question_id.isnot(None)
        )
    )
    assert result.all() == []


async def test_delete_test_clears_flashcard_source(integrity_db):
    """Deleting a single test nulls source_question_id on its flashcards."""
    db = integrity_db
    _, question = await _build_test_tree(db)
    deck = models.FlashcardDeck(title="Deck", ai_model_id=None)
    card_with_source = models.Flashcard(
        deck=deck,
        front="From question",
        back="Back",
        source_type="from_test",
        source_question_id=question.id,
    )
    card_unrelated = models.Flashcard(deck=deck, front="Manual", back="Back")
    db.add_all([card_with_source, card_unrelated])
    await db.commit()
    sourced_id = card_with_source.id

    await tests_router.delete_test(question.test_id, db)

    assert await _row_count(db, models.Test) == 0
    assert await _row_count(db, models.Question) == 0
    assert await _row_count(db, models.Flashcard) == 2
    result = await db.execute(select(models.Flashcard).where(models.Flashcard.id == sourced_id))
    assert result.scalar_one().source_question_id is None


async def test_delete_deck_deletes_sessions_and_their_reviews(integrity_db):
    """Deleting a deck removes sessions and reviews referencing that session
    — including reviews whose card belongs to another deck (the review is
    only reachable via StudySession.reviews)."""
    db = integrity_db
    deck_a = models.FlashcardDeck(title="Deck A", ai_model_id=None)
    deck_b = models.FlashcardDeck(title="Deck B", ai_model_id=None)
    card_b = models.Flashcard(deck=deck_b, front="B", back="B")
    db.add_all([deck_a, deck_b])
    await db.commit()

    # A session of deck A, referencing a card of deck B in its review
    session = models.StudySession(deck_id=deck_a.id, deck=deck_a)
    review = models.FlashcardReview(card=card_b, session=session, rating=3)
    # A card-owned review without any session keeps working via the card path
    card_a = models.Flashcard(deck=deck_a, front="A", back="A")
    review_without_session = models.FlashcardReview(card=card_a, rating=4)
    db.add_all([session, review, card_a, review_without_session])
    await db.commit()

    await flashcards_router.delete_deck(deck_a.id, db)

    assert await _row_count(db, models.StudySession) == 0
    assert await _row_count(db, models.FlashcardReview) == 0
    # The untouched deck with its card remains
    assert await _row_count(db, models.FlashcardDeck) == 1
    assert await _row_count(db, models.Flashcard) == 1


async def test_delete_document_scrubs_document_ids(integrity_db):
    """Deleting a document removes its ID from the document_ids JSON lists
    of test configs, flashcard decks and subjects; untouched rows keep
    their other references."""
    db = integrity_db
    document = models.Document(title="Doc", doc_type="study_guide")
    other_document = models.Document(title="Other", doc_type="study_guide")
    db.add_all([document, other_document])
    await db.commit()
    document_id = document.id

    config_scrubbed = models.TestConfig(
        title="Scrub me",
        num_questions=1,
        num_choices=4,
        ai_model_id=1,
        document_ids=[other_document.id, document_id],
    )
    config_untouched = models.TestConfig(
        title="Keep me",
        num_questions=1,
        num_choices=4,
        ai_model_id=1,
        document_ids=[other_document.id],
    )
    deck = models.FlashcardDeck(title="Deck", document_ids=[document_id])
    subject = models.Subject(title="Subject", document_ids=[document_id])
    db.add_all([config_scrubbed, config_untouched, deck, subject])
    await db.commit()

    await documents_router.delete_document(document_id, db)

    result = await db.execute(select(models.TestConfig).order_by(models.TestConfig.id))
    scrubbed, untouched = result.scalars().all()
    assert scrubbed.document_ids == [other_document.id]
    assert untouched.document_ids == [other_document.id]
    deck = (await db.execute(select(models.FlashcardDeck))).scalar_one()
    assert deck.document_ids == []
    subject = (await db.execute(select(models.Subject))).scalar_one()
    assert subject.document_ids == []
    assert await _row_count(db, models.Document) == 1


async def test_delete_template_ignores_missing_document(integrity_db):
    """Unknown document IDs are a 404 and clean up nothing."""
    db = integrity_db
    with pytest.raises(HTTPException) as error:
        await documents_router.delete_document(9999, db)
    assert error.value.status_code == 404
    assert await _row_count(db, models.TestConfig) == 0
