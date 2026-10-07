# Consolidated Backlog

Items gathered from unchecked task lines, unresolved analysis findings, open reviewer-brief questions, and qualifying reviewer messages. `READY` means actionable now; `NEEDS-DECISION` requires reviewer input; `BLOCKED` depends on another item or an external prerequisite.

## 005 — Spec Kit Guided Flow

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T002 | Track `.askaway/specs/`; ignore generated cloud folders | DONE (won't do) | Won't do: reviewer 2026-10-07 'No' | specs/005-speckit-guided-flow/tasks.md |
| T015 | Include worker spend and turn time in shared banner and Telegram | READY | None | specs/005-speckit-guided-flow/tasks.md |
| T016 | Polish stage navigation, stale labels, colors, and commentary layout | READY | None | specs/005-speckit-guided-flow/tasks.md |

## 006 — Cloud Tasks

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T004 | Run the live cloud proof and record route evidence | BLOCKED | Reviewer named https://github.com/Pega-ProductEngineering/model-calculation-service-app-logic/pull/1603; cloud-agent/model/workflow setup still to confirm | specs/006-cloud-tasks/reviewer-brief.md |
| T005 | Update route decisions and record go/no-go from observed proof | BLOCKED | Depends on T004 evidence | specs/006-cloud-tasks/tasks.md |
| F7 | Decide whether merge blocking applies to every PR or only cloud-task PRs | NEEDS-DECISION | Reviewer asked for more details; recommend cloud-task PRs only, not approved | specs/006-cloud-tasks/reviewer-brief.md |
| F18 | Tag 006 tasks `[cloud]` or `[local: reason]` | BLOCKED | Do when the `/sk.tasks` asset ships | specs/006-cloud-tasks/checklists/analyze.md |
| F21 | Set live-proof go/no-go criteria | NEEDS-DECISION | Reviewer asked for more details; strict model/concurrency gate vs working route with recorded limits remains open | specs/006-cloud-tasks/reviewer-brief.md |

## 007 — Validator Agent

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T001 | Measure agentmemory lifecycle options and report the spike | READY | Install approved; dedicated validator server, auto-forget off (A1) | specs/007-validator-agent/Rules.md |
| T004a | Implement the observer and test caller-visible answers, skips, cost, and failure behavior | READY | None | specs/007-validator-agent/tasks.md |
| T004b | Render validator Commentary entry and Storybook story | BLOCKED | Depends on T004a | specs/007-validator-agent/tasks.md |
| T005 | Implement knowledge-store port and agentmemory adapter | BLOCKED | Depends on T001; A1 selected dedicated server, shared topology remains open under D22 | specs/007-validator-agent/tasks.md |
| T006 | Close the loop on reviewer replies and store validated knowledge | BLOCKED | Depends on T004a/b and T005; A4 resolved: alongside, never blocks reply | specs/007-validator-agent/tasks.md |
| T007 | Propose dismissible context from stored knowledge | BLOCKED | Depends on T005 and T006 | specs/007-validator-agent/tasks.md |
| T008 | Deduplicate, supersede, and keep stored knowledge concise | BLOCKED | Depends on T001 and T005 | specs/007-validator-agent/tasks.md |
| T009a | Add answer, enhance, store, cheap-check, and secret-leak eval suites | BLOCKED | Depends on observer stories T004a–T007 | specs/007-validator-agent/tasks.md |
| T009b | Add eval baselines and a reviewer-correction path | BLOCKED | Depends on T009a; A11 supersedes automated beta baselines with manual review; task needs later alignment | specs/007-validator-agent/tasks.md |
| T010 | Run quickstart, plan first-week measurements, update requirements, and run gates | BLOCKED | Depends on all stories | specs/007-validator-agent/tasks.md |
| A1 | Choose validator knowledge-store lifecycle approach | DONE | Reviewer: "a separate agentmemory server only for the validator, with auto-forget off"; install approved | specs/007-validator-agent/Rules.md |
| A4 | Decide validator-first reply ordering | DONE | Reviewer: "Validator for few turns it is more like trial basis. I manually see the quality of validator how it is responding on behalf of me." Alongside, never blocks reply | specs/007-validator-agent/spec.md |
| A5 | Clarify changed-rule flags and retained history semantics | DONE | Reviewer: "keep older versions also, hide them"; retained, hidden from recall/default views | specs/007-validator-agent/spec.md |
| A10 | Add success criteria for beta isolation and secret handling | NEEDS-DECISION | "Sure": SC-010/SC-011 drafted by agent, reviewer to approve (0 agent-channel outputs; 0 seeded secrets in any sink) | specs/007-validator-agent/spec.md |
| A11 | Choose when to establish SC-002/SC-004 baselines | DONE | Reviewer: "I'll manually see them few days"; no automated baseline in beta | specs/007-validator-agent/spec.md |
| A12 | Resolve external agentmemory dependency and migration | DONE | D22: md files seed agentmemory once, then frozen; agentmemory replaces VS Code `/memories` for agents. OPEN: shared server vs A1 validator-only; rebuild-from-index undecided | specs/007-validator-agent/spec.md |
| A15 | Define what counts as observed versus skipped | NEEDS-DECISION | "Sure": definition drafted by agent, reviewer to approve; cheap-check observed, pure progress skipped and counted | specs/007-validator-agent/spec.md |
| A17 | Align prompt-enhancement terminology across spec, eval, and code | READY | Pick a consistent term and document mapping | specs/007-validator-agent/checklists/analyze.md |
| A19 | Add agentmemory port/health check to quickstart | BLOCKED | Add after T001 lands | specs/007-validator-agent/checklists/analyze.md |
| A20/N6 | Resolve draft spec status and unchecked reviewer checklists | NEEDS-DECISION | Reviewer asked for more details; approval/defer decisions remain open | specs/007-validator-agent/checklists/analyze.md |
| N1 | Rewrite plan constitution check against principles I–VIII | READY | Next plan edit | specs/007-validator-agent/checklists/analyze.md |
| N2 | Account for workspace isolation in the agentmemory store choice | BLOCKED | A1 dedicated server selected; workspace isolation and D22 shared topology still need clarification | specs/007-validator-agent/checklists/analyze.md |
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
| U4 | 006 per-task time cap: default 50 min, hard max 59, never above | DONE | Reviewer: "Okay. We dont want to be more than that also." | 2026-10-07 |
| U5 | agentmemory live demo | READY | Install approved with A1; demo not yet done | 2026-10-07 |
| U6 | pr-daily on app-logic PR #1557 (6 failing checks) | DONE (reviewer-owned) | Reviewer does it in that workspace; no worker fix here | 2026-10-07 |
| U7 | Worker step cap + compaction at ~100K context | NEEDS-DECISION | Cap value; compaction = handoff to a fresh fork | cost RCA 2026-10-06 |
| U8 | Cheaper default model for test/rca/code profiles | READY | Reviewer decision: try Sol 6.1; trial not completed | 2026-10-07 |
| U9 | Cap parallel worker fan-out | READY | Reviewer decision: cap 8; implementation not claimed | 2026-10-07 |
| U10 | Standard simulated workspace to benchmark agents/models/prompts | DONE | Spec 008 created | 2026-10-07 |

## New 2026-10-07

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| NEW-1 | For huge tasks, warm one worker with shared context, then fork N parallel workers | IN-PROGRESS | Fan-out, same model; cap 8 per U9 | Reviewer decision, 2026-10-07 |
| NEW-2 | Maximise worker reuse; 175/200 workers expired, 138 under 100K context | READY | Reviewer: use keep-warm pings and measure hit rate | Reviewer decision, 2026-10-07 |
| NEW-3 | Repo analyst worker over all worker ledgers/sessions | IN-PROGRESS | All repos, on request, review before apply; POC `tasksync-chat/tools/worker-analyst.cjs` | Reviewer decision, 2026-10-07 |
| NEW-4 | Efficiency score = work per $, comparable across models | NEEDS-DECISION | Open question in spec 008 | Reviewer ask, 2026-10-07 |

Counts: READY 13 | NEEDS-DECISION 7 | BLOCKED 13 | DONE 12 | IN-PROGRESS 2 (DONE includes won't-do and reviewer-owned rows).
