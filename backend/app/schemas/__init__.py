from app.schemas.document import DocumentCreate, DocumentUpdate, DocumentResponse
from app.schemas.test import (
    TestConfigCreate, TestConfigResponse,
    TestResponse, TestDetailResponse,
    QuestionResponse, AnswerSubmit, TestResultResponse
)
from app.schemas.ai_model import AIModelCreate, AIModelUpdate, AIModelResponse
from app.schemas.subject import (
    SubjectCreate, SubjectUpdate, SubjectResponse, SubjectListResponse,
    SubjectDetailResponse, TestConfigInSubject, FlashcardDeckInSubject,
    GenerateTestInSubjectRequest, GenerateFlashcardsInSubjectRequest,
    AddQuestionsRequest, AddCardsRequest
)

__all__ = [
    "DocumentCreate", "DocumentUpdate", "DocumentResponse",
    "TestConfigCreate", "TestConfigResponse",
    "TestResponse", "TestDetailResponse",
    "QuestionResponse", "AnswerSubmit", "TestResultResponse",
    "AIModelCreate", "AIModelUpdate", "AIModelResponse",
    "SubjectCreate", "SubjectUpdate", "SubjectResponse", "SubjectListResponse",
    "SubjectDetailResponse", "TestConfigInSubject", "FlashcardDeckInSubject",
    "GenerateTestInSubjectRequest", "GenerateFlashcardsInSubjectRequest",
    "AddQuestionsRequest", "AddCardsRequest"
]

