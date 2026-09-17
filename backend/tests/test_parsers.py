"""
Unit tests for the AI response parsers.

These cover the highest-risk backend paths: turning LLM JSON responses
into test questions and flashcards. P1.1/P1.2/P1.3 behaviours are pinned
by dedicated regression tests (invalid answer keys are discarded, repair
regexes stay inside choices arrays, structured-output objects are
unwrapped, unanswered questions are excluded from wrong-only conversion,
duplicates are filtered per deck).
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

    def test_single_letter_dict_choices_parse_correctly(self):
        """P1.2 regression: choices as {"A": "Paris", "B": "Berlin"} were
        destroyed by the former global regex fixes (unparseable garbage).
        With repairs scoped to broken choices arrays, valid dict choices
        parse and convert by sorted key."""
        content = json.dumps(
            [{"question": "Q1", "choices": {"A": "Paris", "B": "Berlin"},
              "correct_answer": 0}]
        )
        questions = parse_questions_response(content, num_choices=2)
        assert questions[0]["choices"] == ["Paris", "Berlin"]
        assert questions[0]["correct_answer"] == 0

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

    # ---- Invalid answer keys are discarded, never clamped (P1.1) ----

    def test_invalid_index_discards_question(self):
        """P1.1: an out-of-range correct_answer discards the question
        instead of silently clamping it to the last choice (which marked
        a wrong answer as correct)."""
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": 7}]
        )
        with pytest.raises(ValueError):
            parse_questions_response(content, num_choices=4)

    def test_invalid_index_dropped_but_valid_ones_kept(self):
        """P1.1: among several questions only the invalid ones are
        dropped; count and order of the valid ones stay consistent."""
        content = json.dumps([
            q("Q1", correct=0),
            {"question": "Q2", "choices": ["A", "B", "C", "D"],
             "correct_answer": 9},
            q("Q3", correct=2),
        ])
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 2
        assert [x["question"] for x in questions] == ["Q1", "Q3"]
        assert [x["correct_answer"] for x in questions] == [0, 2]

    def test_non_numeric_correct_discards_question(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": "unknown"}]
        )
        with pytest.raises(ValueError):
            parse_questions_response(content, num_choices=4)

    def test_missing_correct_answer_discards_question(self):
        """A question without any answer key is unusable for a learning
        app — it must not silently become index 0."""
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"]}]
        )
        with pytest.raises(ValueError):
            parse_questions_response(content, num_choices=4)

    def test_negative_index_discards_question(self):
        content = json.dumps(
            [{"question": "Q1", "choices": ["A", "B", "C", "D"],
              "correct_answer": -1}]
        )
        with pytest.raises(ValueError):
            parse_questions_response(content, num_choices=4)

    def test_valid_index_at_boundaries_is_kept(self):
        content = json.dumps([
            q("First", correct=0),
            q("Last", correct=3),
        ])
        questions = parse_questions_response(content, num_choices=4)
        assert [x["correct_answer"] for x in questions] == [0, 3]

    def test_explanation_with_letter_colon_pattern_survives_verbatim(self):
        """P1.2 regression guard (briefing case c): patterns like
        `X: "text"` inside explanations must never be rewritten by the
        repair regexes — they now run only inside broken choices arrays."""
        tricky = 'The mapping is B: "Bearer" and A: "Apfel" in the header'
        content = json.dumps([q("Q1", explanation=tricky)])
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["explanation"] == tricky

    def test_explanation_starting_with_letter_prefix_survives_verbatim(self):
        """P1.2: the old global sub3 stripped leading 'A. ' from ANY
        string, including explanations. Explanations must survive
        verbatim; only actual choices get prefix-cleaned."""
        tricky = "A. The capital of France is Paris."
        content = json.dumps([q("Q1", explanation=tricky)])
        questions = parse_questions_response(content, num_choices=4)
        assert questions[0]["explanation"] == tricky

    def test_structured_output_object_format_accepted(self):
        """With response_format json_object (P1.2), models return
        {"questions": [...]} — the parser must unwrap it."""
        content = json.dumps({"questions": [q("Q1", correct=1), q("Q2", correct=2)]})
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 2
        assert questions[0]["correct_answer"] == 1

    def test_broken_choices_array_repaired_in_fallback(self):
        """P1.2: choices written as invalid JSON (["A": "text"]) are still
        repaired — but only inside the choices array, and only after the
        first parse attempt failed."""
        content = (
            '[{"question": "Q1", "choices": ["A": "Paris", "B": "Berlin", '
            '"C": "Madrid", "D": "Rome"], "correct_answer": 0, '
            '"explanation": "E"}]'
        )
        questions = parse_questions_response(content, num_choices=4)
        assert len(questions) == 1
        assert questions[0]["choices"] == ["Paris", "Berlin", "Madrid", "Rome"]
        assert questions[0]["correct_answer"] == 0

    def test_broken_json_explanation_not_rewritten_by_repair(self):
        """P1.2: with invalid JSON, the repair pass must stay inside the
        choices array — an explanation containing '"A": "Apfel"' must
        not be rewritten to 'Apfel' by the repair."""
        content = (
            '[{"question": "Q1", "choices": ["Alpha", "Beta", "Gamma", "Delta"], '
            '"correct_answer": 0, "explanation": "The mapping is "A": "Apfel" here"}]'
        )
        questions = parse_questions_response(content, num_choices=4)
        # Falls back to manual extraction; the question and its answer
        # key survive
        assert len(questions) == 1
        assert questions[0]["question"] == "Q1"
        assert questions[0]["correct_answer"] == 0


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

    def test_fallback_invalid_index_discards_block(self):
        """P1.1: in the fallback path an out-of-range key discards the
        block too (and is validated against the truncated choice list)."""
        content = (
            '[{"question": "Q1", "choices": ["Alpha", "Beta", "Gamma", "Delta"], '
            '"correct_answer": 5, "explanation": "E"}, '
            '{"question": "Q2", "choices": ["Alpha", "Beta"], '
            '"correct_answer": 1, "explanation": ""}]'
        )
        questions = extract_questions_fallback(content, num_choices=2)
        assert len(questions) == 1
        assert questions[0]["question"] == "Q2"
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

    def test_structured_output_object_format_accepted(self):
        """With response_format json_object (P1.2), models return
        {"flashcards": [...]} — the parser must unwrap it."""
        content = json.dumps({"flashcards": [{"front": "F1", "back": "B1"}]})
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

    def test_unanswered_questions_are_excluded(self):
        """P1.3 (B10b): unanswered questions (is_correct=None,
        user_answer=None) must not become flashcards under
        wrong_only=True — None is falsy and used to fall through."""
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [self._question(is_correct=None, user_answer=None)]
        cards = create_flashcards_from_questions(questions, wrong_only=True)
        assert len(cards) == 0

    def test_answered_wrong_is_still_included(self):
        """Guard: the B10b fix must not drop genuinely wrong answers."""
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [
            self._question(is_correct=False, user_answer=1),
            self._question(is_correct=None, user_answer=None),
        ]
        cards = create_flashcards_from_questions(questions, wrong_only=True)
        assert len(cards) == 1
        assert "Correct" in cards[0]["back"]

    def test_unanswered_included_when_all_questions(self):
        """wrong_only=False keeps taking every question, including
        unanswered ones — that is explicit user intent."""
        from app.services.flashcard_generator import create_flashcards_from_questions
        questions = [self._question(is_correct=None, user_answer=None)]
        cards = create_flashcards_from_questions(questions, wrong_only=False)
        assert len(cards) == 1

    def test_filter_existing_cards_removes_duplicates(self):
        """P1.3: importing the same test into an existing deck twice
        must not create duplicate cards."""
        from app.services.flashcard_generator import filter_existing_cards
        cards_data = [
            {"front": "Q1", "back": "A1", "source_question_id": 10},
            {"front": "Q2", "back": "A2", "source_question_id": 11},
        ]
        kept, skipped = filter_existing_cards(cards_data, existing_source_question_ids=[10])
        assert [c["front"] for c in kept] == ["Q2"]
        assert skipped == 1

    def test_filter_existing_cards_without_matches(self):
        from app.services.flashcard_generator import filter_existing_cards
        cards_data = [{"front": "Q1", "back": "A1", "source_question_id": 10}]
        kept, skipped = filter_existing_cards(cards_data, existing_source_question_ids=[])
        assert len(kept) == 1
        assert skipped == 0

    def test_filter_existing_cards_ignores_cards_without_source(self):
        """Manually created cards (source_question_id=None) must never be
        filtered — only the test-import path is duplicate-protected."""
        from app.services.flashcard_generator import filter_existing_cards
        cards_data = [{"front": "Q1", "back": "A1", "source_question_id": None}]
        kept, skipped = filter_existing_cards(cards_data, existing_source_question_ids=[10])
        assert len(kept) == 1
        assert skipped == 0
