"""Regression test: the router's progress reporter must be awaitable.

`generate_test_questions` awaits the return value of the on_progress
callback (`await on_progress(**kw)`). A synchronous reporter returns
None, so the generator raised
`TypeError: object NoneType can't be used in 'await' expression` and
every test generation failed (including all fallback strategies).
"""
import app.services.test_generator as tg
from app.routers.tests import _progress_reporter
from app.services import generation_progress


def _question(name):
    return {
        "question": name,
        "choices": ["A", "B", "C", "D"],
        "correct_answer": 0,
        "explanation": "",
    }


async def test_router_progress_reporter_is_awaitable():
    reporter = _progress_reporter("regression-token")
    assert reporter is not None
    # The generator awaits the callback's return value — this must not
    # raise TypeError.
    await reporter(stage="Generating questions", done=0, total=5)


async def test_generation_with_router_reporter_reports_progress(monkeypatch):
    """End-to-end regression: router reporter + generator must not crash
    and must record progress entries."""
    token = generation_progress.new_token()

    async def fake_batch(documents, num_questions, num_choices, *rest):
        return [_question(f"Q{i}") for i in range(num_questions)]

    monkeypatch.setattr(tg, "_generate_batch", fake_batch)

    questions = await tg.generate_test_questions(
        [], num_questions=5, num_choices=4, model_id="test/model",
        on_progress=_progress_reporter(token),
    )

    assert len(questions) == 5
    entry = generation_progress.get(token)
    assert entry is not None
    assert entry["status"] == "running"
    assert entry["total"] == 5
    assert "stage" in entry
