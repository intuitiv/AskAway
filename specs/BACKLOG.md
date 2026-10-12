# Consolidated Backlog

Items gathered from unchecked task lines, unresolved analysis findings, open reviewer-brief questions, and qualifying reviewer messages. `READY` means actionable now; `NEEDS-DECISION` requires reviewer input; `BLOCKED` depends on another item or an external prerequisite.

## Local tooling bugs — 2026-10-08

| ID | What | State | Evidence / next check | Source |
|---|---|---|---|---|
| KOTLIN-1 | Diagnose and resolve JetBrains Kotlin server startup timeout for TaskSync | WAITING (live restart) | Daemon log 13:22:47-13:24:57: starts in under 1s, publishes port in macOS temp, idle-exits after 10s. Extension hosts use TMPDIR=/Users/machs/.uv-temp; client reads there instead. Workspace intellij.additionalJvmArgs now aligns java.io.tmpdir; actual bundled-JVM baseline/override check PASS. Next: IntelliJ: Restart Language Server and confirm connection | Reviewer error report, 2026-10-08 |

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
| AG-1 | Route some workers to Antigravity (org Pro licence) behind a settings toggle | DROPPED | Reviewer 2026-10-07: "Lets drop, i'll explore more and get back to you in future." Probe 2026-10-07 with agy 1.3.1: headless login works (org account via businessaicode.googleapis.com, prj-prd-agentspace), JSON/stream-json, usage tokens, `--conversation` resume all work; models Gemini only. But every file write and shell command is auto-denied in headless mode, even with `--dangerously-skip-permissions` and with `permissions.allow` rules (`write_file(dir/)`, `command(regex:.*)`) → read-only only, so no use as a build/test worker. Reviewer: "If it doesnt work, we'll drop this idea." | Reviewer ask, 2026-10-07 |

## Handoff capture gaps — 2026-10-07

| ID | Ask and home | Status / next check |
|---|---|---|
| H-1 | G4: Clarify new substantial work once, gather all questions after a POC in one message, execute when clear across workspaces; update Build/Orchestrator policy. Reviewer messages 2026-10-07 10:34; GOALS.md 2026-10-08 | OPEN: verify both shipped agent policies capture this exact workflow; no completion commit established; add a 005 bulk-question story |
| H-2 | Investigate extended VS Code prompt/message-cache availability and pricing, including Vikrant's HTTP keep-alive hypothesis. Reviewer messages 2026-10-01 16:54/17:53 | OPEN: distinguish real message pings (T018 done) from HTTP health calls; extended-cache pricing evidence still unestablished |
| H-3 | Conversation "Worker tool enhancements and tasks" cannot open despite repair reporting 0 broken. Reviewer messages 2026-10-02 18:23 | OPEN: reproduce and diagnose; `/memories/repo/vscode-chat-repair.md` has prior repair guidance, not proof this incident is fixed |
| H-4 | Phone-readable replies: "table is not readable". Reviewer messages 2026-10-07 10:41 | OPEN: enforce short bullets / at most three table columns in future response policy; handoff follows it |
| H-5 | G3: "Capture everything i said, all tasks all rules and everything": permanent ask/status index and session continuation; every ask closes with evidence or a waiting reason. Current handoff packet; GOALS.md 2026-10-08 | OPEN until handoff verification; home `specs/HANDOFF-2026-10-07.md`; retain raw reviewer messages; add a 005 exhaustive intake/closure story |
| H-6 | Future side-channel questions/inputs carry caller IDs and answers correlate to them; reviewer 2026-10-01 17:26 | OPEN: deferred to Spec 003 boundary described in `specs/001-async-subagent-runner/Goal.md`; not implemented by session-fork POC |
| H-7 | Complete cloud ultimate goal beyond US2: polling/reports, local acceptance, conflict/readiness, whole-story GitHub Actions | OPEN: US3–US6 remain Later in `specs/006-cloud-tasks/plan.md`; explicit reviewer-requested US2 release run still required |
| H-8 | Build fixed simulated spec-bearing workspace and harness/model/prompt benchmark, not merely create its draft | BLOCKED: `specs/008-harness-benchmark/spec.md` formula and complex-fixture clarification before plan/tasks; U10 marks draft creation only |

Counts: see the reviewer's latest decision list; NEEDS-DECISION rows above are the open questions. For current completion evidence and stale-row exceptions, read `specs/HANDOFF-2026-10-07.md`.

## Goal coverage gaps — 2026-10-08

GAP means a missing spec contract, not necessarily missing implementation. Existing H-1 (G4) and H-5 (G3) above are reused rather than duplicated.

| ID | What | State | Blocker or question | Source file |
|---|---|---|---|---|
| GC-G2 | G2: Capture additional reviewer tasks and recommendations into Spec Kit tasks | MOVED to 005 'never miss an ask' story (reviewer 2026-10-08: "yes to cpaturing tasks") | Extend 005 US3 with incremental intake and caller-visible task update acceptance | GOALS.md 2026-10-08 |
| GC-G7 | G7: Reply to VS Code from Telegram | DONE (reviewer 2026-10-08: "Replying to vscode from telegram already works") | New Telegram remote-control spec; retain test-telegram-conversation-reply.cjs and test-telegram-handoff.cjs as existing implementation evidence | GOALS.md 2026-10-08 |
| GC-G8 | G8: Proven validator monitors commentary and immediately advises the agent or answers its doubts | BLOCKED | Later 007 live-linking story after beta quality review; current FR-018 forbids unsolicited agent linking | GOALS.md 2026-10-08 |
| GC-G10 | G10: Live validator represents unavailable reviewer, retains memory tool and reports commentary problems | BLOCKED | Later 007 live-phase story after beta quality review; define authority and advisory boundaries | GOALS.md 2026-10-08 |
| GC-G11 | G11: Availability decides when validator takes charge | BLOCKED | Later 007 live release; define timed/indefinite-away authority, return and expiry transitions separately from current away policy | GOALS.md 2026-10-08 |
| GC-G14 | G14: Own tools such as gradle, read_doc and turn budget reduce cost and improve reliability, reuse and control | DONE (reviewer 2026-10-08: "I think we already have all tools.") | Extend 001 tooling scope with caller-visible contracts and evals; existing tool tests do not substitute for a complete spec story | GOALS.md 2026-10-08 |

## New 2026-10-12 (GOALS.md section 4, "2026-10-12, monthly credits, availability, …")

| ID | Ask | State |
|---|---|---|
| N12-1 | Monthly workspace cost in $: "$Total ($W workers)", red, total includes workers, month resets 1st 05:30 IST (00:00 UTC) | DONE a8d6817 (EV-MONTH-CREDITS-WORKSPACE) |
| N12-2 | Every cent counted: evals, tests, validator in the workspace month; explain $636 total vs ~$550 sum of months | DONE a8d6817: month excluded subagent logs + worktree worker ledgers; now sum(months)==all-time |
| N12-3 | GitHub Actions (cloud task) cost attributed to the workspace | NEEDS-DECISION (Q7) |
| N12-4 | Teams-style availability button + gradient frame; current dot + command list "not awesome" | NEEDS-DECISION (Q1), POC in Storybook |
| N12-5 | Validator runs on every message (~0.60/request): one validator session per turn, no keep-alive (GPT-5.6+ cache TTL 30 min verified; Copilot TTL unpublished) | DONE cedda0d (EV-VALIDATOR-SESSION-PER-TURN) |
| N12-6 | Webex "act like me" worker: separate tools for send to person/space, read space/1:1, reply in thread, attachments, check reply later, find space, style from own messages; questions ≤20–30 words, simple English with an example | NEEDS-DECISION (Q4–Q6, Q8) |
| N12-7 | AITalk room rules (always-in members, agent join/leave notices, crisp + Show more mandatory, one Validator reply per question, mention/reply routing, workers may join, emoji use, 👍 relays) | spec 003 build; prototype update pending |
| N12-8 | AITalk tick states for agent and validator recipients | NEEDS-DECISION (Q2) |
| N12-9 | AITalk: user cannot reply to a message (bug) | DONE in prototype f317d78 (Reply + quote bar) |
| N12-10 | AITalk generic: registry + rank user > validator > agent > worker, no hard-coded participants | DONE in prototype f317d78 (config-only new agent story); production build waits for approval |
| N12-11 | VS Code notification when the user needs attention (heads-up, question, AITalk @mention) — when Here and window/panel not in focus | DONE (EV-ATTENTION-NOTIFY; AITalk @mention hook `notifyAttention` ready) |
| N12-12 | Trace tab shows main agent, every worker and Validator traces with the shared trace rows | DONE 083e6eb (EV-TRACE-TAB-UNIFICATION) |
| N12-13 | GitHub cost dry run on PR 1608 runs | DONE read-only: run timing readable (duration, billable ms); user billing + premium requests need `user` scope (reviewer runs `gh auth refresh -h github.com -s user`); org billing needs admin:org |
| N12-14 | Stray `specs/<n>-<slug>/tasks.md` folders created by ask capture for unknown slugs | DONE (missing spec.md → BACKLOG.md; workers can no longer capture asks over MCP, EV worker-ask-capture-refused). Existing stray folders untracked, not deleted |
| N12-17 | Workers' auto-captured packets (incl. another repo's Gradle tasks) landed in specs/005 tasks.md and broke the task budget | DONE: rows saved to .askaway/005-tasks-with-worker-captures-2026-10-12.md, file restored, capture removed from worker MCP |
| N12-18 | askaway_webex removed from main agent LM tools; Webex worker uses the MCP suite | DONE 5c3b3b2 + manifest regenerated |
| N12-15 | AITalk production build (spec 003) A1 mount+tabs, A2 store+registry, A3 composer/reply/next-tool delivery, A4 Validator triggers (user mention/reply, agent/worker questions, end-of-turn batch of whole conversation), A5 join/leave + ticks, A6 Webex draft 👍 approval | A1/A2 DONE 8c65c61 (EV-AITALK-EXTENSION; Commentary tab kept until A5); A3–A6 NEXT |
| N12-16 | Validator: no model call for generic agent messages/commentary; one long-lived session per turn | DONE cedda0d (stores; calls only on questions + end batch) |
