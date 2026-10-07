# Implementation Plan: Cloud Tasks

**Branch**: `006-cloud-tasks` (spec directory only) | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-cloud-tasks/spec.md`; binding rules from `specs/005-speckit-guided-flow/Rules.md` § "Cloud tasks (GitHub)".

**Status**: Approved by the reviewer 2026-10-06 (F11 consistency check passed: F1–F4 HIGH Fixed, no [NEEDS CLARIFICATION] in spec.md, plan references match tasks.md)

## Summary

**GO (reviewer, 2026-10-07)**: "Sure productise cloud thing. As it is triggered only when i ask for it. Not always." Cloud tasks start only on an explicit reviewer request, never automatically or scheduled by default. AskAway never merges: "do not merge PRs". [Live evidence](evidence/proof-2026-10-07.md) demonstrates same-branch delivery; its historical stop-for-reviewer verdict is superseded by this GO, not by stronger model/approval claims.

Queue a flagged task to the GitHub Copilot cloud agent by committing one packet to the spec's active PR branch and posting a short `@copilot` comment that points at it. Poll the PR with `gh`, derive task state with one pure state machine, show it on the Specs tab task row, in the Workers feed (shared trace row) and on Telegram (live + morning digest), and tick a task only after a local verify worker re-runs the packet's verification on the pulled branch. First slice is a live proof that turns the unverified route facts into a committed evidence note and a recorded signal fixture; everything after is built and tested against that fixture.

## Branch identities

| Identity | Value |
|---|---|
| Feature directory / slug | `specs/006-cloud-tasks` / `006-cloud-tasks` |
| Checked-out branch at planning | `main` (HEAD `f8e37ab`) |
| `tasks.md` branch provenance | generated on `main` at `1fc06d1` (see tasks.md) |
| Target work branch (building 006 itself) | the 006 story PR branch, one active PR per 005 rules (e.g. `006-us1-proof`) |
| Cloud worker branch (runtime) | the head branch of the spec's active PR, read with `gh pr view <pr> --json headRefName` at queue time — never inferred from the local checkout |
| Cloud worker base (runtime) | the PR head sha before the packet commit is pushed; written into the packet as `base`. The PR comment references the packet commit sha, not `base`. |

## Technical Context

**Language/Version**: TypeScript 5.x (extension), ES2020 webview JS, Node ≥18 `.cjs` tools/tests.

**Primary Dependencies**: `gh` CLI (existing auth, already used by `tools/pr-daily-facts.cjs`), `git`, 005 modules (`runRecords.ts`, scanner `task.tags`, active PR), existing Workers feed row component (`traceRowsHtml`), Telegram delivery (`src/commentary/telegramLive.ts`), OpenCode `verify` worker.

**Storage**: committed packets `.askaway/specs/<slug>/packets/<taskId>-<n>.md`; local cloud-run state `.askaway/specs/<slug>/cloud/<taskId>-<n>.json` (gitignored, see C-7); final 005 run record (committed) on Accepted/Returned.

**Testing**: pure state machine tested by replaying the recorded US1 signal fixture; packet/comment/secret tests; acceptance tested on two local git fixtures (pass/fail); all in `npm run test:workers`. One live run per story Checkpoint on a real PR.

**Target Platform**: VS Code desktop; GitHub.com repository with Copilot cloud agent enabled.

**Performance Goals**: one poll of one PR ≤ 5 `gh api` calls; default interval 3 min; state visible within one interval + 1 min (SC-006).

**Constraints**: 59-minute session cap; no new credentials; no secrets in packets/comments; never create branch/PR/issue; no approval gate passed offline.

**Scale/Scope**: ≤10 cloud tasks per night per PR; ≤3 open specs with cloud work.

## Constitution Check

Gate: `.specify/memory/constitution.md` v1.0.0 (ratified 2026-10-06). Checked per principle:

| Principle (constitution) | This plan |
|---|---|
| II. Consistent Experience: reuse the existing component | Cloud tasks render through the existing worker trace row (`traceRowsHtml`) after converting cloud-run state to its input format (C-20). PASS |
| I. Tests from the caller's view | State machine tested from recorded real signals; acceptance tested on git fixtures. PASS |
| V. No secrets in transit | Secret gate before any packet/comment write (C-16). PASS |
| III. Worker runtime boundary | Cloud agent UI stays on GitHub; AskAway shows status + links only. PASS |
| IV. Shared tools at the MCP boundary | No new worker tool; `src/cloud/` is extension code. PASS |
| VI. Per-workspace observability | Cloud-run state stored per spec under `.askaway/` (C-7). PASS |
| VII. RTK vs credits | Cloud runs show duration and model, no price. PASS |
| Workers never commit or push (AskAway Build) | The extension (main process, reviewer-initiated button) commits the packet; verify worker only reads and runs tests. PASS |
| New store/framework needs ADR | None (files + gh CLI). PASS |

## Decision Register

| ID | Question | Answer | Rationale | Source |
|---|---|---|---|---|
| C-1 | Which GitHub route delegates a task? | `@copilot` comment on the active PR via `gh pr comment <n> --body-file <tmp>`. Never issue assignment. | Same-branch push by default on PR comments; issue assignment always makes a new branch/PR. | spec FR-007; GitHub docs "Asking Copilot to make changes" |
| C-2 | Which credential? | The developer's `gh` auth; no token stored or passed. `gh auth status` checked before queuing. | Spec assumption "reuse developer auth". | spec Assumptions |
| C-3 | How is the model chosen? | Prefer Sol 6.1 (`github-copilot/gpt-6.1-sol`) for mid-tier work; Claude Sonnet 5.5 remains an explicit option where GitHub allows selection (reviewer 2026-10-07). Read-only "Model: PR default (not independently observed)" plus GitHub picker link; no enabled comment-text picker. PROOF-1 requested Claude Sonnet 5.5 and reported that name; PROOF-1b requested none and reported GPT-5.6 Terra. Store/display report names as self-reported, not verified runtime models. | Matching report text does not prove selection/enforcement; no session telemetry captured. | Rules.md model preference; evidence/proof-2026-10-07.md; FR-008 |
| C-4 | Which PR signals are polled? | Reactions on our comment (👀 acknowledgment, not completion), timeline `copilot_work_started` / `copilot_work_finished`, agent commits after `base`, head check runs/status, authenticated agent report/question comments. PR 1608 had two eyes reactions, two starts, two commits and two reports; first start was ~51 s after request, first push ~113 s after request. | Exact observed events, timestamps and authors drive fixture replay; poll snapshots are not atomic. | evidence/proof-2026-10-07.md; FR-010 |
| C-5 | How is a signal tied to a task when several are queued? | One active posted attempt per PR (including Queued before acknowledgment); additional explicitly requested tasks are Held locally. Commits must prefix `[<taskId>]`; an unquoted `Report <taskId>` line from the agent identifies the report even after a quoted request. Serialise even disjoint tasks: first finish 11:43:25Z preceded second start 11:44:10Z. Release when Needs review/terminal, never tick from report alone. | Concurrent sessions were not observed; author/task/branch correlation is required, not merely any signal after the comment. | evidence/proof-2026-10-07.md; FR-017 |
| C-6 | Poll interval and failure? | Setting `askaway.cloudTasks.pollMinutes` (default 3, min 1). Poll only while a task is non-terminal. On `gh` failure/rate limit: keep last state, set `staleSince`, exponential backoff to 15 min. | Spec edge case "Polling fails". | spec FR-010, Edge Cases |
| C-7 | What is committed vs local? | Committed: packet (the cloud agent must read it) and the final 005 run record written with the acceptance commit. Local, gitignored (`.askaway/specs/*/cloud/`): live cloud-run state updated by polling. Every extension-authored commit (packet, tick, run record) carries the trailer `AskAway-Commit: <packet|tick|record>` and is excluded from FR-018 conflict detection; only commits by someone else than the cloud-agent login and not carrying the trailer count as developer pushes. | Committing live state would push to the branch while the cloud agent works (conflicts, false FR-018 warnings); the extension's own commits must never raise a false warning. | spec FR-004, FR-018, FR-022 |
| C-8 | Who merges while a task is Working? | Human only; AskAway never merges or installs a required-status merge block. Specs card shows the working task and remaining cap, not "Merge blocked". | "do not merge PRs" supersedes the earlier block requirement. | Rules.md F7, reviewer 2026-10-07 |
| C-9 | How is eligibility written in `tasks.md`? | Tag after the task ID: `[cloud]` when eligible, `[local: <reason>]` when not (reasons: `local service`, `open question`, `> 45 min`, `not self-contained`). `/sk.tasks` prompt asset applies the four rules; the scanner exposes tags (005 D-21). | FR-002 needs flag + reason on the row. | spec FR-002, FR-003 |
| C-10 | What is the task's "task-details section"? | The task line plus its indented sub-bullets in `tasks.md`, plus the story's Independent Test from `spec.md`. 005 tasks keep sub-bullets for file paths/notes (standard template allows them). | 005 does not define a separate section; this is the smallest self-contained unit. | spec FR-005 |
| C-11 | Packet format? | Markdown, YAML front matter with the nine fields (`stage`, `story`, `task`, `taskDetails`, `base`, `allowedPaths`, `verify` (list), `stopCondition`, `reportFormat`) + body linking committed artifacts by path. Schema: [contracts/packet.md](contracts/packet.md). | FR-005, SC-004. | spec FR-005 |
| C-12 | Comment text? | ≤5 lines, no spec/plan content: `@copilot Please do <taskId> (<story>, stage <stage>) of <slug>: follow .askaway/specs/<slug>/packets/<file> at <sha>.` + `Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands; stop and ask on anything undecided; reply with the packet's report format.` | FR-006, SC-004; 005 Rules.md "Cloud tasks": the message states the stage, the task and what to do, and references committed artifacts instead of repeating them. | spec FR-006 |
| C-13 | How is stage output marked as draft? | Full mapping: `specify`, `clarify`, `plan`, `tasks` → `draft: true`; `implement` and every later stage (including `converge`/readiness) → `draft: false`. Keep the rule "do not change `**Status**:`"; acceptance returns the task if `**Status**:` changed in any spec/plan file. | FR-009. | spec FR-009 |
| C-14 | How does acceptance run? | On Needs review: local `verify` worker gets a packet with `base`, PR head sha, `verify` commands, `allowedPaths`. It runs `git fetch origin <branch>` into a temporary worktree (`git worktree add`), runs the commands, reports outputs. Main process then does scope check on commits by the cloud-agent login between `base` and head; ticks `tasks.md` (commit + push by the main process, carrying the `AskAway-Commit: tick` trailer) only on pass. Acceptance starts automatically when a task enters Needs review (no manual step, SC-009); the task is Accepted locally at once, and the tick push is deferred while any other task on the PR is Working, then pushed when none is. A task in Needs review never holds the queue: it is not Working, so Held one-at-a-time tasks are released when it enters Needs review. | FR-014, FR-015; workers never push. | spec US4 |
| C-15 | Cloud-agent identity? | Default API login `Copilot` (Bot), app `copilot-swe-agent`, git author `copilot-swe-agent[bot]`; git committer `GitHub` / `web-flow` is not the agent author. Reports are genuinely bot-authored, with quoted human requests above them. Start/finish actor `machs_pega` is the requester; app attribution identifies the cloud event. | Needed for report correlation, conflict detection and scope check; never accept a human echo as a report. | evidence/proof-2026-10-07.md; FR-018 |
| C-16 | Secret gate? | `knownSecretValues(env = process.env): string[]` collects values from environment variables named like `TOKEN|SECRET|KEY|PASSWORD` (length ≥ 8); `secretFindings(fields, known = []): Array<{field, kind}>` checks each field against known values and token patterns. The `github-token` pattern `/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/` covers the `gho_` OAuth token printed by `gh auth token`; no separate `gh auth token` lookup is needed. Error names the field. | FR-020, SC-005. | spec FR-020 |
| C-17 | Ceilings and timeouts? | US5 sets per-task `ceilingMinutes` (default 50, greater than the 45-minute eligibility bound; max 59) in the packet. US3 derives Timed out when elapsed Working time exceeds the ceiling or 59-minute session limit without a report, and derives No response when neither 👀 nor started-work arrives within the fixed 10-minute wait after the comment. | FR-010, FR-019, edge case. | spec FR-010, FR-019 |
| C-18 | Morning digest timing? | Setting `askaway.cloudTasks.digestTime` (default `08:00` local). Sent once per day if any cloud run changed since the last digest; per task: PR, evidence, duration, model, blocker, decision needed; no price. | FR-012, FR-013. | spec FR-012 |
| C-19 | Actions on cloud pushes? | Observed GitHub Actions `copilot` job 112774417359 on first agent SHA, `in_progress`, conclusion null; no approval hold captured. GitGuardian succeeded and Title Merge Check failed on both SHAs (non-Actions apps). Approval setting and ordinary build/test workflow execution are not observed. Surface `action_required` if seen; do not change repo settings or claim they are off. | A running Copilot job does not establish general workflow approval behaviour. | evidence/proof-2026-10-07.md; FR-023 |
| C-20 | Feed rendering? | Convert a cloud run into the Workers trace-row input (`label`, `state`, `startedAt`, `rows[]` of signals with timestamps and links) at the data boundary; render with existing `traceRowsHtml`. | AGENTS.md consistency. | spec FR-011 |
| C-21 | Pre-queue refusals and order? | Checked in this order before any commit/comment: `gh auth` ok → active PR open → push permission (`gh api repos/{o}/{r} --jq .permissions.push`) → task eligible → no active attempt (Timed out and No response are finished and may be queued as attempt n+1) → secret gate. The one-at-a-time rule (from US2) and the overlap rule (US5) do not refuse: they make the task Held. Refusal message names the failed check. | FR-021. | spec FR-021 |
| C-23 | Run ceiling? | Per cloud task wall-clock cap (FR-024): packet `ceilingMinutes` default 50, max 59; the T004 proof budget is 61 minutes (59-minute session plus margin). | Reviewer 2026-10-06: "61 minutes is okay. I think it is reasonable to have cap on time." | spec FR-024, Rules.md |
| C-22 | Is cloud-agent enablement checkable before queuing? | No documented API; not checked up front. If disabled, the task becomes No response (C-17) with hint "Copilot cloud agent may be disabled for this repository". US1 records the observed behaviour. | No guessing an API. | spec Edge Cases |

GO permits US2 planning despite evidence limits. No required-status setup; workflow approval settings remain reviewer-owned, not changed by AskAway.

## Architecture

```mermaid
flowchart LR
  B[Specs tab: Queue in cloud] --> Q[cloudQueue.ts: refusal checks + secret gate]
  Q --> P[packet.ts: write + commit + push packet]
  P --> C[gh pr comment]
  T[timer: pollMinutes] --> PL[cloudPoller.ts: gh api signals]
  PL --> SM[cloudState.ts: pure deriveCloudState(run, signals)]
  SM --> ST[.askaway/specs/slug/cloud/*.json]
  ST --> V1[Specs tab task row]
  ST --> V2[Workers feed via traceRowsHtml]
  ST --> V3[Telegram live + digest]
  SM -->|Needs review| A[cloudAccept.ts: verify worker + scope check]
  A -->|pass| TK[tick tasks.md + 005 run record, commit + push]
  A -->|fail| RT[Returned + evidence]
```

State machine (`deriveCloudState`): `Queued` → (👀 or started-work) `Working` → (agent commit) `Pushed` → (checks complete) `Checks passed`/`Checks failed` (or `Checks waiting for approval`) → (agent report/question comment) `Needs review` → acceptance `Accepted`/`Returned`. Side exits: `No response` (10 min), `Timed out` (ceiling), `Returned` (wrong branch/new PR, PR closed, out-of-scope paths, Status changed). Local `Held` before posting when overlap/one-at-a-time applies.

## Interfaces and contracts

- [contracts/packet.md](contracts/packet.md) — packet format + comment template.
- [contracts/cloud-run.schema.json](contracts/cloud-run.schema.json) — local cloud-run state.
- [contracts/evidence-note.md](contracts/evidence-note.md) — US1 evidence note + fixture format.
- `src/cloud/cloudState.ts` — `deriveCloudState(run, signals, now, settings)` pure.
- `src/cloud/cloudPoller.ts` — `pollPr(repo, pr, since): Signals` (gh wrapper, injectable runner for tests).
- `src/cloud/cloudQueue.ts` — `queueTask(slug, taskId, opts)`; `refusalFor(context)` pure.
- `src/cloud/gh.ts` — injectable `gh` runner, JSON parsing, and typed failures.
- `src/cloud/packet.ts` — `buildPacket(task, story, facts)`, `buildComment(packetRef)`, `knownSecretValues(env = process.env): string[]`, `secretFindings(fields, known = []): Array<{field, kind}>`.
- `src/cloud/cloudAccept.ts` — `acceptCloudTask(run)`; `outOfScope(paths, allowed)` pure.
- `src/cloud/cloudDigest.ts` — `digestLines(runs, since)` pure; Telegram sender reuses existing delivery.
- `tools/cloud-proof.cjs` — US1 live proof CLI.

## Ownership boundaries

| Area | Files | Story |
|---|---|---|
| Live proof | `tools/cloud-proof.cjs`, `specs/006-cloud-tasks/evidence/*`, `tasksync-chat/test-fixtures/cloud-signals-*.json` | US1 |
| Eligibility + packet + queue | `src/cloud/packet.ts`, `src/cloud/cloudQueue.ts`, `specKitPromptAssets.ts` (`/sk.tasks` eligibility rules), Specs tab row button | US2 |
| Polling + state + surfaces | `src/cloud/cloudPoller.ts`, `src/cloud/cloudState.ts`, `src/cloud/cloudDigest.ts`, feed adapter, Telegram | US3 |
| Acceptance | `src/cloud/cloudAccept.ts`, verify worker packet | US4 |
| Safety | overlap/conflict/ceiling in `cloudState.ts` + `cloudQueue.ts`; serial PR queue, no merge | US5 |

## Compatibility, migration, rollback

- No migration; new files only plus additive scanner tags from 005.
- Feature behind setting `askaway.cloudTasks.enabled`; GO permits productisation after US2 passes, not automatic dispatch. Startup, scheduling, eligibility or polling never starts unrequested work. Held tasks may dispatch only because the reviewer explicitly queued each. Rollback = turn setting off; packets already on a branch are inert markdown.

## Failure behavior

- `gh` unavailable/unauthenticated → queue refused ("gh not authenticated"); poller shows stale.
- Wrong branch / new PR by agent → Returned "wrong branch", link to the new PR, nothing merged.
- PR closed outside extension → Working tasks Returned "PR closed".
- Push of packet fails (non-fast-forward) → fetch + rebase packet commit once; on second failure refuse with reason; no comment posted.

## Security

- Secret gate C-16 on packet and comment; packets reference artifacts by path only.
- No token in env passed to workers; verify worker runs with the developer's local environment, same as other workers.
- Allowing workflows without approval (C-19) is the reviewer's explicit repository decision; the plan does not change repository settings.

## Observability

- Every state transition appended to the cloud-run `history[]` with timestamp and signal link; shown in the feed trace rows.
- Final 005 run record per cloud task (kind `worker`, command `cloud:<taskId>`, `agentMs` = duration, cost = 0 with `model`) is internal bookkeeping only; cloud runs omit price from the spec card, Telegram status, and digest.

## Environment and commands

- `gh auth status` → logged in; `gh pr view <n> --json headRefName,state`.
- Build/test: `cd tasksync-chat && npx tsc -p ./ --noEmit && node esbuild.js && node --check media/webview.js && npm run test:workers` → 0 failed.
- Live proof: `node tasksync-chat/tools/cloud-proof.cjs --pr <n> --task PROOF-1` → writes `specs/006-cloud-tasks/evidence/proof-<date>.md` and `tasksync-chat/test-fixtures/cloud-signals-<date>.json`.
- Secrets: none new; `gh` auth only.

## Implementation order (stories are the phases)

| Phase | Deliverable | Depends on |
|---|---|---|
| Setup | `src/cloud/` folder, settings (`enabled`, `pollMinutes`, `digestTime`, `agentLogins`), add `.askaway/specs/*/cloud/` to `.gitignore` | — |
| Foundational | Needs 005 Foundational (`runRecords.ts`, scanner `task.tags`) and 005 active-PR fact (US4/D-12). `gh` runner wrapper with injectable exec for tests. | 005 Foundational |
| US1 | `cloud-proof.cjs`; evidence note with no "unknown" entries; recorded signal fixture; go/no-go | Setup (can run before 005 is done: takes PR number as argument) |
| US2 | eligibility, explicit-request queue/serial hold, packet/comment, Specs card status and report ingestion (no tick), model provenance | US1 GO, Foundational |
| US3 | poller + state machine (fixture replay test) + row/feed/Telegram + digest | US2 |
| US4 | acceptance via verify worker + scope check + tick | US3 |
| US5 | overlap diagnostics, conflict detection, ceilings; retain serial PR queue and human-only merging | US4 |
| Polish | Storybook stories (task row states, digest), README section, deploy | all |

Each story's Checkpoint = its Independent Test automated (fixture-based) + one live run on a real PR recorded in `specs/006-cloud-tasks/evidence/`.

## Cloud Worker Packet (for tasks of 006 itself that are cloud-eligible)

- **Repository**: this workspace's `origin`.
- **Branch**: the 006 story PR head branch (`gh pr view <n> --json headRefName`); **base**: sha in the packet.
- **Allowed paths**: per task, within `tasksync-chat/src/cloud/**`, `tasksync-chat/test-cloud-*.cjs`, `tasksync-chat/test-fixtures/cloud-*`.
- **Required inputs**: `specs/006-cloud-tasks/{spec,plan,data-model}.md`, `contracts/`, the US1 evidence note.
- **Verification**: `cd tasksync-chat && npx tsc -p ./ --noEmit && npm run test:workers` → 0 failed and the task's named test prints its pass line.
- **Completion**: verification passes; changed files ⊆ allowed paths; report per packet `reportFormat`. Not eligible: US1 (needs live GitHub + reviewer PR), anything touching `media/webview.js` shared blocks (one-writer area).

## Project Structure

```text
specs/006-cloud-tasks/
├── spec.md plan.md research.md data-model.md quickstart.md
├── contracts/ (packet.md, cloud-run.schema.json, evidence-note.md)
├── evidence/  (US1 output)
├── tasks.md   (T001–T005 US1 done; T006–T010 US2; US3–US6 under ## Later)
├── Goal.md Rules.md reviewer-brief.md

tasksync-chat/
├── src/cloud/  gh.ts cloudState.ts cloudPoller.ts cloudQueue.ts packet.ts cloudAccept.ts cloudDigest.ts
├── tools/cloud-proof.cjs
├── test-fixtures/cloud-signals-*.json
└── test-cloud-*.cjs
```

**Structure Decision**: new `src/cloud/` module inside the existing extension; no new package.

## Complexity Tracking

None.

## Later

US2 moved to tasks.md after the reviewer's GO. Later increments remain outside the current task budget.

- US3: extend US2 poller/state/store and Specs status to Workers feed via `traceRowsHtml` (C-20), Telegram live + `digestLines` (C-18), elapsed-time exits/backoff; `test-cloud-state.cjs` replays US1 fixture and asserts no cloud price in card/Telegram/digest.
- US4: `acceptCloudTask` (worktree, verify worker, `outOfScope`, Status-line check); tick + run record + push on pass; `test-cloud-accept.cjs` on pass/fail/out-of-scope fixtures.
- US5: overlap diagnostics (does not replace one-at-a-time per PR), conflict detection (ignores `AskAway-Commit` commits), duration-ceiling policy/configuration (default 50 min, max 59); working/cap warning only, never merge or required-status block; `test-cloud-safety.cjs`.
- US6 (ultimate goal, reviewer 2026-10-06): explicitly delegate a whole user story to GitHub on the active PR branch once the spec is in implement; human merges, AskAway never merges. Built on the per-task route after US5; its own plan/tasks are later.
- Polish: Storybook task-row states and digest; README "Cloud tasks" incl. reviewer setup; quickstart + deploy.
