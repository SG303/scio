"""
Unit tests for the AI response parsers.

These cover the highest-risk backend paths: turning LLM JSON responses
into test questions and flashcards. Tests marked CURRENT pin documented
bugs (B1/B2 from the code review, fixed in roadmap Phase 1): they freeze
today's behaviour so the fixes cannot change anything unnoticed — each
must be flipped when its roadmap package lands.
"""
import json

import pytest

from app.services.test_generator import (
    parse_questions_response,
    extract_questions_fallback,
)
from app.services.flashcard_generator import (
    parse_flashcards_response,
    extract_flashcards_fallback,
)


def q(question, choices=None, correct=0, explanation=""):
    """Shorthand for a well-formed question dict."""
    return {
        "question": question,
        "choices": choices or ["A", "B", "C", "D"],
        "correct_answer": correct,
        "explanation": explanation,
    }


# ============== test_generator: parse_questions_response ==============


class TestParseQuestionsResponse:
    def test_clean_json_array(self):
        content = json.dumps([q("Q1", correct=1), q("Q2", correct=2)])
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 2
        assert questions[0]["question"] == "Q1"
        assert questions[0]["correct_answer"] == 1
        assert questions[0]["choices"] == ["A", "B", "C", "D"]

    def test_markdown_code_fence_stripped(self):
        content = "```json\n" + json.dumps([q("Q1")]) + "\n```"
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 1
        assert questions[0]["question"] == "Q1"

    def test_json_with_surrounding_text(self):
        content = "Here are your questions:\n" + json.dumps([q("Q1")]) + "\nGood luck!"
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 1

    def test_dict_choices_converted_to_sorted_list(self):
        # Multi-character keys survive the regex fix pass and hit the
        # dict->list conversion (sorted by key)
        content = json.dumps(
            [{"question": "Q1", "choices": {"opt2": "Berlin", "opt1": "Paris"},
              "correct_answer": 0}]
        )
        questions = parse_questions_response(content, num_choices=2)
        assert questions[0]["choices"] == ["Paris", "Berlin"]

    def test_CURRENT_single_letter_dict_keys_are_mangled(self):
        """B2 (roadmap P1.2): choices given as {"A": "Paris", "B": "Berlin"}
        are destroyed by the global regex fix (sub1 rewrites single-capital
        key-value pairs), making the JSON unparseable. P1.2 must make this
        input produce ["Paris", "Berlin"].
        """
        content = json.dumps(
            [{"question": "Q1", "choices": {"A": "Paris", "B": "Berlin"},
              "correct_answer": 0}]
        )
        with pytest.raises(ValueError):
            parse_questions_response(content, num_choices=2)

    def test_letter_choice_prefixes_removed(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A. One", "B. Two"],
              "correct_answer": 0}]
        )
        questions = parse_questions_response(content, num_choices=2)
        assert questions[0]["choices"] == ["One", "Two"]

    def test_too_few_choices_padded(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["Only one"], "correct_answer": 0}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions[0]["choices"]) == 4
        assert questions[0]["choices"][1:] == ["Choice 2", "Choice 3", "Choice 4"]

    def test_too_many_choices_truncated(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D", "E", "F"],
              "correct_answer": 0}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions[0]["choices"]) == 4

    def test_string_letter_correct_answer_converted(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": "C"}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["correct_answer"] == 2

    def test_string_number_correct_answer_converted(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": "3"}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["correct_answer"] == 3

    def test_question_without_question_key_dropped(self):
        content = json.dumps(
            [{"choices": ["A", "B"], "correct_answer": 0}, q("Q2")]
        )
        questions = parse_questions_response(content, num_choices=2)
        assert len(questions) == 1
        assert questions[0]["question"] == "Q2"

    def test_no_questions_at_all_raises(self):
        with pytest.raises(ValueError):
            parse_questions_response("[]", num_choices=4)

    def test_completely_invalid_content_raises(self):
        with pytest.raises(ValueError):
            parse_questions_response("I am sorry, I cannot create questions.", num_choices=4)

    # ---- CURRENT BEHAVIOUUR pins (documented bugs B1/B2, fixed in P1.1/P1.2) ----

    def test_CURRENT_invalid_index_is_clamped_not_rejected(self):
        """B1 (roadmap P1.1): out-of-range correct_answer is silently clamped.

        This documents today's dangerous behaviour; P1.1 will flip this
        to 'question is discarded' and must update this test.
        """
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": 7}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["correct_answer"] == 3  # clamped to last choice

    def test_CURRENT_non_numeric_correct_falls_back_to_zero(self):
        """B1 companion: unparseable answer keys silently become index 0."""
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": "unknown"}]
        )
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["correct_answer"] == 0

    def test_CURRENT_explanation_with_letter_colon_pattern_survives(self):
        """B2 regression guard: an explanation containing `X: "text"` must
        not be mangled by the global regex fixes. This test documents the
        inputs P1.2 must keep working after moving the regexes into the
        fallback path.
        """
        tricky = 'The mapping is B: "Bearer" in the Authorization header'
        content = json.dumps([q("Q1", explanation=tricky)])
        questions = parse_questions_response(content, num_choices=4)
        # Current code path mangles or preserves this depending on regex
        # order — after P1.2 the explanation must survive verbatim:
        assert "Bearer" in questions[0]["explanation"]


class TestExtractQuestionsFallback:
    def test_fallback_parses_malformed_blocks(self):
        # Trailing comma makes the array JSON-invalid; the fallback splits
        # on '}, {' and recovers both blocks. Multi-character choice values
        # (single letters get filtered out).
        content = (
            '[{"question": "Q1", "choices": ["Alpha", "Beta"], "correct_answer": 0, '
            '"explanation": "E1"}, {"question": "Q2", "choices": ["Gamma", "Delta"], '
            '"correct_answer": 1, "explanation": "E2"},]'
        )
        questions = extract_questions_fallback(content, num_choices=2)
        assert len(questions) == 2
        assert questions[0]["question"] == "Q1"
        assert questions[0]["choices"] == ["Alpha", "Beta"]
        assert questions[1]["correct_answer"] == 1

    def test_fallback_letter_correct_answer(self):
        content = (
            '{"question": "Q1", "choices": ["Alpha", "Beta"], '
            '"correct_answer": "B", "explanation": ""}'
        )
        questions = extract_questions_fallback(content, num_choices=2)
        assert questions[0]["correct_answer"] == 1

    def test_fallback_no_questions_raises(self):
        with pytest.raises(ValueError):
            extract_questions_fallback("no question pattern here", num_choices=4)


# ============== flashcard_generator: parse_flashcards_response ==============


class TestParseFlashcardsResponse:
    def test_clean_json_array(self):
        content = json.dumps([{"front": "F1", "back": "B1"}])
        cards = parse_flashcards_response(content)
        assert cards == [{"front": "F1", "back": "B1"}]

    def test_markdown_code_fence_stripped(self):
        content = "```\n" + json.dumps([{"front": "F1", "back": "B1"}]) + "\n```"
        cards = parse_flashcards_response(content)
        assert len(cards) == 1

    def test_alternate_keys_question_answer(self):
        content = json.dumps([{"question": "F1", "answer": "B1"}])
        cards = parse_flashcards_response(content)
        assert cards == [{"front": "F1", "back": "B1"}]

    def test_alternate_keys_q_a(self):
        content = json.dumps([{"q": "F1", "a": "B1"}])
        cards = parse_flashcards_response(content)
        assert cards == [{"front": "F1", "back": "B1"}]

    def test_cards_missing_fields_dropped(self):
        content = json.dumps(
            [{"front": "F1", "back": "B1"}, {"front": "no back"},
             {"back": "no front"}, "not a dict"]
        )
        cards = parse_flashcards_response(content)
        assert cards == [{"front": "F1", "back": "B1"}]

    def test_all_cards_invalid_raises(self):
        content = json.dumps([{"front": "   ", "back": "B1"}])
        with pytest.raises(ValueError):
            parse_flashcards_response(content)

    def test_empty_result_raises(self):
        with pytest.raises(ValueError):
            parse_flashcards_response("[]")

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError):
            parse_flashcards_response("no json here at all")

    def test_non_list_json_raises(self):
        with pytest.raises(ValueError):
            parse_flashcards_response(json.dumps({"front": "F", "back": "B"}))


class TestExtractFlashcardsFallback:
    def test_fallback_extracts_cards_from_malformed_json(self):
        # Trailing comma makes the array JSON-invalid; the fallback splits
        # on '}, {' and recovers both cards
        content = (
            '[{"front": "F1", "back": "B1"}, {"front": "F2", "back": "B2"},]'
        )
        cards = extract_flashcards_fallback(content)
        assert len(cards) == 2
        assert cards[0]["front"] == "F1"

    def test_fallback_no_cards_raises(self):
        with pytest.raises(ValueError):
            extract_flashcards_fallback("nothing useful here")


# ============== create_flashcards_from_questions ==============


class TestCreateFlashcardsFromQuestions:
    def _question(self, *, is_correct, user_answer=0):
        from app.models import Question
        return Question(
            test_id=1,
            question_number=1,
            question_text="Q?",
            choices=[{"index": 0, "text": "Correct"}, {"index": 1, "text": "Wrong"}],
            correct_answer=0,
            explanation="Because",
            user_answer=user_answer,
            is_correct=is_correct,
        )

    def test_wrong_only_takes_incorrect_answers(self):
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [self._question(is_correct=False), self._question(is_correct=True)]
        cards = create_flashcards_from_questions(questions, wrong_only=True)
        assert len(cards) == 1
        assert cards[0]["source_type"] == "from_test"
        assert "Correct" in cards[0]["back"]  # correct text, not user's wrong text
        assert "Because" in cards[0]["back"]   # explanation appended

    def test_all_takes_every_question(self):
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [self._question(is_correct=True), self._question(is_correct=False)]
        cards = create_flashcards_from_questions(questions, wrong_only=False)
        assert len(cards) == 2

    def test_CURRENT_unanswered_counts_as_wrong(self):
        """Documents roadmap bug B10b: is_correct=None is falsy, so
        unanswered questions become flashcards under wrong_only=True.
        P1.3 will change this to exclude unanswered questions.
        """
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [self._question(is_correct=None, user_answer=None)]
        cards = create_flashcards_from_questions(questions, wrong_only=True)
        assert len(cards) == 1  # TODO(P1.3): must become 0
