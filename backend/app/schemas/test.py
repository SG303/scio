from datetime import datetime

from pydantic import BaseModel, Field

from app.services.language import Language


class Choice(BaseModel):
    index: int
    text: str


class QuestionResponse(BaseModel):
    id: int
    question_number: int
    question_text: str
    choices: list[Choice]
    user_answer: int | None = None
    is_correct: bool | None = None
    correct_answer: int | None = None  # Only shown after test completion
    explanation: str | None = None  # Only shown after test completion

    class Config:
        from_attributes = True


class TestConfigCreate(BaseModel):
    title: str
    num_questions: int = Field(default=10, ge=1, le=100)
    num_choices: int = Field(default=4, ge=2, le=10)
    ai_model_id: int
    document_ids: list[int]
    is_template: bool = False
    custom_prompt: str | None = None
    language: Language = None  # None = language of the material
    # Optional subject grouping; templates never belong to a subject
    subject_id: int | None = None


class TestConfigUpdate(BaseModel):
    """Partial update of a (non-template) config — used to (un)assign a subject."""

    subject_id: int | None = None


class TestConfigResponse(BaseModel):
    id: int
    title: str
    num_questions: int
    num_choices: int
    ai_model_id: int
    document_ids: list[int]
    is_template: bool
    custom_prompt: str | None = None
    language: Language = None  # None = language of the material
    subject_id: int | None = None
    # Templates: number of tests attached to this config (deleted with it)
    test_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class GenerateFromTemplateRequest(BaseModel):
    num_questions: int | None = Field(default=None, ge=1, le=100)  # Override the template's default


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
    document_ids: list[int]
    lecture_ids: list[int] = []  # lecture notes as additional study material
    custom_prompt: str | None = None
    language: Language = None  # None = language of the material
    subject_id: int | None = None
    # optional override of num_questions for the generated test
    generate_num_questions: int | None = None


class TestResponse(BaseModel):
    id: int
    config_id: int
    config_title: str | None = None
    subject_id: int | None = None
    # Legacy tests generated directly from a template config
    from_template: bool = False
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    score: int | None = None
    total_questions: int
    correct_answers: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class TestDetailResponse(BaseModel):
    id: int
    config_id: int
    config_title: str | None = None
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    score: int | None = None
    total_questions: int
    correct_answers: int | None = None
    created_at: datetime
    questions: list[QuestionResponse]

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
    questions: list[QuestionResponse]
