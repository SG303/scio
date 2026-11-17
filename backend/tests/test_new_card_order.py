"""Order of new cards in the study queue: oldest first (default) or random,
shuffled once per day so the order stays stable for reloads and resume."""

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.migrations.add_new_card_order import migrate
from app.routers import flashcards
from app.schemas.flashcard import FlashcardDeckUpdate
from app.services import spaced_repetition


@pytest.fixture
async def database():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _deck_with_cards(database, count=30, new_cards_per_day=100) -> int:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with database() as db:
        deck = models.FlashcardDeck(title="Deck", new_cards_per_day=new_cards_per_day)
        db.add(deck)
        await db.flush()
        for i in range(count):
            db.add(
                models.Flashcard(
                    deck_id=deck.id,
                    front=f"Q{i}",
                    back=f"A{i}",
                    created_at=start + timedelta(minutes=i),
                )
            )
        await db.commit()
        return deck.id


async def _queue_fronts(database, deck_id) -> list[str]:
    async with database() as db:
        response = await flashcards.get_study_cards(deck_id, None, db)
    return [c.front for c in response.cards]


async def test_default_order_is_oldest_first(database):
    deck_id = await _deck_with_cards(database)
    assert await _queue_fronts(database, deck_id) == [f"Q{i}" for i in range(30)]


async def test_random_order_is_shuffled_but_stable(database):
    deck_id = await _deck_with_cards(database)
    async with database() as db:
        deck = await flashcards.update_deck(
            deck_id, FlashcardDeckUpdate(new_card_order="random"), db
        )
        assert deck.new_card_order == "random"

    first = await _queue_fronts(database, deck_id)
    assert sorted(first) == sorted(f"Q{i}" for i in range(30))
    assert first != [f"Q{i}" for i in range(30)]
    # Reloading the queue on the same day gives the same order
    assert await _queue_fronts(database, deck_id) == first


async def test_random_order_respects_daily_limit(database):
    deck_id = await _deck_with_cards(database, count=30, new_cards_per_day=5)
    async with database() as db:
        await flashcards.update_deck(deck_id, FlashcardDeckUpdate(new_card_order="random"), db)
    fronts = await _queue_fronts(database, deck_id)
    assert len(fronts) == 5
    assert fronts != [f"Q{i}" for i in range(5)]


def test_shuffle_changes_daily_and_ignores_other_cards():
    ids = list(range(1, 31))
    day = date(2026, 3, 1)
    order_today = sorted(ids, key=lambda i: spaced_repetition._daily_shuffle_key(i, day))
    order_tomorrow = sorted(
        ids, key=lambda i: spaced_repetition._daily_shuffle_key(i, day + timedelta(days=1))
    )
    assert order_today != order_tomorrow
    # Studying some cards must not reshuffle the remaining ones
    remaining = [i for i in ids if i not in order_today[:10]]
    assert (
        sorted(remaining, key=lambda i: spaced_repetition._daily_shuffle_key(i, day))
        == order_today[10:]
    )


def test_unknown_order_is_rejected():
    with pytest.raises(ValidationError):
        FlashcardDeckUpdate(new_card_order="alphabetical")


def test_migration_adds_column_once_with_old_default(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE flashcard_decks (id INTEGER PRIMARY KEY, title VARCHAR(255))")
    conn.execute("INSERT INTO flashcard_decks (title) VALUES ('Existing')")
    conn.commit()
    conn.close()

    migrate(str(path))
    migrate(str(path))  # idempotent

    conn = sqlite3.connect(path)
    assert conn.execute("SELECT new_card_order FROM flashcard_decks").fetchone() == ("created",)
    conn.close()
