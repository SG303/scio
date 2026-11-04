"""Regressions for the project review; no production data or AI calls."""
from datetime import timedelta
from urllib.parse import quote

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models
from app.database import Base
from app.routers import flashcards, lectures, subjects
from app.schemas.flashcard import ReviewSubmit
from app.schemas.lecture import LectureFormatRequest


@pytest.fixture
async def database():
    engine = create_async_engine('sqlite+aiosqlite:///:memory:')
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest.mark.parametrize('change', ['content', 'title', 'delete'])
async def test_formatting_cannot_overwrite_a_concurrent_save(database, monkeypatch, change):
    async with database() as db:
        model = models.AIModel(name='Mock', openrouter_id='mock')
        subject = models.Subject(title='Subject', ai_model=model)
        lecture = models.Lecture(subject=subject, title='Title', content='Before')
        db.add(lecture)
        await db.commit()
        lecture_id = lecture.id

    async def concurrent_save(source, model_id):
        async with database() as db:
            current = await db.get(models.Lecture, lecture_id)
            if change == 'delete':
                await db.delete(current)
            else:
                setattr(current, change, 'Newer notes')
            await db.commit()
        return 'Formatted old notes'

    monkeypatch.setattr(lectures, 'format_lecture', concurrent_save)
    async with database() as db:
        with pytest.raises(HTTPException) as error:
            await lectures.format_lecture_notes(lecture_id, LectureFormatRequest(), db)
        assert error.value.status_code == 409
    async with database() as db:
        current = await db.get(models.Lecture, lecture_id)
        if change == 'delete':
            assert current is None
        else:
            assert getattr(current, change) == 'Newer notes'
            assert current.original_content is None


async def test_subject_cascade_clears_sources_in_other_decks(database):
    async with database() as db:
        model = models.AIModel(name='Mock', openrouter_id='mock')
        subject = models.Subject(title='Subject')
        config = models.TestConfig(title='Test', ai_model=model, subject=subject, document_ids=[])
        test = models.Test(config=config, total_questions=1)
        question = models.Question(test=test, question_number=1, question_text='Q', choices=[], correct_answer=0)
        db.add(question)
        await db.flush()
        deck = models.FlashcardDeck(title='Independent deck')
        card = models.Flashcard(deck=deck, front='Q', back='A', source_question_id=question.id)
        db.add(card)
        await db.commit()
        await subjects.delete_subject(subject.id, cascade=True, db=db)
        await db.refresh(card)
        assert card.source_question_id is None
        assert (await db.execute(select(models.Question))).scalars().all() == []


@pytest.mark.parametrize('format', ['csv', 'apkg'])
async def test_export_accepts_unicode_titles(database, format):
    async with database() as db:
        deck = models.FlashcardDeck(title='数学 Łódź')
        db.add(models.Flashcard(deck=deck, front='Question', back='Answer'))
        await db.commit()
        response = await flashcards.export_deck(deck.id, format=format, db=db)
        header = response.headers['content-disposition']
        assert "filename*=UTF-8''" + quote(deck.title, safe='') + '.' + format in header
        header.encode('ascii')
        assert response.body


@pytest.mark.parametrize('rating', [1, 3])
async def test_midnight_resets_quota_even_for_a_review_card(database, monkeypatch, rating):
    now = models.utc_now()
    monkeypatch.setattr(flashcards, 'utc_now', lambda: now)
    async with database() as db:
        deck = models.FlashcardDeck(title='Daily limit')
        card = models.Flashcard(deck=deck, front='Q', back='A', state='review', interval_days=1, repetitions=1)
        session = models.StudySession(deck=deck, study_date=(now - timedelta(days=1)).date(), new_cards_reviewed_today=20)
        db.add_all([card, session])
        await db.commit()
        await flashcards.submit_review(card.id, ReviewSubmit(rating=rating), session_id=session.id, db=db)
        assert session.study_date == now.date()
        assert session.new_cards_reviewed_today == 0
        new_card = models.Flashcard(deck=deck, front='New Q', back='A')
        db.add(new_card)
        await db.commit()
        await flashcards.submit_review(new_card.id, ReviewSubmit(rating=3), session_id=session.id, db=db)
        assert session.new_cards_reviewed_today == 1


