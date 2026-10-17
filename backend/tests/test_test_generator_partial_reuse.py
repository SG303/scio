"""
Regression tests for partial-question reuse across generator strategies.

Before this fix, test_generator.py threw away the already-paid-for valid
questions whenever a strategy answer fell short of its 80%-acceptance
threshold (or threw), and the next strategy re-generated the FULL
amount — duplicate API costs plus duplicate-question risk, because the
kept questions were never passed on as existing_questions.

Now the valid partial result accumulates over the fallback chain and
only the missing difference is regenerated. Duplicates (also against
questions already in the DB, passed via existing_questions) are dropped
and do not consume the remaining question budget.

The OpenRouter call is faked in the module namespace (the service
imports chat_completion_json directly), so no real API key or network
access is involved. Each fake call logs how many questions the prompt
requested, letting the tests assert the per-call spend.
"""
import json
import re

import pytest

import app.services.test_generator as test_generator
from app.services.test_generator import generate_test_questions


def _question(text):
    return {
        "question": text,
        "choices": ["A", "B", "C", "D"],
        "correct_answer": 0,
        "explanation": "Because",
    }


class FakeOpenRouter:
    """Fakes chat_completion_json.

    Each call reads the requested question count out of the prompt and
    answers with `outcomes[i]` valid questions (or raises the given
    exception instance). `repeats[i]` lets a call (wrongly) re-answer
    with texts already delivered to — or known from the DB.
    Question texts are globally unique across calls."""

    def __init__(self, outcomes, repeats=None):
        self.outcomes = outcomes
        self.repeats = repeats or [[] for _ in outcomes]
        self.requested = []  # question counts requested by each prompt
        self.prompts = []    # full user prompt of each call
        self._next = 1

    async def __call__(self, **kwargs):
        match = re.search(
            r"Create (\d+) multiple-choice questions", kwargs["user_prompt"]
        )
        assert match, "prompt does not state a question count"
        count = int(match.group(1))
        self.requested.append(count)
        self.prompts.append(kwargs["user_prompt"])

        outcome = self.outcomes[len(self.requested) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        total = min(outcome, count)
        texts = list(self.repeats[len(self.requested) - 1])[:total]
        new_count = total - len(texts)
        texts += [f"Question {self._next + i}" for i in range(new_count)]
        self._next += new_count
        return json.dumps({"questions": [_question(t) for t in texts]})


@pytest.fixture(autouse=True)
def fake_api_key(monkeypatch):
    """_generate_batch refuses to run without a configured API key."""
    monkeypatch.setattr(
        test_generator.settings, "openrouter_api_key", "test-key"
    )


async def test_partial_single_call_is_reused_by_next_strategy(monkeypatch):
    """Strategy 1 delivers 4 of 10 valid questions. The fallback must ask
    for exactly the missing 6 (not 10 again) and receive the 4 paid-for
    questions as existing_questions."""
    fake = FakeOpenRouter(outcomes=[4, 6])
    monkeypatch.setattr(test_generator, "chat_completion_json", fake)

    questions = await generate_test_questions([], 10, 4, "test-model", "Test Topic")

    # Strategy 1 asks 10, delivers 4; strategy 2 asks only the missing 6
    assert fake.requested == [10, 6]
    # All 10 questions present in order, no duplicates, correct shape
    assert [q["question"] for q in questions] == [
        f"Question {i}" for i in range(1, 11)
    ]
    assert len(set(q["question"] for q in questions)) == 10
    for q in questions:
        assert set(q.keys()) == {"question", "choices", "correct_answer", "explanation"}
    # The paid-for strategy-1 questions travelled to strategy 2 as
    # existing ("do not repeat") questions
    for text in ["Question 1", "Question 2", "Question 3", "Question 4"]:
        assert text in fake.prompts[1]


async def test_partial_results_accumulate_over_two_fallbacks(monkeypatch):
    """5 of 20 valid questions from strategy 1, 8 of 15 from strategy 2 —
    strategy 3 must generate only the missing 7 and the 13 earlier
    questions must survive to the final result."""
    fake = FakeOpenRouter(outcomes=[5, 8, 7])
    monkeypatch.setattr(test_generator, "chat_completion_json", fake)

    questions = await generate_test_questions([], 20, 4, "test-model", "Test Topic")

    # Questions requested per call: 20 (S1), the missing 15 (S2), the
    # missing 7 (S3) — never the full amount twice
    assert fake.requested == [20, 15, 7]
    assert [q["question"] for q in questions] == [
        f"Question {i}" for i in range(1, 21)
    ]
    assert len(set(q["question"] for q in questions)) == 20
    # All questions known before strategy 3 were passed on to it
    for text in ["Question 5", "Question 13"]:
        assert text in fake.prompts[2]


async def test_total_failure_error_behaviour_unchanged(monkeypatch):
    """If all three strategies fail, the old behaviour must not change:
    the exception of the final strategy propagates (no silent short
    result, no different error type)."""
    fake = FakeOpenRouter(outcomes=[ValueError("OpenRouter down")] * 3)
    monkeypatch.setattr(test_generator, "chat_completion_json", fake)

    with pytest.raises(ValueError, match="OpenRouter down"):
        await generate_test_questions([], 10, 4, "test-model", "Test Topic")

    # One attempt per strategy, each still asking for the full amount
    assert fake.requested == [10, 10, 10]


async def test_duplicates_from_db_and_model_do_not_consume_budget(monkeypatch):
    """A question already in the DB (passed via existing_questions) must
    not come back in the result — and neither a DB duplicate nor a model
    self-repeat may eat into the remaining question budget."""
    fake = FakeOpenRouter(
        outcomes=[4, 2],
        repeats=[[], ["Question 1"]],  # model ignores "do not repeat"
    )
    monkeypatch.setattr(test_generator, "chat_completion_json", fake)

    questions = await generate_test_questions(
        [], 5, 4, "test-model", "Test Topic",
        existing_questions=["Question 1"],
    )

    # Strategy 1 asked 5, delivered 4 (second call asked only the
    # remaining 2 — the discarded duplicates were replaced for free)
    assert fake.requested == [5, 2]
    # The DB question is not re-generated, everything else is unique
    assert [q["question"] for q in questions] == [
        "Question 2", "Question 3", "Question 4", "Question 5",
    ]
    # The DB question was instructed not to repeat
    assert "Question 1" in fake.prompts[1]
