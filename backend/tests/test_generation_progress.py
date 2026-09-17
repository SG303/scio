"""Unit tests for the in-memory generation progress service (P6.2)."""

import time

import pytest
from fastapi import HTTPException

from app.routers.generation import cancel_generation
from app.services import generation_progress as gp


def _reset():
    gp._entries.clear()


def test_new_token_is_unique():
    assert gp.new_token() != gp.new_token()


def test_update_and_get_roundtrip():
    _reset()
    token = "tok-1"
    gp.update(token, status="running", total_batches=3, batch=1, questions_done=10)
    entry = gp.get(token)
    assert entry["status"] == "running"
    assert entry["total_batches"] == 3
    assert entry["questions_done"] == 10
    # internal bookkeeping must not leak
    assert "cancel_requested" not in entry


def test_partial_update_keeps_other_keys():
    _reset()
    token = "tok-2"
    gp.update(token, status="running", total_batches=3)
    gp.update(token, status="running", batch=2)
    entry = gp.get(token)
    assert entry["total_batches"] == 3
    assert entry["batch"] == 2


def test_unknown_token_returns_none():
    _reset()
    assert gp.get("never-registered") is None


def test_cancel_then_update_raises():
    _reset()
    token = "tok-3"
    gp.update(token, status="running", total_batches=2)
    assert gp.cancel(token) == "cancellation_requested"
    # the running generation notices on its next progress update
    try:
        gp.update(token, status="running", batch=2)
        raise AssertionError("expected GenerationCancelled")
    except gp.GenerationCancelled:
        pass
    # the entry is now terminal
    assert gp.get(token)["status"] == "cancelled"


def test_cancel_unknown_token_is_false():
    _reset()
    assert gp.cancel("nope") is None


def test_cancel_terminal_generation_keeps_its_real_status():
    """A late cancel must not pretend a failed/completed job was cancelled."""
    _reset()
    token = "tok-terminal"
    gp.update(token, status="running")
    gp.fail(token, "boom")

    assert gp.cancel(token) == "failed"
    assert gp.get(token)["status"] == "failed"

    completed = "tok-completed"
    gp.update(completed, status="running")
    gp.complete(completed, done=10, total=10)

    assert gp.cancel(completed) == "completed"
    assert gp.get(completed)["status"] == "completed"


def test_cancel_before_completion_discards_the_result():
    """A cancellation after the last batch but before persistence still wins."""
    _reset()
    token = "tok-finish-race"
    gp.update(token, status="running")
    assert gp.cancel(token) == "cancellation_requested"

    with pytest.raises(gp.GenerationCancelled):
        gp.complete(token, done=10, total=10)

    assert gp.get(token)["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_endpoint_rejects_a_terminal_generation():
    """The HTTP API must not return a false successful cancellation."""
    _reset()
    token = "tok-http-terminal"
    gp.update(token, status="running")
    gp.fail(token, "boom")

    with pytest.raises(HTTPException) as error:
        await cancel_generation(token)

    assert error.value.status_code == 409
    assert error.value.detail == "Generation is already failed"


def test_completed_entries_expire():
    _reset()
    token = "tok-4"
    gp.update(token, status="completed")
    # simulate passage beyond COMPLETED_TTL
    gp._entries[token]["updated_at"] = time.time() - gp.COMPLETED_TTL - 1
    assert gp.get(token) is None


def test_fail_records_message():
    _reset()
    token = "tok-5"
    gp.update(token, status="running")
    gp.fail(token, "boom")
    entry = gp.get(token)
    assert entry["status"] == "failed"
    assert entry["message"] == "boom"


def test_complete_records_totals():
    _reset()
    token = "tok-6"
    gp.update(token, status="running", total_batches=4)
    gp.complete(token, done=40, total=4)
    entry = gp.get(token)
    assert entry["status"] == "completed"
    assert entry["done"] == 40
    assert entry["total"] == 4
