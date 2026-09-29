# Feature Specification: Spec Kit Guided Flow

**Feature Branch**: `005-speckit-guided-flow`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "The developer adopts the Spec Kit flow (constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge) without having to know it. The extension drives the flow; the developer only says what they want in plain words, answers the few questions asked, and approves at three gates: what (spec accepted), how (plan accepted), done (converge + readiness)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Always-visible next step (Priority: P1)

A developer opens the Specs tab and, on every spec card, sees where the feature is in the Spec Kit flow (a stage rail) and exactly one "Next" action: the next stage, the `/sk.*` command that performs it, a plain-language reason, and what it is waiting on (for example "spec is still Draft"). The same decision is shown by the orchestrator, injected by the prompt context hook, and printed in the Telegram handoff, so no two surfaces ever disagree.

**Why this priority**: Every other story depends on one shared answer to "what now?". Without it the developer must know Spec Kit to proceed.

**Independent Test**: Prepare feature folders in known artifact states (spec only, Draft spec, accepted spec, plan, tasks, stale plan) and verify that the Specs tab card, the orchestrator, the prompt context hook and the Telegram handoff all report the identical next stage, command, reason and waiting-on.

**Acceptance Scenarios**:

1. **Given** a feature with a spec whose status is Draft, **When** the developer views its card, **Then** the rail marks "specify" current, and Next says the spec must be accepted at the "what" gate and names what it is waiting on.
2. **Given** an accepted spec and no plan, **When** any surface asks for the next step, **Then** all surfaces return "plan" with `/sk.plan` and the same reason.
3. **Given** an accepted spec and a missing plan, **When** the next step is derived, **Then** "tasks" or "implement" is never offered (required stages are never skipped).
4. **Given** an optional quality gate (clarify, checklist, analyze) applies, **When** the next step is derived, **Then** it is suggested with a reason and is not presented as mandatory.
5. **Given** the spec changed after the plan was produced, **When** the next step is derived, **Then** the plan (and anything derived from it) is shown stale and Next is to refresh the earliest owning artifact.

---

### User Story 2 - Plain text drives the flow (Priority: P1)

The developer never types a command. Any free-text message is routed: new work is sized by ambiguity, blast radius and reversibility; "continue"/"next" runs the next step; an answer is recorded where it belongs; "this is wrong" goes to the earliest artifact with authority; "done?" runs converge and readiness. Questions never cause writes. `/sk.*` commands remain as optional shortcuts.

**Why this priority**: This is the adoption promise — the developer uses plain words and still follows the flow.

**Independent Test**: Send a fixed set of messages (typo fix, dependency bump, new capability, "next", an answer to an open question, "this behavior is wrong", "the design is wrong", "a task is missing", "done?", "what does FR-003 mean?") and verify each lands on the expected route and that the question produced no file change.

**Acceptance Scenarios**:

1. **Given** a message describing a typo, dependency bump, or a bug whose correct behavior is already specified, **When** it is routed, **Then** it becomes a direct change with a test and no new spec.
2. **Given** a message describing new, ambiguous, wide-reaching or hard-to-reverse work, **When** it is routed, **Then** a new spec is started.
3. **Given** "continue" or "next", **When** it is routed, **Then** the step from User Story 1 is performed.
4. **Given** an answer to an open question, **When** it is routed, **Then** it is recorded in the spec's clarifications or the plan's decision register, whichever asked it.
5. **Given** "this is wrong", **When** it is routed, **Then** it goes to the earliest artifact with authority: behavior → spec, design → plan, missing work → tasks, principles → constitution.
6. **Given** a logic error that contradicts an accepted requirement, **When** it is routed, **Then** the code is fixed and the spec is not changed.
7. **Given** a question (e.g., "why is this stale?"), **When** it is routed, **Then** it is answered and no artifact or code is written.

---

### User Story 3 - One quality-gate command (Priority: P2)

Clarify, checklist, analyze and converge are all reached through `/sk.check` (or its plain-text equivalent). It decides which applies to the current state, asks at most five questions, and asks only when two answers would change code or tests. At the spec gate it lists unapproved assumptions; after tasks exist it shows a requirement → task → evidence table so uncovered requirements are visible even when all tests pass.

**Why this priority**: Makes quality gates usable without learning four commands; depends on the next-step decision from User Story 1.

**Independent Test**: Run `/sk.check` on a Draft spec, on an accepted spec with a plan, on a feature with tasks, and on an implemented feature; verify the applicable check is chosen each time, questions stay ≤ 5, and the coverage table flags a requirement with no task or no evidence.

**Acceptance Scenarios**:

1. **Given** a Draft spec with assumptions, **When** `/sk.check` runs, **Then** it performs clarify, lists the assumptions not yet approved, and asks at most five questions.
2. **Given** a question whose possible answers lead to the same code and tests, **When** `/sk.check` prepares questions, **Then** that question is not asked.
3. **Given** tasks exist and one requirement has no task, **When** `/sk.check` runs, **Then** the requirement → task → evidence table shows it uncovered even though the test suite passes.
4. **Given** implementation is complete, **When** `/sk.check` runs, **Then** it performs converge.

---

### User Story 4 - Readiness receipt at the done gate (Priority: P2)

At the "done" gate the developer sees one read-only readiness receipt: converge result, every check with PASS / FAIL / BLOCKED / not-applicable and a reason, open findings, and residual risk. The same receipt appears on the Specs tab, in the Telegram handoff, and as an evidence section drafted into the PR by `/pr-daily`.

**Why this priority**: Gives the "done" approval an honest basis; reuses the checks from User Story 3.

**Independent Test**: Produce a receipt for a feature where one check passed, one failed, one could not run and one does not apply; verify the three surfaces render identical content and the check that could not run is BLOCKED, not PASS.

**Acceptance Scenarios**:

1. **Given** a check that could not run, **When** the receipt is produced, **Then** it is BLOCKED with the reason and is never counted as PASS.
2. **Given** a produced receipt, **When** it is shown on the Specs tab, in the Telegram handoff and in the `/pr-daily` PR draft, **Then** all three contain the same results, findings and residual risk.
3. **Given** the receipt is produced, **When** the developer inspects the repository, **Then** producing it changed no artifact or code.

---

### User Story 5 - Parallel tasks via the orchestrator (Priority: P3)

Tasks are grouped by standard user-story labels `[USn]` and marked parallel with the standard `[P]` marker. The orchestrator dispatches two or more `[P]` tasks as parallel workers only when none has an unfinished dependency and they touch no shared file or surface. After all finish, it checks each worker's changed files against the task's declared scope, runs the full validation gate once on the integrated result, and ticks a task only when the evidence the task names was produced and passed.

**Why this priority**: Speeds up implementation but the flow is complete without it.

**Independent Test**: Give the orchestrator a tasks list with independent `[P]` tasks, a `[P]` task with an unfinished dependency, and two `[P]` tasks sharing a file; verify only the independent ones are dispatched together, an out-of-scope change is reported, the gate runs once, and ticks follow evidence.

**Acceptance Scenarios**:

1. **Given** two `[P]` tasks with no unfinished dependency and disjoint files, **When** the orchestrator dispatches, **Then** they run as parallel workers.
2. **Given** two `[P]` tasks that touch the same file or surface, **When** the orchestrator dispatches, **Then** they are not run in parallel and the wrong `[P]` marker is reported as a tasks problem.
3. **Given** a worker changed a file outside its task's declared scope, **When** all workers finish, **Then** the violation is reported and the task is not ticked.
4. **Given** all workers finished, **When** integration completes, **Then** the full validation gate runs exactly once and each task is ticked only if its named evidence was produced and passed.

---

### User Story 6 - Guards (Priority: P3)

Before any feature-changing `/sk.*` step runs, the extension confirms the intended feature matches the active feature recorded in `.specify/feature.json` (checking out a branch does not change the active feature). On workspace open it checks that the Spec Kit scaffolding (commands, templates, active feature path) is present and reports one focused setup issue without initializing anything.

**Why this priority**: Prevents writing to the wrong feature and explains broken setups; low frequency.

**Independent Test**: Point the active feature at feature A, ask to change feature B, and verify the step does not run silently; remove a template and reopen the workspace, verify one focused setup issue and no files created.

**Acceptance Scenarios**:

1. **Given** the active feature is A and the developer's request targets B, **When** a feature-changing step would run, **Then** the mismatch is surfaced before any write. [NEEDS CLARIFICATION: on mismatch, should the extension block and tell the developer, or offer a one-click switch of the active feature and then proceed?]
2. **Given** a git branch is checked out, **When** the next step is derived, **Then** the active feature is still the one in `.specify/feature.json`.
3. **Given** a missing template, command set or active-feature path, **When** the workspace opens, **Then** one focused setup issue names what is missing and nothing is initialized or created.

---

### Edge Cases

- No `.specify/feature.json`, or it points at a folder that does not exist → setup issue (US6), no next step invented.
- Several features exist → each spec card shows its own next step; only the active feature accepts feature-changing steps.
- Plain-text message that is both a question and a request (e.g., "why is this broken, fix it") → treated as a request; pure questions never write.
- Two upstream artifacts changed → Next points at the earliest owning artifact only.
- A worker fails or times out → its task is not ticked; the gate still runs once on what was integrated and the failure appears in the receipt.
- `/sk.check` finds more than five candidate questions → only the five with the largest code/test impact are asked; the rest become recorded assumptions.
- Converge has never run → the receipt shows converge as BLOCKED/not run, never PASS.

## Requirements *(mandatory)*

### Functional Requirements

**Next-step decision**

- **FR-001**: System MUST derive the next step for a feature purely from that feature's repository artifacts (constitution, spec, plan, checklists, tasks, evidence), with no hidden state.
- **FR-002**: The next step MUST contain: stage, `/sk.*` command, plain-language reason, and what it is waiting on (or nothing).
- **FR-003**: The Specs tab, orchestrator, prompt context hook and Telegram handoff MUST all obtain the next step from the same single decision and MUST show identical content.
- **FR-004**: Each spec card MUST show a stage rail (constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge) and exactly one "Next" action.
- **FR-005**: Required stages (specify, plan, tasks, implement, converge) MUST never be skipped; optional quality gates (clarify, checklist, analyze) MUST be suggested with a reason, not required.
- **FR-006**: When an upstream artifact changed after an artifact derived from it, System MUST mark the derived artifact and everything downstream stale, and the next step MUST be to refresh the earliest owning artifact. [NEEDS CLARIFICATION: what defines "changed after" — file modification time, git commit order, or a fingerprint of the upstream recorded inside the derived artifact?]
- **FR-007**: The three approval gates MUST be explicit steps: "what" (spec accepted), "how" (plan accepted), "done" (converge + readiness receipt).

**Plain-text routing**

- **FR-008**: System MUST route any free-text message to one of: small direct change, new spec, next step, answer, correction, readiness, or question.
- **FR-009**: New work MUST be sized by ambiguity, blast radius and reversibility; typo fixes, dependency bumps and bugs whose behavior is already specified MUST become a direct change with a test and no spec; everything else MUST start a new spec.
- **FR-010**: Answers MUST be recorded in the spec's clarifications or the plan's decision register, whichever artifact asked the question.
- **FR-011**: Corrections MUST go to the earliest artifact with authority: behavior → spec, design → plan, missing work → tasks, principles → constitution.
- **FR-012**: A logic error contradicting an accepted requirement MUST be fixed in code and MUST NOT change the spec.
- **FR-013**: Questions MUST NOT cause any write to artifacts or code.
- **FR-014**: The developer MUST be able to complete the whole flow without typing any command; existing `/sk.*` commands MUST keep working as shortcuts.

**Quality gate**

- **FR-015**: `/sk.check` MUST be the single entry to clarify, checklist, analyze and converge, and MUST choose which applies from the current next-step decision.
- **FR-016**: `/sk.check` MUST ask at most five questions per run, and only questions where two plausible answers would change code or tests.
- **FR-017**: At the "what" gate, `/sk.check` MUST list assumptions not yet approved by the developer.
- **FR-018**: Once tasks exist, `/sk.check` MUST show a requirement → task → evidence table that flags every requirement with no task or no passing evidence, regardless of test results.

**Readiness receipt**

- **FR-019**: System MUST produce a read-only readiness receipt with: converge result; each check as PASS / FAIL / BLOCKED / not-applicable with a reason; open findings; residual risk.
- **FR-020**: A check that could not run MUST be BLOCKED and MUST NEVER be reported as PASS.
- **FR-021**: The Specs tab, Telegram handoff and the `/pr-daily` PR evidence section MUST show the same receipt content.
- **FR-022**: Producing the receipt MUST NOT write artifacts or code.

**Parallel tasks**

- **FR-023**: Tasks MUST be grouped by standard `[USn]` labels and parallelism expressed only by the standard `[P]` marker; no custom phases or cycles for this feature.
- **FR-024**: The orchestrator MUST dispatch `[P]` tasks as parallel workers only when none has an unfinished dependency and they share no file or surface.
- **FR-025**: A `[P]` marker on tasks that share a file/surface or depend on each other MUST be reported as a tasks problem.
- **FR-026**: After all parallel workers finish, the orchestrator MUST compare each worker's changed files with the task's declared scope and report any out-of-scope change.
- **FR-027**: The full validation gate MUST run exactly once on the integrated result of a parallel batch.
- **FR-028**: A task MUST be ticked only when the evidence it names was produced and passed.

**Guards and consistency**

- **FR-029**: Before any feature-changing `/sk.*` step, System MUST confirm the intended feature matches `.specify/feature.json`; checking out a git branch MUST NOT change the active feature.
- **FR-030**: On workspace open, System MUST check that Spec Kit commands, templates and the active feature path exist, and MUST report one focused setup issue without initializing or creating anything.
- **FR-031**: `/sk.continue` MUST pitch exactly one next task consistent with the next-step decision.
- **FR-032**: `/sk.handoff` MUST print a resume checkpoint that includes the next-step decision.
- **FR-033**: `/pr-daily` MUST consume the readiness receipt for its PR evidence section.
- **FR-034**: Spec Kit's own `speckit.*` agent files MUST NOT be edited; all customization MUST live in the `/sk.*` wrappers and the extension.

### Key Entities

- **Feature**: A numbered folder under `specs/` holding a spec and its derived artifacts; one feature is active at a time via `.specify/feature.json`.
- **Artifact**: Constitution, spec, plan, checklist, tasks, evidence; each has an owner stage, a status (e.g. Draft/accepted), and an upstream artifact it derives from.
- **Next Step**: Stage, command, reason, waiting-on; derived only from artifacts; shared by all surfaces.
- **Stage Rail**: Ordered stages with per-stage state (done, current, stale, optional, pending).
- **Gate**: One of "what", "how", "done"; an explicit developer approval.
- **Routed Message**: A free-text message plus its route (direct change, new spec, next, answer, correction, readiness, question) and target artifact.
- **Check Result**: A quality check with outcome PASS / FAIL / BLOCKED / not-applicable and reason.
- **Readiness Receipt**: Converge result, check results, open findings, residual risk; read-only.
- **Task**: Entry in tasks.md with `[USn]` label, optional `[P]` marker, dependencies, declared file scope, and named evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every feature state in the test fixture set, all four surfaces (Specs tab, orchestrator, prompt context hook, Telegram handoff) report the identical next step in 100% of cases.
- **SC-002**: A developer with no Spec Kit knowledge takes a small feature from a plain-text request to the "done" gate typing zero `/sk.*` commands and giving only answers and three approvals.
- **SC-003**: In the routing fixture set, 100% of pure questions cause zero file changes, and every listed message type reaches its expected route.
- **SC-004**: No `/sk.check` run asks more than five questions.
- **SC-005**: 100% of requirements without a task or passing evidence are flagged in the coverage table, including when the full test suite passes.
- **SC-006**: A check that could not run is reported as PASS in 0% of receipts; the receipt content is identical across its three surfaces.
- **SC-007**: In the parallel fixture set, tasks sharing a file or with an unfinished dependency are dispatched in parallel 0 times, and the validation gate runs exactly once per parallel batch.
- **SC-008**: A feature-changing step targeting a non-active feature performs 0 writes before the mismatch is surfaced.

## Assumptions

- The Spec Kit stage order and optional/required split follow the Pega Academy training: constitution, specify, plan, tasks, implement, converge required; clarify, checklist, analyze optional.
- "Accepted" status of a spec or plan is recorded in the artifact itself (the spec's `**Status**` line), so the next-step decision needs no external state.
- Existing surfaces (Specs tab cards, Workers tab, orchestrator, Commentary/Telegram, prompt context hook, `/sk.*` and `/pr-daily`) are reused; no new tab is introduced.
- When routing cannot confidently size new work, it errs toward starting a spec (the reversible, lower-risk choice).
- Parallel workers use the existing OpenCode worker runtime and its observability.
- The constitution stage is considered done when `.specify/memory/constitution.md` exists and is not the unfilled template.

## Out of Scope

- Cross-repository contract workflows.
- Replacing or editing Spec Kit's own `speckit.*` agents.
- Changing, renumbering or migrating specs 001-004.
- Initializing Spec Kit scaffolding automatically (only detection and reporting).
- Custom phases or cycles for grouping this feature's tasks.
- Git branch creation or switching as part of the flow.
