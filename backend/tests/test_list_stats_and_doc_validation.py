"""Regression tests for the round-3 backend fixes:

List endpoints (decks / subjects) must compute their stats with a constant
number of batched GROUP BY queries while producing values identical to the
per-item get_deck_stats() computation, and generation endpoints must reject
missing document IDs with a 404 *before* calling the AI generator.
"""
import pytest
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app import models
from app.routers import flashcards as flashcards_router
from app.routers import subjects as subjects_router
from app.services.spaced_repetition import get_deck_stats, utc_now
from app.schemas.flashcard import GenerateFlashcardsRequest
from app.schemas.subject import (
    GenerateFlashcardsInSubjectRequest, GenerateTestInSubjectRequest,
    AddQuestionsRequest, AddCardsRequest,
)


@pytest.fixture
async def stats_db():
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


async def _build_decks_with_cards(db):
    """Two decks: one empty, one with cards in every state + today's session.

    Returns the deck list. The mixed deck has: 2 new, 1 learning (due),
    1 relearning (due), 1 review (due, not mastered), 1 review mastered,
    and a session that already introduced 1 new card today.
    """
    now = utc_now()
    past = now - timedelta(minutes=30)
    future = now + timedelta(days=7)
    deck_empty = models.FlashcardDeck(title="Empty")
    deck_mixed = models.FlashcardDeck(title="Mixed")
    db.add_all([deck_empty, deck_mixed])
    await db.flush()

    db.add_all([
        models.Flashcard(deck_id=deck_mixed.id, front="N1", back="B", state="new"),
        models.Flashcard(deck_id=deck_mixed.id, front="N2", back="B", state="new"),
        models.Flashcard(
            deck_id=deck_mixed.id, front="L", back="B",
            state="learning", next_review_at=past,
        ),
        models.Flashcard(
            deck_id=deck_mixed.id, front="RL", back="B",
            state="relearning", next_review_at=past,
        ),
        models.Flashcard(
            deck_id=deck_mixed.id, front="R", back="B",
            state="review", next_review_at=past,
            interval_days=7, easiness_factor=2.5,
        ),
        models.Flashcard(
            deck_id=deck_mixed.id, front="M", back="B",
            state="review", next_review_at=future,
            interval_days=30, easiness_factor=2.3,
        ),
        models.StudySession(
            deck_id=deck_mixed.id,
            new_cards_reviewed_today=1,
            study_date=now.date(),
        ),
    ])
    await db.commit()
    return [deck_empty, deck_mixed]


async def test_deck_stats_map_matches_get_deck_stats(stats_db):
    """The batched stats computation returns exactly the per-deck values."""
    db = stats_db
    decks = await _build_decks_with_cards(db)

    stats_map = await flashcards_router.get_deck_stats_map(db, decks)
    expected = {deck.id: await get_deck_stats(db, deck.id) for deck in decks}

    assert stats_map == expected

    mixed = next(d for d in decks if d.title == "Mixed")
    stats = stats_map[mixed.id]
    assert stats["total_cards"] == 6
    assert stats["new_cards"] == 2
    assert stats["learning_cards"] == 2  # learning + relearning
    assert stats["review_cards"] == 2
    assert stats["due_reviews"] == 3  # learning + relearning + review due
    assert stats["new_available"] == 1  # 2 new, 1 already introduced today
    assert stats["due_today"] == 4  # 3 due reviews + 1 new available
    assert stats["mastered_cards"] == 1
    assert all(stats_map[d.id]["total_cards"] == 0 for d in decks if d.title == "Empty")


async def test_list_decks_values_match_get_deck(stats_db):
    """List endpoint data is identical to the per-deck detail endpoint."""
    db = stats_db
    decks = await _build_decks_with_cards(db)

    listed = await flashcards_router.list_decks(db)
    assert len(listed) == 2

    for listed_deck in listed:
        detail = await flashcards_router.get_deck(listed_deck.id, db)
        assert listed_deck.model_dump() == detail.model_dump()


async def test_list_subjects_aggregates_config_and_deck_stats(stats_db):
    """Subject list stats come from batched aggregation and stay correct."""
    db = stats_db
    model = models.AIModel(name="Model", openrouter_id="test/model")
    subject_a = models.Subject(title="Subject A", ai_model=model)
    subject_b = models.Subject(title="Subject B")
    db.add_all([model, subject_a, subject_b])
    await db.flush()

    config = models.TestConfig(
        title="Config", num_questions=2, num_choices=4,
        ai_model=model, document_ids=[], subject_id=subject_a.id,
    )
    db.add(config)
    await db.flush()
    db.add_all([
        models.Test(config=config, status="completed", total_questions=2,
                    score=80, completed_at=utc_now()),
        models.Test(config=config, status="completed", total_questions=2,
                    score=90, completed_at=utc_now()),
        # Not completed and not of this subject: must not count anywhere
        models.Test(config=config, status="generated", total_questions=2),
    ])
    orphan_config = models.TestConfig(
        title="Orphan", num_questions=1, num_choices=4,
        ai_model=model, document_ids=[],
    )
    db.add(orphan_config)
    await db.flush()
    db.add(models.Test(config=orphan_config, status="completed", total_questions=1,
                       score=100, completed_at=utc_now()))

    deck = models.FlashcardDeck(title="Deck A", subject_id=subject_a.id)
    db.add(deck)
    await db.flush()
    db.add_all([
        models.Flashcard(deck_id=deck.id, front="N1", back="B", state="new"),
        models.Flashcard(deck_id=deck.id, front="N2", back="B", state="new"),
        models.Flashcard(deck_id=deck.id, front="M", back="B", state="review",
                         interval_days=30, easiness_factor=2.3),
    ])
    await db.commit()

    subjects = await subjects_router.list_subjects(db)
    by_title = {s.title: s for s in subjects}

    a = by_title["Subject A"]
    assert a.test_count == 1
    assert a.total_tests_taken == 3  # all tests of the subject's configs (completed + generated)
    assert a.average_score == pytest.approx(85.0)  # avg of the two completed scores
    assert a.deck_count == 1
    assert a.total_cards == 3
    assert a.mastered_cards == 1

    b = by_title["Subject B"]
    assert b.test_count == 0
    assert b.total_tests_taken == 0
    assert b.average_score is None
    assert b.deck_count == 0
    assert b.total_cards == 0
    assert b.mastered_cards == 0


async def test_generate_deck_with_missing_document_404_without_ai_call(stats_db, monkeypatch):
    """A deleted document ID must 404 before the generator is called."""
    db = stats_db
    model = models.AIModel(name="Model", openrouter_id="test/model")
    deck = models.FlashcardDeck(title="Deck", ai_model=model, document_ids=[999])
    db.add_all([model, deck])
    await db.commit()

    calls = []

    async def blocked_generate(**kwargs):
        calls.append(1)
        return []

    monkeypatch.setattr(flashcards_router, "generate_flashcards", blocked_generate)

    with pytest.raises(HTTPException) as error:
        await flashcards_router.generate_cards_for_deck(
            deck.id, GenerateFlashcardsRequest(num_cards=1), db
        )

    assert error.value.status_code == 404
    assert "Document(s) not found" in error.value.detail
    assert calls == []  # no AI call
    assert (await db.execute(
        select(func.count()).select_from(models.Flashcard)
    )).scalar_one() == 0  # and nothing was generated/persisted


async def test_subject_generation_with_missing_document_404_without_ai_call(
    stats_db, monkeypatch
):
    """All four subject generation endpoints 404 on missing documents
    before calling the AI generator."""
    db = stats_db
    model = models.AIModel(name="Model", openrouter_id="test/model")
    subject = models.Subject(title="Subject", ai_model=model, document_ids=[999])
    db.add_all([model, subject])
    await db.flush()
    deck = models.FlashcardDeck(
        title="Deck", subject_id=subject.id, ai_model=model, document_ids=[999]
    )
    config = models.TestConfig(
        title="Config", num_questions=2, num_choices=4,
        ai_model=model, document_ids=[999], subject_id=subject.id,
    )
    db.add_all([deck, config])
    await db.commit()

    question_calls = []
    card_calls = []

    async def blocked_questions(**kwargs):
        question_calls.append(1)
        return []

    async def blocked_cards(**kwargs):
        card_calls.append(1)
        return []

    monkeypatch.setattr(subjects_router, "generate_test_questions", blocked_questions)
    monkeypatch.setattr(subjects_router, "generate_flashcards", blocked_cards)

    generate_test_cases = [
        subjects_router.generate_test_in_subject(
            subject.id,
            GenerateTestInSubjectRequest(title="Test", num_questions=1),
            db,
        ),
        subjects_router.generate_flashcards_in_subject(
            subject.id,
            GenerateFlashcardsInSubjectRequest(title="Cards", num_cards=1),
            db,
        ),
        subjects_router.add_questions_to_test_config(
            subject.id, config.id, AddQuestionsRequest(num_questions=1), db
        ),
        subjects_router.add_cards_to_deck(
            subject.id, deck.id, AddCardsRequest(num_cards=1), db
        ),
    ]
    for call in generate_test_cases:
        with pytest.raises(HTTPException) as error:
            await call
        assert error.value.status_code == 404
        assert "Document(s) not found" in error.value.detail

    # No AI call happened for any endpoint
    assert question_calls == []
    assert card_calls == []
    # And the generation left everything untouched (P5.2 contract)
    assert (await db.execute(
        select(func.count()).select_from(models.Test)
    )).scalar_one() == 0
    assert (await db.execute(
        select(func.count()).select_from(models.Question)
    )).scalar_one() == 0
    assert (await db.execute(
        select(func.count()).select_from(models.Flashcard)
    )).scalar_one() == 0
