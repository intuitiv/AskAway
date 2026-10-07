# Consolidated Backlog

Items gathered from unchecked task lines, unresolved analysis findings, open reviewer-brief questions, and qualifying reviewer messages. `READY` means actionable now; `NEEDS-DECISION` requires reviewer input; `BLOCKED` depends on another item or an external prerequisite.

## 005 — Spec Kit Guided Flow

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T002 | Track `.askaway/specs/`; ignore generated cloud folders | NEEDS-DECISION | Waits for reviewer confirmation per D-17 | specs/005-speckit-guided-flow/tasks.md |
| T015 | Include worker spend and turn time in shared banner and Telegram | READY | None | specs/005-speckit-guided-flow/tasks.md |
| T016 | Polish stage navigation, stale labels, colors, and commentary layout | READY | None | specs/005-speckit-guided-flow/tasks.md |

## 006 — Cloud Tasks

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T004 | Run the live cloud proof and record route evidence | BLOCKED | Reviewer must name an open PR and confirm cloud-agent/model/workflow setup | specs/006-cloud-tasks/tasks.md |
| T005 | Update route decisions and record go/no-go from observed proof | BLOCKED | Depends on T004 evidence | specs/006-cloud-tasks/tasks.md |
| F7 | Decide whether merge blocking applies to every PR or only cloud-task PRs | NEEDS-DECISION | Recommend cloud-task PRs only | specs/006-cloud-tasks/checklists/analyze.md |
| F18 | Tag 006 tasks `[cloud]` or `[local: reason]` | BLOCKED | Do when the `/sk.tasks` asset ships | specs/006-cloud-tasks/checklists/analyze.md |
| F21 | Set live-proof go/no-go criteria | NEEDS-DECISION | Choose strict model/concurrency gate or accept any working route and record limits | specs/006-cloud-tasks/reviewer-brief.md |

## 007 — Validator Agent

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T001 | Measure agentmemory lifecycle options and report the spike | BLOCKED | Requires a local agentmemory server | specs/007-validator-agent/tasks.md |
| T004a | Implement the observer and test caller-visible answers, skips, cost, and failure behavior | READY | None | specs/007-validator-agent/tasks.md |
| T004b | Render validator Commentary entry and Storybook story | BLOCKED | Depends on T004a | specs/007-validator-agent/tasks.md |
| T005 | Implement knowledge-store port and agentmemory adapter | BLOCKED | Depends on T001 and reviewer store choice A1 | specs/007-validator-agent/tasks.md |
| T006 | Close the loop on reviewer replies and store validated knowledge | BLOCKED | Depends on T004a/b, T005, and ordering decision A4 | specs/007-validator-agent/tasks.md |
| T007 | Propose dismissible context from stored knowledge | BLOCKED | Depends on T005 and T006 | specs/007-validator-agent/tasks.md |
| T008 | Deduplicate, supersede, and keep stored knowledge concise | BLOCKED | Depends on T001 and T005 | specs/007-validator-agent/tasks.md |
| T009a | Add answer, enhance, store, cheap-check, and secret-leak eval suites | BLOCKED | Depends on observer stories T004a–T007 | specs/007-validator-agent/tasks.md |
| T009b | Add eval baselines and a reviewer-correction path | BLOCKED | Depends on T009a | specs/007-validator-agent/tasks.md |
| T010 | Run quickstart, plan first-week measurements, update requirements, and run gates | BLOCKED | Depends on all stories | specs/007-validator-agent/tasks.md |
| A1 | Choose validator knowledge-store lifecycle approach | NEEDS-DECISION | Dedicated isolated instance, shared store with re-save, or memoryStore fallback | specs/007-validator-agent/checklists/analyze.md |
| A4 | Decide validator-first reply ordering | NEEDS-DECISION | Queue first without waiting, or wait up to a bounded timeout | specs/007-validator-agent/checklists/analyze.md |
| A5 | Clarify changed-rule flags and retained history semantics | NEEDS-DECISION | Confirm informational flag and whether superseded history is never loaded | specs/007-validator-agent/checklists/analyze.md |
| A10 | Add success criteria for beta isolation and secret handling | NEEDS-DECISION | Requires reviewer-owned spec.md edits | specs/007-validator-agent/checklists/analyze.md |
| A11 | Choose when to establish SC-002/SC-004 baselines | NEEDS-DECISION | Defer to first-week measurement or sample past replies before launch | specs/007-validator-agent/checklists/analyze.md |
| A12 | Resolve external agentmemory dependency and index rebuild requirement | NEEDS-DECISION | Amend assumption and decide whether rebuild-from-index is required | specs/007-validator-agent/checklists/analyze.md |
| A15 | Define what counts as observed versus skipped | NEEDS-DECISION | Clarify reviewer-owned spec wording | specs/007-validator-agent/checklists/analyze.md |
| A17 | Align prompt-enhancement terminology across spec, eval, and code | READY | Pick a consistent term and document mapping | specs/007-validator-agent/checklists/analyze.md |
| A19 | Add agentmemory port/health check to quickstart | BLOCKED | Add after T001 lands | specs/007-validator-agent/checklists/analyze.md |
| A20/N6 | Resolve draft spec status and unchecked reviewer checklists | NEEDS-DECISION | Resolve gaps first or accept and record them as beta limits | specs/007-validator-agent/checklists/analyze.md |
| N1 | Rewrite plan constitution check against principles I–VIII | READY | Next plan edit | specs/007-validator-agent/checklists/analyze.md |
| N2 | Account for workspace isolation in the agentmemory store choice | BLOCKED | Resolve with A1; per-workspace instance/data dir if selected | specs/007-validator-agent/checklists/analyze.md |
| N3 | Record validator lifecycle by worker/session through existing hooks | READY | Fold into T004a and assert the event | specs/007-validator-agent/checklists/analyze.md |
| N4 | Name the runner that executes validator eval suites | READY | Specify runner in T009a | specs/007-validator-agent/checklists/analyze.md |
| N5 | Keep validator work within the task budget | READY | Fold N3 into T004a rather than adding a task | specs/007-validator-agent/checklists/analyze.md |

## Untracked reviewer asks

`.askaway/reviewer-messages.md` stops before 2026-10-02; these rows come from the 2026-10-02..10-07 conversation.

| ID | What | State | Blocker or question | Source |
|---|---|---|---|---|
| U1 | 006/007 doc: what the reviewer asked, design, questions | DONE | `specs/006-cloud-tasks/reviewer-brief.md`, `specs/007-validator-agent/reviewer-brief.md` | 2026-10-06 |
| U2 | Workers missing from Workers tab/banner (worktree) + test | DONE (needs reload) | `test-worker-worktree-visibility.cjs`, R-WORKERS-21, deployed | 2026-10-06 |
| U3 | Telegram: handoff as text, full response as mobile PDF | DONE (needs reload) | `src/services/responsePdf.ts`, `test-telegram-delivery.cjs`, deployed | 2026-10-06 |
| U4 | 006 per-task time cap: agent picked default 50 min, max 59 | NEEDS-DECISION | Confirm the numbers | 2026-10-06 |
| U5 | agentmemory live demo | BLOCKED | Same install OK as 007 T001 | 2026-10-06 |
| U6 | pr-daily on app-logic PR #1557 (6 failing checks) | NEEDS-DECISION | Another agent owns that checkout; may a worker fix in a separate worktree? | 2026-10-06 |
| U7 | Worker step cap + compaction at ~100K context | NEEDS-DECISION | Cap value; compaction = handoff to a fresh fork | cost RCA 2026-10-06 |
| U8 | Cheaper default model for test/rca/code profiles | NEEDS-DECISION | Which profiles move off Sonnet | cost RCA 2026-10-06 |
| U9 | Cap parallel worker fan-out | NEEDS-DECISION | 4-5 default vs 10 | cost RCA 2026-10-06 |
| U10 | Standard simulated workspace to benchmark agents/models/prompts | NEEDS-DECISION | Reuse evals `complex` fixture as spec 008 | 2026-10-06 |

## New 2026-10-07

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| NEW-1 | For huge tasks, warm one worker with shared context, then fork N parallel workers | NEEDS-DECISION | Trigger, N cap, fork lifetime (Q1-Q3) | Reviewer ask, 2026-10-07 |
| NEW-2 | Maximise worker reuse; 175/200 workers expired, 138 under 100K context | NEEDS-DECISION | Reuse expired workers under 100K? (Q4) | POC `.askaway/analyst/report.md` |
| NEW-3 | Repo analyst worker over all worker ledgers/sessions | NEEDS-DECISION | Scope, cadence, may it edit prompts (Q5-Q6); POC `tasksync-chat/tools/worker-analyst.cjs` | Reviewer ask, 2026-10-07 |
| NEW-4 | Efficiency score = work per $, comparable across models | NEEDS-DECISION | Formula (Q7) | Reviewer ask, 2026-10-07 |

Counts: READY 8 | NEEDS-DECISION 21 | BLOCKED 15 | DONE 3
