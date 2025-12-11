from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base


def utc_now():
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


class Setting(Base):
    """Key-value settings storage"""
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)


class AIModel(Base):
    __tablename__ = "ai_models"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    openrouter_id = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    is_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now)
    
    # Relationships
    test_configs = relationship("TestConfig", back_populates="ai_model")
    subjects = relationship("Subject", back_populates="ai_model")


class Subject(Base):
    """A subject/topic that groups related tests and flashcard decks"""
    __tablename__ = "subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Default configuration for materials created within this subject
    ai_model_id = Column(Integer, ForeignKey("ai_models.id"), nullable=True)
    document_ids = Column(JSON, nullable=True)  # List of assigned document IDs
    
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
    
    # Relationships
    ai_model = relationship("AIModel", back_populates="subjects")
    test_configs = relationship("TestConfig", back_populates="subject")
    flashcard_decks = relationship("FlashcardDeck", back_populates="subject")


class Document(Base):
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    doc_type = Column(String(50), nullable=False)  # exam_objectives, study_guide, example_questions
    content = Column(Text, nullable=True)  # Extracted text content
    file_path = Column(String(500), nullable=True)  # Original file path
    file_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class TestConfig(Base):
    __tablename__ = "test_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    num_questions = Column(Integer, nullable=False, default=10)
    num_choices = Column(Integer, nullable=False, default=4)
    ai_model_id = Column(Integer, ForeignKey("ai_models.id"), nullable=False)
    document_ids = Column(JSON, nullable=False)  # List of document IDs to use as context
    is_template = Column(Boolean, default=False)  # Whether this config is a reusable template
    custom_prompt = Column(Text, nullable=True)  # Optional custom prompt for test generation
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True, index=True)  # Optional subject grouping
    created_at = Column(DateTime, default=utc_now)
    
    # Relationships
    ai_model = relationship("AIModel", back_populates="test_configs")
    tests = relationship("Test", back_populates="config")
    subject = relationship("Subject", back_populates="test_configs")


class Test(Base):
    __tablename__ = "tests"
    
    id = Column(Integer, primary_key=True, index=True)
    config_id = Column(Integer, ForeignKey("test_configs.id"), nullable=False, index=True)
    status = Column(String(50), default="generated")  # generated, in_progress, completed
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    score = Column(Integer, nullable=True)  # Percentage score
    total_questions = Column(Integer, nullable=False)
    correct_answers = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    
    # Relationships
    config = relationship("TestConfig", back_populates="tests")
    questions = relationship("Question", back_populates="test", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"
    
    id = Column(Integer, primary_key=True, index=True)
    test_id = Column(Integer, ForeignKey("tests.id"), nullable=False, index=True)
    question_number = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    choices = Column(JSON, nullable=False)  # List of choice objects
    correct_answer = Column(Integer, nullable=False)  # Index of correct choice
    explanation = Column(Text, nullable=True)
    user_answer = Column(Integer, nullable=True)  # Index of user's answer
    is_correct = Column(Boolean, nullable=True)
    
    # Relationships
    test = relationship("Test", back_populates="questions")


# ============== Flashcard Models ==============

class FlashcardDeck(Base):
    """A collection of flashcards with generation config"""
    __tablename__ = "flashcard_decks"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Generation configuration (mirrors TestConfig pattern)
    ai_model_id = Column(Integer, ForeignKey("ai_models.id"), nullable=True)
    document_ids = Column(JSON, nullable=True)  # List of source document IDs
    custom_prompt = Column(Text, nullable=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True, index=True)  # Optional subject grouping
    
    # Settings
    new_cards_per_day = Column(Integer, default=20)  # Daily limit for new cards
    
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
    
    # Relationships
    ai_model = relationship("AIModel")
    cards = relationship("Flashcard", back_populates="deck", cascade="all, delete-orphan")
    study_sessions = relationship("StudySession", back_populates="deck", cascade="all, delete-orphan")
    subject = relationship("Subject", back_populates="flashcard_decks")


class Flashcard(Base):
    """Individual flashcard with spaced repetition data"""
    __tablename__ = "flashcards"
    
    id = Column(Integer, primary_key=True, index=True)
    deck_id = Column(Integer, ForeignKey("flashcard_decks.id"), nullable=False, index=True)
    
    # Content
    front = Column(Text, nullable=False)  # Question/prompt
    back = Column(Text, nullable=False)   # Answer
    
    # SM-2 Spaced Repetition Fields
    state = Column(String(20), default='new')  # 'new', 'learning', 'review', 'relearning'
    easiness_factor = Column(Float, default=2.5)  # EF, minimum 1.3
    interval_days = Column(Integer, default=0)  # Current interval in days
    repetitions = Column(Integer, default=0)  # Consecutive correct reviews
    next_review_at = Column(DateTime, nullable=True, index=True)  # When card is due
    
    # Learning phase tracking (for 'learning' and 'relearning' states)
    learning_step = Column(Integer, default=0)  # Current step in learning sequence
    
    # Source tracking (for test integration)
    source_type = Column(String(50), nullable=True)  # 'ai_generated', 'from_test', 'manual'
    source_question_id = Column(Integer, ForeignKey("questions.id"), nullable=True)
    
    created_at = Column(DateTime, default=utc_now)
    last_reviewed_at = Column(DateTime, nullable=True)
    
    # Relationships
    deck = relationship("FlashcardDeck", back_populates="cards")
    reviews = relationship("FlashcardReview", back_populates="card", cascade="all, delete-orphan")
    source_question = relationship("Question")


class FlashcardReview(Base):
    """Record of each review for analytics"""
    __tablename__ = "flashcard_reviews"
    
    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("flashcards.id"), nullable=False, index=True)
    
    rating = Column(Integer, nullable=False)  # 1=Again, 2=Hard, 3=Good, 4=Easy
    time_taken_ms = Column(Integer, nullable=True)  # How long user took to answer
    
    # Snapshot of card state at review time (for analytics)
    state_before = Column(String(20), nullable=True)
    interval_before = Column(Integer, nullable=True)
    
    reviewed_at = Column(DateTime, default=utc_now, index=True)
    
    # Relationships
    card = relationship("Flashcard", back_populates="reviews")


class StudySession(Base):
    """Track study sessions for streaks and analytics"""
    __tablename__ = "study_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    deck_id = Column(Integer, ForeignKey("flashcard_decks.id"), nullable=True)  # Null = mixed decks
    
    started_at = Column(DateTime, default=utc_now)
    completed_at = Column(DateTime, nullable=True)
    
    # Session stats
    cards_reviewed = Column(Integer, default=0)
    cards_again = Column(Integer, default=0)   # Rating 1
    cards_hard = Column(Integer, default=0)    # Rating 2
    cards_good = Column(Integer, default=0)    # Rating 3
    cards_easy = Column(Integer, default=0)    # Rating 4
    total_time_ms = Column(Integer, default=0)
    
    # Relationships
    deck = relationship("FlashcardDeck", back_populates="study_sessions")
