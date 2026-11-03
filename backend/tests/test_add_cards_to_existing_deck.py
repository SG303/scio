"""create-and-generate with deck_id: new cards go into an existing deck.

Same contract as creating a deck: reads, then the AI call, then one commit —
a failed generation leaves the deck untouched.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.routers import flashcards as flashcards_router
from app.schemas.flashcard import CreateAndGenerateDeckRequest

FAKE_CARDS = [{"front": "New front", "back": "New back"}]


@pytest.fixture
async def setup():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as db:
            model = models.AIModel(name="Test", openrouter_id="test/model")
            subject = models.Subject(title="Marketing")
            db.add_all([model, subject])
            await db.flush()
            db.add_all([
                models.Lecture(id=lecture_id, subject_id=subject.id, title=f"L{lecture_id}", content="notes")
                for lecture_id in (5, 6)
            ])
            in_subject = models.FlashcardDeck(
                title="Terms", subject_id=subject.id, language="German",
                document_ids=[1], lecture_ids=[5],
            )
            loose = models.FlashcardDeck(title="Loose deck")
            other = models.FlashcardDeck(title="Other deck of the subject", subject_id=subject.id)
            db.add_all([in_subject, loose, other])
            await db.flush()
            db.add_all([
                models.Flashcard(deck_id=in_subject.id, front="Old front", back="b"),
                models.Flashcard(deck_id=other.id, front="Sibling front", back="b"),
                models.Flashcard(deck_id=loose.id, front="Loose front", back="b"),
            ])
            await db.commit()
            yield db, model, in_subject, loose
    finally:
        await engine.dispose()


def _request(model, deck, **kw):
    return CreateAndGenerateDeckRequest(
        title=deck.title, num_cards=1, ai_model_id=model.id, deck_id=deck.id, **kw
    )


async def _count(db, model_cls):
    return (await db.execute(select(func.count()).select_from(model_cls))).scalar_one()


async def test_cards_are_added_to_the_deck_and_sources_merge(setup, monkeypatch):
    db, model, deck, _ = setup
    seen = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return FAKE_CARDS

    monkeypatch.setattr(flashcards_router, "generate_flashcards", fake_generate)
    db.add(models.Document(title="Doc", doc_type="study_guide", content="text"))
    await db.commit()

    response = await flashcards_router.create_and_generate_deck(
        _request(model, deck, document_ids=[1], lecture_ids=[5, 6]), db
    )

    assert response.deck.id == deck.id
    assert response.cards_generated == 1
    assert await _count(db, models.FlashcardDeck) == 3  # no new deck
    fronts = (await db.execute(
        select(models.Flashcard.front).where(models.Flashcard.deck_id == deck.id)
    )).scalars().all()
    assert sorted(fronts) == ["New front", "Old front"]
    refreshed = await db.get(models.FlashcardDeck, deck.id)
    assert (refreshed.document_ids, refreshed.lecture_ids) == ([1], [5, 6])
    # the whole subject is the dedupe input; the deck's language is used
    assert sorted(seen["existing_fronts"]) == ["Old front", "Sibling front"]
    assert seen["language"] == "German"
    assert refreshed.title == "Terms"


async def test_a_deck_without_subject_dedupes_against_its_own_cards(setup, monkeypatch):
    db, model, _, loose = setup
    seen = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return FAKE_CARDS

    monkeypatch.setattr(flashcards_router, "generate_flashcards", fake_generate)

    await flashcards_router.create_and_generate_deck(_request(model, loose, language="French"), db)

    assert seen["existing_fronts"] == ["Loose front"]
    assert seen["language"] == "French"  # the request wins over the deck


async def test_a_failed_generation_leaves_the_deck_untouched(setup, monkeypatch):
    db, model, deck, _ = setup

    async def failing(**kwargs):
        raise RuntimeError("OpenRouter down")

    monkeypatch.setattr(flashcards_router, "generate_flashcards", failing)
    cards_before = await _count(db, models.Flashcard)

    with pytest.raises(HTTPException) as exc:
        await flashcards_router.create_and_generate_deck(_request(model, deck, lecture_ids=[6]), db)

    assert exc.value.status_code == 500
    assert await _count(db, models.Flashcard) == cards_before
    refreshed = await db.get(models.FlashcardDeck, deck.id)
    await db.refresh(refreshed)
    assert refreshed.lecture_ids == [5]


async def test_an_unknown_deck_is_rejected_before_the_ai_call(setup, monkeypatch):
    db, model, _, _ = setup

    async def must_not_run(**kwargs):
        raise AssertionError("AI must not be called")

    monkeypatch.setattr(flashcards_router, "generate_flashcards", must_not_run)

    with pytest.raises(HTTPException) as exc:
        await flashcards_router.create_and_generate_deck(
            CreateAndGenerateDeckRequest(title="x", num_cards=1, ai_model_id=model.id, deck_id=999),
            db,
        )
    assert exc.value.status_code == 404
