# Feature Specification: Team

**Feature Branch**: `010-team` (planning identifier; no branch created)
**Created**: 2026-10-15
**Status**: Implemented and in use (reconciled 2026-10-22). Open: T042 live agy proof, T043 and T046 reviewer sign-offs, T045 reviewer-facing gap rows. See plan.md "Built outside the original plan".
**Input**: GOALS.md G18 and section 4 latest Team decisions; ADR 0023 and superseding ADR 0024; requirements/team.md R-TEAM-01–72 (superseded rows retained as history).

## Presence and posting rules in force (2026-10-22)
- AITalk presence: the reviewer and Priya are always in the room; the main agent joins at turn start and leaves at turn end; every other member joins only while it has an open question or approval card (R-AITALK-51, ADR 0036; supersedes the assignment-time presence of R-TEAM-09).
- Members post only questions in AITalk; progress goes in the worker's final report (R-AITALK-45).
- agy members show $0.00 cost and appear when active (R-TEAM-72). Claude and agy workers are identified and forked like OpenCode workers (ADR 0033, R-AITALK-46/47, R-WTOOL-45..48).
- Cathy's assistant tools and approval cards are spec 009 US8 (R-CATHY-01..08).

## User Scenarios & Testing

### User Story 1 - Any profile uses agy/Argon (Priority: P1)
As reviewer, I can choose agy instead of OpenCode and Argon for any profile, so this work can use it without inventing an agy member.
**Why this priority**: Explicit prerequisite to all Team work.
**Independent Test**: Caller dispatches a real scoped edit/build/test task using agy/Argon, observes completion and runtime/model attribution; OpenCode still works.
**Acceptance Scenarios**:
1. Given any existing profile, when agy and an available Argon variant are selected, then dispatch, permissions, results and observability work without a new persona.
2. Given headless write/command denial or unavailable model, when dispatch runs, then report failure truthfully, preserve workspace scope and do not call discovery a successful build.

### User Story 2 - Review the Team before production (Priority: P2)
As reviewer, I review simulated AITalk and Team together, including generated realistic faces or prompts/upload fallback and a reusable GIF.
**Why this priority**: Approval precedes production Team changes.
**Independent Test**: Storybook preserves the real extension tab contract and displays active member rows, pinned Priya, expandable tasks, dropdown/profile edits, named joins/mentions and GIF scenarios through shared render blocks; no top summary pills or end-turn rollup.
**Acceptance Scenarios**:
1. Given US1 proof, when the prototype runs, then reviewer sees one row/member, only turn-active members and shared identities/faces across tabs.
2. Given unsuccessful generation, when portraits are requested, then prompts are supplied for upload instead; no claim that photos were generated.
3. Given an unapproved prototype, when production is considered, then Team implementation remains blocked.

### User Story 3 - Operate a member's tasks (Priority: P3)
As reviewer, I open a member profile from AITalk, edit display name/role/model/thinking, follow the agent-file link to edit the prompt and expand multiple tasks.
**Why this priority**: Member identity must stay separate from runtime, profile and task.
**Independent Test**: Through the UI, assign two tasks to a member, inspect both banners/status/age/messages, click their AITalk name and route @member to running work.
**Acceptance Scenarios**:
1. Given approved Storybook, when a task is assigned, then member joins immediately and @member reaches running work via spec 003 without diverting the main task.
2. Given two tasks for one member, when its counted tasks pill is activated, then the existing-format task cards expand within that member row with their shared banners, task age, status, last message and supported actions; collapse state survives routine updates.
3. Given profile editing, when saved, then both views share the same simple display name/face, role remains distinct, model and supported effort use dropdowns, and the agent-file link emits the correct open-file intent; no persona/skills editor exists and internal worker contracts are unchanged.
4. Given AA.Orchestrator, when selected, then Mahesh's identity is used; when switching to AskAway Build, then Bhaskar's distinct technical-lead identity appears consistently, not a static Manager alias. Cathy represents Webex and Priya the Validator/Product Owner. Participant labels and join/leave notices use simple display names, while Team shows name and role separately; the user's name comes from supplied identity rather than CPO. Unknown agents retain their actual display names.
5. Given a real user-uploaded CPO photo referenced from a user-owned folder, when switching workspaces or upgrading the extension, then the same photo remains available without copying it into extension install/media, the repo or distributed bundles.
6. Given active Bhaskar and other members, when selecting @Bhaskar, @Cathy, @Priya, @Mahesh or another member's short alias, then autocomplete shows member identity and routes through stable IDs and existing routing priority. Renaming labels preserves identity; inactive members are not suggested; duplicate names require disambiguation rather than arbitrary delivery.

### User Story 4 - Compare candidate implementations (Priority: P2)
As reviewer, I inspect one detailed prompt and the existing Storybook reference before three isolated Sol 6.1, Opus 5.5 and Argon implementations are compared for quality and observed cost.
**Why this priority**: The review rejected parts of the prior design; technical checks alone do not establish the preferred model or layout.
**Independent Test**: Review the prompt first, then compare outputs built from one frozen baseline and identical checks, with cost/token/time evidence separated from quality and no end-turn rollup panel in the product.
**Acceptance Scenarios**:
1. Given this prompt-preparation stage, when the draft is delivered, then the existing full Storybook reference and exact production tab contract are linked and no candidate is launched yet.
2. Given prompt approval, when candidates run, then each receives the same prompt/snapshot/fixtures/limits in isolation; runtime/tool differences and queue time are reported rather than concealed.
3. Given completed candidates, when reviewed, then behavior/visual/test results and actual cost/token/time evidence are compared separately, unreported cost remains explicit, and no prototype winner is auto-promoted to production.

### Edge Cases
- Inactive profiles do not fill the turn view; Validator remains configured and pinned when visible, not fabricated as active.
- Multiple running tasks use existing task correlation for mentions; no arbitrary new routing policy without a caller-view test.
- Restart, unavailable portraits/model, completed tasks and reused sessions cannot leak previous task cost or identity.
- AITalk bug reports remain unverified until real caller-view checks; existing cited tests are not live acceptance.

## Requirements
### Functional Requirements
- **FR-001**: Verify alternate runtime and any-profile model selection first (R-TEAM-01).
- **FR-002**: UI-only Team/tasks terminology, active-turn member rows, CPO/PO/TPM/technical Build distinction and named expert roster (R-TEAM-02–05).
- **FR-003**: Shared face/initials treatment, simple-name profiles, available-model/supported-effort dropdowns, agent-file links and name-click navigation; no persona/skills editing (R-TEAM-06,20–21).
- **FR-004**: Multiple tasks/member, shared banners and assignment-time AITalk participation/@member routing (R-TEAM-08–09).
- **FR-005**: No end-turn member rollup/tip UI; existing-format Storybook approval plus GIF precedes production, and a separately approved three-model comparison reports quality/cost (R-TEAM-11,23–25).
- **FR-006**: Add-member UI stays future backlog (R-TEAM-12).
- **FR-007**: Selected native agent determines consistent identity across both views and join banners; AA.Orchestrator maps to Mahesh, Build has a distinct configurable technical-lead identity, unknown agents use their actual display names (R-TEAM-13).
- **FR-008**: CPO uses a real user-uploaded photo stored outside extension/repo/bundles in a user-owned folder, referenced across workspaces and retained on upgrades (R-TEAM-14); generated-photo behavior applies only to other members.
- **FR-009**: Every member has a selectable short-name alias; identity-visible autocomplete binds to stable member ID, survives label renames, excludes inactive members and disambiguates duplicate names by role/identity, preserving existing reply/mention priority (R-TEAM-15).
- **FR-010**: Existing extension-style navigation, larger-portrait member rows, counted task expansion and shared reference-format task cards (R-TEAM-22,24).
### Key Entities
- Member/profile: stable identity, display name, role, face, available runtime/model/thinking choices and an editable agent-file link.
- Task: one run assigned to a member; status, age, message, conversation, shared usage facts and cost.
- Turn: active member set and task correlations; no additional end-turn cost-rollup panel.
- Comparison candidate: isolated implementation from a frozen snapshot, assigned model/runtime/effort, proof artifacts and separately reported quality/cost evidence.

## Success Criteria
- **SC-001**: One real edit/build/test agy task and OpenCode regression pass before Team work.
- **SC-002**: All current, non-superseded Team scenarios have caller-view tests and explicit Storybook approval before production ships.
- **SC-003**: Two tasks/member appear under one counted expansion control; per-task shared usage remains correct without introducing a rollup section.
- **SC-004**: Every ask maps to tasks.md or BACKLOG.md; no undocumented claim of shipped Team.

## Assumptions
Grouping/other unspecified names are implementer choices, not new reviewer quotes; the later review explicitly uses simple Bhaskar/Cathy/Priya/Mahesh display names. Numbered reply context is preserved in GOALS.md. Runtime capabilities require actual evidence, not model discovery alone; missing monetary cost is never fabricated.

Selected-native-agent identity overrides any static Manager alias. AskAway Build displays Bhaskar with a separate role and @Bhaskar mention; the older Build Bhaskar label is superseded by ADR 0024. The external user photo remains `~/.askaway/profile/avatar.png`, shared across workspaces and excluded from distributable fixtures; use the resolved user name rather than a visible CPO placeholder.
