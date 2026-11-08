"""Exam objectives as generation focus.

Documents of type ``exam_objectives`` describe *what the exam covers*. They
are not study material: when the user selects them, the generators put them
into their own prompt section that steers the focus of the questions/cards.
"""

from collections.abc import Sequence

from app.models import Document

EXAM_OBJECTIVES = "exam_objectives"


def split_exam_objectives(
    documents: Sequence[Document],
) -> tuple[list[Document], list[Document]]:
    """Split into (study materials, exam objectives)."""
    study = [d for d in documents if d.doc_type != EXAM_OBJECTIVES]
    objectives = [d for d in documents if d.doc_type == EXAM_OBJECTIVES]
    return study, objectives


def format_documents(documents: Sequence[Document]) -> str:
    """Join document contents into one prompt context block."""
    return "\n\n---\n\n".join(
        f"### {doc.title} ({doc.doc_type})\n{doc.content}" for doc in documents if doc.content
    )


def exam_objectives_section(objectives: Sequence[Document], has_study_materials: bool) -> str:
    """Prompt section for the exam objectives ('' if there are none)."""
    text = format_documents(objectives)
    if not text:
        return ""
    if has_study_materials:
        usage = """HOW TO USE THE EXAM OBJECTIVES:
- They are the learning objectives of the exam. Align what you create with them and give priority to study-material content that relates to them.
- Take all facts from the study materials; the objectives only set the focus.
- If parts of the study materials are unrelated to the objectives, you may still cover their key concepts, but with lower priority.
- Do not ask about the objectives list itself (e.g. "Which of these is an exam objective?")."""
    else:
        usage = """HOW TO USE THE EXAM OBJECTIVES:
- They are the learning objectives of the exam and the only material provided.
- Test the knowledge and skills the objectives describe.
- Do not ask about the objectives list itself (e.g. "Which of these is an exam objective?")."""
    return f"EXAM OBJECTIVES:\n{text}\n\n{usage}"
