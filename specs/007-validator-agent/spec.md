# Feature Specification: Validator Agent

**Feature Branch**: `007-validator-agent`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Then user role becomes explaining new requirement only once." A validator agent watches every agent and worker response, answers from what the reviewer already said (ADRs, memories, specs, Goal/Rules), learns from each reviewer reply, and stores what it learns next to the active spec, story or task, so the reviewer never repeats himself and work can start from anywhere. Binding inputs: [Goal.md](Goal.md) and [Rules.md](Rules.md).

## Clarifications

### Session 2026-10-02

- Q: FR-018 — may the validator's answer be delivered to the agent without the reviewer seeing it first? → A: No. Beta phase (reviewer, binding, also in Rules.md): validator answers appear only in the Commentary tab and nothing is sent to the agent; linking to the agent is a later release, with cautions, and is out of scope for this spec's first release.
- Q: FR-019 — which responses does the validator observe? → A: C: every response, with a cheap check first that skips pure progress updates.
- Q: FR-020 — when does stored knowledge expire? → A: A: it is kept until the reviewer changes it (the reviewer is the only authority).
- Q: Success targets 60/70/80/10% — are they confirmed? → A: A: provisional; reset after a first-week measurement.
- Q: Prompt enhancement during beta — how is it delivered? → A: A: as a suggestion in the Commentary tab that the reviewer can dismiss.
- Q: Show how closely the validator predicted the reviewer's reply? → A: A: yes, shown in Commentary (it builds the reviewer's confidence to link the validator to the agent later).

### Session 2026-10-07

- A1: "a separate agentmemory server only for the validator, with auto-forget off". Initial dedicated selection; install approved. Validator-only topology superseded by M1 below.
- A4 / FR-006: "Validator for few turns it is more like trial basis. I manually see the quality of validator how it is responding on behalf of me." Trial runs alongside; it never blocks the reviewer's reply.
- Memory access: "if it uses as memory store, agent should be able to call it for memory needs". Agents can query the same store for memory needs, without receiving validator outputs.
- A11: "I'll manually see them few days". No automated baseline in beta; the reviewer manually assesses quality.
- A5: "keep older versions also, hide them". Retain superseded versions, hidden from recall and default views.
- A10 / A15: "Sure" — draft missing success criteria and observed/skipped definitions; drafted by agent, reviewer to approve.
- A12 / D22: "memories md files are source of truth, we can seed memories built so far from them, but we dont use or update them going forward... We are changing memory solution and at the same time, we are using the same for validator also." Migration below; earlier OPEN topology question resolved by M1: ONE server.

### Session 2026-10-07 (decisions, later)

- M1 topology (resolves the OPEN question above): "agentmemory is replacement for all memory needs. Validator also uses it." + "Do it in 007. We have to many specs. It belongs there." → ONE server for agents, workers and validator; the D15/A1 "only for the validator" wording is superseded. No separate spec 009 (M3).
- Product choice: "Use agentmemory or anything better which has good reviews". agentmemory is the default; research may substitute a better-reviewed alternative before T005.
- M2: "Yes" to local-only (FR-024). Trial finding: agentmemory auto-used the shell's `OPENAI_API_KEY` and tried to send observations to OpenAI (failed 429).
- M4: "Askaway starts it like we start opencode server." (FR-025).
- D19: "accept" — the open reviewer-checklist gaps are accepted as beta limits (listed under Beta limits below); analyze A20 is resolved.

## User Scenarios & Testing *(mandatory)*

Each story is an independently testable slice, delivered in priority order. The validator starts as a simple observer (a tool with an agent run behind it); moving it to the backend is a later optimisation and is not a story here. In the beta first release the validator is Commentary-only: its output is never sent to the agent.

### User Story 1 - Observer answers the agent's question, with its cost (Priority: P1)

Every agent or worker response is handed to the validator. When the response asks a question or needs a decision, the validator answers it from the active spec and its resources (ADRs, memories, documents, Goal.md, Rules.md, the spec's stories and tasks), keeping the spec's ultimate goal in mind. The answer is as close as possible to what the reviewer would say, and comes with observations, a short summary and the impact. The validator's response appears in the Commentary tab only, and its cost is added to the shared cost banner. In beta nothing is sent to the agent: the reviewer reads the answer in Commentary first and builds confidence before any linking to the agent. When no source supports an answer, the validator says so instead of guessing.

**Why this priority**: This is the smallest slice that shows the reviewer which questions the repo already answers, and it proves the core promise ("explain once") and the validator's closeness to the reviewer before any learning or linking is built.

**Independent Test**: In a sample spec whose Rules.md states a decision, have an agent response ask a question covered by that rule and one that is not covered. Confirm the first gets an answer citing the rule with observations, summary and impact, shown in the Commentary tab; the second is reported as unanswerable from sources; the agent received nothing from the validator; and the shared banner's cost rose by the validator's cost.

**Acceptance Scenarios**:

1. **Given** an active spec whose Rules.md decides X, **When** an agent response asks "should we do X or Y?", **Then** the validator answers X in the Commentary tab, names the source it used, and adds observations, summary and impact; nothing is sent to the agent.
2. **Given** an agent response with no question or decision, **When** it is observed, **Then** the validator still returns observations and a summary and does not invent a question.
3. **Given** a question no source covers, **When** the validator runs, **Then** it states that no source answers it and leaves the question for the reviewer.
4. **Given** a validator run that cost tokens, **When** the UI renders, **Then** its response is visible in the Commentary tab and the shared banner includes its cost.
5. **Given** a worker response (not the native chat agent), **When** it is observed, **Then** it is handled the same as an agent response.

---

### User Story 2 - Close the loop on the reviewer's reply and store knowledge (Priority: P2)

When the reviewer replies, the previous agent response and the reviewer's reply go to the validator alongside the agent flow, never blocking delivery of the reply. It compares the reviewer's reply with the answer it predicted, extracts knowledge, rules, instructions and goals from the reviewer's words, and stores them with the active spec, story or task. Memories are preferred over new files. Examples may be captured with a rule. The difference between prediction and reply is recorded for the reviewer's manual trial assessment.

**Why this priority**: This is where "explain once" is earned: each reply makes the next answer better. It depends on Story 1's predictions.

**Independent Test**: Run Story 1's question, then reply as the reviewer with a decision that differs from the prediction and contains a new rule. With a slow validator, confirm the agent receives the reply without waiting; confirm the validator receives the pair, records the mismatch, and stores the rule with the active spec/story/task. Have a fresh agent query the memory store and confirm the rule is available; the validator's Commentary answer also cites it, with no validator output delivered to the agent.

**Acceptance Scenarios**:

1. **Given** an agent response and a reviewer reply, **When** the reply is sent, **Then** the validator receives the pair alongside the agent flow; the agent receives the reply without waiting for the validator.
2. **Given** a reviewer reply that states a new rule, **When** the validator processes it, **Then** the rule is stored with the related spec, story or task, preferring a memory over a new file.
3. **Given** a prediction that differs from the reviewer's reply, **When** processed, **Then** the difference is recorded and counted in the match measure.
4. **Given** a reviewer reply that carries a worked example, **When** processed, **Then** the example may be stored beside its rule.
5. **Given** a reviewer reply with no new knowledge ("ok"), **When** processed, **Then** nothing is stored.
6. **Given** a rule stored earlier, **When** a new agent starts on the same spec with no chat history, **Then** the rule is available to the validator's answers.

---

### User Story 3 - Prompt enhancement (Priority: P3)

When the reviewer sends a prompt, the validator can propose the context to load (relevant ADRs, memories, spec resources, stored rules), so that once linked everything can arrive with the prompt in one go instead of the agent asking for it. In beta the proposal is shown in the Commentary tab only; the agent still receives the reviewer's prompt exactly as written. The reviewer sees what was proposed and can remove it.

**Why this priority**: It previews how the agent's discovery questions would be removed up front, but only pays off once Stories 1 and 2 have knowledge to load.

**Independent Test**: With stored rules for a spec, send a short prompt on that spec. Confirm the Commentary tab names the proposed context to load, the reviewer can see and remove each proposed addition, and the agent receives the prompt unchanged.

**Acceptance Scenarios**:

1. **Given** stored knowledge relevant to a short prompt, **When** the prompt is sent, **Then** the Commentary tab shows the proposed context additions and the agent's prompt is unchanged.
2. **Given** a proposed addition the reviewer does not want, **When** the reviewer removes it, **Then** it no longer appears in the proposal.
3. **Given** a prompt with nothing relevant stored, **When** enhanced, **Then** no proposal is shown.
4. **Given** a prompt that already names the context, **When** enhanced, **Then** nothing is duplicated in the proposal.

---

### User Story 4 - Knowledge stays small: dedup and concision (Priority: P4)

Stored knowledge is deduplicated and concise. The same fact is never kept in two active forms (a memory, a spec line and an ADR sentence saying the same thing), and the same fact is never loaded twice into one prompt. When the reviewer changes a decision, the new statement becomes current; older versions are retained but hidden from recall and default views.

**Why this priority**: Without it, Stories 2 and 3 slowly grow cost and contradiction; it can wait until there is stored knowledge to measure.

**Independent Test**: Store the same rule from two reviewer replies in different words and one existing ADR line; confirm one canonical entry remains and an enhanced prompt loads it once. Then reverse the decision and confirm only the new statement is loaded.

**Acceptance Scenarios**:

1. **Given** an existing stored rule, **When** a reply restates it differently, **Then** no second entry is stored.
2. **Given** a fact present in an ADR and a memory, **When** the context is loaded, **Then** it is loaded once.
3. **Given** a reviewer reply that reverses a stored decision, **When** processed, **Then** the new statement becomes current, the old version is retained but hidden from recall and default views, and the changed flag is informational only.
4. **Given** a long reviewer reply, **When** stored, **Then** only the concise rule (and optional example) is kept.

---

### User Story 5 - Evals for the validator's prompt (Priority: P5)

The validator's prompt is verified by eval cases covering three behaviours: answering questions, improving the prompt, and storing observations. Each eval has recorded inputs and expected outcomes. In beta the reviewer manually assesses quality over a few days; there is no automated baseline or baseline-regression gate.

**Why this priority**: Evals protect Stories 1–4 during tuning and before any move to the backend; they are most useful once each behaviour exists.

**Independent Test**: Run the eval set against the current prompt; confirm a result per behaviour is available for manual reviewer assessment, without an automated beta baseline gate.

**Acceptance Scenarios**:

1. **Given** the eval set, **When** it runs, **Then** it reports a result for answering, prompt improvement and storing separately.
2. **Given** a prompt change during beta, **When** evals run, **Then** results are available for manual quality review, with no automated baseline comparison.
3. **Given** a real reviewer correction (prediction vs reply), **When** added to the eval set, **Then** later runs include it.

---

### User Story 6 - One memory store for all agents (Priority: P6)

One local agentmemory server (or a better-reviewed alternative chosen after research) replaces the VS Code `/memories` md files for Copilot agents and OpenCode workers. Reviewer: "agentmemory is replacement for all memory needs. Validator also uses it." Existing md files (user `/memories/`, repo `/memories/repo/`) seed it once and are then frozen: not used or updated going forward (D22: "we dont use or update them going forward"). The validator uses the same server, separated by agentId. A superseded version stays hidden from recall.

**Why this priority**: It changes where every agent reads and writes memory, so it lands after the validator works against the store (Stories 2 and 4).

**Independent Test**: Seed from a sample `/memories` folder; a Copilot-side agent and an OpenCode worker each read a seeded fact and write a new one through the MCP tools; the validator's items are not returned to an agent query for another agentId; a superseded fact is not returned; the md files are unchanged after seeding; with the server stopped, AskAway starts it on first use.

**Acceptance Scenarios**:

1. **Given** existing md memories, **When** seeding runs, **Then** each item is in the store once and the md files are never read or written afterwards.
2. **Given** a Copilot agent and an OpenCode worker, **When** each queries and writes memory, **Then** both use the same server through the AskAway MCP tools.
3. **Given** the validator and an agent share the server, **When** either queries, **Then** results are separated by agentId and superseded versions are hidden.
4. **Given** no server is running, **When** a memory call is first made, **Then** AskAway starts one detached server; a second window attaches to it instead of starting another.

---

### Edge Cases

- Sources contradict each other (an old ADR vs a newer reviewer reply): the newest reviewer statement wins, and the conflict is shown.
- The reviewer's reply contradicts the validator's earlier stored knowledge: the reply wins; the older version is retained but hidden from recall and default views (Story 4).
- Several agents or workers respond at once: each is observed separately and costs are attributed per source.
- No active spec: the validator answers only from repo-wide ADRs and memories and says the spec context is missing.
- A response contains a secret: it is never sent to the validator, stored, or shown.
- The validator itself fails or times out: the agent and reviewer flow continues unblocked and the failure is visible.
- The reviewer's reply is unrelated to the previous agent response: nothing is stored against the wrong spec/story/task.
- The reviewer replies to a response the validator never saw: the pair is still processed.
- Validator answer would take a destructive or irreversible action: it is shown as advice, never acted on without the reviewer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST pass every agent or worker response to the validator (Goal: observes continuously).
- **FR-002**: Validator MUST answer an agent's question from the active spec and its resources, ADRs, memories and documents, and show the answer in Commentary so the reviewer sees it before replying (Rules: Sources).
- **FR-003**: Validator MUST keep the active spec's ultimate goal (Goal.md) in view for every answer.
- **FR-004**: Validator MUST produce an answer as close as possible to the reviewer's own, plus observations, a summary and the impact.
- **FR-005**: Validator MUST say when no source supports an answer instead of guessing.
- **FR-006**: After a reviewer message, System MUST send the previous agent response and the reviewer's reply to the validator alongside the agent flow; validator processing MUST never block delivery of the reviewer's reply (2026-10-07 trial).
- **FR-007**: Validator MUST compare the reviewer's reply with its prediction and record the difference.
- **FR-008**: Validator MUST extract knowledge, rules, instructions and goals from reviewer replies and store them with the related spec, story or task, preferring memories over new files; examples MAY be captured.
- **FR-009**: Validator MAY propose, in the Commentary tab, context to load with the reviewer's prompt; the proposal is a suggestion the reviewer MUST be able to see and dismiss (remove each proposed addition). In beta the proposal MUST NOT change the prompt the agent receives.
- **FR-010**: Stored knowledge MUST be deduplicated and concise; the same fact MUST NOT be loaded in different forms.
- **FR-011**: A reviewer decision that reverses a stored one MUST supersede it as current; older versions MUST be retained but hidden from recall and default views. Any changed flag is informational only.
- **FR-012**: Validator responses MUST be visible in the Commentary tab, using the same shared components that show agent responses and observations elsewhere.
- **FR-013**: Validator cost (input, output, reasoning, cache, cost) MUST count in the shared usage banner.
- **FR-014**: The validator MUST begin as a simple observer (a tool backed by an agent run); the interface seen by agents and the UI MUST NOT change when it later moves to the backend.
- **FR-015**: The validator's prompt MUST be verified by evals for answering questions, improving the prompt and storing observations.
- **FR-016**: Secrets MUST never reach the validator, its storage, its UI output or its cost records.
- **FR-017**: A validator failure MUST NOT block the agent or reviewer flow and MUST be visible.
- **FR-018**: Validator output MUST be advisory; it MUST NOT approve gates or trigger destructive actions on the reviewer's behalf. In beta, validator answers MUST appear only in the Commentary tab and MUST NOT be sent to the agent; linking validator answers to the agent is out of scope for this spec's first release.

- **FR-019**: System MUST observe every agent or worker response, running a cheap check first that skips pure progress updates (no question, decision or new information) before the validator answers.
- **FR-020**: System MUST keep stored knowledge without automatic expiry or review flags (the reviewer is the only authority). Reviewer changes supersede the current version; older versions MUST be retained but hidden from recall and default views. The agentmemory server MUST have auto-forget off (FR-024).
- **FR-021**: In Commentary, the validator MUST show how closely its prediction matched the reviewer's actual reply (the match measure of FR-007), so the reviewer can build confidence before linking.
- **FR-022**: Agents MUST be able to query the same memory store for their memory needs; this MUST NOT route validator outputs to agent channels in beta. Topology resolved: ONE server (M1, Session 2026-10-07).
- **FR-023**: agentmemory (or the better-reviewed alternative chosen after research) MUST replace VS Code `/memories` md files for Copilot agents and OpenCode workers. Existing md files (user `/memories/`, repo `/memories/repo/`) MUST seed it once and then remain frozen; agents MUST NOT use or update those files going forward. The validator MUST use the same single server, separated by agentId; superseded versions stay hidden from recall.
- **FR-024**: The memory server MUST run local-only (M2: "Yes"): no cloud calls, no OpenAI key passed to it (its environment MUST NOT inherit `OPENAI_API_KEY` or any provider key), local embeddings, auto-forget and consolidation off. Trial finding 2026-10-07: agentmemory auto-used the shell's `OPENAI_API_KEY` and tried to send observations to OpenAI.
- **FR-025**: AskAway MUST start or attach to one detached memory server on first use, with the port as the cross-window mutex, exactly like the shared OpenCode server (M4: "Askaway starts it like we start opencode server."). No server per window, worker or agent.
- **FR-026**: Agent and worker prompts and profiles MUST point to the memory store, not to `/memories`, once seeding is done.

**Observed vs skipped (draft — drafted by agent, reviewer to approve; A15)**: observed means a response has passed through the cheap check. Skipped means it was checked but not sent to the answering validator because it contains only progress (no question, decision or new information). Skipped responses remain counted and visible in Commentary stats; observed does not mean answered.

### Key Entities

- **Validator response**: the answer, observations, summary, impact, sources used, and cost, linked to the response it observed.
- **Prediction**: the answer the validator expected the reviewer to give, kept to compare with the actual reply.
- **Knowledge item**: a rule, instruction, goal or fact (with optional example) extracted from a reviewer reply and attached to a spec, story or task.
- **Context addition**: a resource named by the validator to load with the reviewer's prompt.
- **Eval case**: a recorded input and expected outcome for answering, prompt improvement or storing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

The numeric targets below (60%, 70%, 80%, 10%) remain provisional. Reviewer 2026-10-07: "I'll manually see them few days" — no automated baseline in beta; manual quality review replaces the earlier first-week baseline plan. SC-002 remains deferred until linking; baseline comparisons in SC-001/SC-004/SC-009 are not beta gates.

- **SC-001**: At least 60% of agent questions get a validator answer in Commentary from existing artifacts, with a named source (provisional; manual beta review, no automated baseline).
- **SC-002**: Once linking to the agent ships (after beta; not measurable in beta, when the agent receives nothing), repeat instructions from the reviewer (the same rule or requirement stated more than once) fall by at least 70% per week versus the week before linking.
- **SC-003**: For answered questions, at least 80% of the validator's answers match the reviewer's reply on the decision made.
- **SC-004**: For a fresh agent started on a spec with stored knowledge, no more than 1 question about context the reviewer already gave goes without a validator answer in Commentary that cites the stored knowledge (provisional; no pre-launch or automated baseline in beta).
- **SC-005**: Duplicate knowledge items across a spec's stored knowledge stay at 0 on audit, and enhanced prompts load no fact twice.
- **SC-006**: 100% of validator runs show their response in the Commentary tab and their cost in the shared banner.
- **SC-007**: Validator cost stays under 10% of the total cost of the agent work it observes.
- **SC-008**: A validator failure delays the agent or reviewer flow by 0 blocking steps in all tested failure cases.
- **SC-009**: Every prompt change provides results from the three eval sets (answering, improving, storing) for manual quality review in beta; no automated baseline comparison is required.
- **SC-010 (draft — drafted by agent, reviewer to approve; A10)**: 0 validator outputs reach any agent channel in beta, including chat input, worker input, MCP tool results, hooks and prompt text, across observe, close-loop and context-proposal paths.
- **SC-011 (draft — drafted by agent, reviewer to approve; A10)**: 0 seeded secrets from agent responses, reviewer replies or sources reach any sink: validator input, agentmemory requests/storage, jsonl records, Commentary/UI, logs or cost records.

## Assumptions

- The reviewer is the single authority; "as close as possible to the reviewer" means matching his past statements, not correcting them.
- An active spec exists for most work; without one the validator uses repo-wide ADRs and memories only.
- ADRs, Goal.md, Rules.md and spec resources are already readable by the tools. agentmemory is the new memory solution for agents and validator (A12 / D22); existing VS Code `/memories` md files are the seed source of truth, imported once and then frozen, not used or updated going forward. Install is approved. Agents, workers and the validator share one server (M1; supersedes A1's "only for the validator"); FR-023 to FR-026 follow the reviewer's 2026-10-07 decisions.
- The shared usage banner and shared response and observation components already exist and are reused, not rebuilt (Consistent Experience).
- Moving the validator to the backend and smoothing the process is a later spec, after tuning.
- Linking the validator's answers and prompt additions to the agent is out of scope for the first release (beta, Commentary-only); it is a later release, added with cautions once the reviewer has confidence.
- Per-spec cost and token fields recorded by earlier specs (005) are reused for the validator's cost.

## Beta limits

Reviewer D19: "accept". The open items of the reviewer checklists (beta-privacy, knowledge-store, cost-evals) are accepted as beta limits, not blockers; analyze A20/N6 is resolved. Known limits:

- Checklists stay unticked; spec Status stays Draft while plan.md is approved.
- No automated baseline or regression gate for evals or success targets; manual review for a few days (A11).
- Rebuild of the store from `index.jsonl` is not required and not tested (A12).
- Workspace isolation (N2) is by project/agentId tag on the one shared server, not by a server per workspace.
- Dropped-item (secret) visibility and prompt-enhancement terminology (A17) are not specified further.
- Success targets 60/70/80/10% stay provisional; SC-002 is not measurable until linking.
