from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class Choice(BaseModel):
    index: int
    text: str


class QuestionResponse(BaseModel):
    id: int
    question_number: int
    question_text: str
    choices: List[Choice]
    user_answer: Optional[int] = None
    is_correct: Optional[bool] = None
    correct_answer: Optional[int] = None  # Only shown after test completion
    explanation: Optional[str] = None  # Only shown after test completion
    
    class Config:
        from_attributes = True


class TestConfigCreate(BaseModel):
    title: str
    num_questions: int = Field(default=10, ge=1, le=100)
    num_choices: int = Field(default=4, ge=2, le=10)
    ai_model_id: int
    document_ids: List[int]
    is_template: bool = False
    custom_prompt: Optional[str] = None
    # Optional subject grouping; templates never belong to a subject
    subject_id: Optional[int] = None


class TestConfigUpdate(BaseModel):
    """Partial update of a (non-template) config — used to (un)assign a subject."""
    subject_id: Optional[int] = None


class TestConfigResponse(BaseModel):
    id: int
    title: str
    num_questions: int
    num_choices: int
    ai_model_id: int
    document_ids: List[int]
    is_template: bool
    custom_prompt: Optional[str] = None
    subject_id: Optional[int] = None
    # Templates: number of tests attached to this config (deleted with it)
    test_count: int = 0
    created_at: datetime
    
    class Config:
        from_attributes = True


class GenerateFromTemplateRequest(BaseModel):
    num_questions: Optional[int] = Field(default=None, ge=1, le=100)  # Override the template's default


class CreateAndGenerateRequest(BaseModel):
    """P5.2: create a config and generate a test in one transaction —
    a failed generation leaves no empty config behind.

    Deliberately no is_template: a generated test must never hang on a
    template config (deleting the template would cascade to its tests).
    Templates are saved separately via POST /configs."""
    title: str
    num_questions: int = Field(default=10, ge=1, le=100)
    num_choices: int = Field(default=4, ge=2, le=10)
    ai_model_id: int
    document_ids: List[int]
    custom_prompt: Optional[str] = None
    subject_id: Optional[int] = None
    # optional override of num_questions for the generated test
    generate_num_questions: Optional[int] = None


class TestResponse(BaseModel):
    id: int
    config_id: int
    config_title: Optional[str] = None
    subject_id: Optional[int] = None
    # Legacy tests generated directly from a template config
    from_template: bool = False
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    score: Optional[int] = None
    total_questions: int
    correct_answers: Optional[int] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class TestDetailResponse(BaseModel):
    id: int
    config_id: int
    config_title: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    score: Optional[int] = None
    total_questions: int
    correct_answers: Optional[int] = None
    created_at: datetime
    questions: List[QuestionResponse]
    
    class Config:
        from_attributes = True


class AnswerSubmit(BaseModel):
    question_id: int
    answer: int  # Index of the selected choice


class TestResultResponse(BaseModel):
    test_id: int
    status: str
    score: int
    total_questions: int
    correct_answers: int
    questions: List[QuestionResponse]

