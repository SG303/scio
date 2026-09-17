"""Shared fixtures and helpers for the Scio backend test suite."""
import sys
from pathlib import Path

# Make `app` importable regardless of where pytest is invoked from
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))


class MockDocument:
    """Lightweight stand-in for app.models.Document (no DB required)."""

    def __init__(self, title: str, doc_type: str, content: str):
        self.title = title
        self.doc_type = doc_type
        self.content = content
