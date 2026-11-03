"""Exam objectives steer generation.

The prompt builders put selected exam-objectives documents into their own
focus section instead of mixing them into the study materials.
"""
import pytest

from app.services.flashcard_generator import build_flashcard_prompt
from app.services.test_generator import build_prompt
from tests.conftest import MockDocument

GUIDE = MockDocument("Marketing Script", "study_guide", "The 4P model: product, price, place, promotion.")
OBJECTIVES = MockDocument("Exam Scope", "exam_objectives", "Explain the 4P model.")


# ============== Prompt builders ==============


@pytest.mark.parametrize("builder", ["test", "flashcards"])
def test_objectives_get_own_section_after_study_materials(builder):
    prompt = _build(builder, [GUIDE, OBJECTIVES])

    materials, objectives = prompt.split("EXAM OBJECTIVES:", 1)
    assert "Marketing Script" in materials and "Exam Scope" not in materials
    assert "Explain the 4P model." in objectives
    assert "learning objectives of the exam" in objectives
    assert "Do not ask about the objectives list itself" in objectives


@pytest.mark.parametrize("builder", ["test", "flashcards"])
def test_objectives_only_become_the_source(builder):
    prompt = _build(builder, [OBJECTIVES])

    assert "Based on the following exam objectives" in prompt
    assert "STUDY MATERIALS:" not in prompt
    assert "the only material provided" in prompt


@pytest.mark.parametrize("builder", ["test", "flashcards"])
def test_without_objectives_prompt_has_no_objectives_section(builder):
    prompt = _build(builder, [GUIDE])

    assert "Based on the following study materials" in prompt
    assert "EXAM OBJECTIVES" not in prompt


def _build(builder, documents):
    if builder == "test":
        return build_prompt(documents=documents, num_questions=5, num_choices=4, topic="Marketing")
    return build_flashcard_prompt(documents=documents, num_cards=5, topic="Marketing")
