"""
SM-2 Spaced Repetition Algorithm implementation.

This module implements the SuperMemo 2 (SM-2) algorithm for scheduling flashcard reviews.
The algorithm adjusts review intervals based on how well the user remembers each card.

Rating Scale:
- 1 (Again): Complete failure, card needs to be relearned
- 2 (Hard): Correct but with difficulty
- 3 (Good): Correct with some effort
- 4 (Easy): Perfect recall with no hesitation
"""
from datetime import datetime, timedelta, timezone
from typing import Tuple, List, Optional
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Flashcard, FlashcardDeck

# Learning steps in minutes (for new and relearning cards)
LEARNING_STEPS = [1, 10]  # 1 minute, 10 minutes

# Minimum easiness factor
MIN_EF = 1.3

# Default easiness factor for new cards
DEFAULT_EF = 2.5


def utc_now() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


def calculate_next_review(
    state: str,
    easiness_factor: float,
    interval_days: int,
    repetitions: int,
    learning_step: int,
    rating: int
) -> Tuple[str, float, int, int, int, datetime]:
    """
    Calculate the next review parameters based on SM-2 algorithm.
    
    Args:
        state: Current card state ('new', 'learning', 'review', 'relearning')
        easiness_factor: Current EF value (>= 1.3)
        interval_days: Current interval in days
        repetitions: Number of consecutive successful reviews
        learning_step: Current step in learning phase
        rating: User's rating (1-4)
    
    Returns:
        Tuple of (new_state, new_ef, new_interval, new_repetitions, new_learning_step, next_review_at)
    """
    now = utc_now()
    
    # Rating 1 (Again) - Failed, reset to learning/relearning
    if rating == 1:
        new_state = 'relearning' if state == 'review' else 'learning'
        new_ef = max(MIN_EF, easiness_factor - 0.2)
        new_interval = 0
        new_repetitions = 0
        new_learning_step = 0
        # First learning step (1 minute)
        next_review = now + timedelta(minutes=LEARNING_STEPS[0])
        return (new_state, new_ef, new_interval, new_repetitions, new_learning_step, next_review)
    
    # Handle learning/relearning states
    if state in ('new', 'learning', 'relearning'):
        if rating >= 3:  # Good or Easy - advance learning step
            new_learning_step = learning_step + 1
            
            # Check if graduated to review state
            if new_learning_step >= len(LEARNING_STEPS):
                # Graduate to review
                new_state = 'review'
                new_learning_step = 0
                new_repetitions = 1
                
                # First review interval depends on rating
                if rating == 4:  # Easy
                    new_interval = 4
                else:  # Good
                    new_interval = 1
                
                next_review = now + timedelta(days=new_interval)
                return (new_state, easiness_factor, new_interval, new_repetitions, new_learning_step, next_review)
            else:
                # Continue learning
                next_review = now + timedelta(minutes=LEARNING_STEPS[new_learning_step])
                return (state if state != 'new' else 'learning', easiness_factor, interval_days, repetitions, new_learning_step, next_review)
        else:  # Hard (rating 2) - repeat current step
            next_review = now + timedelta(minutes=LEARNING_STEPS[learning_step])
            return (state if state != 'new' else 'learning', easiness_factor, interval_days, repetitions, learning_step, next_review)
    
    # Handle review state (graduated cards)
    # Update easiness factor based on rating
    # EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    # where q is mapped: rating 2->2, 3->4, 4->5 (to fit SM-2 scale)
    q_map = {2: 2, 3: 4, 4: 5}
    q = q_map.get(rating, 4)
    new_ef = easiness_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    new_ef = max(MIN_EF, new_ef)
    
    # Calculate new interval
    new_repetitions = repetitions + 1
    
    if new_repetitions == 1:
        new_interval = 1
    elif new_repetitions == 2:
        new_interval = 6
    else:
        new_interval = round(interval_days * new_ef)
    
    # Adjust interval based on rating
    if rating == 2:  # Hard
        new_interval = max(1, round(new_interval * 0.8))
        new_ef = max(MIN_EF, new_ef - 0.15)
    elif rating == 4:  # Easy
        new_interval = round(new_interval * 1.3)
        new_ef = min(3.0, new_ef + 0.15)  # Cap EF at 3.0
    
    next_review = now + timedelta(days=new_interval)
    
    return ('review', new_ef, new_interval, new_repetitions, 0, next_review)


async def get_due_cards(
    db: AsyncSession,
    deck_id: int,
    limit: Optional[int] = None
) -> List[Flashcard]:
    """
    Get cards that are due for review (next_review_at <= now).
    
    Args:
        db: Database session
        deck_id: ID of the deck
        limit: Maximum number of cards to return
    
    Returns:
        List of due Flashcard objects, ordered by due date (oldest first)
    """
    now = utc_now()
    
    query = (
        select(Flashcard)
        .where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state.in_(['review', 'relearning', 'learning']),
                Flashcard.next_review_at <= now
            )
        )
        .order_by(Flashcard.next_review_at.asc())
    )
    
    if limit:
        query = query.limit(limit)
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_new_cards(
    db: AsyncSession,
    deck_id: int,
    limit: int
) -> List[Flashcard]:
    """
    Get new cards that haven't been studied yet.
    
    Args:
        db: Database session
        deck_id: ID of the deck
        limit: Maximum number of new cards to return
    
    Returns:
        List of new Flashcard objects
    """
    query = (
        select(Flashcard)
        .where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state == 'new'
            )
        )
        .order_by(Flashcard.created_at.asc())
        .limit(limit)
    )
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_learning_cards(
    db: AsyncSession,
    deck_id: int
) -> List[Flashcard]:
    """
    Get cards currently in learning phase (not yet graduated).
    
    Args:
        db: Database session
        deck_id: ID of the deck
    
    Returns:
        List of learning Flashcard objects
    """
    now = utc_now()
    
    query = (
        select(Flashcard)
        .where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state.in_(['learning', 'relearning']),
                or_(
                    Flashcard.next_review_at <= now,
                    Flashcard.next_review_at.is_(None)
                )
            )
        )
        .order_by(Flashcard.next_review_at.asc())
    )
    
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_study_queue(
    db: AsyncSession,
    deck_id: int,
    new_cards_limit: int = 20
) -> List[Flashcard]:
    """
    Build the study queue for a deck following this priority:
    1. Learning/relearning cards that are due (interleaved throughout)
    2. Review cards that are due (overdue first)
    3. New cards up to daily limit
    
    Args:
        db: Database session
        deck_id: ID of the deck
        new_cards_limit: Maximum number of new cards to include
    
    Returns:
        List of Flashcard objects in study order
    """
    # Get all due cards (learning + review)
    due_cards = await get_due_cards(db, deck_id)
    
    # Separate learning and review cards
    learning_cards = [c for c in due_cards if c.state in ('learning', 'relearning')]
    review_cards = [c for c in due_cards if c.state == 'review']
    
    # Get new cards
    new_cards = await get_new_cards(db, deck_id, new_cards_limit)
    
    # Build queue: reviews first, then new cards, with learning cards interleaved
    queue = []
    
    # Add review cards
    queue.extend(review_cards)
    
    # Add new cards
    queue.extend(new_cards)
    
    # Interleave learning cards throughout (they have short intervals)
    # Insert learning cards at regular intervals
    if learning_cards and queue:
        interval = max(1, len(queue) // (len(learning_cards) + 1))
        for i, card in enumerate(learning_cards):
            insert_pos = min((i + 1) * interval, len(queue))
            queue.insert(insert_pos, card)
    elif learning_cards:
        queue = learning_cards
    
    return queue


async def get_deck_stats(
    db: AsyncSession,
    deck_id: int
) -> dict:
    """
    Get statistics for a deck.
    
    Args:
        db: Database session
        deck_id: ID of the deck
    
    Returns:
        Dictionary with deck statistics
    """
    now = utc_now()
    
    # Get deck
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()
    
    if not deck:
        return {}
    
    # Count cards by state
    result = await db.execute(
        select(Flashcard.state, Flashcard.id)
        .where(Flashcard.deck_id == deck_id)
    )
    cards = result.all()
    
    total = len(cards)
    new_count = sum(1 for s, _ in cards if s == 'new')
    learning_count = sum(1 for s, _ in cards if s in ('learning', 'relearning'))
    review_count = sum(1 for s, _ in cards if s == 'review')
    
    # Count due cards
    result = await db.execute(
        select(Flashcard)
        .where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state != 'new',
                Flashcard.next_review_at <= now
            )
        )
    )
    due_count = len(result.scalars().all())
    
    # Cards due today including new cards up to limit
    new_today = min(new_count, deck.new_cards_per_day)
    due_today = due_count + new_today
    
    # Count mastered cards (review state with high EF and good interval)
    result = await db.execute(
        select(Flashcard)
        .where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state == 'review',
                Flashcard.interval_days >= 21,  # At least 3 weeks interval
                Flashcard.easiness_factor >= 2.0  # Decent easiness factor
            )
        )
    )
    mastered_count = len(result.scalars().all())
    
    return {
        'total_cards': total,
        'new_cards': new_count,
        'learning_cards': learning_count,
        'review_cards': review_count,
        'due_today': due_today,
        'due_reviews': due_count,
        'new_available': new_today,
        'mastered_cards': mastered_count
    }


async def get_global_stats(db: AsyncSession) -> dict:
    """
    Get global flashcard statistics across all decks.
    
    Args:
        db: Database session
    
    Returns:
        Dictionary with global statistics
    """
    now = utc_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Total cards due across all decks
    result = await db.execute(
        select(Flashcard)
        .where(
            and_(
                Flashcard.state != 'new',
                Flashcard.next_review_at <= now
            )
        )
    )
    due_reviews = len(result.scalars().all())
    
    # Get all decks with their new card limits
    result = await db.execute(select(FlashcardDeck))
    decks = result.scalars().all()
    
    total_new_available = 0
    for deck in decks:
        # Count new cards in this deck
        result = await db.execute(
            select(Flashcard)
            .where(
                and_(
                    Flashcard.deck_id == deck.id,
                    Flashcard.state == 'new'
                )
            )
        )
        new_in_deck = len(result.scalars().all())
        total_new_available += min(new_in_deck, deck.new_cards_per_day)
    
    total_due = due_reviews + total_new_available
    
    # Count total decks and cards
    result = await db.execute(select(Flashcard))
    total_cards = len(result.scalars().all())
    
    return {
        'total_decks': len(decks),
        'total_cards': total_cards,
        'due_today': total_due,
        'due_reviews': due_reviews,
        'new_available': total_new_available
    }

