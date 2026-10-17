"""Tests that a P6.2 cancellation leaves the test generation fallback chain.

Strategy 1/2 wrap their AI calls in `except Exception` — without a
re-raise for GenerationCancelled, an established cancellation would be
swallowed and the fallback strategies would fire further paid OpenRouter
calls after the user already cancelled.
"""
import pytest

import app.services.test_generator as tg
from app.services.generation_progress import GenerationCancelled


def _question(name):
    return {
        "question": name,
        "choices": ["A", "B", "C", "D"],
        "correct_answer": 0,
        "explanation": "",
    }


async def test_cancel_in_single_call_aborts_fallback_chain(monkeypatch):
    """Strategy 1 raises GenerationCancelled → no strategy 2/3 AI calls."""
    calls = []

    async def fake_batch(*args, **kwargs):
        calls.append(args)
        raise GenerationCancelled("cancelled")

    monkeypatch.setattr(tg, "_generate_batch", fake_batch)

    with pytest.raises(GenerationCancelled):
        await tg.generate_test_questions(
            [], num_questions=10, num_choices=4, model_id="test/model"
        )

    assert len(calls) == 1


async def test_cancel_mid_chain_aborts_fallback_chain(monkeypatch):
    """A cancellation in a later medium batch must not be turned into a
    partial result that triggers the small-batch fallback."""
    calls = []

    async def fake_batch(documents, num_questions, num_choices, *rest):
        calls.append(documents)
        if len(calls) <= 2:
            return [_question(f"Q{len(calls)}-{i}") for i in range(num_questions)]
        raise GenerationCancelled("cancelled")

    monkeypatch.setattr(tg, "_generate_batch", fake_batch)

    # 100 questions skip the single-call strategy: 2 medium batches succeed,
    # the 3rd raises GenerationCancelled.
    with pytest.raises(GenerationCancelled):
        await tg.generate_test_questions(
            [], num_questions=100, num_choices=4, model_id="test/model"
        )

    # Exactly the 3 medium-batch calls happened; no small-batch retries.
    assert len(calls) == 3
