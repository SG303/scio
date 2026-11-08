"""
Pydantic schemas for Flashcard API endpoints.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from app.services.language import Language

# ============== Flashcard Deck Schemas ==============


class FlashcardDeckCreate(BaseModel):
    """Schema for creating a new flashcard deck."""

    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    ai_model_id: int | None = None
    document_ids: list[int] | None = None
    custom_prompt: str | None = None
    language: Language = None  # None = language of the material
    new_cards_per_day: int = Field(default=20, ge=1, le=100)
    subject_id: int | None = None  # Optional subject grouping


class FlashcardDeckUpdate(BaseModel):
    """Schema for updating a flashcard deck."""

    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    new_cards_per_day: int | None = Field(None, ge=1, le=100)
    subject_id: int | None = None  # explicit null unassigns the subject


class FlashcardDeckResponse(BaseModel):
    """Schema for flashcard deck in responses."""

    id: int
    title: str
    description: str | None = None
    ai_model_id: int | None = None
    document_ids: list[int] | None = None
    custom_prompt: str | None = None
    language: Language = None  # None = language of the material
    new_cards_per_day: int
    subject_id: int | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FlashcardDeckWithStats(FlashcardDeckResponse):
    """Deck response with computed statistics."""

    total_cards: int = 0
    new_cards: int = 0
    due_cards: int = 0
    learning_cards: int = 0
    review_cards: int = 0
    # P4.3: what a fresh study queue would deliver right now — used by the
    # frontend to disable study buttons honestly
    due_reviews: int = 0
    new_available: int = 0


# ============== Flashcard Schemas ==============


class FlashcardCreate(BaseModel):
    """Schema for creating a flashcard manually."""

    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)


class FlashcardUpdate(BaseModel):
    """Schema for updating a flashcard's content."""

    front: str | None = Field(None, min_length=1)
    back: str | None = Field(None, min_length=1)


class FlashcardResponse(BaseModel):
    """Schema for flashcard in responses."""

    id: int
    deck_id: int
    front: str
    back: str
    state: str
    easiness_factor: float
    interval_days: int
    repetitions: int
    next_review_at: datetime | None = None
    source_type: str | None = None
    source_question_id: int | None = None
    created_at: datetime
    last_reviewed_at: datetime | None = None

    class Config:
        from_attributes = True


class FlashcardStudyResponse(BaseModel):
    """Simplified flashcard response for study sessions (hides SR internals)."""

    id: int
    front: str
    back: str
    state: str


# ============== Review Schemas ==============


class ReviewSubmit(BaseModel):
    """Schema for submitting a flashcard review."""

    rating: int = Field(..., ge=1, le=4, description="1=Again, 2=Hard, 3=Good, 4=Easy")
    time_taken_ms: int | None = Field(
        None, ge=0, description="Time taken to answer in milliseconds"
    )


class ReviewResponse(BaseModel):
    """Schema for review submission response."""

    card_id: int
    rating: int
    new_state: str
    next_review_at: datetime | None = None
    interval_days: int


# ============== Study Session Schemas ==============


class StudySessionCreate(BaseModel):
    """Schema for starting a study session."""

    deck_id: int | None = None  # Null for all decks


class StudySessionResponse(BaseModel):
    """Schema for study session in responses."""

    id: int
    deck_id: int | None = None
    started_at: datetime
    completed_at: datetime | None = None
    cards_reviewed: int
    cards_again: int
    cards_hard: int
    cards_good: int
    cards_easy: int
    total_time_ms: int

    class Config:
        from_attributes = True


class StudySessionComplete(BaseModel):
    """Schema for completing a study session."""

    total_time_ms: int = Field(default=0, ge=0)


# ============== Generation Schemas ==============


class GenerateFlashcardsRequest(BaseModel):
    """Schema for AI flashcard generation request."""

    num_cards: int = Field(default=20, ge=1, le=100)
    topic: str | None = None  # Optional topic override


class GenerateFlashcardsResponse(BaseModel):
    """Schema for flashcard generation response."""

    deck_id: int
    cards_generated: int
    cards: list[FlashcardResponse]


class CreateAndGenerateDeckRequest(FlashcardDeckCreate):
    """P5.2: create a deck and generate its first cards in one transaction —
    a failed generation leaves no empty deck behind. With ``deck_id`` the
    cards are added to that existing deck instead."""

    num_cards: int = Field(ge=1, le=100)  # required, no default
    topic: str | None = None
    lecture_ids: list[int] = []  # lecture notes as additional study material
    # Add the cards to this deck instead of creating a new one. The deck keeps
    # its title/subject/language; the sources of this request are added to the
    # deck's sources so later generations know them.
    deck_id: int | None = None


class CreateAndGenerateDeckResponse(BaseModel):
    """Schema for the combined create-and-generate response."""

    deck: FlashcardDeckResponse
    cards_generated: int


class ImportCardsResult(BaseModel):
    """P6.1: result of a CSV import into a deck."""

    cards_imported: int
    rows_skipped: int


# ============== Analytics Schemas (P6.3) ==============


class ReviewsPerDay(BaseModel):
    date: str  # YYYY-MM-DD
    reviews: int


class DeckAnswerTime(BaseModel):
    deck_id: int
    deck_title: str
    avg_time_ms: float | None = None
    review_count: int


class SubjectScorePoint(BaseModel):
    test_id: int
    date: str  # YYYY-MM-DD of completion
    score: int


class SubjectScoreSeries(BaseModel):
    subject_id: int
    subject_title: str
    points: list[SubjectScorePoint]


class FlashcardAnalytics(BaseModel):
    reviews_per_day: list[ReviewsPerDay]
    state_distribution: dict
    avg_answer_time_ms: float | None = None
    per_deck: list[DeckAnswerTime]
    subject_scores: list[SubjectScoreSeries]


# ============== Test Integration Schemas ==============


class CreateFromTestRequest(BaseModel):
    """Schema for creating flashcards from test results."""

    deck_id: int | None = None  # Null to create new deck
    deck_title: str | None = None  # Title for new deck (required if deck_id is None)
    wrong_only: bool = Field(default=True, description="Only create cards from wrong answers")


class CreateFromTestResponse(BaseModel):
    """Schema for test-to-flashcard conversion response."""

    deck_id: int
    cards_created: int
    cards_skipped: int = Field(
        default=0,
        description="Cards skipped because the deck already has one for that source question",
    )
    cards: list[FlashcardResponse]


# ============== Stats Schemas ==============


class DeckStats(BaseModel):
    """Statistics for a single deck."""

    total_cards: int
    new_cards: int
    learning_cards: int
    review_cards: int
    due_today: int
    due_reviews: int
    new_available: int


class GlobalStats(BaseModel):
    """Global flashcard statistics."""

    total_decks: int
    total_cards: int
    due_today: int
    due_reviews: int
    new_available: int


class StreakResponse(BaseModel):
    """P4.2: study streak and daily goal statistics."""

    current_streak: int
    longest_streak: int
    reviews_today: int
    daily_goal: int
    due_today: int


# ============== Study Queue Schemas ==============


class StudyQueueResponse(BaseModel):
    """Response containing cards to study."""

    deck_id: int
    total_cards: int
    cards: list[FlashcardStudyResponse]
