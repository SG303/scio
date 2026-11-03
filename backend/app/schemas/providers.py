from typing import Literal, Optional

from pydantic import BaseModel, Field


class OpenRouterKeyStatus(BaseModel):
    """Whether an OpenRouter key is configured — never the key itself."""
    configured: bool
    # "app" = entered in the web UI, "environment" = OPENROUTER_API_KEY
    source: Optional[Literal["app", "environment"]] = None
    key_hint: Optional[str] = None


class OpenRouterKeyUpdate(BaseModel):
    api_key: str = Field(min_length=10, max_length=500)


class ClaudeStatus(BaseModel):
    """Installation and sign-in state of the Claude Code CLI."""
    installed: bool
    can_install: bool
    version: Optional[str] = None
    logged_in: bool
    email: Optional[str] = None
    subscription_type: Optional[str] = None
    login_pending: bool


class ClaudeLoginStart(BaseModel):
    """Anthropic sign-in page the user opens to get the one-time code."""
    url: str


class ClaudeLoginComplete(BaseModel):
    code: str = Field(min_length=1, max_length=2000)
