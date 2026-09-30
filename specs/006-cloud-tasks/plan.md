# Implementation Plan: Cloud Tasks

**Branch**: `006-cloud-tasks` (spec directory only) | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-cloud-tasks/spec.md`; binding rules from `specs/005-speckit-guided-flow/Rules.md` § "Cloud tasks (GitHub)".

**Status**: Draft (awaiting reviewer approval at the "how" gate)

## Summary

Queue a flagged task to the GitHub Copilot cloud agent by committing one packet to the spec's active PR branch and posting a short `@copilot` comment that points at it. Poll the PR with `gh`, derive task state with one pure state machine, show it on the Specs tab task row, in the Workers feed (shared trace row) and on Telegram (live + morning digest), and tick a task only after a local verify worker re-runs the packet's verification on the pulled branch. First slice is a live proof that turns the unverified route facts into a committed evidence note and a recorded signal fixture; everything after is built and tested against that fixture.

## Branch identities

| Identity | Value |
|---|---|
| Feature directory / slug | `specs/006-cloud-tasks` / `006-cloud-tasks` |
| Checked-out branch at planning | `main` (HEAD `f8e37ab`) |
| `tasks.md` branch provenance | not yet generated |
| Target work branch (building 006 itself) | the 006 story PR branch, one active PR per 005 rules (e.g. `006-us1-proof`) |
| Cloud worker branch (runtime) | the head branch of the spec's active PR, read with `gh pr view <pr> --json headRefName` at queue time — never inferred from the local checkout |
| Cloud worker base (runtime) | the PR head sha right after the packet commit is pushed; written into the packet as `base` |

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

Constitution file is the unfilled template; the gate uses the binding repo rules (same table as 005 plan). Specific to 006:

| Rule (source) | This plan |
|---|---|
| Consistent Experience: reuse the existing component (AGENTS.md) | Cloud tasks render through the existing worker trace row (`traceRowsHtml`) after converting cloud-run state to its input format (C-20). PASS |
| Every feature ships an outside-in test (AGENTS.md) | State machine tested from recorded real signals; acceptance tested on git fixtures. PASS |
| Never send secrets through worker messages/MCP/transcripts (AGENTS.md Hooks) | Secret gate before any packet/comment write (C-16). PASS |
| OpenCode owns worker conversation UI (AGENTS.md boundary) | Cloud agent UI stays on GitHub; AskAway shows status + links only. PASS |
| Workers never commit or push (AskAway Build) | The extension (main process, reviewer-initiated button) commits the packet; verify worker only reads and runs tests. PASS |
| New store/framework needs ADR | None (files + gh CLI). PASS |

## Decision Register

| ID | Question | Answer | Rationale | Source |
|---|---|---|---|---|
| C-1 | Which GitHub route delegates a task? | `@copilot` comment on the active PR via `gh pr comment <n> --body-file <tmp>`. Never issue assignment. | Same-branch push by default on PR comments; issue assignment always makes a new branch/PR. | spec FR-007; GitHub docs "Asking Copilot to make changes" |
| C-2 | Which credential? | The developer's `gh` auth; no token stored or passed. `gh auth status` checked before queuing. | Spec assumption "reuse developer auth". | spec Assumptions |
| C-3 | How is the model chosen? | Docs: model picker only in the web UI for PR comments; otherwise the PR's original model, and Auto where no picker exists. Until US1 proves a comment-text or API way to pick, the dialog shows "Model: PR default" (read-only) plus an "Open on GitHub to pick" link. If US1 proves a way, the picker is enabled for that way only. | FR-008 "where GitHub allows"; no guessing. | spec FR-008, US1; GitHub docs "Changing the AI model" |
| C-4 | Which PR signals are polled? | (a) reactions on our comment (👀 = accepted); (b) issue timeline events after our comment (the "Copilot started work" event; exact event name taken from the US1 fixture); (c) PR commits after `base`; (d) check runs + combined status on head sha; (e) issue comments by the cloud agent after our comment. | Docs name 👀 and the "started work" timeline event; commits/checks are standard. | spec FR-010; GitHub docs "Tracking and continuing a session" |
| C-5 | How is a signal tied to a task when several are queued? | MVP: only one Working task per PR (FR-017), so all signals after our comment belong to it. Packets instruct the agent to prefix commit messages with `[<taskId>]` and start its report with `Report <taskId>`. Concurrent cloud tasks on one PR (US5) are enabled only if US1's second probe shows two sessions can run on one PR at once; otherwise the local queue serialises them and US5 still delivers overlap holds, conflicts, ceilings and secrets. | Correlation must not be guessed. | spec FR-017, US5 |
| C-6 | Poll interval and failure? | Setting `askaway.cloudTasks.pollMinutes` (default 3, min 1). Poll only while a task is non-terminal. On `gh` failure/rate limit: keep last state, set `staleSince`, exponential backoff to 15 min. | Spec edge case "Polling fails". | spec FR-010, Edge Cases |
| C-7 | What is committed vs local? | Committed: packet (the cloud agent must read it) and the final 005 run record written with the acceptance commit. Local, gitignored (`.askaway/specs/*/cloud/`): live cloud-run state updated by polling. | Committing live state would push to the branch while the cloud agent works (conflicts, false FR-018 warnings). | spec FR-004, FR-018, FR-022 |
| C-8 | How is merge blocked while a task is Working? | The extension posts commit status `askaway/cloud-task` = `pending` on the PR head (re-posted when the head moves) and `success` when no task is Working. This blocks the GitHub merge button only when branch protection/ruleset requires that status context — a one-time repository setting (reviewer action). The Specs tab additionally shows "Merge blocked: T012 working, ~34 min to cap". | Only required status checks can block GitHub's merge button. | spec Clarification (block merge), Edge Cases |
| C-9 | How is eligibility written in `tasks.md`? | Tag after the task ID: `[cloud]` when eligible, `[local: <reason>]` when not (reasons: `local service`, `open question`, `> 45 min`, `not self-contained`). `/sk.tasks` prompt asset applies the four rules; the scanner exposes tags (005 D-21). | FR-002 needs flag + reason on the row. | spec FR-002, FR-003 |
| C-10 | What is the task's "task-details section"? | The task line plus its indented sub-bullets in `tasks.md`, plus the story's Independent Test from `spec.md`. 005 tasks keep sub-bullets for file paths/notes (standard template allows them). | 005 does not define a separate section; this is the smallest self-contained unit. | spec FR-005 |
| C-11 | Packet format? | Markdown, YAML front matter with the nine fields (`stage`, `story`, `task`, `taskDetails`, `base`, `allowedPaths`, `verify` (list), `stopCondition`, `reportFormat`) + body linking committed artifacts by path. Schema: [contracts/packet.md](contracts/packet.md). | FR-005, SC-004. | spec FR-005 |
| C-12 | Comment text? | ≤5 lines, no spec/plan content: `@copilot Please do <taskId> of <slug>: follow .askaway/specs/<slug>/packets/<file> at <sha>.` + `Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands; stop and ask on anything undecided; reply with the packet's report format.` | FR-006, SC-004. | spec FR-006 |
| C-13 | How is spec/plan-stage output kept a draft? | Packet adds `draft: true` and the rule "do not change `**Status**:`"; acceptance returns the task if `**Status**:` changed in any spec/plan file. | FR-009. | spec FR-009 |
| C-14 | How does acceptance run? | On Needs review: local `verify` worker gets a packet with `base`, PR head sha, `verify` commands, `allowedPaths`. It runs `git fetch origin <branch>` into a temporary worktree (`git worktree add`), runs the commands, reports outputs. Main process then does scope check on commits by the cloud-agent login between `base` and head; ticks `tasks.md` (commit + push by the main process, reviewer-initiated or orchestrator) only on pass. | FR-014, FR-015; workers never push. | spec US4 |
| C-15 | Cloud-agent identity? | The commit author / comment author login recorded in the US1 evidence note (docs do not state it); stored in setting `askaway.cloudTasks.agentLogins` (default from US1). | Needed for conflict detection and scope check. | spec FR-018 |
| C-16 | Secret gate? | Before writing a packet or comment: refuse if text matches known token patterns (`ghp_`, `gho_`, `github_pat_`, `AKIA`, `xox[abp]-`, `sk-`, `-----BEGIN .*PRIVATE KEY-----`, JWT-shaped) or contains the value of any process env var whose name matches `TOKEN|SECRET|KEY|PASSWORD` (length ≥ 8) or the `gh auth token` value. Error names the field. | FR-020, SC-005. | spec FR-020 |
| C-17 | Ceilings and timeouts? | Per task `ceilingMinutes` (default 45, max 59) in the packet. Timed out when Working longer than the ceiling without a report. No response when neither 👀 nor started-work within 10 min of the comment. | FR-019, edge case. | spec FR-019 |
| C-18 | Morning digest timing? | Setting `askaway.cloudTasks.digestTime` (default `08:00` local). Sent once per day if any cloud run changed since the last digest; per task: PR, evidence, duration, model, blocker, decision needed; no price. | FR-012, FR-013. | spec FR-012 |
| C-19 | Actions on cloud pushes? | Requires repo admin to turn off "Require approval for workflow runs" (Settings → Copilot → Cloud agent). The poller reports check runs with conclusion `action_required` as state "Checks waiting for approval" (blocker). US1 records the setting state. | Docs: default requires approval. | spec FR-023, Clarification |
| C-20 | Feed rendering? | Convert a cloud run into the Workers trace-row input (`label`, `state`, `startedAt`, `rows[]` of signals with timestamps and links) at the data boundary; render with existing `traceRowsHtml`. | AGENTS.md consistency. | spec FR-011 |
| C-21 | Pre-queue refusals and order? | Checked in this order before any commit/comment: `gh auth` ok → active PR open → push permission (`gh api repos/{o}/{r} --jq .permissions.push`) → task eligible → task not already queued/working → secret gate → overlap/one-at-a-time rule. Refusal message names the failed check. | FR-021. | spec FR-021 |
| C-22 | Is cloud-agent enablement checkable before queuing? | No documented API; not checked up front. If disabled, the task becomes No response (C-17) with hint "Copilot cloud agent may be disabled for this repository". US1 records the observed behaviour. | No guessing an API. | spec Edge Cases |

No open questions block planning. Reviewer-owned setup items (not code): enable required status `askaway/cloud-task` (C-8), turn off workflow approval for Copilot (C-19).

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
  SM --> MS[commit status askaway/cloud-task]
```

State machine (`deriveCloudState`): `Queued` → (👀 or started-work) `Working` → (agent commit) `Pushed` → (checks complete) `Checks passed`/`Checks failed` (or `Checks waiting for approval`) → (agent report/question comment) `Needs review` → acceptance `Accepted`/`Returned`. Side exits: `No response` (10 min), `Timed out` (ceiling), `Returned` (wrong branch/new PR, PR closed, out-of-scope paths, Status changed). Local `Held` before posting when overlap/one-at-a-time applies.

## Interfaces and contracts

- [contracts/packet.md](contracts/packet.md) — packet format + comment template.
- [contracts/cloud-run.schema.json](contracts/cloud-run.schema.json) — local cloud-run state.
- [contracts/evidence-note.md](contracts/evidence-note.md) — US1 evidence note + fixture format.
- `src/cloud/cloudState.ts` — `deriveCloudState(run, signals, now, settings)` pure.
- `src/cloud/cloudPoller.ts` — `pollPr(repo, pr, since): Signals` (gh wrapper, injectable runner for tests).
- `src/cloud/cloudQueue.ts` — `queueTask(slug, taskId, opts)`; `refusalFor(context)` pure.
- `src/cloud/packet.ts` — `buildPacket(task, story, facts)`, `buildComment(packetRef)`, `secretFindings(text, knownValues)`.
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
| Safety | overlap/conflict/ceiling in `cloudState.ts` + `cloudQueue.ts`, commit status | US5 |

## Compatibility, migration, rollback

- No migration; new files only plus additive scanner tags from 005.
- Feature behind setting `askaway.cloudTasks.enabled` (default false until US1 evidence is committed and US2 passes). Rollback = turn setting off; packets already on a branch are inert markdown.

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
- Final 005 run record per cloud task (kind `worker`, command `cloud:<taskId>`, `agentMs` = duration, cost = 0 with `model`), so spec card totals include cloud time without inventing a price.

## Environment and commands

- `gh auth status` → logged in; `gh pr view <n> --json headRefName,state`.
- Build/test: `cd tasksync-chat && npx tsc -p ./ --noEmit && node esbuild.js && node --check media/webview.js && npm run test:workers` → 0 failed.
- Live proof: `node tasksync-chat/tools/cloud-proof.cjs --pr <n> --task PROOF-1` → writes `specs/006-cloud-tasks/evidence/proof-<date>.md` and `tasksync-chat/test-fixtures/cloud-signals-<date>.json`.
- Secrets: none new; `gh` auth only.

## Implementation order (stories are the phases)

| Phase | Deliverable | Depends on |
|---|---|---|
| Setup | `src/cloud/` folder, settings (`enabled`, `pollMinutes`, `digestTime`, `agentLogins`), gitignore `.askaway/specs/*/cloud/` | — |
| Foundational | Needs 005 Foundational (`runRecords.ts`, scanner `task.tags`) and 005 active-PR fact (US4/D-12). `gh` runner wrapper with injectable exec for tests. | 005 Foundational |
| US1 | `cloud-proof.cjs`; evidence note with no "unknown" entries; recorded signal fixture; go/no-go | Setup (can run before 005 is done: takes PR number as argument) |
| US2 | eligibility tags from `/sk.tasks`; packet + comment + secret gate + refusals; "Queue in cloud" button; model display per C-3 | US1 go, Foundational |
| US3 | poller + state machine (fixture replay test) + row/feed/Telegram + digest | US2 |
| US4 | acceptance via verify worker + scope check + tick | US3 |
| US5 | overlap holds, conflict detection, ceilings, commit status merge block, concurrency per C-5 | US4 |
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
└── tasks.md   (next: /sk.tasks)

tasksync-chat/
├── src/cloud/  cloudState.ts cloudPoller.ts cloudQueue.ts packet.ts cloudAccept.ts cloudDigest.ts
├── tools/cloud-proof.cjs
├── test-fixtures/cloud-signals-*.json
└── test-cloud-*.cjs
```

**Structure Decision**: new `src/cloud/` module inside the existing extension; no new package.

## Complexity Tracking

None.

## Later

Moved out of tasks.md by the task budget; each becomes tasks after US1's go.

- US2: `[cloud]`/`[local: reason]` rules in the `/sk.tasks` asset; `buildPacket`/`buildComment` (contracts/packet.md); `queueTask` + `refusalFor` (C-21); "Queue in cloud" button + model line (C-3); `test-cloud-queue.cjs` (9 fields, ≤5-line comment, refusals before writes).
- US3: `pollPr` (C-4, C-6); pure `deriveCloudState` (data-model transitions); feed adapter to `traceRowsHtml` (C-20); Telegram live + `digestLines` (C-18); `test-cloud-state.cjs` replaying the US1 fixture.
- US4: `acceptCloudTask` (worktree, verify worker, `outOfScope`, Status-line check); tick + run record + push on pass; `test-cloud-accept.cjs` on pass/fail/out-of-scope fixtures.
- US5: overlap/one-at-a-time hold; conflict detection; ceilings + No response; commit status `askaway/cloud-task` + "merge blocked" line; `test-cloud-safety.cjs`.
- Polish: Storybook task-row states and digest; README "Cloud tasks" incl. reviewer setup; quickstart + deploy.
