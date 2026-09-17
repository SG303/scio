"""
P6.2: In-memory progress tracking for long-running AI generations.

Generations (tests, flashcards) register a token before they start and
update it as batches complete. The frontend polls
``GET /api/generation/progress/{token}`` while waiting, so a 30-50
question generation shows "Batch 2 of 3, 25 questions done" instead of
an endless spinner.

Deliberately simple (single-user app, one uvicorn worker):
- a plain dict keyed by token
- entries expire after COMPLETED_TTL / RUNNING_TTL seconds
- no persistence, no cross-process sharing

Cancellation is cooperative: the frontend calls
``POST /api/generation/progress/{token}/cancel``, which raises a
``cancel_requested`` flag. The running generation checks it on every
progress update (i.e. between AI batches) and aborts — a single-call
generation that is already waiting on OpenRouter cannot be interrupted
mid-flight and finishes in the background (its result is discarded).
"""

import time
import uuid
from typing import Dict, Optional

# Finished entries are kept long enough for the final poll to read them;
# abandoned entries (browser closed mid-generation) are reaped later.
COMPLETED_TTL = 300  # 5 minutes
RUNNING_TTL = 1800  # 30 minutes (very large generations)

_entries: Dict[str, dict] = {}

_CANCELLED_MESSAGE = "Generation cancelled by user"


class GenerationCancelled(Exception):
    """Raised inside a generation when the user cancelled it."""


def _raise_cancelled(token: str) -> None:
    _entries[token] = {
        "status": "cancelled",
        "message": _CANCELLED_MESSAGE,
        "updated_at": time.time(),
    }
    raise GenerationCancelled(_CANCELLED_MESSAGE)


def new_token() -> str:
    """Create a fresh progress token."""
    return uuid.uuid4().hex


def update(
    token: str,
    *,
    status: str,
    **fields,
) -> None:
    """Create or update a progress entry (partial update, keeps other keys).

    Raises GenerationCancelled if the token was cancelled in the meantime —
    callers inside the generation loop let this propagate to abort.
    """
    entry = _entries.setdefault(token, {"status": "running"})
    entry["status"] = status
    for key, value in fields.items():
        if value is not None:
            entry[key] = value
    entry["updated_at"] = time.time()
    if entry.get("cancel_requested"):
        _raise_cancelled(token)


def get(token: str) -> Optional[dict]:
    """Read a progress entry (None if unknown or expired)."""
    _reap()
    entry = _entries.get(token)
    if entry is None:
        return None
    result = dict(entry)
    # internal bookkeeping never leaves the server
    result.pop("cancel_requested", None)
    result.pop("updated_at", None)
    return result


def cancel(token: str) -> Optional[str]:
    """Request cancellation of a running generation.

    Returns ``"cancellation_requested"`` only for a currently running
    generation, its terminal status for an already finished one, or ``None``
    for an unknown token. This lets callers avoid claiming a completed/failed
    generation was cancelled.
    """
    entry = _entries.get(token)
    if entry is None:
        return None
    if entry.get("status") != "running":
        return entry.get("status")
    entry["cancel_requested"] = True
    entry["updated_at"] = time.time()
    return "cancellation_requested"


def fail(token: str, message: str) -> None:
    _entries[token] = {
        "status": "failed",
        "message": message,
        "updated_at": time.time(),
    }


def complete(token: str, done: int, total: Optional[int] = None) -> None:
    # A cancellation can arrive after the last batch reported progress but
    # before the route persists its generated result. Do not let that race
    # turn a requested cancellation into a completed generation.
    if _entries.get(token, {}).get("cancel_requested"):
        _raise_cancelled(token)
    _entries[token] = {
        "status": "completed",
        "done": done,
        "total": total,
        "updated_at": time.time(),
    }


def _reap() -> None:
    """Drop entries that are finished (or stale) past their TTL."""
    now = time.time()
    stale = [
        token
        for token, entry in _entries.items()
        if (
            entry.get("status") in ("completed", "failed", "cancelled")
            and now - entry.get("updated_at", 0) > COMPLETED_TTL
        )
        or now - entry.get("updated_at", 0) > RUNNING_TTL
    ]
    for token in stale:
        del _entries[token]
