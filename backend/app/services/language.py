"""Output language of generated questions and cards.

``None`` means "auto": the AI writes in the language of the study material.
"""

from typing import Annotated

from pydantic import BeforeValidator, StringConstraints

LANGUAGE_MAX_LENGTH = 50


def clean_language(language: str | None) -> str | None:
    """Trimmed language name, or None for auto (empty / whitespace)."""
    return (language or "").strip() or None


# Request/response field type: trimmed, blank = None (auto)
Language = Annotated[
    Annotated[str, StringConstraints(max_length=LANGUAGE_MAX_LENGTH)] | None,
    BeforeValidator(lambda value: clean_language(value) if isinstance(value, str) else value),
]


def language_section(language: str | None) -> str:
    """Prompt paragraph that fixes the output language."""
    language = clean_language(language)
    if language:
        return (
            f"LANGUAGE: Write everything the learner reads (questions, answer choices, "
            f"answers and explanations) in {language}, even if the study material is in "
            f"another language. Keep proper names and widely used technical terms as they are."
        )
    return (
        "LANGUAGE: Write everything the learner reads (questions, answer choices, "
        "answers and explanations) in the language of the study material or topic. "
        "Do not translate it."
    )
