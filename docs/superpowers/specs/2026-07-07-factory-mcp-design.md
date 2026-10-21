# factory-mcp — Typed Tool Surface for the Content Pipeline (Design)

**Date:** 2026-07-07
**Status:** Design derived from locked decisions (NEXT_SPRINT Q1–Q12) + standing publish rules. Implementation deferred — *banked* spec/plan pair. **Revised 2026-07-07** per the adversarial plan review (`docs/superpowers/reviews/2026-07-07-factory-mcp-plan-review.md`): B1/H1/H2/H3/H4 + mediums folded in — this spec and the plan are now consistent; where the old spec said "streaming", "schedule writes the queue", `brief`, or `fix?`, THIS revision wins.
**Home repo:** `jarvis-project/` — scaffold at `factory-mcp/`, pipeline scripts at `command-post/`, state at `state/`.
**Note:** spec/plan filed under `travelplaninfo-prototype/docs/superpowers/` alongside today's batch for co-location; the code lives in `jarvis-project/factory-mcp/`.

---

## 1. Goal & success criteria

Extend the existing `factory-mcp` scaffold from 3 read-only tools to a typed **6-verb tool surface** (`factory_draft/images/assemble/review/publish/status` — snake_case on the wire; MCP/Anthropic tool names exclude `.`) that lets a Claude Code/Desktop client drive the content pipeline through a stable contract instead of memorizing 18 CLI scripts — **without** loosening the human publish gate.

**Success criteria:**
1. The 6 verbs are exposed over stdio, each with a typed input schema + description, building on the existing scaffold's packaging/transport.
2. Each verb wraps its backing script via **subprocess** (no import-time dep coupling), capturing output and returning a structured result (stdout/stderr tail). True MCP progress notifications are deferred — long verbs run request/response.
3. `factory_publish` performs **dry-run / preview / schedule-prep only** — it can never trigger a live `--approve`, and **no response string it returns ever contains `--approve` or `--ack-jose-approved`** (no fabricated approval tokens, no paste-and-run live command). Live publish stays operator-gated (CLI/dashboard + the ack flag the operator types themselves).
4. `factory_status` reads the SQLite source of truth (`db.get_articles()`), not raw JSON.
5. The MCP is registered in the client config and its tools are listable + callable by an MCP client (smoke).
6. Unit tests cover arg-mapping per verb; an integration smoke drives draft→images→assemble→review→dry-run on a throwaway slug.

---

## 2. Current state (ground truth, 2026-07-07 sweep)

- **Scaffold exists** — `jarvis-project/factory-mcp/`: `pyproject.toml` (`name=factory-mcp`, `requires-python>=3.11`, `dependencies=["mcp>=1.0"]`, console-script `factory-mcp = factory_mcp.__main__:main`), `src/factory_mcp/server.py` (145 lines, `Server("factory-mcp")`, `stdio_server()`) implementing **only** `list_events` / `get_event` / `list_queue`. Docstring: *"trigger_publish — NOT IMPLEMENTED in Phase 1 (publishing remains operator-gated)."* Own isolated `.venv` (3.12) with **only `mcp`**. Git-clean. **NOT registered in any MCP client config.**
- **Pipeline scripts** — `command-post/*.py`, invoked today with bare `/usr/bin/python3` (Python 3.12.3, deps global). Each core script has BOTH a CLI (`argparse`/`main()`) AND an importable core function.
- **Precedent:** the FastAPI backend (`command-post/api.py`, `routers/content_pipeline.py:342,802`) already wraps every stage via `subprocess.Popen(["python3", "command-post/<script>.py", ...])`, streaming stdout into a job store. This is the proven wrap pattern.
- **State** at `jarvis-project/state/` (not `command-post/state/`); mutated through `command-post/lib/common.py:98 atomic_modify_json` (flock + `os.replace`). **`db.py`: SQLite (`state/jarvis.db`) is the source; `queue.json`/`publishing-log.json` are *exported from* it** (`db.export_queue_json()`), so `factory_status` should read `db.get_articles()`.
- **Locked decisions** (NEXT_SPRINT Q1–Q12): topology = **two MCPs (factory + smo) same machine, stdio-primary, HTTP escape hatch deferred to Phase 2** (Q9); off-page/SMO is the sister `smo-mcp` (Q1 "extend `offpage_queue.py`"), **out of scope here**. Event emitter is live; multi-writer lock exists.

---

## 3. Design

### 3.1 Wrap strategy — subprocess-CLI
The MCP shells out to `/usr/bin/python3 command-post/<script>.py <args>` (system interpreter, which has the pipeline deps). The MCP process itself needs only `mcp` — so the scaffold's minimal `.venv` is fine and the import-time dependency mismatch is sidestepped. This mirrors the FastAPI router exactly. A shared `run_script(script, args) -> {ok, exit_code, stdout_tail, ...}` helper captures output (tail). **Runtime gate:** `run_script()` is the single chokepoint every verb passes through — it holds a frozen forbidden-flag denylist (`--approve`, `--ack-jose-approved`, `--force`, `--rebuild`, `--all`, `--batch`, `--audit-all`, `--audit-published`, `--fix`) and raises before spawning any subprocess if a banned flag appears in argv, so the publish gate is a mechanism, not just tests + grep.

### 3.2 The 6 verbs

Wire names are snake_case (`factory_draft` etc. — the real handler names; dots are invalid in MCP/Anthropic tool names). Every schema sets `additionalProperties: false` and every handler rejects unknown argument keys with an error (a typo'd key like `schdule` must fail loudly, never silently no-op). `slug` is charset-validated on every verb: `re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}")`.

| Verb | Backing script | Key inputs | Notes |
|---|---|---|---|
| `factory_draft` | `sonnet_writer.py` | `site, slug, brief_path?, keywords?, words?` | $0 via Claude CLI path; `brief_path` is a file path (`--brief`) |
| `factory_images` | `image_pipeline.py` | `slug, provider?, stage?, slot?, reason?, dry_run?` | script requires `--provider` (choices `openai\|xai\|openrouter`); MCP defaults it to `openai` |
| `factory_assemble` | `content_assembler.py` | `slug, dry_run?` | |
| `factory_review` | `content_reviewer.py` | `slug, site?` | mandatory reviewer gate. The script's `--fix` override (self-marks `review_status:"passed"`) is **operator-CLI-only — NOT exposed via MCP** |
| `factory_publish` | `wp_publisher.py` \| `tpi_publisher.py` | `slug, dry_run=true, schedule?` | **live `--approve` NOT exposed** (§3.3); site→publisher via DIR_TO_DOMAIN |
| `factory_status` | `db.get_articles()` | `slug?, stage?, site?, limit?` | structured DB rows, not JSON |

### 3.3 Publish gate (the one safety call)
`factory_publish` **defaults `dry_run=true`** and supports `schedule` as **validate + dry-run preview + returned operator next-step only** — the MCP never writes the schedule queue (both publishers gate schedule *effects* behind `--approve`, which this tool cannot pass). Live publication remains exclusively an operator action through the CLI/dashboard with `--ack-jose-approved`, preserving the non-negotiable "NEVER publish/deploy without Jose's go-ahead." Two hard rules on the response: the returned `operator_command` field is a **plainly NON-executable next-step instruction** (interpolated values `shlex.quote`d), and **no string the tool composes — `operator_command`, the `dry_run:false` refusal message, tool descriptions — ever contains `--approve` or `--ack-jose-approved`**; the operator composes the live command and types the approval flags themselves. (`stdout_tail`/`stderr_tail` are verbatim passthrough of the wrapped script's own output and are not sanitized; the hook-passing ack token appears in no script output and must appear in no response field at all.) Defense in depth: the §3.1 runtime denylist in `run_script()` raises if any banned flag ever reaches an argv. (Matches the scaffold's stated intent.) Exposing a gated-live-publish verb later is an explicit, separate decision (O2) — default NO.

### 3.4 Returns & routing
- Action verbs return `{ ok, verb, slug, exit_code, stdout_tail, resulting_state }` where `resulting_state` is re-read from `db.get_articles(slug)` / the queue after the run — giving the caller structured truth despite the subprocess boundary.
- `factory_publish` routes to `tpi_publisher.py` for the `travelplan`/travelplaninfo site and `wp_publisher.py` for the 5 WP sites (via the existing DIR_TO_DOMAIN map).
- The MCP never writes state files directly (except read-only `db` for status); all mutation goes through the wrapped scripts, inheriting their `atomic_modify_json` safety.

### 3.5 Transport & registration
stdio-primary (Q9). Register `factory-mcp` in the MCP client config (stdio; command = the installed console-script or `<venv>/bin/python -m factory_mcp`). The **HTTP/SSE escape hatch is deferred to Phase 2** (Q9) — the tool schemas are transport-agnostic, so adding it later is additive.

---

## 4. Task breakdown
1. Scaffold audit + `run_script()` subprocess helper (capture + tail + the §3.1 forbidden-flag runtime denylist), with a tests harness that mocks subprocess and isolates the DB (unit tests must never touch production `state/jarvis.db` — importing `db.py` runs `init_db()`, which includes an `ALTER TABLE` + backfill migration).
2–7. Implement the 6 verb tools (schema + handler + arg-mapping + unit test each), in order: `status` (read-only, safest) → `draft` → `images` → `assemble` → `review` → `publish` (gated last).
8. Register in MCP client config + integration smoke: list tools via an MCP client; drive `draft→images(dry_run)→assemble→review→publish(dry_run)→status` on a throwaway slug; assert `publish` refuses/omits live `--approve`.

Apply `mcp-builder` skill patterns (tool naming, input-schema clarity, error surfacing, no silent failures) throughout the plan.

---

## 5. Out of scope
- **Live `--approve` publishing via MCP** (human-gated CLI/dashboard only; O2).
- **Off-page / SMO** — the sister `smo-mcp` (Q1); not this package.
- **HTTP/SSE transport** — Phase 2 (Q9).
- **`factory_brief` (`generate_tpi_briefs.py`) / batch mode (`pipeline_runner.py`)** — later verbs (O3).
- **`content_reviewer.py --fix`** — the review-gate override stays operator-CLI-only (§3.2); exposing it via MCP would let an agent self-green the mandatory quality gate.
- **Import-based wrapping** — subprocess chosen (§3.1).

---

## 6. Verification bar
- Per-verb unit tests (arg-mapping, subprocess mocked, error paths surfaced not swallowed, unknown keys rejected) against an isolated temp DB — never production `state/jarvis.db`.
- The `run_script()` forbidden-flag denylist has its own unit test (raises before any subprocess).
- Integration smoke: full dry-run chain on a throwaway slug; `factory_publish` proven unable to go live AND its responses proven free of `--approve`/`--ack-jose-approved`.
- MCP registered; `tools/list` shows all 6 + the 3 existing read tools; a client can call `factory_status`.
- `factory-mcp` package installs clean in its `.venv`; scaffold's 3 read tools still pass.

---

## 7. Open questions
- **O1 (HTTP escape hatch):** Phase 2 per Q9 — deferred, additive when needed.
- **O2 (gated-live-publish verb):** default NO; revisit only if Jose wants MCP-driven publish with an in-tool ack gate.
- **O3 (extra verbs):** `factory_brief` + batch (`pipeline_runner`) as later additions.

---

## 8. References
- `~/seo-workspace/NEXT_SPRINT.md` "Locked Decisions" (Q1–Q12); `ARTICLE_FACTORY_RUNBOOK.md` (stale — do not re-litigate the 12 questions).
- Scaffold: `jarvis-project/factory-mcp/src/factory_mcp/server.py`. Precedent: `command-post/routers/content_pipeline.py:342,802`. Atomic helper: `command-post/lib/common.py:98`. Source-of-truth: `command-post/db.py`.
- `mcp-builder` skill (Python MCP SDK patterns). Standing rule: NEVER publish/deploy without Jose's explicit go-ahead.
