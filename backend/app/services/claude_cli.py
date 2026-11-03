"""Claude subscription provider via the official Claude Code CLI.

Scio never reads, stores or forwards Claude credentials. The unmodified
`claude` binary manages sign-in and token refresh itself; Scio only
- installs the CLI with Anthropic's official installer,
- relays the sign-in URL and the one-time code of `claude auth login`
  between the web UI and the CLI process,
- runs `claude -p` with all tools disabled for JSON generation calls.

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
from typing import Any, Dict, Optional, Tuple

from app.config import get_settings

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
    "Claude subscription is not connected. "
    "Connect it under Settings → AI providers."
)

# The sign-in URL is complete once whitespace follows it
_LOGIN_URL_RE = re.compile(r"https://\S+(?=\s)")


def is_subscription_model(model_id: str) -> bool:
    return model_id.startswith(MODEL_PREFIX)


def _cli_home() -> Optional[str]:
    return get_settings().claude_cli_home or None


def can_install() -> bool:
    """Automatic installation needs a dedicated CLI home (Docker image)."""
    return _cli_home() is not None


def cli_path() -> Optional[str]:
    home = _cli_home()
    if home:
        path = os.path.join(home, ".local", "bin", "claude")
        return path if os.access(path, os.X_OK) else None
    return shutil.which("claude")


def _cli_env() -> Dict[str, str]:
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
    stdin_data: Optional[bytes] = None,
    cwd: Optional[str] = None,
) -> Tuple[int, str, str]:
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


async def get_status() -> Dict[str, Any]:
    """Installation and sign-in state of the CLI (no secrets)."""
    status: Dict[str, Any] = {
        "installed": False,
        "can_install": can_install(),
        "version": None,
        "logged_in": False,
        "email": None,
        "subscription_type": None,
        "login_pending": login_pending(),
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
    except (asyncio.TimeoutError, OSError, json.JSONDecodeError) as e:
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
    except asyncio.TimeoutError:
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


_login: Optional[_LoginSession] = None
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
            path, "auth", "login", "--claudeai",
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
            raise ValueError(
                f"Could not start the Claude sign-in. {output.strip()[-300:]}".strip()
            )

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
        except asyncio.TimeoutError:
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
    path = cli_path()
    if path is None:
        return
    code, out, err = await _run([path, "auth", "logout"], STATUS_TIMEOUT_SECONDS)
    if code != 0:
        raise ValueError(f"Sign-out failed: {(err or out).strip()[-300:]}")


async def chat_completion(model_id: str, system_prompt: str, user_prompt: str) -> str:
    """Run one prompt through `claude -p` and return the assistant text.

    All tools are disabled: uploaded documents end up in the prompt and
    must never be able to trigger commands or file access. The prompt goes
    in via stdin (documents can exceed the argv size limit), the working
    directory is an empty temp dir and no settings files are loaded.
    """
    path = cli_path()
    if path is None:
        raise ValueError(NOT_CONNECTED_MESSAGE)

    args = [
        path, "-p",
        "--output-format", "json",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--model", model_id[len(MODEL_PREFIX):],
        "--system-prompt", system_prompt,
    ]
    with tempfile.TemporaryDirectory(prefix="scio-claude-") as workdir:
        try:
            code, out, err = await _run(
                args, GENERATION_TIMEOUT_SECONDS, stdin_data=user_prompt.encode(), cwd=workdir
            )
        except asyncio.TimeoutError:
            raise ValueError("Claude did not answer in time. Please try again.")

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        logger.error("Claude CLI returned no JSON (exit %s): %s %s", code, out, err)
        raise ValueError(f"Claude CLI failed: {(err or out).strip()[-300:]}")

    if data.get("is_error") or code != 0:
        message = str(data.get("result") or data.get("subtype") or "unknown error")
        logger.error("Claude CLI error: %s", message)
        if "not logged in" in message.lower() or "/login" in message:
            raise ValueError(NOT_CONNECTED_MESSAGE)
        raise ValueError(f"Claude subscription error: {message}")

    return data.get("result") or ""


async def shutdown() -> None:
    """Stop a pending sign-in process when the app shuts down."""
    await cancel_login()
