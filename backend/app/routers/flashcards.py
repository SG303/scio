"""
Flashcard API Router.

Implements all endpoints for flashcard deck management, card operations,
study sessions, and spaced repetition functionality.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import logging

from app.database import get_db
from app.models import (
    FlashcardDeck, Flashcard, FlashcardReview, StudySession,
    Document, AIModel, Test, Question
)
from app.schemas.flashcard import (
    FlashcardDeckCreate, FlashcardDeckUpdate, FlashcardDeckResponse, FlashcardDeckWithStats,
    FlashcardCreate, FlashcardUpdate, FlashcardResponse, FlashcardStudyResponse,
    ReviewSubmit, ReviewResponse,
    StudySessionCreate, StudySessionResponse, StudySessionComplete,
    GenerateFlashcardsRequest, GenerateFlashcardsResponse,
    CreateFromTestRequest, CreateFromTestResponse,
    DeckStats, GlobalStats, StudyQueueResponse
)
from app.services.spaced_repetition import (
    calculate_next_review, get_study_queue, get_deck_stats, get_global_stats
)
from app.services.flashcard_generator import generate_flashcards, create_flashcards_from_questions

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])
logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


# ============== Deck Endpoints ==============

@router.get("/decks", response_model=List[FlashcardDeckWithStats])
async def list_decks(db: AsyncSession = Depends(get_db)):
    """List all flashcard decks with statistics."""
    result = await db.execute(
        select(FlashcardDeck).order_by(FlashcardDeck.created_at.desc())
    )
    decks = result.scalars().all()
    
    response = []
    for deck in decks:
        stats = await get_deck_stats(db, deck.id)
        response.append(FlashcardDeckWithStats(
            id=deck.id,
            title=deck.title,
            description=deck.description,
            ai_model_id=deck.ai_model_id,
            document_ids=deck.document_ids,
            custom_prompt=deck.custom_prompt,
            new_cards_per_day=deck.new_cards_per_day,
            created_at=deck.created_at,
            updated_at=deck.updated_at,
            total_cards=stats.get('total_cards', 0),
            new_cards=stats.get('new_cards', 0),
            due_cards=stats.get('due_today', 0),
            learning_cards=stats.get('learning_cards', 0),
            review_cards=stats.get('review_cards', 0)
        ))
    
    return response


@router.post("/decks", response_model=FlashcardDeckResponse)
async def create_deck(
    deck_data: FlashcardDeckCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new flashcard deck."""
    # Validate AI model if provided
    if deck_data.ai_model_id:
        result = await db.execute(select(AIModel).where(AIModel.id == deck_data.ai_model_id))
        ai_model = result.scalar_one_or_none()
        if not ai_model:
            raise HTTPException(status_code=404, detail="AI model not found")
        if not ai_model.is_enabled:
            raise HTTPException(status_code=400, detail="AI model is not enabled")
    
    # Validate documents if provided
    if deck_data.document_ids:
        result = await db.execute(
            select(Document.id).where(Document.id.in_(deck_data.document_ids))
        )
        found_ids = set(row[0] for row in result.fetchall())
        missing_ids = set(deck_data.document_ids) - found_ids
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Document(s) not found: {missing_ids}")
    
    deck = FlashcardDeck(**deck_data.model_dump())
    db.add(deck)
    await db.commit()
    await db.refresh(deck)
    
    return deck


@router.get("/decks/{deck_id}", response_model=FlashcardDeckWithStats)
async def get_deck(deck_id: int, db: AsyncSession = Depends(get_db)):
    """Get a flashcard deck with statistics."""
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    stats = await get_deck_stats(db, deck_id)
    
    return FlashcardDeckWithStats(
        id=deck.id,
        title=deck.title,
        description=deck.description,
        ai_model_id=deck.ai_model_id,
        document_ids=deck.document_ids,
        custom_prompt=deck.custom_prompt,
        new_cards_per_day=deck.new_cards_per_day,
        created_at=deck.created_at,
        updated_at=deck.updated_at,
        total_cards=stats.get('total_cards', 0),
        new_cards=stats.get('new_cards', 0),
        due_cards=stats.get('due_today', 0),
        learning_cards=stats.get('learning_cards', 0),
        review_cards=stats.get('review_cards', 0)
    )


@router.put("/decks/{deck_id}", response_model=FlashcardDeckResponse)
async def update_deck(
    deck_id: int,
    deck_data: FlashcardDeckUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a flashcard deck's settings."""
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    update_data = deck_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(deck, key, value)
    
    await db.commit()
    await db.refresh(deck)
    
    return deck


@router.delete("/decks/{deck_id}")
async def delete_deck(deck_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a flashcard deck and all its cards."""
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    await db.delete(deck)
    await db.commit()
    
    return {"message": "Deck deleted successfully"}


# ============== Card Generation ==============

@router.post("/decks/{deck_id}/generate", response_model=GenerateFlashcardsResponse)
async def generate_cards_for_deck(
    deck_id: int,
    request: GenerateFlashcardsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate flashcards for a deck using AI."""
    # Get deck with AI model
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    if not deck.ai_model_id:
        raise HTTPException(status_code=400, detail="Deck has no AI model configured")
    
    # Get AI model
    result = await db.execute(select(AIModel).where(AIModel.id == deck.ai_model_id))
    ai_model = result.scalar_one_or_none()
    
    if not ai_model or not ai_model.is_enabled:
        raise HTTPException(status_code=400, detail="AI model not available")
    
    # Get documents if configured
    documents = []
    if deck.document_ids:
        result = await db.execute(
            select(Document).where(Document.id.in_(deck.document_ids))
        )
        documents = list(result.scalars().all())
    
    # Get existing card fronts to avoid duplicates
    result = await db.execute(
        select(Flashcard.front).where(Flashcard.deck_id == deck_id)
    )
    existing_fronts = [row[0] for row in result.fetchall()]
    
    # Generate flashcards
    topic = request.topic or deck.title
    try:
        cards_data = await generate_flashcards(
            documents=documents,
            num_cards=request.num_cards,
            model_id=ai_model.openrouter_id,
            topic=topic,
            custom_prompt=deck.custom_prompt,
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


# ============== Card CRUD ==============

@router.get("/decks/{deck_id}/cards", response_model=List[FlashcardResponse])
async def list_cards(deck_id: int, db: AsyncSession = Depends(get_db)):
    """List all cards in a deck."""
    # Verify deck exists
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Deck not found")
    
    result = await db.execute(
        select(Flashcard)
        .where(Flashcard.deck_id == deck_id)
        .order_by(Flashcard.created_at.desc())
    )
    cards = result.scalars().all()
    
    return [FlashcardResponse.model_validate(c) for c in cards]


@router.post("/decks/{deck_id}/cards", response_model=FlashcardResponse)
async def create_card(
    deck_id: int,
    card_data: FlashcardCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a flashcard manually."""
    # Verify deck exists
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Deck not found")
    
    card = Flashcard(
        deck_id=deck_id,
        front=card_data.front,
        back=card_data.back,
        source_type="manual"
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    
    return FlashcardResponse.model_validate(card)


@router.put("/cards/{card_id}", response_model=FlashcardResponse)
async def update_card(
    card_id: int,
    card_data: FlashcardUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a flashcard's content."""
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    
    update_data = card_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(card, key, value)
    
    await db.commit()
    await db.refresh(card)
    
    return FlashcardResponse.model_validate(card)


@router.delete("/cards/{card_id}")
async def delete_card(card_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a flashcard."""
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    
    await db.delete(card)
    await db.commit()
    
    return {"message": "Card deleted successfully"}


# ============== Study Endpoints ==============

@router.get("/decks/{deck_id}/study", response_model=StudyQueueResponse)
async def get_study_cards(deck_id: int, db: AsyncSession = Depends(get_db)):
    """Get the study queue for a deck."""
    # Get deck to access new_cards_per_day setting
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    
    cards = await get_study_queue(db, deck_id, deck.new_cards_per_day)
    
    return StudyQueueResponse(
        deck_id=deck_id,
        total_cards=len(cards),
        cards=[FlashcardStudyResponse(
            id=c.id,
            front=c.front,
            back=c.back,
            state=c.state
        ) for c in cards]
    )


@router.post("/cards/{card_id}/review", response_model=ReviewResponse)
async def submit_review(
    card_id: int,
    review: ReviewSubmit,
    db: AsyncSession = Depends(get_db)
):
    """Submit a review rating for a flashcard."""
    result = await db.execute(select(Flashcard).where(Flashcard.id == card_id))
    card = result.scalar_one_or_none()
    
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    
    # Store old state for review record
    old_state = card.state
    old_interval = card.interval_days
    
    # Calculate new review parameters
    new_state, new_ef, new_interval, new_reps, new_step, next_review = calculate_next_review(
        state=card.state,
        easiness_factor=card.easiness_factor,
        interval_days=card.interval_days,
        repetitions=card.repetitions,
        learning_step=card.learning_step,
        rating=review.rating
    )
    
    # Update card
    card.state = new_state
    card.easiness_factor = new_ef
    card.interval_days = new_interval
    card.repetitions = new_reps
    card.learning_step = new_step
    card.next_review_at = next_review
    card.last_reviewed_at = utc_now()
    
    # Create review record
    review_record = FlashcardReview(
        card_id=card_id,
        rating=review.rating,
        time_taken_ms=review.time_taken_ms,
        state_before=old_state,
        interval_before=old_interval
    )
    db.add(review_record)
    
    await db.commit()
    await db.refresh(card)
    
    return ReviewResponse(
        card_id=card_id,
        rating=review.rating,
        new_state=card.state,
        next_review_at=card.next_review_at,
        interval_days=card.interval_days
    )


# ============== Study Sessions ==============

@router.post("/sessions", response_model=StudySessionResponse)
async def start_session(
    session_data: StudySessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """Start a new study session."""
    # Verify deck exists if specified
    if session_data.deck_id:
        result = await db.execute(
            select(FlashcardDeck).where(FlashcardDeck.id == session_data.deck_id)
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Deck not found")
    
    session = StudySession(deck_id=session_data.deck_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    
    return StudySessionResponse.model_validate(session)


@router.post("/sessions/{session_id}/complete", response_model=StudySessionResponse)
async def complete_session(
    session_id: int,
    completion: StudySessionComplete,
    db: AsyncSession = Depends(get_db)
):
    """Complete a study session and save stats."""
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if session.completed_at:
        raise HTTPException(status_code=400, detail="Session already completed")
    
    # Calculate session stats from reviews made during session
    result = await db.execute(
        select(FlashcardReview)
        .where(
            and_(
                FlashcardReview.reviewed_at >= session.started_at,
                FlashcardReview.reviewed_at <= utc_now()
            )
        )
    )
    reviews = result.scalars().all()
    
    # If deck_id is set, filter to that deck's cards
    if session.deck_id:
        result = await db.execute(
            select(Flashcard.id).where(Flashcard.deck_id == session.deck_id)
        )
        deck_card_ids = set(row[0] for row in result.fetchall())
        reviews = [r for r in reviews if r.card_id in deck_card_ids]
    
    session.completed_at = utc_now()
    session.total_time_ms = completion.total_time_ms
    session.cards_reviewed = len(reviews)
    session.cards_again = sum(1 for r in reviews if r.rating == 1)
    session.cards_hard = sum(1 for r in reviews if r.rating == 2)
    session.cards_good = sum(1 for r in reviews if r.rating == 3)
    session.cards_easy = sum(1 for r in reviews if r.rating == 4)
    
    await db.commit()
    await db.refresh(session)
    
    return StudySessionResponse.model_validate(session)


@router.get("/sessions/{session_id}", response_model=StudySessionResponse)
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """Get a study session."""
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return StudySessionResponse.model_validate(session)


# ============== Stats ==============

@router.get("/stats", response_model=GlobalStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Get global flashcard statistics."""
    stats = await get_global_stats(db)
    return GlobalStats(**stats)


@router.get("/decks/{deck_id}/stats", response_model=DeckStats)
async def get_deck_statistics(deck_id: int, db: AsyncSession = Depends(get_db)):
    """Get statistics for a specific deck."""
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Deck not found")
    
    stats = await get_deck_stats(db, deck_id)
    return DeckStats(**stats)


# ============== Test Integration ==============

@router.post("/from-test/{test_id}", response_model=CreateFromTestResponse)
async def create_from_test(
    test_id: int,
    request: CreateFromTestRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create flashcards from test questions (wrong answers by default)."""
    # Get test with questions
    result = await db.execute(
        select(Test)
        .options(selectinload(Test.questions), selectinload(Test.config))
        .where(Test.id == test_id)
    )
    test = result.scalar_one_or_none()
    
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.status != "completed":
        raise HTTPException(status_code=400, detail="Test must be completed first")
    
    # Get or create deck
    if request.deck_id:
        result = await db.execute(
            select(FlashcardDeck).where(FlashcardDeck.id == request.deck_id)
        )
        deck = result.scalar_one_or_none()
        if not deck:
            raise HTTPException(status_code=404, detail="Deck not found")
    else:
        # Create new deck
        deck_title = request.deck_title or f"From Test: {test.config.title if test.config else f'Test #{test_id}'}"
        deck = FlashcardDeck(title=deck_title)
        db.add(deck)
        await db.flush()
    
    # Convert questions to flashcards
    cards_data = create_flashcards_from_questions(test.questions, request.wrong_only)
    
    if not cards_data:
        raise HTTPException(
            status_code=400,
            detail="No questions to convert" if request.wrong_only else "No wrong answers to convert"
        )
    
    # Create flashcard records
    created_cards = []
    for card_data in cards_data:
        card = Flashcard(
            deck_id=deck.id,
            front=card_data["front"],
            back=card_data["back"],
            source_type=card_data.get("source_type", "from_test"),
            source_question_id=card_data.get("source_question_id")
        )
        db.add(card)
        await db.flush()
        created_cards.append(card)
    
    await db.commit()
    
    # Refresh to get IDs
    for card in created_cards:
        await db.refresh(card)
    
    return CreateFromTestResponse(
        deck_id=deck.id,
        cards_created=len(created_cards),
        cards=[FlashcardResponse.model_validate(c) for c in created_cards]
    )

