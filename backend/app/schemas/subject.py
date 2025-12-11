from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class SubjectCreate(BaseModel):
    """Schema for creating a new subject"""
    title: str
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    document_ids: Optional[List[int]] = None


class SubjectUpdate(BaseModel):
    """Schema for updating an existing subject"""
    title: Optional[str] = None
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    document_ids: Optional[List[int]] = None


class SubjectResponse(BaseModel):
    """Basic subject response"""
    id: int
    title: str
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    document_ids: Optional[List[int]] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class SubjectListResponse(BaseModel):
    """Subject response with stats for listing"""
    id: int
    title: str
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    ai_model_name: Optional[str] = None
    document_ids: Optional[List[int]] = None
    document_count: int = 0
    test_count: int = 0
    deck_count: int = 0
    # Aggregated stats
    total_tests_taken: int = 0
    average_score: Optional[float] = None
    total_cards: int = 0
    mastered_cards: int = 0
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class TestConfigInSubject(BaseModel):
    """Test config info for subject detail view"""
    id: int
    title: str
    num_questions: int
    num_choices: int
    tests_taken: int = 0
    best_score: Optional[int] = None
    last_score: Optional[int] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class FlashcardDeckInSubject(BaseModel):
    """Flashcard deck info for subject detail view"""
    id: int
    title: str
    description: Optional[str] = None
    total_cards: int = 0
    new_cards: int = 0
    learning_cards: int = 0
    review_cards: int = 0
    due_cards: int = 0
    created_at: datetime
    
    class Config:
        from_attributes = True


class SubjectDetailResponse(BaseModel):
    """Full subject detail with all tests and decks"""
    id: int
    title: str
    description: Optional[str] = None
    ai_model_id: Optional[int] = None
    ai_model_name: Optional[str] = None
    document_ids: Optional[List[int]] = None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime
    # Stats
    total_tests_taken: int = 0
    average_score: Optional[float] = None
    total_cards: int = 0
    mastered_cards: int = 0
    # Materials
    test_configs: List[TestConfigInSubject] = []
    flashcard_decks: List[FlashcardDeckInSubject] = []
    
    class Config:
        from_attributes = True


class GenerateTestInSubjectRequest(BaseModel):
    """Request to generate a test within a subject"""
    title: str
    num_questions: int = 10
    num_choices: int = 4
    ai_model_id: Optional[int] = None  # Override subject default
    document_ids: Optional[List[int]] = None  # Override subject default
    custom_prompt: Optional[str] = None


class GenerateFlashcardsInSubjectRequest(BaseModel):
    """Request to generate flashcards within a subject"""
    title: str
    description: Optional[str] = None
    num_cards: int = 20
    ai_model_id: Optional[int] = None  # Override subject default
    document_ids: Optional[List[int]] = None  # Override subject default
    custom_prompt: Optional[str] = None


class AddQuestionsRequest(BaseModel):
    """Request to add questions to an existing test config"""
    num_questions: int = 10
    ai_model_id: Optional[int] = None  # Override config's model
    custom_prompt: Optional[str] = None


class AddCardsRequest(BaseModel):
    """Request to add cards to an existing deck"""
    num_cards: int = 10
    ai_model_id: Optional[int] = None  # Override deck's model
    custom_prompt: Optional[str] = None

