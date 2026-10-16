"""
Regression tests for the flashcard generator's batch path (num_cards > 30).

Pins two bugs from code review round 1:
- the batch loop called math.ceil without importing math (NameError ->
  HTTP 500 on every generation requesting more than 30 cards),
- an explicit JSON null for front/back crashed .strip() with an
  AttributeError, discarding the whole batch instead of skipping the
  single invalid card.

The OpenRouter call is replaced by a fake in the module namespace (the
service imports chat_completion_json directly), so no real API key or
network access is involved.
"""
import json
import re

import pytest

import app.services.flashcard_generator as flashcard_generator
from app.services.flashcard_generator import generate_flashcards


@pytest.fixture(autouse=True)
def fake_api_key(monkeypatch):
    """_generate_batch refuses to run without a configured API key."""
    monkeypatch.setattr(
        flashcard_generator.settings, "openrouter_api_key", "test-key"
    )


def _install_fake(monkeypatch, counts):
    """Fake chat_completion_json that returns as many cards as the prompt
    asks for, with globally unique fronts across calls."""

    async def fake_chat_completion_json(**kwargs):
        match = re.search(r"(\d+) flashcards", kwargs["user_prompt"])
        count = int(match.group(1))
        counts.append(count)
        start = sum(counts) - count
        cards = [
            {"front": f"Front {start + i}", "back": f"Back {start + i}"}
            for i in range(count)
        ]
        return json.dumps({"flashcards": cards})

    monkeypatch.setattr(
        flashcard_generator, "chat_completion_json", fake_chat_completion_json
    )


async def test_batch_generation_no_name_error(monkeypatch):
    """Regression: num_cards > 30 hit math.ceil without importing math and
    raised NameError (HTTP 500). 35 cards must be generated via two
    batches (25 + 10) with unique fronts."""
    counts = []
    _install_fake(monkeypatch, counts)

    cards = await generate_flashcards([], 35, "test-model", "Test Topic")

    assert len(cards) == 35
    assert len(set(c["front"] for c in cards)) == 35
    # batch 1 asks for 25, batch 2 for the remaining 10
    assert counts == [25, 10]


async def test_null_front_or_back_skips_card_keeps_rest(monkeypatch):
    """Regression: an explicit JSON null ("front": null) bypassed the
    .get(key, "") default and crashed .strip() with an AttributeError,
    discarding the whole batch. Invalid cards must be skipped, valid
    ones kept."""
    response = json.dumps({"flashcards": [
        {"front": "F1", "back": "B1"},
        {"front": None, "back": "B2"},  # null front -> skipped
        {"front": "F3", "back": None},  # null back -> skipped
        {"question": None, "q": "F4", "answer": "B4"},  # alternate keys survive nulls
    ]})

    async def fake_chat_completion_json(**kwargs):
        return response

    monkeypatch.setattr(
        flashcard_generator, "chat_completion_json", fake_chat_completion_json
    )

    cards = await generate_flashcards([], 4, "test-model", "Test Topic")

    assert [c["front"] for c in cards] == ["F1", "F4"]
    assert cards[0]["back"] == "B1"
    assert cards[1]["back"] == "B4"
