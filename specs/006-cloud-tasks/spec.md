# Feature Specification: Cloud Tasks

**Feature Branch**: `006-cloud-tasks` (spec directory only; no git branch created — work lands on the spec's one active PR)

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "Queue selected Spec Kit tasks to the GitHub Copilot cloud agent so work continues while the developer is offline, from the AskAway VS Code extension (Specs tab), on the spec's ONE active PR branch. This is where we'll go eventually, plan this part very carefully. I am counting on this feature."

**Binding sources**: `specs/005-speckit-guided-flow/Goal.md` ("Work continues while the reviewer is offline") and `specs/005-speckit-guided-flow/Rules.md` § "Cloud tasks (GitHub)":
- Flagged tasks have a button to queue them; the extension polls periodically and updates status.
- Update the same branch (the active PR), not a new branch per task. The model should be selectable.
- The message to the cloud agent states the stage, the task and what to do; context is referenced from committed artifacts, not repeated.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live proof of the cloud route (Priority: P1)

Before any UI is built, the developer (through the orchestrator) posts one short `@copilot` comment on a real, existing active PR that points at a committed task packet, and the extension records what actually happened: whether the cloud agent pushed to that same PR branch, which model ran and whether the model could be chosen from the posted comment, which signals appear on the PR while it works (comments, "started work" timeline event, commits, check runs), and whether repository workflows ran on its push. The result is a committed evidence note that every later story builds on.

**Why this priority**: Every other story depends on facts that are only partly documented (model selection from a posted comment is unverified). Building UI on a wrong assumption would waste a week; a live proof de-risks the whole feature in days.

**Independent Test**: On a throwaway task in this repository's active PR, run the proof once and check the evidence note lists: same-branch commit SHA(s), model used and whether it was selectable, each polling signal with timestamp, Actions-run outcome, session duration. Delivers a go/no-go decision for the route.

**Acceptance Scenarios**:

1. **Given** an open active PR and a committed packet for a trivial task, **When** the proof posts an `@copilot` comment referencing the packet, **Then** the evidence note records the commit(s) the cloud agent pushed and confirms they are on the PR's own branch, not a new branch.
2. **Given** the proof run, **When** it attempts to request a specific model in the posted comment, **Then** the evidence note states the model that actually ran and records "model selectable from comment: yes/no" with the observed proof.
3. **Given** the cloud agent is working, **When** the proof polls the PR, **Then** the evidence note lists which of comments, "started work" event, commits and check runs were observed and in what order.
4. **Given** the cloud agent pushed, **When** the proof inspects checks, **Then** the evidence note states whether repository workflows ran automatically, were held for approval, or did not run.
5. **Given** the route fails (no response, new branch created, permission refused), **When** the proof ends, **Then** the evidence note records the failure and the feature is stopped for a reviewer decision instead of building on it.

---

### User Story 2 - Flag and queue a task with a self-contained packet (Priority: P1)

When `/sk.tasks` (from 005) writes tasks, it marks a task as cloud-eligible when it is self-contained, fits well inside about 45 minutes, has no open question and needs no local services. The Specs tab shows a "Queue in cloud" button on each eligible task. Pressing it (in any stage once the task exists) writes one committed packet for that task, pushes it to the active PR branch, and posts a short `@copilot` comment that only references the packet. The developer can pick the model where GitHub allows it.

**Why this priority**: This is the core value: the developer queues work before going offline. With US1 proven, this story alone lets work continue overnight.

**Independent Test**: In a spec with an active PR and a cloud-eligible task, press "Queue in cloud"; verify a packet file appears under `.askaway/specs/<slug>/packets/` in the pushed branch, the PR shows one short comment referencing it, the comment and packet contain no secrets, and the task row shows "Queued".

**Acceptance Scenarios**:

1. **Given** `/sk.tasks` generates a task that is self-contained, under ~45 minutes, with no open question and no local service, **When** the tasks file is written, **Then** the task carries a cloud-eligible flag and the Specs tab shows "Queue in cloud" on its row.
2. **Given** a task that needs a local service or has an open question, **When** tasks are written, **Then** it is not flagged and shows no queue button, with the reason visible on hover.
3. **Given** an eligible task and an active PR, **When** the developer presses "Queue in cloud", **Then** one packet is committed and pushed stating stage, story, task, the task's task-details section, base commit, allowed paths, exact verification commands, stop condition and report format, and one `@copilot` comment referencing that packet is posted on the active PR.
4. **Given** a packet that names a spec or plan stage, **When** the cloud agent finishes, **Then** its output is marked as a draft awaiting the human approval gate; no gate is passed offline.
5. **Given** the spec has no active PR, **When** the developer presses "Queue in cloud", **Then** nothing is posted and the developer is told to open the active PR first.
6. **Given** a model is chosen in the queue dialog, **When** GitHub does not allow selecting a model for a posted comment (per US1 evidence), **Then** the dialog shows the model that will actually run instead of a picker.

---

### User Story 3 - See cloud task status everywhere (Priority: P2)

The extension polls the active PR periodically and moves each queued task through Queued → Working → Pushed → Checks passed / Checks failed → Needs review → Accepted / Returned. The state shows on the task row in the Specs tab, in the Workers-style feed (same shared components as other workers), and on Telegram, including a morning digest listing per task: PR, evidence, duration, model, blocker, and decision needed.

**Why this priority**: Without status the developer cannot trust offline work, but the work itself (US2) already runs; status makes it visible and actionable.

**Independent Test**: Replay a recorded PR signal sequence (from US1 evidence) against the status tracker and verify each transition appears on the task row, in the feed and in the digest; then one live queued task shows the same transitions.

**Acceptance Scenarios**:

1. **Given** a queued task, **When** polling sees the cloud agent's "started work" signal, **Then** the task shows Working with the start time.
2. **Given** a Working task, **When** a new commit from the cloud agent appears on the branch, **Then** the task shows Pushed with the commit SHA.
3. **Given** a Pushed task, **When** check runs complete, **Then** the task shows Checks passed or Checks failed with links to the runs.
4. **Given** the cloud agent posts its report or asks a question, **When** polling sees it, **Then** the task shows Needs review and the question is quoted as the "decision needed".
5. **Given** one or more cloud tasks changed state overnight, **When** the morning digest is sent on Telegram, **Then** each task lists PR, evidence, duration, model, blocker and decision needed, and shows duration and model but never a price.
6. **Given** the Workers feed shows a cloud task, **When** it is rendered, **Then** it uses the same trace/row component as other workers (consistent ordering, colours, expand/collapse).

---

### User Story 4 - Accept cloud work only after local verification (Priority: P2)

A cloud task is never ticked on the cloud agent's word. When a task reaches Needs review, a local verify worker pulls the branch, runs the packet's named verification commands, and only when they pass is the task ticked as Accepted; otherwise it is Returned with the failing evidence. Story Checkpoint verification from 005 applies unchanged.

**Why this priority**: 005 requires the orchestrator to accept a change only after verification. Without this, offline output could silently break the branch.

**Independent Test**: Take a cloud-pushed commit whose verification passes and one whose verification fails; run acceptance for both and verify the first is ticked Accepted with evidence recorded and the second is Returned with the failing command output, while the tasks file is unchanged for it.

**Acceptance Scenarios**:

1. **Given** a task in Needs review, **When** the verify worker's named evidence passes on the pulled branch, **Then** the task is ticked in the tasks file and marked Accepted with the evidence recorded.
2. **Given** a task in Needs review, **When** any named verification fails, **Then** the task is marked Returned, stays unticked, and the failure is shown on the row and in the digest.
3. **Given** all tasks of a story are Accepted, **When** the story checkpoint runs, **Then** the 005 checkpoint verification runs exactly as for locally done tasks.
4. **Given** the cloud agent changed files outside the packet's allowed paths, **When** acceptance runs, **Then** the task is Returned and the out-of-scope paths are listed.

---

### User Story 5 - Safety, conflicts and ceilings (Priority: P3)

The extension prevents unsafe overlap and runaway work: no two cloud tasks run on the same files at once; when the developer and the cloud agent both push to the branch, it is detected and surfaced; each task has a duration/budget ceiling that stays within the cloud agent's 59-minute session limit; secrets never appear in packets or comments.

**Why this priority**: US2 ships with a safe default (one cloud task per active PR at a time), so offline work is usable before this story. This story unlocks running several cloud tasks safely.

**Independent Test**: Queue two tasks whose allowed paths overlap and verify the second is held; queue two disjoint tasks and verify both run; simulate a local push during a Working task and verify a conflict warning; run a task that exceeds its ceiling and verify it is marked timed out.

**Acceptance Scenarios**:

1. **Given** a Working cloud task with allowed paths A, **When** the developer queues a task whose allowed paths overlap A, **Then** the second task is held in Queued (local) with the overlapping paths shown, and is sent only after the first finishes.
2. **Given** a Working cloud task, **When** a developer commit lands on the same branch, **Then** the task row and feed show a branch-conflict warning with both commits.
3. **Given** a task with a duration ceiling, **When** the ceiling or the 59-minute session limit is reached without a report, **Then** the task is marked Timed out and appears in the digest as a blocker.
4. **Given** a packet or comment is about to be written, **When** it contains a value matching a secret pattern or a known credential, **Then** writing is refused and the developer is told which field was rejected.

---

### Edge Cases

- The active PR is merged or closed while a cloud task is Working: [NEEDS CLARIFICATION: what happens to a cloud task when the active PR is merged mid-run — (A) mark it Returned and re-queue it on the next active PR, (B) let it finish and cherry-pick its commits onto the next PR, or (C) block merging the PR while any cloud task is Working?]
- The cloud agent opens a new branch or PR instead of pushing to the active branch: the task is marked Returned with "wrong branch" and nothing is merged automatically.
- The developer lacks write access or the cloud agent is not enabled for the repository: queuing is refused with that reason before any commit or comment.
- The cloud agent never responds to the comment: after a fixed wait the task shows "No response" as a blocker.
- The base commit in the packet is behind the branch head when the cloud agent starts: the packet names its base commit; acceptance verifies on the current head.
- The same task is queued twice: the second press is refused while the first is not Accepted or Returned.
- Polling fails (network, rate limit): the last known state stays with a "stale since" time; no state is guessed.
- The cloud agent stops to ask a question (stop condition met): the task moves to Needs review with the question as "decision needed", never auto-answered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The first delivered slice MUST be a live proof on a real PR that records same-branch push, model used and whether it was selectable from a posted comment, observed polling signals, Actions-run behaviour and session duration in a committed evidence note.
- **FR-002**: `/sk.tasks` MUST mark a task cloud-eligible only when it is self-contained, estimated well inside ~45 minutes, has no open question and needs no local services; ineligible tasks MUST carry the reason.
- **FR-003**: The Specs tab MUST show a "Queue in cloud" button on every cloud-eligible task in any stage once the task exists, and no button on ineligible tasks.
- **FR-004**: Queuing MUST write exactly one packet per queued task under `.askaway/specs/<slug>/packets/`, committed and pushed to the spec's active PR branch.
- **FR-005**: A packet MUST state: stage, story, task, the task's task-details section, base commit, allowed paths, exact verification commands, stop condition ("stop and ask on any undecided behaviour instead of guessing") and report format.
- **FR-006**: Queuing MUST post one short `@copilot` comment on the active PR that references the packet by path and commit and does not repeat its content.
- **FR-007**: Queuing MUST use the active PR's branch; it MUST NOT create a branch, PR or issue. Issue assignment MUST NOT be the default route.
- **FR-008**: The developer MUST be able to choose the model where GitHub allows it for the chosen route; where it does not, the extension MUST show the model that will run.
- **FR-009**: A packet naming a spec or plan stage MUST produce output marked as draft; no human approval gate (spec, plan, converge/readiness) is passed by cloud work.
- **FR-010**: The extension MUST poll the active PR periodically (comments, "started work" timeline events, commits, check runs) and derive task state Queued → Working → Pushed → Checks passed/failed → Needs review → Accepted/Returned, plus Timed out and No response.
- **FR-011**: Task state MUST be shown on the Specs tab task row, in the Workers-style feed using the existing shared row/trace component, and in Telegram status messages.
- **FR-012**: A Telegram morning digest MUST list, per cloud task that changed since the last digest: PR, evidence, duration, model, blocker and decision needed.
- **FR-013**: Cloud cost MUST be shown as duration and model only; the extension MUST NOT display an invented price.
- **FR-014**: A cloud task MUST be ticked only after a local verify worker pulls the branch and the packet's named verification commands pass; otherwise it is Returned with failing evidence.
- **FR-015**: Changes outside the packet's allowed paths MUST cause the task to be Returned.
- **FR-016**: Story Checkpoint verification from 005 MUST apply unchanged to stories containing cloud tasks.
- **FR-017**: Until overlap detection ships, at most one cloud task per active PR MUST be Working at a time; after it ships, two cloud tasks MUST NOT be Working on overlapping allowed paths.
- **FR-018**: The extension MUST detect and surface when the developer and the cloud agent push to the same branch during a Working task.
- **FR-019**: Each cloud task MUST have a duration ceiling not exceeding the cloud agent's 59-minute session limit; exceeding it marks the task Timed out.
- **FR-020**: Packets and comments MUST NOT contain secrets; writing MUST be refused when a secret pattern or known credential is detected.
- **FR-021**: Queuing MUST be refused, before any commit or comment, when there is no active PR, the developer lacks write access, or the task is already queued and not finished.
- **FR-022**: Per-task cloud facts (packet path, comment link, model, start/end time, duration, commits, state) MUST be stored per spec in `.askaway/`, mapped by spec name.
- **FR-023**: Repository workflows on cloud-agent pushes MUST be handled as follows: [NEEDS CLARIFICATION: should the extension enable Actions runs on cloud-agent pushes automatically (changes repository configuration, costs Actions minutes, gives Checks passed/failed without the developer), or leave them off and rely only on local verification (US4)?]

### Key Entities

- **Cloud-eligible task**: A task in a spec's tasks file with the eligibility flag or the reason it is not eligible.
- **Task packet**: One committed file per queued task under `.askaway/specs/<slug>/packets/`; holds stage, story, task, task-details section, base commit, allowed paths, verification commands, stop condition, report format; the only context the cloud agent receives beyond committed artifacts.
- **Cloud task run**: One queuing of a packet: packet reference, PR, comment link, model, state, state history with timestamps, commits, check runs, duration, blocker, decision needed, acceptance evidence.
- **Active PR**: The spec's single open PR (from 005) whose branch receives all cloud work.
- **Evidence note**: The committed result of the live proof (US1), the source of truth for route facts.
- **Morning digest**: Telegram summary of cloud task runs that changed since the last digest.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One live proof run produces an evidence note answering all five route questions (same-branch push, model selectability, signals, Actions behaviour, duration) with no "unknown" entries. Verified by: US1
- **SC-002**: 100% of commits from a cloud task land on the active PR's branch; zero new branches, PRs or issues are created by queuing. Verified by: US1, US2
- **SC-003**: A developer queues an eligible task in under 30 seconds and at most 2 interactions from the Specs tab. Verified by: US2
- **SC-004**: Every packet contains all nine required fields and the PR comment is at most 5 lines; no context from spec, plan or constitution is repeated in the comment. Verified by: US2
- **SC-005**: Zero secrets appear in any packet or comment across all test runs, including a seeded-secret test that is refused. Verified by: US2, US5
- **SC-006**: A state change on the PR is reflected on the task row, feed and Telegram within one poll interval plus one minute. Verified by: US3
- **SC-007**: After a night of cloud work, the developer can decide on every task from the morning digest alone, without opening GitHub, for at least 9 of 10 tasks. Verified by: US3
- **SC-008**: Zero cloud tasks are ticked without passing local verification; every Returned task shows the failing evidence. Verified by: US4
- **SC-009**: At least 3 cloud-eligible tasks are completed and Accepted overnight on one active PR in a real spec, with no manual steps between queuing and the morning digest. Verified by: US2, US3, US4
- **SC-010**: Zero overlapping-path cloud tasks run at the same time; 100% of simulated same-branch developer pushes during a Working task are surfaced. Verified by: US5
- **SC-011**: No cloud task runs past its ceiling or the 59-minute limit without being marked Timed out. Verified by: US5

## Assumptions

- Verified from GitHub docs (2026-09-30): mentioning `@copilot` in a comment on any pull request, including ones the developer created, makes the cloud agent push commits directly to that PR's branch by default. Assigning an issue always creates a new branch and PR, so it is not the default route (same-branch is a reviewer requirement).
- Verified: the web UI has a model picker; a comment posted without it uses the PR's original/default model. Whether an API-posted comment can select a model is UNVERIFIED and is proven in US1 before FR-008's UI is built.
- Verified: each cloud-agent session has a hard 59-minute limit; the ~45-minute eligibility bound leaves margin.
- Verified: the cloud agent runs in a GitHub Actions environment and follows repository custom instructions, custom agents, MCP servers, hooks and skills; `copilot-setup-steps.yml` prepares its environment. Packets therefore reference committed artifacts instead of repeating them.
- Verified: GitHub Actions workflows do not run automatically on the cloud agent's pushes unless configured (see FR-023).
- Verified: the cloud agent only responds to users with write access.
- Verified: cost is Actions minutes plus AI credits; no per-session price is exposed, so only duration and model are shown.
- Status is obtained by periodic polling as stated in 005 Rules ("the extension polls periodically"); webhooks are not used because a local extension has no public endpoint. The poll interval is a setting with a default of a few minutes.
- The spec already has one active PR (005 delivery rules); this feature does not open PRs.
- The developer's GitHub authentication available to the extension is reused; no new credential is introduced or stored in packets.
- Local verify workers, the Workers feed, the Specs tab and Telegram delivery from 001–005 are reused as they are.

## Dependencies

- GitHub Copilot cloud agent enabled for the repository and plan; developer has write access.
- 005: `/sk.tasks`, task-details sections, stage tracking, active PR per spec, story checkpoints, `.askaway/` per-spec storage.
- Existing AskAway Workers view shared components, verify/build workers, and Telegram status/digest delivery.

## Out of Scope

- Issue-based delegation (new branch and PR per task) as a default route.
- Creating, merging or closing PRs; opening a new PR after a story checkpoint (005 owns this).
- Passing any human approval gate offline or auto-answering the cloud agent's questions.
- Showing or estimating a monetary price per cloud task.
- Running local services for the cloud agent or tasks that need them.
- Changing the cloud agent's own UI, transcript or environment beyond committed repository files.
- Automatic conflict resolution or rebasing between developer and cloud commits (only detection and surfacing).
