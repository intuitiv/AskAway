# Feature Specification: Validator Agent

**Feature Branch**: `007-validator-agent`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Then user role becomes explaining new requirement only once." A validator agent watches every agent and worker response, answers from what the reviewer already said (ADRs, memories, specs, Goal/Rules), learns from each reviewer reply, and stores what it learns next to the active spec, story or task, so the reviewer never repeats himself and work can start from anywhere. Binding inputs: [Goal.md](Goal.md) and [Rules.md](Rules.md).

## User Scenarios & Testing *(mandatory)*

Each story is an independently testable slice, delivered in priority order. The validator starts as a simple observer (a tool with an agent run behind it); moving it to the backend is a later optimisation and is not a story here.

### User Story 1 - Observer answers the agent's question, with its cost (Priority: P1)

Every agent or worker response is handed to the validator. When the response asks a question or needs a decision, the validator answers it from the active spec and its resources (ADRs, memories, documents, Goal.md, Rules.md, the spec's stories and tasks), keeping the spec's ultimate goal in mind. The answer is as close as possible to what the reviewer would say, and comes with observations, a short summary and the impact. The validator's response appears in the UI, and its cost is added to the shared cost banner. When no source supports an answer, the validator says so instead of guessing.

**Why this priority**: This is the smallest slice that removes the reviewer from the loop for questions already answered in the repo, and it proves the core promise ("explain once") before any learning is built.

**Independent Test**: In a sample spec whose Rules.md states a decision, have an agent response ask a question covered by that rule and one that is not covered. Confirm the first gets an answer citing the rule with observations, summary and impact, shown in the UI; the second is reported as unanswerable from sources; and the shared banner's cost rose by the validator's cost.

**Acceptance Scenarios**:

1. **Given** an active spec whose Rules.md decides X, **When** an agent response asks "should we do X or Y?", **Then** the validator answers X, names the source it used, and adds observations, summary and impact.
2. **Given** an agent response with no question or decision, **When** it is observed, **Then** the validator still returns observations and a summary and does not invent a question.
3. **Given** a question no source covers, **When** the validator runs, **Then** it states that no source answers it and leaves the question for the reviewer.
4. **Given** a validator run that cost tokens, **When** the UI renders, **Then** its response is visible and the shared banner includes its cost.
5. **Given** a worker response (not the native chat agent), **When** it is observed, **Then** it is handled the same as an agent response.

---

### User Story 2 - Close the loop on the reviewer's reply and store knowledge (Priority: P2)

When the reviewer replies, the previous agent response and the reviewer's reply go to the validator first. It compares the reviewer's reply with the answer it predicted, extracts knowledge, rules, instructions and goals from the reviewer's words, and stores them with the active spec, story or task. Memories are preferred over new files. Examples may be captured with a rule. The difference between prediction and reply is recorded so the validator's closeness to the reviewer can be measured.

**Why this priority**: This is where "explain once" is earned: each reply makes the next answer better. It depends on Story 1's predictions.

**Independent Test**: Run Story 1's question, then reply as the reviewer with a decision that differs from the prediction and contains a new rule. Confirm the validator received the pair before anything else, recorded the mismatch, and stored the rule with the active spec/story/task; start a fresh agent on that spec and confirm the rule is answerable from storage.

**Acceptance Scenarios**:

1. **Given** an agent response and a reviewer reply, **When** the reply is sent, **Then** the validator receives the previous response and the reply before the agent does.
2. **Given** a reviewer reply that states a new rule, **When** the validator processes it, **Then** the rule is stored with the related spec, story or task, preferring a memory over a new file.
3. **Given** a prediction that differs from the reviewer's reply, **When** processed, **Then** the difference is recorded and counted in the match measure.
4. **Given** a reviewer reply that carries a worked example, **When** processed, **Then** the example may be stored beside its rule.
5. **Given** a reviewer reply with no new knowledge ("ok"), **When** processed, **Then** nothing is stored.
6. **Given** a rule stored earlier, **When** a new agent starts on the same spec with no chat history, **Then** the rule is available to the validator's answers.

---

### User Story 3 - Prompt enhancement (Priority: P3)

When the reviewer sends a prompt, the validator can add the context to load (relevant ADRs, memories, spec resources, stored rules), so everything arrives with the prompt in one go instead of the agent asking for it. The reviewer sees what was added and can remove it.

**Why this priority**: It removes the agent's discovery questions up front, but only pays off once Stories 1 and 2 have knowledge to load.

**Independent Test**: With stored rules for a spec, send a short prompt on that spec. Confirm the enhanced prompt names the context to load, the reviewer can see and remove each addition, and the agent starts without asking for that context.

**Acceptance Scenarios**:

1. **Given** stored knowledge relevant to a short prompt, **When** the prompt is sent, **Then** the validator adds the context to load and the reviewer sees the additions.
2. **Given** an addition the reviewer does not want, **When** the reviewer removes it, **Then** the agent receives the prompt without it.
3. **Given** a prompt with nothing relevant stored, **When** enhanced, **Then** it is sent unchanged.
4. **Given** a prompt that already names the context, **When** enhanced, **Then** nothing is duplicated.

---

### User Story 4 - Knowledge stays small: dedup and concision (Priority: P4)

Stored knowledge is deduplicated and concise. The same fact is never kept in two forms (a memory, a spec line and an ADR sentence saying the same thing), and the same fact is never loaded twice into one prompt. When the reviewer changes a decision, the old statement is replaced, not kept beside the new one.

**Why this priority**: Without it, Stories 2 and 3 slowly grow cost and contradiction; it can wait until there is stored knowledge to measure.

**Independent Test**: Store the same rule from two reviewer replies in different words and one existing ADR line; confirm one canonical entry remains and an enhanced prompt loads it once. Then reverse the decision and confirm only the new statement is loaded.

**Acceptance Scenarios**:

1. **Given** an existing stored rule, **When** a reply restates it differently, **Then** no second entry is stored.
2. **Given** a fact present in an ADR and a memory, **When** the context is loaded, **Then** it is loaded once.
3. **Given** a reviewer reply that reverses a stored decision, **When** processed, **Then** the old statement is replaced and flagged as changed.
4. **Given** a long reviewer reply, **When** stored, **Then** only the concise rule (and optional example) is kept.

---

### User Story 5 - Evals for the validator's prompt (Priority: P5)

The validator's prompt is strong and verified by evals covering three behaviours: answering questions, improving the prompt, and storing observations. Each eval has recorded inputs and expected outcomes, and a change to the validator's prompt is accepted only when the evals do not regress.

**Why this priority**: Evals protect Stories 1–4 during tuning and before any move to the backend; they are most useful once each behaviour exists.

**Independent Test**: Run the eval set against the current prompt; confirm a score per behaviour. Weaken the prompt on purpose and confirm the affected behaviour's score drops and the change is rejected.

**Acceptance Scenarios**:

1. **Given** the eval set, **When** it runs, **Then** it reports a result for answering, prompt improvement and storing separately.
2. **Given** a prompt change that lowers any behaviour's result below its baseline, **When** evals run, **Then** the change is reported as a regression.
3. **Given** a real reviewer correction (prediction vs reply), **When** added to the eval set, **Then** later runs include it.

---

### Edge Cases

- Sources contradict each other (an old ADR vs a newer reviewer reply): the newest reviewer statement wins, and the conflict is shown.
- The reviewer's reply contradicts the validator's earlier stored knowledge: the reply wins and replaces it (Story 4).
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
- **FR-002**: Validator MUST answer an agent's question from the active spec and its resources, ADRs, memories and documents before the reviewer is asked (Rules: Sources).
- **FR-003**: Validator MUST keep the active spec's ultimate goal (Goal.md) in view for every answer.
- **FR-004**: Validator MUST produce an answer as close as possible to the reviewer's own, plus observations, a summary and the impact.
- **FR-005**: Validator MUST say when no source supports an answer instead of guessing.
- **FR-006**: After a reviewer message, System MUST send the previous agent response and the reviewer's reply to the validator FIRST.
- **FR-007**: Validator MUST compare the reviewer's reply with its prediction and record the difference.
- **FR-008**: Validator MUST extract knowledge, rules, instructions and goals from reviewer replies and store them with the related spec, story or task, preferring memories over new files; examples MAY be captured.
- **FR-009**: Validator MAY add to the reviewer's prompt the context to load; the reviewer MUST be able to see and remove additions.
- **FR-010**: Stored knowledge MUST be deduplicated and concise; the same fact MUST NOT be loaded in different forms.
- **FR-011**: A reviewer decision that reverses a stored one MUST replace it.
- **FR-012**: Validator responses MUST be visible in the UI, using the same shared components that show agent responses and observations elsewhere.
- **FR-013**: Validator cost (input, output, reasoning, cache, cost) MUST count in the shared usage banner.
- **FR-014**: The validator MUST begin as a simple observer (a tool backed by an agent run); the interface seen by agents and the UI MUST NOT change when it later moves to the backend.
- **FR-015**: The validator's prompt MUST be verified by evals for answering questions, improving the prompt and storing observations.
- **FR-016**: Secrets MUST never reach the validator, its storage, its UI output or its cost records.
- **FR-017**: A validator failure MUST NOT block the agent or reviewer flow and MUST be visible.
- **FR-018**: Validator output MUST be advisory; it MUST NOT approve gates or trigger destructive actions on the reviewer's behalf [NEEDS CLARIFICATION: may the validator's answer be delivered straight to the agent without the reviewer seeing it first? Options: A) never, reviewer sees every answer before the agent acts; B) only above a confidence threshold the reviewer sets; C) always for questions answered from Rules.md, advisory otherwise].

### Open Questions

- **FR-019**: System MUST observe [NEEDS CLARIFICATION: which responses are observed to control cost? Options: A) every response; B) only responses containing a question or decision; C) every response, with a cheap check first that skips pure progress updates].
- **FR-020**: System MUST keep stored knowledge for [NEEDS CLARIFICATION: when does stored knowledge expire or get reviewed? Options: A) until the reviewer changes it; B) flagged for review when the related spec completes; C) flagged when its source file changes].

### Key Entities

- **Validator response**: the answer, observations, summary, impact, sources used, and cost, linked to the response it observed.
- **Prediction**: the answer the validator expected the reviewer to give, kept to compare with the actual reply.
- **Knowledge item**: a rule, instruction, goal or fact (with optional example) extracted from a reviewer reply and attached to a spec, story or task.
- **Context addition**: a resource named by the validator to load with the reviewer's prompt.
- **Eval case**: a recorded input and expected outcome for answering, prompt improvement or storing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 60% of agent questions are answered by the validator from existing artifacts, with no reviewer involvement (baseline measured in the first week).
- **SC-002**: Repeat instructions from the reviewer (the same rule or requirement stated more than once) fall by at least 70% per week versus the week before launch.
- **SC-003**: For answered questions, at least 80% of the validator's answers match the reviewer's reply on the decision made.
- **SC-004**: A fresh agent started on a spec with stored knowledge needs no more than 1 follow-up question for context the reviewer already gave, down from the pre-launch average.
- **SC-005**: Duplicate knowledge items across a spec's stored knowledge stay at 0 on audit, and enhanced prompts load no fact twice.
- **SC-006**: 100% of validator runs show their response in the UI and their cost in the shared banner.
- **SC-007**: Validator cost stays under 10% of the total cost of the agent work it observes.
- **SC-008**: A validator failure delays the agent or reviewer flow by 0 blocking steps in all tested failure cases.
- **SC-009**: Every prompt change passes the three eval sets (answering, improving, storing) with no behaviour below its baseline.

## Assumptions

- The reviewer is the single authority; "as close as possible to the reviewer" means matching his past statements, not correcting them.
- An active spec exists for most work; without one the validator uses repo-wide ADRs and memories only.
- ADRs, memories, Goal.md, Rules.md and spec resources are already readable by the tools; this spec adds no new source type.
- The shared usage banner and shared response and observation components already exist and are reused, not rebuilt (Consistent Experience).
- Moving the validator to the backend and smoothing the process is a later spec, after tuning.
- Per-spec cost and token fields recorded by earlier specs (005) are reused for the validator's cost.
