"""Subject assignment from the regular create wizards and template safety.

- subject_id travels through create-and-generate (tests and decks), is
  validated (SQLite foreign_keys=OFF would store a dangling id) and comes
  back in every response.
- With a subject, generation receives the subject's existing questions /
  card fronts (dedupe saves paid OpenRouter calls).
- Templates never own generated tests or a subject: create-and-generate
  always writes a non-template config and the direct generate endpoint
  refuses template ids.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.routers import flashcards as flashcards_router
from app.routers import subjects as subjects_router
from app.routers import tests as tests_router
from app.schemas.flashcard import CreateAndGenerateDeckRequest, FlashcardDeckUpdate
from app.schemas import test as test_schemas
from app.schemas.test import CreateAndGenerateRequest

FAKE_QUESTIONS = [
    {"question": "New question", "choices": ["A", "B", "C", "D"], "correct_answer": 0}
]
FAKE_CARDS = [{"front": "New front", "back": "Back"}]


@pytest.fixture
async def db_with_subject():
    """In-memory DB: one model, one subject with an existing test and deck."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with session_factory() as db:
            model = models.AIModel(name="Test Model", openrouter_id="test/model")
            subject = models.Subject(title="CWSP", ai_model=model)
            db.add_all([model, subject])
            await db.flush()

            config = models.TestConfig(
                title="Existing", ai_model_id=model.id, document_ids=[],
                subject_id=subject.id,
            )
            db.add(config)
            await db.flush()
            test = models.Test(config_id=config.id, total_questions=1)
            db.add(test)
            await db.flush()
            db.add(models.Question(
                test_id=test.id, question_number=1, question_text="Old question",
                choices=[{"index": 0, "text": "A"}], correct_answer=0,
            ))

            deck = models.FlashcardDeck(title="Existing deck", subject_id=subject.id)
            db.add(deck)
            await db.flush()
            db.add(models.Flashcard(deck_id=deck.id, front="Old front", back="Back"))
            await db.commit()
            yield db, subject, model
    finally:
        await engine.dispose()


async def _count(db, model_cls):
    result = await db.execute(select(func.count()).select_from(model_cls))
    return result.scalar_one()


def _test_request(model, **kw):
    return CreateAndGenerateRequest(
        title="Chapter 2", num_questions=1, ai_model_id=model.id, document_ids=[], **kw
    )


async def test_create_and_generate_test_with_subject_dedupes_and_links(db_with_subject, monkeypatch):
    db, subject, model = db_with_subject
    seen = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return FAKE_QUESTIONS

    monkeypatch.setattr(tests_router, "generate_test_questions", fake_generate)

    response = await tests_router.create_and_generate_test(
        _test_request(model, subject_id=subject.id), db, progress_token=None
    )

    assert seen["existing_questions"] == ["Old question"]
    assert response.subject_id == subject.id
    config = await db.get(models.TestConfig, response.config_id)
    assert config.subject_id == subject.id
    assert config.is_template is False


async def test_create_and_generate_test_without_subject_has_no_dedupe(db_with_subject, monkeypatch):
    db, subject, model = db_with_subject
    seen = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return FAKE_QUESTIONS

    monkeypatch.setattr(tests_router, "generate_test_questions", fake_generate)

    response = await tests_router.create_and_generate_test(
        _test_request(model), db, progress_token=None
    )

    assert seen["existing_questions"] is None
    assert response.subject_id is None


async def test_create_and_generate_test_ignores_is_template(db_with_subject, monkeypatch):
    """An old client sending is_template must not create a template that owns the test."""
    db, subject, model = db_with_subject

    async def fake_generate(**kwargs):
        return FAKE_QUESTIONS

    monkeypatch.setattr(tests_router, "generate_test_questions", fake_generate)

    request = CreateAndGenerateRequest.model_validate({
        "title": "T", "num_questions": 1, "ai_model_id": model.id,
        "document_ids": [], "is_template": True,
    })
    response = await tests_router.create_and_generate_test(request, db, progress_token=None)

    config = await db.get(models.TestConfig, response.config_id)
    assert config.is_template is False


async def test_create_and_generate_test_unknown_subject_writes_nothing(db_with_subject, monkeypatch):
    db, subject, model = db_with_subject

    async def fake_generate(**kwargs):  # pragma: no cover - must not be called
        raise AssertionError("AI must not be called for an invalid subject")

    monkeypatch.setattr(tests_router, "generate_test_questions", fake_generate)
    configs_before = await _count(db, models.TestConfig)

    with pytest.raises(HTTPException) as error:
        await tests_router.create_and_generate_test(
            _test_request(model, subject_id=9999), db, progress_token=None
        )

    assert error.value.status_code == 404
    assert await _count(db, models.TestConfig) == configs_before


async def test_direct_generate_refuses_templates(db_with_subject):
    db, subject, model = db_with_subject
    template = await tests_router.create_test_config(
        test_schemas.TestConfigCreate(title="Tpl", ai_model_id=model.id, document_ids=[], is_template=True),
        db,
    )

    with pytest.raises(HTTPException) as error:
        await tests_router.generate_test(template.id, None, db, progress_token=None)

    assert error.value.status_code == 400


async def test_template_cannot_get_a_subject(db_with_subject):
    db, subject, model = db_with_subject

    with pytest.raises(HTTPException) as error:
        await tests_router.create_test_config(
            test_schemas.TestConfigCreate(
                title="Tpl", ai_model_id=model.id, document_ids=[],
                is_template=True, subject_id=subject.id,
            ),
            db,
        )
    assert error.value.status_code == 400

    template = await tests_router.create_test_config(
        test_schemas.TestConfigCreate(title="Tpl", ai_model_id=model.id, document_ids=[], is_template=True),
        db,
    )
    with pytest.raises(HTTPException) as error:
        await tests_router.update_test_config(
            template.id, test_schemas.TestConfigUpdate(subject_id=subject.id), db
        )
    assert error.value.status_code == 404


async def test_patch_config_assigns_and_unassigns_subject(db_with_subject):
    db, subject, model = db_with_subject
    config = await tests_router.create_test_config(
        test_schemas.TestConfigCreate(title="Loose", ai_model_id=model.id, document_ids=[]), db
    )
    assert config.subject_id is None

    updated = await tests_router.update_test_config(
        config.id, test_schemas.TestConfigUpdate(subject_id=subject.id), db
    )
    assert updated.subject_id == subject.id

    updated = await tests_router.update_test_config(
        config.id, test_schemas.TestConfigUpdate.model_validate({"subject_id": None}), db
    )
    assert updated.subject_id is None

    with pytest.raises(HTTPException) as error:
        await tests_router.update_test_config(
            config.id, test_schemas.TestConfigUpdate(subject_id=9999), db
        )
    assert error.value.status_code == 404


async def test_delete_config_removes_tests_but_not_templates(db_with_subject):
    db, subject, model = db_with_subject
    config = (await db.execute(
        select(models.TestConfig).where(models.TestConfig.title == "Existing")
    )).scalar_one()

    await tests_router.delete_test_config(config.id, db)

    assert await _count(db, models.TestConfig) == 0
    assert await _count(db, models.Test) == 0
    assert await _count(db, models.Question) == 0

    template = await tests_router.create_test_config(
        test_schemas.TestConfigCreate(title="Tpl", ai_model_id=model.id, document_ids=[], is_template=True),
        db,
    )
    with pytest.raises(HTTPException) as error:
        await tests_router.delete_test_config(template.id, db)
    assert error.value.status_code == 404


async def test_template_list_reports_attached_test_count(db_with_subject):
    db, subject, model = db_with_subject
    template = models.TestConfig(
        title="Legacy tpl", ai_model_id=model.id, document_ids=[], is_template=True
    )
    db.add(template)
    await db.flush()
    db.add_all([
        models.Test(config_id=template.id, total_questions=1),
        models.Test(config_id=template.id, total_questions=1),
    ])
    await db.commit()

    templates = await tests_router.list_test_templates(db)

    assert [(t.title, t.test_count) for t in templates] == [("Legacy tpl", 2)]


async def test_list_tests_reports_subject_and_template_origin(db_with_subject):
    db, subject, model = db_with_subject

    tests = await tests_router.list_tests(db)

    assert [(t.config_title, t.subject_id, t.from_template) for t in tests] == [
        ("Existing", subject.id, False)
    ]


async def test_create_and_generate_deck_with_subject_dedupes_and_links(db_with_subject, monkeypatch):
    db, subject, model = db_with_subject
    seen = {}

    async def fake_generate(**kwargs):
        seen.update(kwargs)
        return FAKE_CARDS

    monkeypatch.setattr(flashcards_router, "generate_flashcards", fake_generate)

    response = await flashcards_router.create_and_generate_deck(
        CreateAndGenerateDeckRequest(
            title="New deck", ai_model_id=model.id, num_cards=1, subject_id=subject.id
        ),
        db,
    )

    assert seen["existing_fronts"] == ["Old front"]
    assert response.deck.subject_id == subject.id


async def test_create_and_generate_deck_unknown_subject_writes_nothing(db_with_subject, monkeypatch):
    db, subject, model = db_with_subject

    async def fake_generate(**kwargs):  # pragma: no cover - must not be called
        raise AssertionError("AI must not be called for an invalid subject")

    monkeypatch.setattr(flashcards_router, "generate_flashcards", fake_generate)
    decks_before = await _count(db, models.FlashcardDeck)

    with pytest.raises(HTTPException) as error:
        await flashcards_router.create_and_generate_deck(
            CreateAndGenerateDeckRequest(
                title="New deck", ai_model_id=model.id, num_cards=1, subject_id=9999
            ),
            db,
        )

    assert error.value.status_code == 404
    assert await _count(db, models.FlashcardDeck) == decks_before


async def test_update_deck_assigns_and_unassigns_subject(db_with_subject):
    db, subject, model = db_with_subject
    deck = (await db.execute(select(models.FlashcardDeck))).scalar_one()

    updated = await flashcards_router.update_deck(
        deck.id, FlashcardDeckUpdate.model_validate({"subject_id": None}), db
    )
    assert updated.subject_id is None

    updated = await flashcards_router.update_deck(
        deck.id, FlashcardDeckUpdate(subject_id=subject.id), db
    )
    assert updated.subject_id == subject.id

    with pytest.raises(HTTPException) as error:
        await flashcards_router.update_deck(deck.id, FlashcardDeckUpdate(subject_id=9999), db)
    assert error.value.status_code == 404

    listed = await flashcards_router.list_decks(db)
    assert [d.subject_id for d in listed] == [subject.id]


async def test_subject_list_reports_due_cards(db_with_subject):
    db, subject, model = db_with_subject
    decks = (await db.execute(select(models.FlashcardDeck))).scalars().all()
    stats = await flashcards_router.get_deck_stats_map(db, decks)
    expected_due = sum(s.get("due_today", 0) for s in stats.values())

    subjects = await subjects_router.list_subjects(db)

    assert subjects[0].due_cards == expected_due
    assert expected_due > 0  # the new card is studiable today
