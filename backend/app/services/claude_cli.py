"""Claude subscription provider via the official Claude Code CLI.

Scio never reads, stores or forwards Claude credentials. The unmodified
`claude` binary manages sign-in and token refresh itself; Scio only
- installs the CLI with Anthropic's official installer,
- relays the sign-in URL and the one-time code of `claude auth login`
  between the web UI and the CLI process,
- runs `claude -p` with all tools disabled for JSON generation calls,
- remembers the plan usage (5-hour and weekly window) that the CLI reports
  with every call in its stream output.

Models served this way carry the MODEL_PREFIX in their model ID
(e.g. "claude-subscription/sonnet"); the part after the prefix is passed
to `claude --model`.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings
from app.models import utc_now

logger = logging.getLogger(__name__)

MODEL_PREFIX = "claude-subscription/"
# Context window the CLI reports for Opus, Sonnet and Haiku 5.5 on a
# subscription (OpenRouter has no data for these model IDs)
SUBSCRIPTION_CONTEXT_LENGTH = 1_000_000

INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash"
INSTALL_TIMEOUT_SECONDS = 600
STATUS_TIMEOUT_SECONDS = 30
LOGIN_URL_TIMEOUT_SECONDS = 30
LOGIN_CODE_TIMEOUT_SECONDS = 60
# Whole documents go into one call; generous because the subscription
# models think before answering.
GENERATION_TIMEOUT_SECONDS = 600

NOT_CONNECTED_MESSAGE = (
    "Claude subscription is not connected. Connect it under Settings → AI providers."
)

# Smallest possible request, only sent when the user asks for fresh usage
USAGE_CHECK_MODEL = f"{MODEL_PREFIX}haiku"

# The sign-in URL is complete once whitespace follows it
_LOGIN_URL_RE = re.compile(r"https://\S+(?=\s)")


def is_subscription_model(model_id: str) -> bool:
    return model_id.startswith(MODEL_PREFIX)


def _cli_home() -> str | None:
    return get_settings().claude_cli_home or None


def can_install() -> bool:
    """Automatic installation needs a dedicated CLI home (Docker image)."""
    return _cli_home() is not None


def cli_path() -> str | None:
    home = _cli_home()
    if home:
        path = os.path.join(home, ".local", "bin", "claude")
        return path if os.access(path, os.X_OK) else None
    return shutil.which("claude")


def _cli_env() -> dict[str, str]:
    # Drop ANTHROPIC_* so an API key or proxy in the app's environment can
    # never silently replace the subscription login.
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    home = _cli_home()
    if home:
        env["HOME"] = home
        env["PATH"] = os.path.join(home, ".local", "bin") + os.pathsep + env.get("PATH", "")
    return env


async def _run(
    args: list,
    timeout: float,
    stdin_data: bytes | None = None,
    cwd: str | None = None,
) -> tuple[int, str, str]:
    """Run a command; the process is killed on timeout or cancellation."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE if stdin_data is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_cli_env(),
        cwd=cwd,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin_data), timeout)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        raise
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def get_status() -> dict[str, Any]:
    """Installation and sign-in state of the CLI (no secrets)."""
    status: dict[str, Any] = {
        "installed": False,
        "can_install": can_install(),
        "version": None,
        "logged_in": False,
        "email": None,
        "subscription_type": None,
        "login_pending": login_pending(),
        "usage": _last_usage,
    }
    path = cli_path()
    if not path:
        return status
    status["installed"] = True

    try:
        _, out, _ = await _run([path, "--version"], STATUS_TIMEOUT_SECONDS)
        status["version"] = out.strip().split(" ")[0] or None
        _, out, _ = await _run([path, "auth", "status", "--json"], STATUS_TIMEOUT_SECONDS)
        auth = json.loads(out)
    except (TimeoutError, OSError, json.JSONDecodeError) as e:
        logger.warning("Could not read Claude CLI status: %s", e)
        return status

    status["logged_in"] = bool(auth.get("loggedIn"))
    status["email"] = auth.get("email")
    status["subscription_type"] = auth.get("subscriptionType")
    return status


async def install() -> None:
    """Install the CLI into the configured home with the official installer."""
    home = _cli_home()
    if home is None:
        raise ValueError(
            "Automatic installation is only available in the Docker image. "
            "Install Claude Code on this machine and restart Scio."
        )
    os.makedirs(home, exist_ok=True)
    try:
        code, out, err = await _run(
            ["bash", "-o", "pipefail", "-c", INSTALL_COMMAND], INSTALL_TIMEOUT_SECONDS
        )
    except TimeoutError:
        raise ValueError("Installing Claude Code timed out. Please try again.")
    if code != 0 or cli_path() is None:
        logger.error("Claude Code installation failed: %s %s", out, err)
        detail = (err or out).strip()[-300:]
        raise ValueError(f"Installing Claude Code failed: {detail}")
    logger.info("Claude Code installed into %s", home)


@dataclass
class _LoginSession:
    proc: asyncio.subprocess.Process
    url: str


_login: _LoginSession | None = None
_login_lock = asyncio.Lock()


def login_pending() -> bool:
    return _login is not None and _login.proc.returncode is None


async def _stop_login() -> None:
    global _login
    if _login is not None and _login.proc.returncode is None:
        _login.proc.kill()
        await _login.proc.wait()
    _login = None


async def start_login() -> str:
    """Start `claude auth login` and return the sign-in URL it prints.

    The process keeps running and waits for the one-time code that the
    user copies from Anthropic's page (see complete_login).
    """
    global _login
    async with _login_lock:
        await _stop_login()
        path = cli_path()
        if path is None:
            raise ValueError("Claude Code is not installed yet.")

        proc = await asyncio.create_subprocess_exec(
            path,
            "auth",
            "login",
            "--claudeai",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=_cli_env(),
        )
        output = ""
        match = None
        try:
            async with asyncio.timeout(LOGIN_URL_TIMEOUT_SECONDS):
                while match is None:
                    chunk = await proc.stdout.read(4096)
                    if not chunk:
                        break
                    output += chunk.decode(errors="replace")
                    match = _LOGIN_URL_RE.search(output)
        except TimeoutError:
            pass

        if match is None:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            logger.error("Claude sign-in did not print a URL: %s", output)
            raise ValueError(f"Could not start the Claude sign-in. {output.strip()[-300:]}".strip())

        _login = _LoginSession(proc=proc, url=match.group())
        return _login.url


async def complete_login(code: str) -> None:
    """Hand the one-time code to the waiting CLI and wait for its verdict."""
    global _login
    async with _login_lock:
        if not login_pending():
            await _stop_login()
            raise ValueError("No sign-in in progress. Please start the sign-in again.")
        proc = _login.proc
        proc.stdin.write(code.strip().encode() + b"\n")
        await proc.stdin.drain()
        try:
            out = await asyncio.wait_for(proc.stdout.read(), LOGIN_CODE_TIMEOUT_SECONDS)
            returncode = await asyncio.wait_for(proc.wait(), 10)
        except TimeoutError:
            await _stop_login()
            raise ValueError("Claude did not confirm the sign-in in time. Please try again.")
        _login = None

        message = out.decode(errors="replace").strip()
        if returncode != 0:
            raise ValueError(message or "Sign-in failed. Please try again.")


async def cancel_login() -> None:
    async with _login_lock:
        await _stop_login()


async def logout() -> None:
    global _last_usage
    _last_usage = None
    path = cli_path()
    if path is None:
        return
    code, out, err = await _run([path, "auth", "logout"], STATUS_TIMEOUT_SECONDS)
    if code != 0:
        raise ValueError(f"Sign-out failed: {(err or out).strip()[-300:]}")


# Plan usage from the most recent CLI call (in memory; gone after restart)
_last_usage: dict[str, Any] | None = None


def _usage_window(windows: dict[str, Any], key: str) -> dict[str, Any] | None:
    window = windows.get(key)
    if not isinstance(window, dict) or window.get("utilization") is None:
        return None
    resets_at = window.get("resetsAt")
    return {
        # 0..1 share of the window that is used up
        "utilization": float(window["utilization"]),
        "resets_at": datetime.fromtimestamp(resets_at, timezone.utc) if resets_at else None,
    }


def _remember_usage(windows: dict[str, Any] | None) -> None:
    global _last_usage
    if not isinstance(windows, dict):
        return
    _last_usage = {
        "five_hour": _usage_window(windows, "five_hour"),
        "seven_day": _usage_window(windows, "seven_day"),
        "checked_at": utc_now(),
    }


def _parse_stream(output: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Return (result event, usage windows) from stream-json output."""
    result = None
    windows = None
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "rate_limit_event":
            info = event.get("rate_limit_info") or {}
            windows = info.get("unifiedWindows") or windows
        elif event.get("type") == "result":
            result = event
    return result, windows


async def chat_completion(model_id: str, system_prompt: str, user_prompt: str) -> str:
    """Run one prompt through `claude -p` and return the assistant text.

    All tools are disabled: uploaded documents end up in the prompt and
    must never be able to trigger commands or file access. The prompt goes
    in via stdin (documents can exceed the argv size limit), the working
    directory is an empty temp dir and no settings files are loaded.
    stream-json is used because only it carries the plan usage.
    """
    path = cli_path()
    if path is None:
        raise ValueError(NOT_CONNECTED_MESSAGE)

    args = [
        path,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--model",
        model_id[len(MODEL_PREFIX) :],
        "--system-prompt",
        system_prompt,
    ]
    with tempfile.TemporaryDirectory(prefix="scio-claude-") as workdir:
        try:
            code, out, err = await _run(
                args, GENERATION_TIMEOUT_SECONDS, stdin_data=user_prompt.encode(), cwd=workdir
            )
        except TimeoutError:
            raise ValueError("Claude did not answer in time. Please try again.")

    data, windows = _parse_stream(out)
    _remember_usage(windows)
    if data is None:
        logger.error("Claude CLI returned no result (exit %s): %s %s", code, out, err)
        raise ValueError(f"Claude CLI failed: {(err or out).strip()[-300:]}")

    if data.get("is_error") or code != 0:
        message = str(data.get("result") or data.get("subtype") or "unknown error")
        logger.error("Claude CLI error: %s", message)
        if "not logged in" in message.lower() or "/login" in message:
            raise ValueError(NOT_CONNECTED_MESSAGE)
        raise ValueError(f"Claude subscription error: {message}")

    return data.get("result") or ""


async def refresh_usage() -> dict[str, Any] | None:
    """Send a minimal request so the CLI reports the current plan usage."""
    await chat_completion(USAGE_CHECK_MODEL, "Reply with OK.", "OK")
    if _last_usage is None:
        raise ValueError("Claude did not report usage data.")
    return _last_usage


async def shutdown() -> None:
    """Stop a pending sign-in process when the app shuts down."""
    await cancel_login()
