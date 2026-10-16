"""
Tests for numeric bounds on AI generation request schemas.

The num_* fields feed directly into OpenRouter calls — unbounded values
are a cost and degeneration risk. Bounds mirror the existing
GenerateFlashcardsRequest (ge/le); defaults stay untouched.
"""
import pytest
from pydantic import ValidationError

from app.schemas.flashcard import CreateAndGenerateDeckRequest
from app.schemas.subject import (
    AddCardsRequest,
    AddQuestionsRequest,
    GenerateFlashcardsInSubjectRequest,
    GenerateTestInSubjectRequest,
)
# imported as a module: its Test* schema classes would otherwise trip
# pytest's collection (PytestCollectionWarning)
from app.schemas import test as test_schemas


class TestCreateAndGenerateDeckRequest:
    def test_valid(self):
        req = CreateAndGenerateDeckRequest(title="Deck", num_cards=100)
        assert req.num_cards == 100

    def test_num_cards_still_required(self):
        """Adding bounds must not turn the required num_cards into a
        defaulted field."""
        with pytest.raises(ValidationError):
            CreateAndGenerateDeckRequest(title="Deck")

    @pytest.mark.parametrize("num_cards", [0, 101, -5])
    def test_num_cards_out_of_bounds(self, num_cards):
        with pytest.raises(ValidationError):
            CreateAndGenerateDeckRequest(title="Deck", num_cards=num_cards)


class TestGenerateTestInSubjectRequest:
    def test_valid_defaults(self):
        req = GenerateTestInSubjectRequest(title="Test")
        assert req.num_questions == 10
        assert req.num_choices == 4

    def test_valid_boundaries(self):
        req = GenerateTestInSubjectRequest(title="Test", num_questions=1, num_choices=2)
        assert req.num_questions == 1
        assert req.num_choices == 2

    @pytest.mark.parametrize("num_questions", [0, 101])
    def test_num_questions_out_of_bounds(self, num_questions):
        with pytest.raises(ValidationError):
            GenerateTestInSubjectRequest(title="Test", num_questions=num_questions)

    @pytest.mark.parametrize("num_choices", [1, 11])
    def test_num_choices_out_of_bounds(self, num_choices):
        with pytest.raises(ValidationError):
            GenerateTestInSubjectRequest(title="Test", num_choices=num_choices)


class TestGenerateFlashcardsInSubjectRequest:
    def test_valid_defaults(self):
        req = GenerateFlashcardsInSubjectRequest(title="Deck")
        assert req.num_cards == 20

    @pytest.mark.parametrize("num_cards", [0, 101])
    def test_num_cards_out_of_bounds(self, num_cards):
        with pytest.raises(ValidationError):
            GenerateFlashcardsInSubjectRequest(title="Deck", num_cards=num_cards)


class TestAddQuestionsRequest:
    def test_valid_defaults(self):
        req = AddQuestionsRequest()
        assert req.num_questions == 10

    @pytest.mark.parametrize("num_questions", [0, 101])
    def test_num_questions_out_of_bounds(self, num_questions):
        with pytest.raises(ValidationError):
            AddQuestionsRequest(num_questions=num_questions)


class TestAddCardsRequest:
    def test_valid_defaults(self):
        req = AddCardsRequest()
        assert req.num_cards == 10

    @pytest.mark.parametrize("num_cards", [0, 101])
    def test_num_cards_out_of_bounds(self, num_cards):
        with pytest.raises(ValidationError):
            AddCardsRequest(num_cards=num_cards)


class TestTestConfigCreate:
    def test_valid(self):
        req = test_schemas.TestConfigCreate(
            title="Test", ai_model_id=1, document_ids=[1],
            num_questions=100, num_choices=10,
        )
        assert req.num_questions == 100
        assert req.num_choices == 10

    @pytest.mark.parametrize("num_questions", [0, 101])
    def test_num_questions_out_of_bounds(self, num_questions):
        with pytest.raises(ValidationError):
            test_schemas.TestConfigCreate(
                title="Test", ai_model_id=1, document_ids=[1],
                num_questions=num_questions,
            )

    @pytest.mark.parametrize("num_choices", [1, 11])
    def test_num_choices_out_of_bounds(self, num_choices):
        with pytest.raises(ValidationError):
            test_schemas.TestConfigCreate(
                title="Test", ai_model_id=1, document_ids=[1],
                num_choices=num_choices,
            )


class TestGenerateFromTemplateRequest:
    def test_valid_default_is_none(self):
        req = test_schemas.GenerateFromTemplateRequest()
        assert req.num_questions is None

    def test_valid_boundaries(self):
        assert test_schemas.GenerateFromTemplateRequest(num_questions=1).num_questions == 1
        assert test_schemas.GenerateFromTemplateRequest(num_questions=100).num_questions == 100

    @pytest.mark.parametrize("num_questions", [0, 101, -1])
    def test_num_questions_out_of_bounds(self, num_questions):
        with pytest.raises(ValidationError):
            test_schemas.GenerateFromTemplateRequest(num_questions=num_questions)


class TestCreateAndGenerateRequest:
    def test_valid_defaults(self):
        req = test_schemas.CreateAndGenerateRequest(title="Test", ai_model_id=1, document_ids=[1])
        assert req.num_questions == 10
        assert req.num_choices == 4

    @pytest.mark.parametrize("num_questions", [0, 101])
    def test_num_questions_out_of_bounds(self, num_questions):
        with pytest.raises(ValidationError):
            test_schemas.CreateAndGenerateRequest(
                title="Test", ai_model_id=1, document_ids=[1],
                num_questions=num_questions,
            )

    @pytest.mark.parametrize("num_choices", [1, 11])
    def test_num_choices_out_of_bounds(self, num_choices):
        with pytest.raises(ValidationError):
            test_schemas.CreateAndGenerateRequest(
                title="Test", ai_model_id=1, document_ids=[1],
                num_choices=num_choices,
            )
