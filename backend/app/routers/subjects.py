"""
Subjects API Router.

Implements endpoints for organizing tests and flashcard decks into subjects
with shared configuration and centralized management.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import logging

from app.database import get_db
from app.models import (
    Subject, TestConfig, Test, Question, FlashcardDeck, Flashcard,
    Document, AIModel
)
from app.schemas.subject import (
    SubjectCreate, SubjectUpdate, SubjectResponse, SubjectListResponse,
    SubjectDetailResponse, TestConfigInSubject, FlashcardDeckInSubject,
    GenerateTestInSubjectRequest, GenerateFlashcardsInSubjectRequest,
    AddQuestionsRequest, AddCardsRequest
)
from app.schemas.test import TestResponse
from app.schemas.flashcard import FlashcardDeckResponse, GenerateFlashcardsResponse, FlashcardResponse
from app.services.test_generator import generate_test_questions
from app.services.flashcard_generator import generate_flashcards
from app.services.spaced_repetition import get_deck_stats

router = APIRouter(prefix="/api/subjects", tags=["subjects"])
logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


# ============== Subject CRUD ==============

@router.get("", response_model=List[SubjectListResponse])
async def list_subjects(db: AsyncSession = Depends(get_db)):
    """List all subjects with statistics."""
    result = await db.execute(
        select(Subject)
        .options(selectinload(Subject.ai_model))
        .order_by(Subject.created_at.desc())
    )
    subjects = result.scalars().all()
    
    response = []
    for subject in subjects:
        # Get test configs for this subject
        test_result = await db.execute(
            select(TestConfig)
            .options(selectinload(TestConfig.tests))
            .where(TestConfig.subject_id == subject.id)
        )
        test_configs = test_result.scalars().all()
        
        # Get flashcard decks for this subject
        deck_result = await db.execute(
            select(FlashcardDeck)
            .where(FlashcardDeck.subject_id == subject.id)
        )
        decks = deck_result.scalars().all()
        
        # Calculate aggregated stats
        total_tests_taken = sum(len(tc.tests) for tc in test_configs)
        completed_tests = [t for tc in test_configs for t in tc.tests if t.status == "completed"]
        average_score = None
        if completed_tests:
            scores = [t.score for t in completed_tests if t.score is not None]
            if scores:
                average_score = sum(scores) / len(scores)
        
        # Get flashcard stats
        total_cards = 0
        mastered_cards = 0
        for deck in decks:
            stats = await get_deck_stats(db, deck.id)
            total_cards += stats.get('total_cards', 0)
            mastered_cards += stats.get('mastered_cards', 0)
        
        response.append(SubjectListResponse(
            id=subject.id,
            title=subject.title,
            description=subject.description,
            ai_model_id=subject.ai_model_id,
            ai_model_name=subject.ai_model.name if subject.ai_model else None,
            document_ids=subject.document_ids,
            document_count=len(subject.document_ids) if subject.document_ids else 0,
            test_count=len(test_configs),
            deck_count=len(decks),
            total_tests_taken=total_tests_taken,
            average_score=average_score,
            total_cards=total_cards,
            mastered_cards=mastered_cards,
            created_at=subject.created_at,
            updated_at=subject.updated_at
        ))
    
    return response


@router.post("", response_model=SubjectResponse)
async def create_subject(
    subject_data: SubjectCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new subject."""
    # Validate AI model if provided
    if subject_data.ai_model_id:
        result = await db.execute(select(AIModel).where(AIModel.id == subject_data.ai_model_id))
        ai_model = result.scalar_one_or_none()
        if not ai_model:
            raise HTTPException(status_code=404, detail="AI model not found")
        if not ai_model.is_enabled:
            raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Validate documents if provided
    if subject_data.document_ids:
        result = await db.execute(
            select(Document.id).where(Document.id.in_(subject_data.document_ids))
        )
        found_ids = set(row[0] for row in result.fetchall())
        missing_ids = set(subject_data.document_ids) - found_ids
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Document(s) not found: {missing_ids}")
    
    subject = Subject(**subject_data.model_dump())
    db.add(subject)
    await db.commit()
    await db.refresh(subject)
    
    return subject


@router.get("/{subject_id}", response_model=SubjectDetailResponse)
async def get_subject(subject_id: int, db: AsyncSession = Depends(get_db)):
    """Get a subject with all its tests and flashcard decks."""
    result = await db.execute(
        select(Subject)
        .options(selectinload(Subject.ai_model))
        .where(Subject.id == subject_id)
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Get test configs with their tests
    test_result = await db.execute(
        select(TestConfig)
        .options(selectinload(TestConfig.tests))
        .where(TestConfig.subject_id == subject_id)
        .order_by(TestConfig.created_at.desc())
    )
    test_configs = test_result.scalars().all()
    
    # Get flashcard decks
    deck_result = await db.execute(
        select(FlashcardDeck)
        .where(FlashcardDeck.subject_id == subject_id)
        .order_by(FlashcardDeck.created_at.desc())
    )
    decks = deck_result.scalars().all()
    
    # Build test config responses with stats
    test_config_responses = []
    total_tests_taken = 0
    all_scores = []
    
    for tc in test_configs:
        completed_tests = [t for t in tc.tests if t.status == "completed"]
        tests_taken = len(tc.tests)
        total_tests_taken += tests_taken
        
        best_score = None
        last_score = None
        
        if completed_tests:
            scores = [t.score for t in completed_tests if t.score is not None]
            all_scores.extend(scores)
            if scores:
                best_score = max(scores)
            # Get last completed test's score
            sorted_tests = sorted(completed_tests, key=lambda t: t.completed_at or t.created_at, reverse=True)
            if sorted_tests:
                last_score = sorted_tests[0].score
        
        test_config_responses.append(TestConfigInSubject(
            id=tc.id,
            title=tc.title,
            num_questions=tc.num_questions,
            num_choices=tc.num_choices,
            tests_taken=tests_taken,
            best_score=best_score,
            last_score=last_score,
            created_at=tc.created_at
        ))
    
    # Build flashcard deck responses with stats
    deck_responses = []
    total_cards = 0
    mastered_cards = 0
    
    for deck in decks:
        stats = await get_deck_stats(db, deck.id)
        total_cards += stats.get('total_cards', 0)
        mastered_cards += stats.get('mastered_cards', 0)
        
        deck_responses.append(FlashcardDeckInSubject(
            id=deck.id,
            title=deck.title,
            description=deck.description,
            total_cards=stats.get('total_cards', 0),
            new_cards=stats.get('new_cards', 0),
            learning_cards=stats.get('learning_cards', 0),
            review_cards=stats.get('review_cards', 0),
            due_cards=stats.get('due_today', 0),
            created_at=deck.created_at
        ))
    
    average_score = None
    if all_scores:
        average_score = sum(all_scores) / len(all_scores)
    
    return SubjectDetailResponse(
        id=subject.id,
        title=subject.title,
        description=subject.description,
        ai_model_id=subject.ai_model_id,
        ai_model_name=subject.ai_model.name if subject.ai_model else None,
        document_ids=subject.document_ids,
        document_count=len(subject.document_ids) if subject.document_ids else 0,
        created_at=subject.created_at,
        updated_at=subject.updated_at,
        total_tests_taken=total_tests_taken,
        average_score=average_score,
        total_cards=total_cards,
        mastered_cards=mastered_cards,
        test_configs=test_config_responses,
        flashcard_decks=deck_responses
    )


@router.put("/{subject_id}", response_model=SubjectResponse)
async def update_subject(
    subject_id: int,
    subject_data: SubjectUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a subject's settings."""
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Validate AI model if being updated
    if subject_data.ai_model_id is not None:
        if subject_data.ai_model_id:
            result = await db.execute(select(AIModel).where(AIModel.id == subject_data.ai_model_id))
            ai_model = result.scalar_one_or_none()
            if not ai_model:
                raise HTTPException(status_code=404, detail="AI model not found")
            if not ai_model.is_enabled:
                raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Validate documents if being updated
    if subject_data.document_ids is not None:
        if subject_data.document_ids:
            result = await db.execute(
                select(Document.id).where(Document.id.in_(subject_data.document_ids))
            )
            found_ids = set(row[0] for row in result.fetchall())
            missing_ids = set(subject_data.document_ids) - found_ids
            if missing_ids:
                raise HTTPException(status_code=404, detail=f"Document(s) not found: {missing_ids}")
    
    update_data = subject_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(subject, key, value)
    
    await db.commit()
    await db.refresh(subject)
    
    return subject


@router.delete("/{subject_id}")
async def delete_subject(
    subject_id: int,
    cascade: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Delete a subject. Optionally cascade to delete all associated materials."""
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    if cascade:
        # Delete all test configs (tests and questions will cascade)
        test_result = await db.execute(
            select(TestConfig).where(TestConfig.subject_id == subject_id)
        )
        for tc in test_result.scalars().all():
            await db.delete(tc)
        
        # Delete all flashcard decks (cards will cascade)
        deck_result = await db.execute(
            select(FlashcardDeck).where(FlashcardDeck.subject_id == subject_id)
        )
        for deck in deck_result.scalars().all():
            await db.delete(deck)
    else:
        # Just unlink materials from subject
        await db.execute(
            select(TestConfig).where(TestConfig.subject_id == subject_id)
        )
        test_result = await db.execute(
            select(TestConfig).where(TestConfig.subject_id == subject_id)
        )
        for tc in test_result.scalars().all():
            tc.subject_id = None
        
        deck_result = await db.execute(
            select(FlashcardDeck).where(FlashcardDeck.subject_id == subject_id)
        )
        for deck in deck_result.scalars().all():
            deck.subject_id = None
    
    await db.delete(subject)
    await db.commit()
    
    return {"message": "Subject deleted successfully"}


# ============== Generate Materials ==============

@router.post("/{subject_id}/generate-test", response_model=TestResponse)
async def generate_test_in_subject(
    subject_id: int,
    request: GenerateTestInSubjectRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate a practice test within a subject."""
    # Get subject
    result = await db.execute(
        select(Subject)
        .options(selectinload(Subject.ai_model))
        .where(Subject.id == subject_id)
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Determine AI model (request override > subject default)
    ai_model_id = request.ai_model_id or subject.ai_model_id
    if not ai_model_id:
        raise HTTPException(status_code=400, detail="No AI model specified and subject has no default")
    
    result = await db.execute(select(AIModel).where(AIModel.id == ai_model_id))
    ai_model = result.scalar_one_or_none()
    
    if not ai_model or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")
    
    # Determine documents (request override > subject default)
    document_ids = request.document_ids if request.document_ids is not None else subject.document_ids
    documents = []
    if document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(document_ids))
        )
        documents = list(result.scalars().all())
    
    # Create test config linked to subject
    test_config = TestConfig(
        title=request.title,
        num_questions=request.num_questions,
        num_choices=request.num_choices,
        ai_model_id=ai_model_id,
        document_ids=document_ids or [],
        custom_prompt=request.custom_prompt,
        subject_id=subject_id,
        is_template=False
    )
    db.add(test_config)
    await db.flush()
    
    # Get existing questions from this subject to avoid duplicates
    existing_result = await db.execute(
        select(Question)
        .join(Test, Question.test_id == Test.id)
        .join(TestConfig, Test.config_id == TestConfig.id)
        .where(TestConfig.subject_id == subject_id)
    )
    existing_questions = [q.question_text for q in existing_result.scalars().all()]
    
    # Generate questions
    try:
        questions_data = await generate_test_questions(
            documents=documents,
            num_questions=request.num_questions,
            num_choices=request.num_choices,
            model_id=ai_model.openrouter_id,
            topic=request.title,
            custom_prompt=request.custom_prompt,
            existing_questions=existing_questions if existing_questions else None
        )
    except ValueError as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate test: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate test. Please try again.")
    
    # Create test
    test = Test(
        config_id=test_config.id,
        status="generated",
        total_questions=len(questions_data)
    )
    db.add(test)
    await db.flush()
    
    # Create questions
    for i, q_data in enumerate(questions_data):
        question = Question(
            test_id=test.id,
            question_number=i + 1,
            question_text=q_data["question"],
            choices=[{"index": j, "text": c} for j, c in enumerate(q_data["choices"])],
            correct_answer=q_data["correct_answer"],
            explanation=q_data.get("explanation", "")
        )
        db.add(question)
    
    await db.commit()
    await db.refresh(test)
    
    return TestResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=test_config.title,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at
    )


@router.post("/{subject_id}/generate-flashcards", response_model=GenerateFlashcardsResponse)
async def generate_flashcards_in_subject(
    subject_id: int,
    request: GenerateFlashcardsInSubjectRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate flashcards within a subject."""
    # Get subject
    result = await db.execute(
        select(Subject)
        .options(selectinload(Subject.ai_model))
        .where(Subject.id == subject_id)
    )
    subject = result.scalar_one_or_none()
    
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Determine AI model (request override > subject default)
    ai_model_id = request.ai_model_id or subject.ai_model_id
    if not ai_model_id:
        raise HTTPException(status_code=400, detail="No AI model specified and subject has no default")
    
    result = await db.execute(select(AIModel).where(AIModel.id == ai_model_id))
    ai_model = result.scalar_one_or_none()
    
    if not ai_model or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")
    
    # Determine documents (request override > subject default)
    document_ids = request.document_ids if request.document_ids is not None else subject.document_ids
    documents = []
    if document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(document_ids))
        )
        documents = list(result.scalars().all())
    
    # Create deck linked to subject
    deck = FlashcardDeck(
        title=request.title,
        description=request.description,
        ai_model_id=ai_model_id,
        document_ids=document_ids,
        custom_prompt=request.custom_prompt,
        subject_id=subject_id
    )
    db.add(deck)
    await db.flush()
    
    # Get existing card fronts from this subject to avoid duplicates
    existing_result = await db.execute(
        select(Flashcard.front)
        .join(FlashcardDeck, Flashcard.deck_id == FlashcardDeck.id)
        .where(FlashcardDeck.subject_id == subject_id)
    )
    existing_fronts = [row[0] for row in existing_result.fetchall()]
    
    # Generate flashcards
    try:
        cards_data = await generate_flashcards(
            documents=documents,
            num_cards=request.num_cards,
            model_id=ai_model.openrouter_id,
            topic=request.title,
            custom_prompt=request.custom_prompt,
            existing_fronts=existing_fronts if existing_fronts else None
        )
    except ValueError as e:
        logger.error(f"Failed to generate flashcards: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate flashcards: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to generate flashcards: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate flashcards. Please try again.")
    
    # Create flashcard records
    created_cards = []
    for card_data in cards_data:
        card = Flashcard(
            deck_id=deck.id,
            front=card_data["front"],
            back=card_data["back"],
            source_type="ai_generated"
        )
        db.add(card)
        await db.flush()
        created_cards.append(card)
    
    await db.commit()
    
    # Refresh cards to get IDs
    for card in created_cards:
        await db.refresh(card)
    
    return GenerateFlashcardsResponse(
        deck_id=deck.id,
        cards_generated=len(created_cards),
        cards=[FlashcardResponse.model_validate(c) for c in created_cards]
    )


# ============== Add to Existing Materials ==============

@router.post("/{subject_id}/test-configs/{config_id}/add-questions", response_model=TestResponse)
async def add_questions_to_test_config(
    subject_id: int,
    config_id: int,
    request: AddQuestionsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Add new questions to an existing test config by generating a new test."""
    # Verify subject exists
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Get test config
    result = await db.execute(
        select(TestConfig)
        .options(selectinload(TestConfig.ai_model), selectinload(TestConfig.tests))
        .where(TestConfig.id == config_id, TestConfig.subject_id == subject_id)
    )
    test_config = result.scalar_one_or_none()
    
    if not test_config:
        raise HTTPException(status_code=404, detail="Test config not found in this subject")
    
    # Determine AI model
    ai_model_id = request.ai_model_id or test_config.ai_model_id
    result = await db.execute(select(AIModel).where(AIModel.id == ai_model_id))
    ai_model = result.scalar_one_or_none()
    
    if not ai_model or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")
    
    # Get documents
    documents = []
    if test_config.document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(test_config.document_ids))
        )
        documents = list(result.scalars().all())
    
    # Get ALL existing questions from this config to avoid duplicates
    existing_result = await db.execute(
        select(Question)
        .join(Test, Question.test_id == Test.id)
        .where(Test.config_id == config_id)
    )
    existing_questions = [q.question_text for q in existing_result.scalars().all()]
    
    # Generate new questions
    try:
        questions_data = await generate_test_questions(
            documents=documents,
            num_questions=request.num_questions,
            num_choices=test_config.num_choices,
            model_id=ai_model.openrouter_id,
            topic=test_config.title,
            custom_prompt=request.custom_prompt or test_config.custom_prompt,
            existing_questions=existing_questions if existing_questions else None
        )
    except ValueError as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate questions: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to generate test questions: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate questions. Please try again.")
    
    # Create new test with the new questions
    test = Test(
        config_id=test_config.id,
        status="generated",
        total_questions=len(questions_data)
    )
    db.add(test)
    await db.flush()
    
    # Create questions
    for i, q_data in enumerate(questions_data):
        question = Question(
            test_id=test.id,
            question_number=i + 1,
            question_text=q_data["question"],
            choices=[{"index": j, "text": c} for j, c in enumerate(q_data["choices"])],
            correct_answer=q_data["correct_answer"],
            explanation=q_data.get("explanation", "")
        )
        db.add(question)
    
    await db.commit()
    await db.refresh(test)
    
    return TestResponse(
        id=test.id,
        config_id=test.config_id,
        config_title=test_config.title,
        status=test.status,
        started_at=test.started_at,
        completed_at=test.completed_at,
        score=test.score,
        total_questions=test.total_questions,
        correct_answers=test.correct_answers,
        created_at=test.created_at
    )


@router.post("/{subject_id}/decks/{deck_id}/add-cards", response_model=GenerateFlashcardsResponse)
async def add_cards_to_deck(
    subject_id: int,
    deck_id: int,
    request: AddCardsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Add new cards to an existing flashcard deck."""
    # Verify subject exists
    result = await db.execute(select(Subject).where(Subject.id == subject_id))
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    
    # Get deck
    result = await db.execute(
        select(FlashcardDeck)
        .where(FlashcardDeck.id == deck_id, FlashcardDeck.subject_id == subject_id)
    )
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found in this subject")
    
    # Determine AI model
    ai_model_id = request.ai_model_id or deck.ai_model_id
    if not ai_model_id:
        raise HTTPException(status_code=400, detail="No AI model specified and deck has no default")
    
    result = await db.execute(select(AIModel).where(AIModel.id == ai_model_id))
    ai_model = result.scalar_one_or_none()
    
    if not ai_model or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")
    
    # Get documents
    documents = []
    if deck.document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(deck.document_ids))
        )
        documents = list(result.scalars().all())
    
    # Get existing card fronts to avoid duplicates
    existing_result = await db.execute(
        select(Flashcard.front).where(Flashcard.deck_id == deck_id)
    )
    existing_fronts = [row[0] for row in existing_result.fetchall()]
    
    # Generate new cards
    try:
        cards_data = await generate_flashcards(
            documents=documents,
            num_cards=request.num_cards,
            model_id=ai_model.openrouter_id,
            topic=deck.title,
            custom_prompt=request.custom_prompt or deck.custom_prompt,
            existing_fronts=existing_fronts if existing_fronts else None
        )
    except ValueError as e:
        logger.error(f"Failed to generate flashcards: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate cards: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to generate flashcards: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate cards. Please try again.")
    
    # Create flashcard records
    created_cards = []
    for card_data in cards_data:
        card = Flashcard(
            deck_id=deck_id,
            front=card_data["front"],
            back=card_data["back"],
            source_type="ai_generated"
        )
        db.add(card)
        await db.flush()
        created_cards.append(card)
    
    await db.commit()
    
    # Refresh cards to get IDs
    for card in created_cards:
        await db.refresh(card)
    
    return GenerateFlashcardsResponse(
        deck_id=deck_id,
        cards_generated=len(created_cards),
        cards=[FlashcardResponse.model_validate(c) for c in created_cards]
    )

