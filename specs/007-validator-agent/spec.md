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
- A10 / A15 Resolved: A10: "I review the validator response in comentary. And memory should give respond to agent as memory tool." A15: "We should only worry about last agent repsonse not intermittent agent response. As in turn end. Whatever we send to telegram that should be sent to validate. Observation is agent previous turn reply and user response should be observed. Observing intermittent things is also fine but they are not really like unconfirmed by user (some times we can store). So validator should only come into the picture in following cases. - When turn ends - When turn starts - When agent calls the tool for memory" SC-010 is pull-only; SC-011 approved 2026-10-07: "S-11 yes". Later turn-end and beta corrections below supersede the earlier input scope.
- A12 / D22: "memories md files are source of truth, we can seed memories built so far from them, but we dont use or update them going forward... We are changing memory solution and at the same time, we are using the same for validator also." Migration below; earlier OPEN topology question resolved by M1: ONE server.

### Session 2026-10-07 (decisions, later)

- SC-011 approved: "S-11 yes" — supersedes its earlier draft status; A10 fully resolved.
- Turn-end correction: "Validator is plan B for me. So, i see the final turn response. Correction, i recieve the whole final messgae not just response hand off section. It should be read as, reply to hand off with more additional details." The reviewer reads the final response themselves; the validator is their plan B and validates the whole final message sent to Telegram (the reply plus its Response Handoff), not only the handoff section.
- Accepted recommendations: "Sure" — main-chat turns only; OpenCode workers' final replies do not trigger the validator, workers access memory only through the memory tool, and intermediate replies are ignored in beta until reconsidered after the review days.
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

One local agentmemory server (or a better-reviewed alternative chosen after research) fully replaces the VS Code `/memories` md files for Copilot agents and OpenCode workers. Reviewer: "agentmemory is replacement for all memory needs. Validator also uses it." Reviewer 2026-10-07: "And agent memory should be full replacement to memory. One immideiate benefit i see is i dont need to load 30K or 20K memory files into conversation." Existing md files (user `/memories/`, repo `/memories/repo/`) seed it once and are then frozen: not used or updated going forward (D22: "we dont use or update them going forward"). Success means seeded md content no longer enters the conversation; agents pull memory through the memory tool. How md files stop being auto-loaded: mechanism pending reviewer choice. The validator uses the same server, separated by agentId. A superseded version stays hidden from recall.

**Why this priority**: It changes where every agent reads and writes memory, so it lands after the validator works against the store (Stories 2 and 4).

**Independent Test**: Seed from a sample `/memories` folder; a Copilot-side agent and an OpenCode worker each read a seeded fact and write a new one through the MCP tools; the validator's items are not returned to an agent query for another agentId; a superseded fact is not returned; the md files are unchanged after seeding; after the switch, the conversation's injected memory text contains zero md memory content; with the server stopped, AskAway starts it on first use.

**Acceptance Scenarios**:

1. **Given** existing md memories, **When** seeding runs, **Then** each item is in the store once and the md files are never read or written afterwards.
2. **Given** a Copilot agent and an OpenCode worker, **When** each queries and writes memory, **Then** both use the same server through the AskAway MCP tools.
3. **Given** the validator and an agent share the server, **When** either queries, **Then** results are separated by agentId and superseded versions are hidden.
4. **Given** no server is running, **When** a memory call is first made, **Then** AskAway starts one detached server; a second window attaches to it instead of starting another.

---

### User Story 7 - Live validator acts for the reviewer while away (Priority: P2)

Reviewer (2026-10-08): "It should act as me when i am away from keyboard." / "I say when it is ready for live. May be add some setting, when i am happy, i'll turn it on. by default it is off."

**Why this priority**: Work continues during the reviewer's absence without granting destructive authority or unsolicited agent input.

**Independent Test**: Call askaway_validator with live off, then on while Here, then on while Away with safe and unsafe questions; verify beta acknowledgements, sourced answer or held result, append-only decisions, return digest and reviewer-only drift flags.

**Acceptance Scenarios** (recommendations accepted 2026-10-08):
1. **Given** live is enabled and the reviewer is Away, **When** an agent asks a low-risk reversible sourced question with confidence at least 0.8, **Then** its tool result contains the answer and sources; all other questions are held.
2. **Given** a live decision, **When** no agent asks, **Then** no answer is pushed into agent input; Commentary still shows the prediction.
3. **Given** the reviewer is Here or timed Away has expired, **When** the tool is called, **Then** it remains beta, Commentary only.
4. **Given** decisions and held questions accumulated while Away, **When** the reviewer returns, **Then** a digest shows decisions, sources, uncertainties and held questions.
5. **Given** live is enabled while Away, **When** commentary indicates drift or risk, **Then** the reviewer receives a flag, never a destructive action.
6. **Given** a fresh installation, **When** readiness has not been declared by the reviewer enabling the setting, **Then** live is off.

This supersedes the beta-only FR-018 delivery limit ONLY when askaway.validator.live is on and workspace availability is Away. Destructive actions remain forbidden.

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

- **FR-001**: System MUST run the validator at exactly three triggers: main-chat turn end validates the whole final message as sent to Telegram (the reply plus its Response Handoff, not only the handoff section); main-chat turn start observes the previous turn's whole final message together with the user's response; an agent's memory tool call. OpenCode workers' final replies MUST NOT trigger the validator; workers reach memory only through the memory tool. Intermediate replies MUST be ignored in beta; revisit after the review days (reviewer 2026-10-07).
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

- **FR-019**: System MUST use the three triggers in FR-001, not a per-response cheap check. Intermediate replies MUST be ignored in beta; revisit after the review days (reviewer 2026-10-07).
- **FR-020**: System MUST keep stored knowledge without automatic expiry or review flags (the reviewer is the only authority). Reviewer changes supersede the current version; older versions MUST be retained but hidden from recall and default views. The agentmemory server MUST have auto-forget off (FR-024).
- **FR-021**: In Commentary, the validator MUST show how closely its prediction matched the reviewer's actual reply (the match measure of FR-007), so the reviewer can build confidence before linking.
- **FR-022**: Agents MUST be able to query the same memory store for their memory needs; this MUST NOT route validator outputs to agent channels in beta. Topology resolved: ONE server (M1, Session 2026-10-07).
- **FR-023**: agentmemory (or the better-reviewed alternative chosen after research) MUST replace VS Code `/memories` md files for Copilot agents and OpenCode workers. Existing md files (user `/memories/`, repo `/memories/repo/`) MUST seed it once and then remain frozen; agents MUST NOT use or update those files going forward. The validator MUST use the same single server, separated by agentId; superseded versions stay hidden from recall.
- **FR-024**: The memory server MUST run local-only (M2: "Yes"): no cloud calls, no OpenAI key passed to it (its environment MUST NOT inherit `OPENAI_API_KEY` or any provider key), local embeddings, auto-forget and consolidation off. Trial finding 2026-10-07: agentmemory auto-used the shell's `OPENAI_API_KEY` and tried to send observations to OpenAI.
- **FR-025**: AskAway MUST start or attach to one detached memory server on first use, with the port as the cross-window mutex, exactly like the shared OpenCode server (M4: "Askaway starts it like we start opencode server."). No server per window, worker or agent.
- **FR-026**: Agent and worker prompts and profiles MUST point to the memory store, not to `/memories`, once seeding is done.
- **FR-027**: askaway.validator.live MUST be boolean, default false, enabled only by the reviewer when ready; live authority requires workspace Away (timed and unexpired or until back).
- **FR-028**: Requested live tool calls MUST force observation and wait with a bounded timeout; only low-risk, reversible, sourced answers with confidence >= 0.8 may return; all others MUST return held for the reviewer. No unsolicited agent delivery.
- **FR-029**: Every live decision MUST append question, answer or held, sources, risk, reversibility, confidence and timestamp to a workspace JSONL ledger; prediction remains in Commentary.
- **FR-030**: Return to Here MUST produce a reviewer digest of decisions, sources, uncertainties and held questions.
- **FR-031**: Live commentary watching MUST flag drift/risk only to the reviewer and MUST NOT take destructive actions.

**Validator triggers (resolved 2026-10-07; A15)**: The validator runs at exactly three triggers: main-chat turn end validates the whole final message as sent to Telegram (the reply plus its Response Handoff, not only the handoff section); main-chat turn start observes the previous turn's whole final message paired with the user's response; an agent's memory tool call returns the answer only to the calling agent through the requested memory tool result. OpenCode workers' final replies do not trigger the validator; workers reach memory only through the memory tool. Intermediate replies are ignored in beta; revisit after the review days. The reviewer reads the final response themselves; the validator is their plan B.

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
- **SC-010 (resolved 2026-10-07; A10)**: 0 validator outputs are pushed into any agent channel, including chat input, worker input, hooks and prompt text, across observe, close-loop and context-proposal paths. The reviewer reviews validator responses in Commentary. Memory tool results requested by the agent are the one allowed path from memory/validator to that calling agent; nothing is sent to any other agent.
- **SC-011 (approved 2026-10-07; A10: "S-11 yes")**: 0 seeded secrets from agent responses, reviewer replies or sources reach any sink: validator input, agentmemory requests/storage, jsonl records, Commentary/UI, logs or cost records.

## Assumptions

- The reviewer is the single authority; "as close as possible to the reviewer" means matching his past statements, not correcting them.
- An active spec exists for most work; without one the validator uses repo-wide ADRs and memories only.
- ADRs, Goal.md, Rules.md and spec resources are already readable by the tools. agentmemory is the new memory solution for agents and validator (A12 / D22); existing VS Code `/memories` md files are the seed source of truth, imported once and then frozen, not used or updated going forward. Install is approved. Agents, workers and the validator share one server (M1; supersedes A1's "only for the validator"); FR-023 to FR-026 follow the reviewer's 2026-10-07 decisions.
- The shared usage banner and shared response and observation components already exist and are reused, not rebuilt (Consistent Experience).
- Moving the validator to the backend and smoothing the process is a later spec, after tuning.
- Linking the validator's answers and prompt additions to the agent is out of scope for the first release (beta, Commentary-only); it is a later release, added with cautions once the reviewer has confidence.
- Per-spec cost and token fields recorded by earlier specs (005) are reused for the validator's cost.

## Learn and predict loops (reviewer design, 2026-10-22, proposed; slow design in progress)

Reviewer: "I dont want to design 007 and the rest in a hurry. LEt me design in slowly." This section records his design input and the audit facts; [ADR 0038](../../docs/adr/0038-validator-learn-predict-conversation-stack.md) holds the decision (Proposed). Rows R-PLAN-38 to R-PLAN-43 in `tasksync-chat/docs/requirements/availability-and-validator.md`.

**Audit facts (2026-10-22):** the turn-end input is the previous final plus the reviewer's reply, the AITalk messages of the turn and the whole current final, not a durable stack (`src/validator/validatorTriggers.ts:27-55`). `ValidatorObserver.closeLoop` (compare the earlier prediction with the reviewer's reply, store rules, record `matched`) exists and is tested (`test-validator-close-loop.cjs`) but has no caller in `src` (`src/validator/observer.ts:152`), so Priya does not learn from his replies today. No conversation stack is persisted for spec 004.

**Sequence** (U = reviewer message, m = intermediate messages, tool calls and thinking, A = final agent response, V = Validator output): `U1, m1, m2 m3..., A1, V1, U2, m10, m11..., A2, V2, U3...`. Only U and A are captured, for the whole conversation, continuously.

| Step | Input | Output |
|---|---|---|
| Respond to A1 | U1 | V1 (answer when in charge, prediction when not) |
| Learn | U1, A1, prediction V1, U2 | match or miss recorded, extracted knowledge stored |
| Respond to A2 | U1, A1, U2 | V2 |
| Learn | U1, A1, U2, A2, V2, U3 | match or miss, knowledge |
| Respond to A3, learn again | the stack so far | and so on |

**Extract from the reviewer's messages:** how he answers questions, priorities and guidance, what is important and what is not, what he repeats. A prediction that matches his reply adds points. The same stack feeds spec 004.

**Tests:** end to end with a cheap model (Luna, or agy Argon 4), scripted conversation, asserting the stack, the predictions, the match records and that a later answer uses something learned earlier.

**Open (reviewer's question batch):** stack size cap and whether it survives a conversation switch; how points are counted and where they show; whether learning runs only when the Validator is in charge or always; whether "respond to A_n" at Here (not in charge) stays a silent prediction; which model the live test may spend on and its budget.

## Beta limits

Reviewer D19: "accept". The open items of the reviewer checklists (beta-privacy, knowledge-store, cost-evals) are accepted as beta limits, not blockers; analyze A20/N6 is resolved. Known limits:

- Checklists stay unticked; spec Status stays Draft while plan.md is approved.
- No automated baseline or regression gate for evals or success targets; manual review for a few days (A11).
- Rebuild of the store from `index.jsonl` is not required and not tested (A12).
- Workspace isolation (N2) is by project/agentId tag on the one shared server, not by a server per workspace.
- Dropped-item (secret) visibility and prompt-enhancement terminology (A17) are not specified further.
- Success targets 60/70/80/10% stay provisional; SC-002 is not measurable until linking.
