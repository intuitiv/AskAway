# Feature Specification: Spec Kit Guided Flow

**Feature Branch**: `005-speckit-guided-flow`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "I transfer context and what I need to build to you, and the agent should do most of the work with less cost." The extension drives the Spec Kit flow so the reviewer does not have to know it. The reviewer says what they want in plain words, answers the few questions asked, and approves at three gates: what (spec), how (plan), done (converge + readiness). Binding inputs: [Goal.md](Goal.md) and [Rules.md](Rules.md).

## User Scenarios & Testing *(mandatory)*

Each story is 3–5 days to a week of work, independently testable, and merged through one active PR at its Checkpoint.

### User Story 1 - Stage tracking and next step (Priority: P1)

Every spec stores its current stage, named as Spec Kit names it. The flow is: specify → `/sk.check` (clarify) → plan → `/sk.check` (checklist) → tasks → `/sk.check` (analyze) → implement → `/sk.check` (converge). The Specs tab always shows the button for the current stage's action (plan, tasks, implement…) and `/sk.check`, and suggests the next step. The stored stage is cross-checked against the artifacts on disk; a mismatch is shown, never hidden. An artifact is stale when an artifact it depends on changed after it; "changed after" is decided by git commit order, and any uncommitted edit counts as the newest. The Specs tab has two switches, **All** (specs other than the active one) and **Completed**. Working on a non-active feature is allowed.

**Why this priority**: Every other story needs to know where a spec is. Without a known stage, neither the reviewer nor the orchestrator can pick the next step.

**Independent Test**: Take a spec at each stage in a sample repo; open the Specs tab; confirm the stored stage, the stage button, `/sk.check`, and the suggested next step. Edit an upstream artifact without committing; confirm the downstream artifact shows as stale and a stage mismatch is flagged.

**Acceptance Scenarios**:

1. **Given** a spec whose `spec.md` exists and no plan, **When** the Specs tab renders, **Then** the stage reads "specify", the next step is `/sk.check` (clarify), and the plan button and `/sk.check` are visible.
2. **Given** a spec whose stored stage is "tasks" but no `tasks.md` exists, **When** the Specs tab renders, **Then** a stage mismatch is shown naming the stored stage and the stage implied by the artifacts.
3. **Given** `plan.md` committed after `tasks.md`, **When** staleness is evaluated, **Then** `tasks.md` is shown as stale.
4. **Given** an uncommitted edit to `spec.md` and committed `plan.md`, **When** staleness is evaluated, **Then** `plan.md` is shown as stale.
5. **Given** ten specs of which three are completed, **When** the reviewer turns **All** off and **Completed** off, **Then** only the active spec is listed; turning each switch on reveals the matching specs.

---

### User Story 2 - Stories as phases everywhere (Priority: P1)

New specs, plans and task lists use the standard Spec Kit story structure: Setup, Foundational, one phase per user story in priority order (with its Independent Test and Checkpoint), then Polish; parallel work uses the standard `[P]` marker. The Specs tab groups work by story and shows each story's progress and Independent Test. The `/sk.plan`, `/sk.tasks`, `/sk.check` and `/sk.implement` wrappers produce and read this structure. No `CY-NNN`, `PAC` or `CAC` appears in new specs; older specs that use cycles still render.

**Why this priority**: Stories are the unit of work, PR and verification for Stories 4 and 6; they must exist before anything is delivered per story.

**Independent Test**: Run the tasks wrapper on a sample spec with three stories and confirm the task list has Setup, Foundational, US1–US3 by priority, and Polish; open the Specs tab and confirm the story grouping, progress counts and Independent Test text; open an older cycle-based spec and confirm it still renders.

**Acceptance Scenarios**:

1. **Given** a spec with stories P1, P2, P3, **When** tasks are generated, **Then** the phases are Setup, Foundational, US1, US2, US3, Polish in that order, each story phase carrying its Independent Test and Checkpoint.
2. **Given** a task list with 4 of 6 US1 tasks done, **When** the Specs tab renders, **Then** US1 shows 4/6 and its Independent Test.
3. **Given** a newly generated spec, plan or task list, **When** it is searched, **Then** it contains no `CY-NNN`, `PAC` or `CAC` markers.
4. **Given** an existing spec using cycles, **When** the Specs tab renders, **Then** it displays without error.

---

### User Story 3 - Plain text drives the flow (Priority: P2)

The reviewer writes a normal message and it is routed to the right stage. New work is sized by ambiguity, blast radius and reversibility: small, clear, reversible work becomes a direct change with a test; larger work starts at specify. A message about an existing spec continues from its stored stage. `/sk.*` commands remain shortcuts. `/sk.continue`, `/sk.handoff` and `/pr-daily` are extension flows, not stages, and read and respect the stored stage.

**Why this priority**: The reviewer should not need Spec Kit knowledge; this depends on Story 1's stored stage.

**Independent Test**: Send three plain messages (a one-line fix, a new multi-area feature, "continue 005") and confirm each routes to direct change + test, specify, and the stored stage's next step respectively; run `/sk.continue` and `/sk.handoff` and confirm both name the same stage as the Specs tab.

**Acceptance Scenarios**:

1. **Given** a message asking for a small, unambiguous, reversible change, **When** it is routed, **Then** it becomes a direct change that ships with a test and no new spec.
2. **Given** a message describing ambiguous work across several areas, **When** it is routed, **Then** specify runs for a new spec.
3. **Given** a spec stored at "plan", **When** the reviewer writes "continue", **Then** the next step is `/sk.check` (checklist), matching the Specs tab.
4. **Given** a spec at any stage, **When** `/sk.handoff` or `/pr-daily` runs, **Then** the stage it reports equals the stored stage.

---

### User Story 4 - Per-spec facts (Priority: P2)

Branch, active PR, stage, cost spent and agent time are stored per spec in the repo under `.askaway/specs/<slug>/`, one small file per run, so parallel runs never write the same file. Facts are mapped by spec name and shown on the spec card. Telegram status messages carry cost and tokens with the status.

**Why this priority**: Cost is the stated goal ("less cost"); the reviewer needs to see it per spec, and Stories 5 and 7 need the active PR.

**Independent Test**: Start two runs on the same spec at once; confirm two separate run files exist and neither overwrote the other; open the spec card and confirm branch, active PR, stage, summed cost and summed agent time.

**Acceptance Scenarios**:

1. **Given** two concurrent runs on one spec, **When** both finish, **Then** each wrote its own file and the card totals include both.
2. **Given** a spec with recorded runs, **When** the spec card renders, **Then** it shows branch, active PR, stage, cost spent and agent time.
3. **Given** a status message sent to Telegram, **When** it arrives, **Then** it includes cost and tokens.

---

### User Story 5 - Story completion and PR flow (Priority: P2)

Each spec has one active PR. When a story reaches its Checkpoint, a verify worker runs the story's Independent Test and checks the success criteria mapped to that story. On pass, the story's PR is shown as ready to merge; after merge, the next story continues on a new PR. Never one PR per day.

**Why this priority**: "Mergeable as soon as possible" is the first outcome in the goal; this depends on Stories 2 and 4.

**Independent Test**: Complete US1 of a sample spec; confirm the verify worker ran the Independent Test and the SCs marked "Verified by: US1", the PR is marked ready to merge, and after merge the next story's work opens a new PR recorded as the active PR.

**Acceptance Scenarios**:

1. **Given** all US1 tasks done, **When** the Checkpoint is reached, **Then** a verify worker runs the US1 Independent Test and its mapped SCs and records the result.
2. **Given** the verification passes, **When** the result is recorded, **Then** the PR is shown as ready to merge.
3. **Given** the verification fails, **When** the result is recorded, **Then** the PR is not marked ready and the failing check is named.
4. **Given** the US1 PR merged, **When** US2 work starts, **Then** a new PR becomes the spec's single active PR.

---

### User Story 6 - Orchestrator runs the flow (Priority: P3)

The orchestrator is a technical manager: it knows the stages, the repo and the application, works in story order, and thinks of what the reviewer did not. It delegates: `[P]` tasks go to at most two parallel build workers per track, only on disjoint files; workers use the model tier the work needs; a worker running longer than 4 minutes returns an ID and never blocks the orchestrator. It uses the terminal only for one standalone command. It accepts a change only after a scope check, one integrated gate, and named evidence, and runs `/sk.check` at each gate.

**Why this priority**: It delivers the "less cost, reviewer does less" outcome at scale, but needs Stories 1, 2 and 5 first.

**Independent Test**: Give the orchestrator a task list with three `[P]` tasks (two on disjoint files, one overlapping); confirm at most two build workers run at once, the overlapping task waits, each change is accepted only with scope check + gate result + evidence, and `/sk.check` runs at the gate.

**Acceptance Scenarios**:

1. **Given** three `[P]` tasks, **When** dispatched, **Then** no more than two build workers run at once and no two running workers share a file.
2. **Given** a worker change that touches files outside its task, **When** the orchestrator reviews it, **Then** the change is rejected by the scope check.
3. **Given** a worker still running after 4 minutes, **When** the orchestrator dispatched it, **Then** the orchestrator already holds an ID and continues other work.
4. **Given** a stage gate, **When** it is reached, **Then** `/sk.check` runs for that gate before the next stage starts.

---

### User Story 7 - Readiness at the done gate (Priority: P3)

`/sk.check` (converge) produces a readiness summary: each check is PASS, FAIL, BLOCKED or not-applicable (a check that could not run is never a pass), plus open findings and residual risk. The same summary appears on the Specs tab, in Telegram, and in the PR text drafted by `/pr-daily`.

**Why this priority**: It is the third reviewer gate ("done"), used after implementation exists.

**Independent Test**: Run converge on a spec where one check cannot run; confirm it shows BLOCKED (not PASS), and that the Specs tab, Telegram message and drafted PR text show identical statuses, findings and risk.

**Acceptance Scenarios**:

1. **Given** a check whose tool is unavailable, **When** converge runs, **Then** that check is BLOCKED with the reason.
2. **Given** a converge result, **When** shown on the Specs tab, Telegram and PR text, **Then** all three list the same check statuses, open findings and residual risk.

---

### Edge Cases

- Stored stage points past a missing artifact → mismatch shown; the suggested next step is based on the artifacts.
- An artifact is missing from git history entirely (never committed) → treated as uncommitted, i.e. newest.
- Two runs finish in the same second → still separate files; totals include both.
- An older cycle-based spec → renders, but new wrapper output never emits cycles.
- A `[P]` task whose files overlap a running task → waits; it is never run in parallel.
- No active PR yet (first story) → spec card shows "no PR"; the first story opens it.
- A verify worker cannot run the Independent Test → story result BLOCKED, PR not marked ready.
- Plain text that matches no spec and is ambiguous in size → routed to specify, not a direct change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store the current stage per spec using Spec Kit's stage names.
- **FR-002**: System MUST follow the flow specify → `/sk.check` (clarify) → plan → `/sk.check` (checklist) → tasks → `/sk.check` (analyze) → implement → `/sk.check` (converge).
- **FR-003**: Quality gates (clarify, checklist, analyze, converge) MUST all be reached through one command, `/sk.check`; all commands are `/sk.*`.
- **FR-004**: The Specs tab MUST show the current stage's action button and `/sk.check` at all times, and suggest the next step.
- **FR-005**: System MUST cross-check the stored stage against artifacts and show any mismatch.
- **FR-006**: System MUST mark an artifact stale when an artifact it depends on changed later by git commit order, counting any uncommitted edit as newest.
- **FR-007**: The Specs tab MUST offer **All** and **Completed** switches; working on a non-active spec MUST be allowed.
- **FR-008**: New specs, plans and task lists MUST follow `.specify/templates/` structure, with spec `**Status**: Draft` as the acceptance marker.
- **FR-009**: Task lists MUST use Setup, Foundational, one phase per user story by priority (Independent Test + Checkpoint), Polish, and `[P]` for parallel work; new artifacts MUST NOT contain `CY-NNN`, `PAC` or `CAC`.
- **FR-010**: The Specs tab MUST group work by story with progress and Independent Test; older cycle-based specs MUST still render.
- **FR-011**: The `/sk.plan`, `/sk.tasks`, `/sk.check` and `/sk.implement` wrappers MUST produce and read the standard story structure.
- **FR-012**: Plain text MUST be routed to the right stage; new work MUST be sized by ambiguity, blast radius and reversibility, and small work MUST become a direct change with a test.
- **FR-013**: `/sk.continue`, `/sk.handoff` and `/pr-daily` MUST read and report the stored stage consistently with the Specs tab.
- **FR-014**: System MUST store branch, active PR, stage, cost spent and agent time per spec under `.askaway/specs/<slug>/`, one file per run, mapped by spec name.
- **FR-015**: The spec card MUST display those per-spec facts, with totals across runs.
- **FR-016**: Telegram status messages MUST include cost and tokens.
- **FR-017**: Each spec MUST have exactly one active PR; a story's PR merges at its Checkpoint and the next story uses a new PR.
- **FR-018**: At a story Checkpoint a verify worker MUST run the story's Independent Test and its mapped success criteria; only on pass is the PR shown ready to merge.
- **FR-019**: The orchestrator MUST work in story order and run `/sk.check` at each gate.
- **FR-020**: The orchestrator MUST dispatch `[P]` tasks to at most two build workers at once per track, on disjoint files only.
- **FR-021**: The orchestrator MUST accept a change only after a scope check, one integrated gate and named evidence.
- **FR-022**: The orchestrator MUST use the terminal only for one standalone command; multi-command work goes to a build worker.
- **FR-023**: A worker running longer than 4 minutes MUST return an ID and not block the orchestrator; workers MUST be able to use a model tier other than the default.
- **FR-024**: `/sk.check` (converge) MUST report each check as PASS, FAIL, BLOCKED or not-applicable, never PASS for a check that did not run, plus open findings and residual risk.
- **FR-025**: The readiness summary MUST be identical on the Specs tab, Telegram and the PR text drafted by `/pr-daily`.
- **FR-026**: Context MUST be written once in spec, plan and constitution and referenced by workers, not repeated in messages.
- **FR-027**: System MUST provide the hook points feature 006 needs: the stored stage, the per-spec data store, and a per-task flag visible in the Specs tab.

### Key Entities

- **Spec**: A feature folder under `specs/`; has a name/slug, stored stage, artifacts, stories, active PR.
- **Stage**: A Spec Kit step (specify, clarify, plan, checklist, tasks, analyze, implement, converge) with its action button and next step.
- **Artifact**: spec, plan, tasks, checklists; has a change order from git (uncommitted = newest) and may be stale.
- **User Story**: Priority, Independent Test, Checkpoint, tasks, progress, mapped success criteria.
- **Run Record**: One per run under `.askaway/specs/<slug>/`: branch, PR, stage, cost, tokens, agent time.
- **Pull Request**: The spec's single active PR; ready-to-merge after a passed Checkpoint.
- **Readiness Summary**: Per-check status (PASS/FAIL/BLOCKED/not-applicable), open findings, residual risk.
- **Worker**: A delegated build or verify run with a model tier, file scope, ID and evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of specs in a sample repo, the Specs tab shows a stage, its action button, `/sk.check` and a next step. Verified by: US1.
- **SC-002**: 100% of seeded stage mismatches and stale artifacts (including uncommitted edits) are shown. Verified by: US1.
- **SC-003**: Newly generated specs, plans and task lists contain zero `CY-NNN`/`PAC`/`CAC` markers, and 100% of existing cycle-based specs still render. Verified by: US2.
- **SC-004**: At least 9 of 10 sample plain-text requests are routed to the stage a reviewer would choose, with no Spec Kit command typed. Verified by: US3.
- **SC-005**: `/sk.continue`, `/sk.handoff`, `/pr-daily` and the Specs tab report the same stage in 100% of checks. Verified by: US1, US3.
- **SC-006**: Two concurrent runs on one spec lose zero records, and the spec card totals equal the sum of run records. Verified by: US4.
- **SC-007**: Every Telegram status message carries cost and tokens. Verified by: US4.
- **SC-008**: Each spec has at most one active PR at any time, and no PR is marked ready to merge without a passed story verification. Verified by: US5.
- **SC-009**: Never more than two build workers run at once per track, and zero accepted changes lack scope check, gate result and evidence. Verified by: US6.
- **SC-010**: The orchestrator is never blocked by a worker for more than 4 minutes. Verified by: US6.
- **SC-011**: Zero checks that did not run are reported as PASS, and the readiness summary is identical across Specs tab, Telegram and PR text. Verified by: US7.
- **SC-012**: The reviewer's actions for a full feature are limited to plain-text requests, answering asked questions, and three approvals (spec, plan, done). Verified by: US3, US5, US7.

## Assumptions

- The spec directory name (slug) is the stable key for per-spec data.
- Git is available in the workspace; commit order is the change order for staleness.
- "Agent time" is the summed wall-clock time of agent and worker runs for the spec.
- Merging a ready PR stays a reviewer action; the extension marks it ready and does not merge by itself.
- Small-work sizing uses judgement on ambiguity, blast radius and reversibility; the plan defines the exact thresholds.
- Existing AskAway workers, OpenCode build workers, Telegram and the Specs tab are reused, not rebuilt.

### Out of scope

- **Cloud tasks (Copilot cloud agent)** move to a separate feature **006**: queue button, delegation on the active PR's branch, model selection, polling and status. 005 provides only the hook points (FR-027): stored stage, per-spec data store, and a task flag visible in the Specs tab.
- Changing Spec Kit's own templates or command semantics.
- An active-feature guard.
