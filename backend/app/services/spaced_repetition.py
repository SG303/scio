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

from datetime import datetime, timedelta, timezone, date
import json
from typing import Tuple, List, Optional
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Flashcard, FlashcardDeck, StudySession

# Learning steps in minutes (for new and relearning cards)
LEARNING_STEPS = [1, 10]  # 1 minute, 10 minutes

# Minimum easiness factor
MIN_EF = 1.3

# Default easiness factor for new cards
DEFAULT_EF = 2.5

# P4.2: daily review goal for the dashboard streak widget (initially fixed;
# making it user-configurable is a later roadmap item)
DAILY_GOAL_REVIEWS = 30


def utc_now() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


def calculate_next_review(
    state: str,
    easiness_factor: float,
    interval_days: int,
    repetitions: int,
    learning_step: int,
    rating: int,
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
        new_state = "relearning" if state == "review" else "learning"
        new_ef = max(MIN_EF, easiness_factor - 0.2)
        new_interval = 0
        new_repetitions = 0
        new_learning_step = 0
        # First learning step (1 minute)
        next_review = now + timedelta(minutes=LEARNING_STEPS[0])
        return (
            new_state,
            new_ef,
            new_interval,
            new_repetitions,
            new_learning_step,
            next_review,
        )

    # Handle learning/relearning states
    if state in ("new", "learning", "relearning"):
        if rating >= 3:  # Good or Easy - advance learning step
            new_learning_step = learning_step + 1

            # Check if graduated to review state
            if new_learning_step >= len(LEARNING_STEPS):
                # Graduate to review
                new_state = "review"
                new_learning_step = 0
                new_repetitions = 1

                # First review interval depends on rating
                if rating == 4:  # Easy
                    new_interval = 4
                else:  # Good
                    new_interval = 1

                next_review = now + timedelta(days=new_interval)
                return (
                    new_state,
                    easiness_factor,
                    new_interval,
                    new_repetitions,
                    new_learning_step,
                    next_review,
                )
            else:
                # Continue learning
                next_review = now + timedelta(minutes=LEARNING_STEPS[new_learning_step])
                return (
                    state if state != "new" else "learning",
                    easiness_factor,
                    interval_days,
                    repetitions,
                    new_learning_step,
                    next_review,
                )
        else:  # Hard (rating 2) - repeat current step
            next_review = now + timedelta(minutes=LEARNING_STEPS[learning_step])
            return (
                state if state != "new" else "learning",
                easiness_factor,
                interval_days,
                repetitions,
                learning_step,
                next_review,
            )

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

    return ("review", new_ef, new_interval, new_repetitions, 0, next_review)


async def get_due_cards(
    db: AsyncSession, deck_id: int, limit: Optional[int] = None
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
                Flashcard.state.in_(["review", "relearning", "learning"]),
                Flashcard.next_review_at <= now,
            )
        )
        .order_by(Flashcard.next_review_at.asc())
    )

    if limit:
        query = query.limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_new_cards(db: AsyncSession, deck_id: int, limit: int) -> List[Flashcard]:
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
        .where(and_(Flashcard.deck_id == deck_id, Flashcard.state == "new"))
        .order_by(Flashcard.created_at.asc())
        .limit(limit)
    )

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_learning_cards(db: AsyncSession, deck_id: int) -> List[Flashcard]:
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
                Flashcard.state.in_(["learning", "relearning"]),
                or_(
                    Flashcard.next_review_at <= now, Flashcard.next_review_at.is_(None)
                ),
            )
        )
        .order_by(Flashcard.next_review_at.asc())
    )

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_study_queue(
    db: AsyncSession,
    deck_id: int,
    new_cards_limit: int = 20,
    session_id: Optional[int] = None,
    cards_studied_json: Optional[str] = None,
    new_cards_reviewed_today: int = 0,
    study_date: Optional[date] = None,
) -> List[Flashcard]:
    """
    Build the study queue for a deck following this priority:
    1. Learning/relearning cards that are due (interleaved throughout)
    2. Review cards that are due (overdue first)
    3. New cards up to daily limit

    Supports session persistence for resume functionality.

    Args:
        db: Database session
        deck_id: ID of the deck
        new_cards_limit: Maximum number of new cards to include per day
        session_id: Optional session ID for resume tracking
        cards_studied_json: JSON array of card IDs already reviewed in this session
        new_cards_reviewed_today: Count of new cards already reviewed today
        study_date: Date of the study session (for daily limit reset)

    Returns:
        List of Flashcard objects in study order
    """
    now = utc_now()
    today = now.date()

    cards_studied = set()
    if cards_studied_json:
        try:
            cards_studied = set(json.loads(cards_studied_json))
        except (json.JSONDecodeError, TypeError):
            cards_studied = set()

    is_new_day = study_date is None or study_date != today
    if is_new_day:
        remaining_new_quota = new_cards_limit
    else:
        remaining_new_quota = max(0, new_cards_limit - new_cards_reviewed_today)

    due_cards = await get_due_cards(db, deck_id)

    due_cards = [c for c in due_cards if c.id not in cards_studied]

    learning_cards = [c for c in due_cards if c.state in ("learning", "relearning")]
    review_cards = [c for c in due_cards if c.state == "review"]

    if remaining_new_quota > 0:
        new_cards = await get_new_cards(db, deck_id, remaining_new_quota)
        new_cards = [c for c in new_cards if c.id not in cards_studied]
    else:
        new_cards = []

    return _build_interleaved_queue(learning_cards, review_cards, new_cards)


def _build_interleaved_queue(
    learning_cards: List[Flashcard],
    review_cards: List[Flashcard],
    new_cards: List[Flashcard],
) -> List[Flashcard]:
    """
    Build study queue with learning cards interleaved.

    Anki-style: Learning cards appear more frequently,
    reviews and new cards are distributed throughout.

    Args:
        learning_cards: Cards in learning/relearning state
        review_cards: Cards in review state
        new_cards: New cards to introduce

    Returns:
        Interleaved list of cards for study
    """
    queue = []

    queue.extend(review_cards)

    queue.extend(new_cards)

    if learning_cards and queue:
        interval = max(1, len(queue) // (len(learning_cards) + 1))
        for i, card in enumerate(learning_cards):
            insert_pos = min((i + 1) * interval, len(queue))
            queue.insert(insert_pos, card)
    elif learning_cards:
        queue = learning_cards

    return queue


async def get_incomplete_session(
    db: AsyncSession, deck_id: int
) -> Optional[StudySession]:
    """
    Get the most recent incomplete session for a deck from today.

    Sessions without any rated cards (empty cards_studied_json) are ignored:
    they are leftovers from accidental starts or immediate exits, not
    sessions worth resuming. This makes old ghost sessions disappear
    automatically (P2.1).

    Args:
        db: Database session
        deck_id: ID of the deck

    Returns:
        StudySession if an incomplete session with at least one rated card
        exists, None otherwise
    """
    now = utc_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(
        select(StudySession)
        .where(
            and_(
                StudySession.deck_id == deck_id,
                StudySession.completed_at.is_(None),
                StudySession.started_at >= today_start,
            )
        )
        .order_by(StudySession.started_at.desc())
        .limit(10)
    )

    for session in result.scalars():
        if _has_rated_cards(session):
            return session

    return None


def _has_rated_cards(session: StudySession) -> bool:
    """True if the session has at least one rated card recorded."""
    if not session.cards_studied_json:
        return False
    try:
        cards = json.loads(session.cards_studied_json)
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(cards)


async def get_deck_stats(db: AsyncSession, deck_id: int) -> dict:
    """
    Get statistics for a deck.

    Args:
        db: Database session
        deck_id: ID of the deck

    Returns:
        Dictionary with deck statistics
    """
    now = utc_now()
    today = now.date()

    # Get deck
    result = await db.execute(select(FlashcardDeck).where(FlashcardDeck.id == deck_id))
    deck = result.scalar_one_or_none()

    if not deck:
        return {}

    # B15/P6.3: SQL aggregates instead of loading every card row
    # Count cards by state
    result = await db.execute(
        select(Flashcard.state, func.count(Flashcard.id))
        .where(Flashcard.deck_id == deck_id)
        .group_by(Flashcard.state)
    )
    counts_by_state = dict(result.all())

    total = sum(counts_by_state.values())
    new_count = counts_by_state.get("new", 0)
    learning_count = counts_by_state.get("learning", 0) + counts_by_state.get("relearning", 0)
    review_count = counts_by_state.get("review", 0)

    # Count due cards
    result = await db.execute(
        select(func.count(Flashcard.id)).where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state != "new",
                Flashcard.next_review_at <= now,
            )
        )
    )
    due_count = result.scalar_one()

    # Cards due today including new cards up to the remaining daily quota
    # P4.3: subtract the new cards already introduced today (deck-wide), so
    # the number matches what a fresh study queue would actually deliver
    new_reviewed_today = await get_deck_new_cards_today(db, deck_id, today)
    new_today = max(0, min(new_count, deck.new_cards_per_day) - new_reviewed_today)
    due_today = due_count + new_today

    # Count mastered cards (review state with high EF and good interval)
    result = await db.execute(
        select(func.count(Flashcard.id)).where(
            and_(
                Flashcard.deck_id == deck_id,
                Flashcard.state == "review",
                Flashcard.interval_days >= 21,  # At least 3 weeks interval
                Flashcard.easiness_factor >= 2.0,  # Decent easiness factor
            )
        )
    )
    mastered_count = result.scalar_one()

    return {
        "total_cards": total,
        "new_cards": new_count,
        "learning_cards": learning_count,
        "review_cards": review_count,
        "due_today": due_today,
        "due_reviews": due_count,
        "new_available": new_today,
        "mastered_cards": mastered_count,
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

    # B15/P6.3: SQL aggregates instead of loading every card row
    # Total cards due across all decks
    result = await db.execute(
        select(func.count(Flashcard.id)).where(
            and_(Flashcard.state != "new", Flashcard.next_review_at <= now)
        )
    )
    due_reviews = result.scalar_one()

    # Get all decks with their new card limits
    result = await db.execute(select(FlashcardDeck))
    decks = result.scalars().all()

    # New cards per deck in one aggregated query
    result = await db.execute(
        select(Flashcard.deck_id, func.count(Flashcard.id))
        .where(Flashcard.state == "new")
        .group_by(Flashcard.deck_id)
    )
    new_by_deck = dict(result.all())

    # P4.3: new cards already introduced today, all decks in one query
    today = now.date()
    result = await db.execute(
        select(
            StudySession.deck_id,
            func.sum(StudySession.new_cards_reviewed_today),
        )
        .where(StudySession.study_date == today)
        .group_by(StudySession.deck_id)
    )
    new_reviewed_by_deck = {deck_id: total or 0 for deck_id, total in result.all()}

    total_new_available = 0
    for deck in decks:
        new_in_deck = new_by_deck.get(deck.id, 0)
        # P4.3: remaining quota subtracts the new cards already introduced
        # today across this deck's sessions
        new_reviewed_today = new_reviewed_by_deck.get(deck.id, 0)
        total_new_available += max(
            0, min(new_in_deck, deck.new_cards_per_day) - new_reviewed_today
        )

    total_due = due_reviews + total_new_available

    # Count total cards
    result = await db.execute(select(func.count(Flashcard.id)))
    total_cards = result.scalar_one()

    return {
        "total_decks": len(decks),
        "total_cards": total_cards,
        "due_today": total_due,
        "due_reviews": due_reviews,
        "new_available": total_new_available,
    }


# ============== Streaks (P4.2) ==============


async def get_deck_new_cards_today(
    db: AsyncSession, deck_id: int, today: date
) -> int:
    """
    P4.3: new cards already introduced today for a deck — summed over all
    of the day's sessions, so the daily limit is deck-wide instead of
    restarting with every session.

    Args:
        db: Database session
        deck_id: ID of the deck
        today: the reference date

    Returns:
        Number of new cards introduced today for this deck
    """
    result = await db.execute(
        select(StudySession).where(
            and_(
                StudySession.deck_id == deck_id,
                StudySession.study_date == today,
            )
        )
    )
    return sum((s.new_cards_reviewed_today or 0) for s in result.scalars().all())


def compute_streak(
    reviews_by_day: dict,
    today: date,
) -> Tuple[int, int]:
    """
    Compute current and longest study streak from daily review counts.

    A day counts towards a streak if at least one review happened. The
    current streak tolerates "today not studied yet": it counts down from
    today if today has reviews, otherwise from yesterday — so a streak is
    still alive in the evening before the first review of the day.

    Args:
        reviews_by_day: mapping of date -> number of reviews
        today: the reference date (usually the current date)

    Returns:
        Tuple of (current_streak, longest_streak)
    """
    days = {day for day, count in reviews_by_day.items() if count > 0}

    # Current streak: count consecutive days ending today (or yesterday)
    cursor = today if today in days else today - timedelta(days=1)
    current = 0
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)

    # Longest streak: longest run of consecutive days overall
    longest = 0
    run = 0
    for day in sorted(days):
        run = run + 1 if (day - timedelta(days=1)) in days else 1
        longest = max(longest, run)

    return current, longest


def remaining_new_quota(
    new_cards_limit: int,
    new_cards_reviewed_today: int,
    study_date: Optional[date],
    today: date,
) -> int:
    """
    P4.3: remaining new-card quota for a deck on a given day. The counter
    is deck-wide (summed over all of the day's sessions by the caller), so
    several sessions on one day share one daily limit.

    Args:
        new_cards_limit: deck's new_cards_per_day
        new_cards_reviewed_today: new cards already introduced today (deck-wide)
        study_date: the day the counter was last touched (None = untouched)
        today: the reference date

    Returns:
        Remaining new cards allowed today
    """
    if study_date is None or study_date != today:
        return new_cards_limit
    return max(0, new_cards_limit - new_cards_reviewed_today)


async def get_streak_stats(db: AsyncSession) -> dict:
    """
    P4.2: streak and daily-goal stats computed from completed sessions.

    Args:
        db: Database session

    Returns:
        Dictionary with current_streak, longest_streak, reviews_today
        and daily_goal
    """
    result = await db.execute(
        select(StudySession).where(StudySession.completed_at.isnot(None))
    )
    sessions = result.scalars().all()

    now = utc_now()
    today = now.date()

    # Reviews per day: a session's day is its study_date if set (the day
    # its daily-limit counter was last touched), else the day it completed
    reviews_by_day: dict = {}
    for session in sessions:
        day = session.study_date or (session.completed_at or session.started_at).date()
        reviews_by_day[day] = reviews_by_day.get(day, 0) + (session.cards_reviewed or 0)

    current, longest = compute_streak(reviews_by_day, today)

    return {
        "current_streak": current,
        "longest_streak": longest,
        "reviews_today": reviews_by_day.get(today, 0),
        "daily_goal": DAILY_GOAL_REVIEWS,
    }
