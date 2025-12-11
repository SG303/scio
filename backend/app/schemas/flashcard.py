"""
Pydantic schemas for Flashcard API endpoints.
"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


# ============== Flashcard Deck Schemas ==============

class FlashcardDeckCreate(BaseModel):
    """Schema for creating a new flashcard deck."""
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    document_ids: Optional[List[int]] = None
    custom_prompt: Optional[str] = None
    new_cards_per_day: int = Field(default=20, ge=1, le=100)


class FlashcardDeckUpdate(BaseModel):
    """Schema for updating a flashcard deck."""
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    new_cards_per_day: Optional[int] = Field(None, ge=1, le=100)


class FlashcardDeckResponse(BaseModel):
    """Schema for flashcard deck in responses."""
    id: int
    title: str
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    document_ids: Optional[List[int]] = None
    custom_prompt: Optional[str] = None
    new_cards_per_day: int
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


# ============== Flashcard Schemas ==============

class FlashcardCreate(BaseModel):
    """Schema for creating a flashcard manually."""
    front: str = Field(..., min_length=1)
    back: str = Field(..., min_length=1)


class FlashcardUpdate(BaseModel):
    """Schema for updating a flashcard's content."""
    front: Optional[str] = Field(None, min_length=1)
    back: Optional[str] = Field(None, min_length=1)


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
    next_review_at: Optional[datetime] = None
    source_type: Optional[str] = None
    source_question_id: Optional[int] = None
    created_at: datetime
    last_reviewed_at: Optional[datetime] = None
    
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
    time_taken_ms: Optional[int] = Field(None, ge=0, description="Time taken to answer in milliseconds")


class ReviewResponse(BaseModel):
    """Schema for review submission response."""
    card_id: int
    rating: int
    new_state: str
    next_review_at: Optional[datetime] = None
    interval_days: int


# ============== Study Session Schemas ==============

class StudySessionCreate(BaseModel):
    """Schema for starting a study session."""
    deck_id: Optional[int] = None  # Null for all decks


class StudySessionResponse(BaseModel):
    """Schema for study session in responses."""
    id: int
    deck_id: Optional[int] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
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
    topic: Optional[str] = None  # Optional topic override


class GenerateFlashcardsResponse(BaseModel):
    """Schema for flashcard generation response."""
    deck_id: int
    cards_generated: int
    cards: List[FlashcardResponse]


# ============== Test Integration Schemas ==============

class CreateFromTestRequest(BaseModel):
    """Schema for creating flashcards from test results."""
    deck_id: Optional[int] = None  # Null to create new deck
    deck_title: Optional[str] = None  # Title for new deck (required if deck_id is None)
    wrong_only: bool = Field(default=True, description="Only create cards from wrong answers")


class CreateFromTestResponse(BaseModel):
    """Schema for test-to-flashcard conversion response."""
    deck_id: int
    cards_created: int
    cards: List[FlashcardResponse]


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


# ============== Study Queue Schemas ==============

class StudyQueueResponse(BaseModel):
    """Response containing cards to study."""
    deck_id: int
    total_cards: int
    cards: List[FlashcardStudyResponse]

