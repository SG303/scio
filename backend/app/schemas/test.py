from pydantic import BaseModel
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
    num_questions: int = 10
    num_choices: int = 4
    ai_model_id: int
    document_ids: List[int]
    is_template: bool = False
    custom_prompt: Optional[str] = None


class TestConfigResponse(BaseModel):
    id: int
    title: str
    num_questions: int
    num_choices: int
    ai_model_id: int
    document_ids: List[int]
    is_template: bool
    custom_prompt: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class GenerateFromTemplateRequest(BaseModel):
    num_questions: Optional[int] = None  # Override the template's default


class TestResponse(BaseModel):
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

