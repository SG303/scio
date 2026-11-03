"""Tests for the Claude subscription provider (app/services/claude_cli.py).

A fake `claude` shell script stands in for the real CLI, so no network,
no account and no subscription usage are involved. It records the
arguments, stdin and environment of `-p` calls and emulates the
`auth login` flow (prints a sign-in URL, then waits for the code).
"""
import json
import os
import stat

import pytest

from app.config import get_settings
from app.services import claude_cli
from app.services.openrouter_client import chat_completion_json

FAKE_CLI = r"""#!/bin/bash
state="$HOME/state"
mkdir -p "$state"
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
if [ "$1" = "auth" ]; then
  case "$2" in
    status)
      if [ -f "$state/loggedin" ]; then
        echo '{"loggedIn": true, "email": "me@example.com", "subscriptionType": "max"}'
      else
        echo '{"loggedIn": false}'
      fi
      exit 0;;
    login)
      echo "Opening browser to sign in…"
      echo "If the browser didn't open, visit: https://claude.example/oauth/authorize?code=true&state=abc"
      printf "Paste code here if prompted > "
      read -r code
      if [ "$code" = "good-code#state" ]; then
        touch "$state/loggedin"; echo "Login successful."; exit 0
      fi
      echo "Login failed: That code wasn't accepted."; exit 1;;
    logout) rm -f "$state/loggedin"; exit 0;;
  esac
fi
if [ "$1" = "-p" ]; then
  printf '%s\n' "$@" > "$state/args"
  cat > "$state/stdin"
  echo "${ANTHROPIC_API_KEY:-unset}" > "$state/api_key_env"
  pwd > "$state/cwd"
  if [ ! -f "$state/loggedin" ]; then
    echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}'
    exit 1
  fi
  if [ -f "$state/limit" ]; then
    echo '{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached"}'
    exit 1
  fi
  echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"ok\": true}"}'
  exit 0
fi
exit 2
"""


@pytest.fixture
def cli_home(tmp_path, monkeypatch):
    """Configure a CLI home that contains the fake `claude` binary."""
    bin_dir = tmp_path / ".local" / "bin"
    bin_dir.mkdir(parents=True)
    cli = bin_dir / "claude"
    cli.write_text(FAKE_CLI)
    cli.chmod(cli.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setattr(get_settings(), "claude_cli_home", str(tmp_path))
    return tmp_path


def _state(cli_home, name):
    return (cli_home / "state" / name).read_text()


def _log_in(cli_home):
    (cli_home / "state").mkdir(exist_ok=True)
    (cli_home / "state" / "loggedin").touch()


def test_subscription_model_detection():
    assert claude_cli.is_subscription_model("claude-subscription/sonnet")
    assert not claude_cli.is_subscription_model("anthropic/claude-sonnet-5.5")


async def test_status_when_not_installed(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "claude_cli_home", str(tmp_path))
    status = await claude_cli.get_status()
    assert status["installed"] is False
    assert status["can_install"] is True
    assert status["logged_in"] is False


async def test_status_reports_version_and_account(cli_home):
    _log_in(cli_home)
    status = await claude_cli.get_status()
    assert status["installed"] is True
    assert status["version"] == "9.9.9"
    assert status["logged_in"] is True
    assert status["email"] == "me@example.com"
    assert status["subscription_type"] == "max"


async def test_login_flow_relays_url_and_code(cli_home):
    url = await claude_cli.start_login()
    assert url == "https://claude.example/oauth/authorize?code=true&state=abc"
    assert claude_cli.login_pending()

    await claude_cli.complete_login("  good-code#state \n")

    assert not claude_cli.login_pending()
    assert (await claude_cli.get_status())["logged_in"] is True


async def test_login_with_wrong_code_reports_cli_message(cli_home):
    await claude_cli.start_login()
    with pytest.raises(ValueError, match="wasn't accepted"):
        await claude_cli.complete_login("wrong")
    assert not claude_cli.login_pending()
    assert (await claude_cli.get_status())["logged_in"] is False


async def test_complete_without_started_login_fails(cli_home):
    with pytest.raises(ValueError, match="No sign-in in progress"):
        await claude_cli.complete_login("good-code#state")


async def test_cancel_login_stops_process(cli_home):
    await claude_cli.start_login()
    await claude_cli.cancel_login()
    assert not claude_cli.login_pending()


async def test_logout(cli_home):
    _log_in(cli_home)
    await claude_cli.logout()
    assert (await claude_cli.get_status())["logged_in"] is False


async def test_generation_runs_cli_without_tools(cli_home, monkeypatch):
    _log_in(cli_home)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-must-not-leak")
    big_prompt = "Document text. " * 20000  # larger than one argv entry may be

    content = await chat_completion_json(
        model_id="claude-subscription/sonnet",
        system_prompt="Return JSON.",
        user_prompt=big_prompt,
        temperature=0.7,
    )

    assert json.loads(content) == {"ok": True}
    args = _state(cli_home, "args").splitlines()
    assert args[args.index("--model") + 1] == "sonnet"
    assert args[args.index("--tools") + 1] == ""
    assert args[args.index("--system-prompt") + 1] == "Return JSON."
    assert "--no-session-persistence" in args
    # Prompt goes via stdin, not argv
    assert _state(cli_home, "stdin") == big_prompt
    assert big_prompt not in "\n".join(args)
    # An API key in the app's environment never reaches the CLI
    assert _state(cli_home, "api_key_env").strip() == "unset"
    # Runs in an empty temp dir, not in the app directory
    assert _state(cli_home, "cwd").strip() != os.getcwd()


async def test_generation_when_not_logged_in(cli_home):
    with pytest.raises(ValueError, match="not connected"):
        await chat_completion_json(
            model_id="claude-subscription/opus",
            system_prompt="s",
            user_prompt="u",
            temperature=0.7,
        )


async def test_generation_passes_on_cli_errors(cli_home):
    _log_in(cli_home)
    (cli_home / "state" / "limit").touch()
    with pytest.raises(ValueError, match="usage limit reached"):
        await chat_completion_json(
            model_id="claude-subscription/opus",
            system_prompt="s",
            user_prompt="u",
            temperature=0.7,
        )


async def test_generation_when_cli_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "claude_cli_home", str(tmp_path))
    with pytest.raises(ValueError, match="not connected"):
        await chat_completion_json(
            model_id="claude-subscription/opus",
            system_prompt="s",
            user_prompt="u",
            temperature=0.7,
        )


async def test_install_needs_cli_home(monkeypatch):
    monkeypatch.setattr(get_settings(), "claude_cli_home", "")
    assert claude_cli.can_install() is False
    with pytest.raises(ValueError, match="only available in the Docker image"):
        await claude_cli.install()
