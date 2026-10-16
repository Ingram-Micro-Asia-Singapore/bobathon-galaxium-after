"""Bob PreToolUse hook: refuse `git commit` while the test suite is red.

Wired in .bob/settings.json on the command-execution tool. The matcher only
regexes the TOOL NAME, so this runs before every shell command and filters on
the command text itself. Non-commit commands exit 0 immediately.

Exit codes (Bob lifecycle hooks):
  0  allow the tool call
  2  block the tool call; the reason goes to stderr

Fails open (exit 0, with a note on stderr) when the payload is unreadable or
pytest is not installed: a broken environment is not a policy breach.

Written in Python rather than sh so it runs the same on Windows and macOS.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # .bob/hooks/gate_commit.py -> repo root

# An actual `git commit` invocation at the start of the command or after a
# separator (&&, ||, ;, |), not "commit" mentioned inside a grep or echo.
GIT_COMMIT = re.compile(r"(^|[;&|]\s*)git\s+commit\b")


def read_command() -> str:
    """Return the shell command from the hook payload, or "" if there is none.

    Bob builds differ: the documented payload has `tool_input`, some builds
    send `input` instead. Read both, like the Galaxium Travels hooks do.
    """
    raw = sys.stdin.buffer.read().decode("utf-8-sig", errors="replace")
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        print("gate-commit: hook payload is not JSON; allowing", file=sys.stderr)
        return ""
    if not isinstance(payload, dict):
        return ""
    tool_input = payload.get("tool_input") or payload.get("input") or {}
    if isinstance(tool_input, str):  # some builds send the input JSON-encoded
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError:
            return ""
    if not isinstance(tool_input, dict):
        return ""
    command = tool_input.get("command", "")
    return command if isinstance(command, str) else ""


def find_python() -> str:
    """Prefer the project's virtualenv; fall back to whatever runs this hook."""
    for candidate in (ROOT / ".venv" / "Scripts" / "python.exe", ROOT / ".venv" / "bin" / "python"):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def main() -> int:
    command = read_command()
    if not GIT_COMMIT.search(command.strip()):
        return 0

    python = find_python()
    print(f"gate-commit: `git commit` detected, running pytest with {python}", file=sys.stderr)
    result = subprocess.run(
        [python, "-m", "pytest", "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (result.stdout + result.stderr).strip()

    if "No module named pytest" in output:
        print(f"gate-commit: pytest is not installed for {python}; allowing commit", file=sys.stderr)
        return 0

    last_line = output.splitlines()[-1] if output else ""
    if result.returncode == 0:
        print(f"gate-commit: tests passed ({last_line}); commit allowed", file=sys.stderr)
        return 0

    tail = "\n".join(output.splitlines()[-30:])
    print(
        "BLOCKED: commit refused because the test suite is failing.\n"
        f"Command: {command}\n"
        "Fix the failing tests (run `pytest -q`), then commit again.\n"
        "--- pytest output (last 30 lines) ---\n"
        f"{tail}",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
