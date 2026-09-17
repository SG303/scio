"""
Tests for the AI prompt builders.

Replaces the former ad-hoc scripts `test_custom_prompt.py` and
`verify_custom_prompt.py` (both deleted in P0.2) with real pytest tests.
Covers: custom prompt inclusion (documents- and topic-based), default
prompts when no custom instructions are given, empty/whitespace
normalization, and the "do not repeat" sections for existing questions
and flashcards.
"""
from tests.conftest import MockDocument

from app.services.test_generator import build_prompt
from app.services.flashcard_generator import build_flashcard_prompt


def make_docs():
    return [MockDocument(
        title="AWS Study Guide",
        doc_type="study_guide",
        content="AWS EC2 is a web service that provides resizable compute capacity...",
    )]


# ============== build_prompt (test generator) ==============


class TestBuildPromptCustom:
    def test_custom_prompt_with_documents(self):
        prompt = build_prompt(
            documents=make_docs(),
            num_questions=5,
            num_choices=4,
            topic="AWS",
            custom_prompt="Focus on scenario-based questions about security best practices",
        )
        assert "CUSTOM INSTRUCTIONS:" in prompt
        assert "Focus on scenario-based questions" in prompt
        assert "STUDY MATERIALS:" in prompt
        assert "AWS Study Guide" in prompt

    def test_custom_prompt_topic_based(self):
        prompt = build_prompt(
            documents=[],
            num_questions=10,
            num_choices=4,
            topic="Python Programming",
            custom_prompt="Make questions progressively harder",
        )
        assert "CUSTOM INSTRUCTIONS:" in prompt
        assert "Make questions progressively harder" in prompt
        assert "TOPIC: Python Programming" in prompt


class TestBuildPromptDefaults:
    def test_no_custom_prompt_with_documents(self):
        prompt = build_prompt(
            documents=make_docs(),
            num_questions=5,
            num_choices=4,
            topic="Kubernetes",
            custom_prompt=None,
        )
        assert "CUSTOM INSTRUCTIONS:" not in prompt
        assert "Questions should test understanding" in prompt

    def test_no_custom_prompt_topic_based(self):
        prompt = build_prompt(
            documents=[],
            num_questions=10,
            num_choices=4,
            topic="Machine Learning",
            custom_prompt=None,
        )
        assert "CUSTOM INSTRUCTIONS:" not in prompt
        assert "Include a mix of difficulty levels" in prompt

    def test_empty_string_treated_as_none(self):
        prompt = build_prompt(
            documents=[],
            num_questions=5,
            num_choices=4,
            topic="Docker",
            custom_prompt="",
        )
        assert "CUSTOM INSTRUCTIONS:" not in prompt

    def test_whitespace_only_treated_as_none(self):
        prompt = build_prompt(
            documents=[],
            num_questions=5,
            num_choices=4,
            topic="React",
            custom_prompt="   \n\t  ",
        )
        assert "CUSTOM INSTRUCTIONS:" not in prompt


class TestBuildPromptDedup:
    def test_existing_questions_section(self):
        prompt = build_prompt(
            documents=[],
            num_questions=5,
            num_choices=4,
            topic="BGP",
            custom_prompt=None,
            existing_questions=["What is an ASN?", "What port does BGP use?"],
        )
        assert "PREVIOUSLY GENERATED QUESTIONS" in prompt
        assert "What is an ASN?" in prompt
        assert "What port does BGP use?" in prompt


# ============== build_flashcard_prompt (flashcard generator) ==============


class TestBuildFlashcardPrompt:
    def test_custom_prompt_with_documents(self):
        prompt = build_flashcard_prompt(
            documents=make_docs(),
            num_cards=10,
            topic="AWS",
            custom_prompt="Focus on VPC networking details",
        )
        assert "CUSTOM INSTRUCTIONS:" in prompt
        assert "Focus on VPC networking details" in prompt
        assert "STUDY MATERIALS:" in prompt

    def test_custom_prompt_topic_based(self):
        prompt = build_flashcard_prompt(
            documents=[],
            num_cards=10,
            topic="OSPF",
            custom_prompt="Only link-state fundamentals",
        )
        assert "CUSTOM INSTRUCTIONS:" in prompt
        assert "TOPIC: OSPF" in prompt

    def test_no_custom_prompt(self):
        prompt = build_flashcard_prompt(
            documents=[],
            num_cards=10,
            topic="DNS",
            custom_prompt=None,
        )
        assert "CUSTOM INSTRUCTIONS:" not in prompt

    def test_existing_fronts_section(self):
        prompt = build_flashcard_prompt(
            documents=[],
            num_cards=10,
            topic="VLANs",
            custom_prompt=None,
            existing_fronts=["What is a native VLAN?", "What does 802.1Q add?"],
        )
        assert "EXISTING FLASHCARDS" in prompt
        assert "What is a native VLAN?" in prompt
