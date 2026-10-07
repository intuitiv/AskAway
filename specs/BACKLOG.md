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
| T004 | Run live cloud proof and record route evidence | DONE | Throwaway PR #1608; same-branch commits, sequential sessions; model self-reports only; Actions copilot ran/no observed hold, setting not captured | specs/006-cloud-tasks/evidence/proof-2026-10-07.md |
| T005 | Update route decisions and record GO | DONE | C-3/4/5/15/19, spec and packet contract aligned to evidence; reviewer explicit-request-only GO | specs/006-cloud-tasks/tasks.md |
| F7 | Merge block | DONE | "do not merge PRs" → AskAway never merges or adds required-status block; C-8 aligned | specs/006-cloud-tasks/Rules.md |
| F18 | Tag 006 tasks `[cloud]` or `[local: reason]` | BLOCKED | Do when the `/sk.tasks` asset ships | specs/006-cloud-tasks/checklists/analyze.md |
| F21 | 006 GO after demo | DONE | Reviewer 2026-10-07: "Sure productise cloud thing. As it is triggered only when i ask for it. Not always." Only explicit requests, never automatic/scheduled by default; no merges | specs/006-cloud-tasks/Rules.md |
| T006–T010 | US2 eligibility, explicit serial queue, Specs card status and task report | READY | Concrete outside-in-tested tasks planned; one active attempt per PR, no tick until US4 | specs/006-cloud-tasks/tasks.md |

## 007 — Validator Agent

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| T001 | Measure agentmemory lifecycle options and report the spike | IN-PROGRESS | Partly done 2026-10-07 (install, engine, isolated instance 5 demo, egress finding); remaining: local embeddings, flags off, supersede/versions | specs/007-validator-agent/Rules.md |
| T004a | Implement the observer and test caller-visible answers, skips, cost, and failure behavior | READY | None | specs/007-validator-agent/tasks.md |
| T004b | Render validator Commentary entry and Storybook story | BLOCKED | Depends on T004a | specs/007-validator-agent/tasks.md |
| T005 | Implement knowledge-store port and agentmemory adapter | BLOCKED | Depends on T001; topology resolved: one server (M1) | specs/007-validator-agent/tasks.md |
| T006 | Close the loop on reviewer replies and store validated knowledge | BLOCKED | Depends on T004a/b and T005; A4 resolved: alongside, never blocks reply | specs/007-validator-agent/tasks.md |
| T007 | Propose dismissible context from stored knowledge | BLOCKED | Depends on T005 and T006 | specs/007-validator-agent/tasks.md |
| T008 | Deduplicate, supersede, and keep stored knowledge concise | BLOCKED | Depends on T001 and T005 | specs/007-validator-agent/tasks.md |
| T009a | Add answer, enhance, store, cheap-check, and secret-leak eval suites | BLOCKED | Depends on observer stories T004a–T007 | specs/007-validator-agent/tasks.md |
| T009b | Add manual eval review and a reviewer-correction path | BLOCKED | Depends on T009a; "I'll manually see them few days"; no automated beta baseline | specs/007-validator-agent/tasks.md |
| T010 | Run quickstart, manual beta review, update requirements, and run gates | BLOCKED | Depends on all stories including US6 | specs/007-validator-agent/tasks.md |
| A1 | Choose validator knowledge-store lifecycle approach | DONE | Earlier "a separate agentmemory server only for the validator, with auto-forget off" superseded by M1: ONE server, globals off | specs/007-validator-agent/Rules.md |
| A4 | Decide validator-first reply ordering | DONE | Reviewer: "Validator for few turns it is more like trial basis. I manually see the quality of validator how it is responding on behalf of me." Alongside, never blocks reply | specs/007-validator-agent/spec.md |
| A5 | Clarify changed-rule flags and retained history semantics | DONE | Reviewer: "keep older versions also, hide them"; retained, hidden from recall/default views | specs/007-validator-agent/spec.md |
| A10 | Add success criteria for beta isolation and secret handling | NEEDS-DECISION | "Sure": SC-010/SC-011 drafted by agent, reviewer to approve (0 agent-channel outputs; 0 seeded secrets in any sink) | specs/007-validator-agent/spec.md |
| A11 | Choose when to establish SC-002/SC-004 baselines | DONE | Reviewer: "I'll manually see them few days"; no automated baseline in beta | specs/007-validator-agent/spec.md |
| A12 | Resolve external agentmemory dependency and migration | DONE | D22: "we dont use or update them going forward"; user/repo md seed once then freeze. M1 resolves ONE server; no beta rebuild-from-index requirement | specs/007-validator-agent/spec.md |
| A15 | Define what counts as observed versus skipped | NEEDS-DECISION | "Sure": definition drafted by agent, reviewer to approve; cheap-check observed, pure progress skipped and counted | specs/007-validator-agent/spec.md |
| A17 | Align prompt-enhancement terminology across spec, eval, and code | READY | Pick a consistent term and document mapping | specs/007-validator-agent/checklists/analyze.md |
| A19 | Add agentmemory port/health check to quickstart | BLOCKED | Add after T001 lands | specs/007-validator-agent/checklists/analyze.md |
| A20/N6 | Resolve draft spec status and unchecked reviewer checklists | DONE | Reviewer D19 2026-10-07: "accept"; gaps listed as beta limits in spec.md | specs/007-validator-agent/checklists/analyze.md |
| N1 | Rewrite plan constitution check against principles I–VIII | READY | Next plan edit | specs/007-validator-agent/checklists/analyze.md |
| N2 | Account for workspace isolation in the agentmemory store choice | BLOCKED | One shared server (M1); isolation by project/agentId tag, accepted as beta limit (D19) | specs/007-validator-agent/checklists/analyze.md |
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
| U5 | agentmemory live demo | DONE | Demo ran on isolated instance 5; FINDING: it used the shell's OPENAI_API_KEY and tried to send observations to OpenAI (failed 429) → see M2 | 2026-10-07 |
| U6 | pr-daily on app-logic PR #1557 (6 failing checks) | DONE (reviewer-owned) | Reviewer does it in that workspace; no worker fix here | 2026-10-07 |
| U7 | Worker context handoff at ~100K | IN-PROGRESS | Reviewer: "yes", but "i dont want to add that intelligence behind the scenes. Not to begin with... i want some kind of observability" → step 1: worker card flags ≥100K context; no automatic handoff | 2026-10-07 |
| U8 | Sol 6.1 default mid tier for all profiles | DONE | Reviewer 2026-10-07: "Wire Sol6.1 instead of Sonnet" → Sol 6.1 is now the default mid tier for all profiles, not just code/test | 2026-10-07 |
| U9 | Cap parallel workers at 8 | DONE | `PARALLEL_CAP`, EV-WORKER-FANOUT, 20548e7 | 2026-10-07 |
| U10 | Standard simulated workspace to benchmark agents/models/prompts | DONE | Spec 008 created | 2026-10-07 |

## New 2026-10-07

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| NEW-1 | Warm one worker, then `fanout` N forks on the same model | DONE | EV-WORKER-FANOUT, 20548e7 | Reviewer decision, 2026-10-07 |
| NEW-2 | Maximise worker reuse | IN-PROGRESS | Ping hit rate 13% (5/38, $1.53). RCA: TTL expiry, thinking in reuse key, router blind to other hosts. R1/R2 decided; implementation in progress | RCA run-7cxp1q-16 |
| NEW-3 | Repo analyst over all worker ledgers | DONE | On request: `node tasksync-chat/tools/worker-analyst.cjs`; EV-WORKER-ANALYST | Reviewer decision, 2026-10-07 |
| T011 | US6 memory server lifecycle started by AskAway, local-only | BLOCKED | Depends on T001; FR-024, FR-025 | specs/007-validator-agent/tasks.md |
| T012 | US6 seed from md files + MCP access for Copilot and OpenCode | BLOCKED | Depends on T005, T008, T011 | specs/007-validator-agent/tasks.md |
| T013 | US6 switch prompts from /memories to the store | BLOCKED | Depends on T012 | specs/007-validator-agent/tasks.md |
| DATA-2WS | Analyst must cover the two workspaces the reviewer uses (AppLogic and TaskSync), including main-agent Copilot logs | DONE | `tools/copilot-usage-extract.cjs` + analyst Main agent/Harness sections (EV-COPILOT-USAGE-EXTRACT, fbdd080) | Reviewer ask, 2026-10-07 |
| NEW-4 | Harness efficiency number | NEEDS-DECISION | Reviewer: "Show me a sample to approve" | Reviewer ask, 2026-10-07 |
| BUG-1 | Banner request count excludes worker requests | IN-PROGRESS | Reviewer: "I still dont see total number of requests including worker requests" | 2026-10-07 |
| BUG-2 | app-logic runs 99fd4i-7/8 hung with no events; orchestrator (Opus, 200K) waited ~23 min | DONE | Cause: session reused from another dir (proven by hand); fix CWD_MISMATCH + STALLED after 60 s (9126ad5) | 2026-10-07 |
| R1 | Reuse an idle worker even if the new packet asks a different thinking level | DECIDED | Reviewer 2026-10-07: "if we use the same worker, we reuse all those config things. Do not lose cache" | RCA run-7cxp1q-16 |
| R2 | Reuse an expired worker (<100K) instead of pinging | DECIDED (IN-PROGRESS) | Reviewer 2026-10-07: "only for 3-4 times ... do not use workers which are more than few hours old" (pings limited to 3-4 times; no workers older than a few hours); implementation in progress | RCA run-7cxp1q-16 |
| M1 | One agentmemory server for agents + validator, or two | DECIDED | Reviewer 2026-10-07: "agentmemory is replacement for all memory needs. Validator also uses it." One server; D15 superseded; "Use agentmemory or anything better which has good reviews" | 2026-10-07 |
| M2 | Keep memory local-only (no cloud calls/OpenAI key, local embeddings, auto-forget/consolidation off) | DECIDED | Reviewer 2026-10-07: "Yes"; FR-024; trial auto-used shell's `OPENAI_API_KEY` | 2026-10-07 |
| M3 | Memory migration as its own spec (009) | DECIDED | Reviewer 2026-10-07: "Do it in 007. We have to many specs. It belongs there." No spec 009; US6 in spec 007 | 2026-10-07 |
| M4 | How agentmemory stays running (login item vs started by AskAway) | DECIDED | Reviewer 2026-10-07: "Askaway starts it like we start opencode server." FR-025 in spec 007 | 2026-10-07 |
| T004-C | Cloud proof uses throwaway PR and tests approval behaviour | DONE | "use throwaway PR. And cloud agent is enabled, but not sure if it require approval or not, but try and test it"; #1608 demo done, copilot Actions ran/no hold observed; setting not captured | specs/006-cloud-tasks/evidence/proof-2026-10-07.md |
| AG-1 | Route some workers to Antigravity (org Pro licence) behind a settings toggle | DROPPED (proposed) | Probe 2026-10-07 with agy 1.3.1: headless login works (org account via businessaicode.googleapis.com, prj-prd-agentspace), JSON/stream-json, usage tokens, `--conversation` resume all work; models Gemini only. But every file write and shell command is auto-denied in headless mode, even with `--dangerously-skip-permissions` and with `permissions.allow` rules (`write_file(dir/)`, `command(regex:.*)`) → read-only only, so no use as a build/test worker. Reviewer: "If it doesnt work, we'll drop this idea." | Reviewer ask, 2026-10-07 |

Counts: see the reviewer's latest decision list; NEEDS-DECISION rows above are the open questions.
