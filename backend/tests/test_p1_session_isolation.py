"""Regression tests for P1 study-session review attribution."""

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import Flashcard, FlashcardDeck, StudySession
from app.routers.flashcards import complete_session, submit_review
from app.schemas.flashcard import ReviewSubmit, StudySessionComplete


@pytest.mark.asyncio
async def test_overlapping_sessions_only_count_their_own_reviews():
    """Completing session A must never include a review submitted in session B."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as db:
            deck = FlashcardDeck(title="Session isolation")
            db.add(deck)
            await db.flush()

            card = Flashcard(deck_id=deck.id, front="Question", back="Answer")
            session_a = StudySession(deck_id=deck.id)
            session_b = StudySession(deck_id=deck.id)
            db.add_all([card, session_a, session_b])
            await db.commit()

            await submit_review(
                card.id,
                ReviewSubmit(rating=4, time_taken_ms=250),
                session_id=session_b.id,
                db=db,
            )

            completed_a = await complete_session(
                session_a.id, StudySessionComplete(total_time_ms=1), db
            )
            completed_b = await complete_session(
                session_b.id, StudySessionComplete(total_time_ms=1), db
            )

            assert completed_a.cards_reviewed == 0
            assert completed_a.cards_easy == 0
            assert completed_b.cards_reviewed == 1
            assert completed_b.cards_easy == 1
    finally:
        await engine.dispose()
