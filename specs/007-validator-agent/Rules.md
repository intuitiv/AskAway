# Rules — 007 Validator Agent

Decisions the reviewer stated (2026-10-01). Change a rule only when the reviewer changes it.

- Input: any agent or worker response; after a reviewer message, the previous agent response plus the reviewer's reply go to the validator alongside the agent flow, never blocking the reviewer's reply (2026-10-07 trial decision supersedes FIRST).
- Sources: ADRs, memories, documents, spec resources; most answers should come from the active spec, task or their related resources.
- Every answer keeps the active spec's ultimate goal (Goal.md) in mind.
- Output: an answer as close to the reviewer's as possible, plus observations, summary and impact.
- Storage: knowledge bits, rules, instructions and goals extracted from reviewer messages are stored with the related spec, story or task (memories preferred over new files); deduplicated and concise.
- Strong prompt, verified by evals: answering questions, improving the prompt, storing observations.
- Delivery: start as a simple observer (a tool; behind it an agent run); optimise later.
- Beta (2026-10-02): "we are in beta phase, I want to see validator response in Commentary before it going to the agent. Once i get confidence we'll link later, with some cautions and all." The validator's answers show in the Commentary tab only; nothing reaches the agent until the reviewer links it.
- UI shows the validator's responses; its cost counts in the shared banner.

## Memory store (2026-10-02)

- Reviewer: "For validator we need a memory store for recording stuff, for that we can use, https://github.com/rohitg00/agentmemory".

## Reviewer decisions (2026-10-07)

- A1: "a separate agentmemory server only for the validator, with auto-forget off". Dedicated validator agentmemory server selected; install approved.
- A4 / FR-006: "Validator for few turns it is more like trial basis. I manually see the quality of validator how it is responding on behalf of me." Validator runs alongside, never blocks the reviewer's reply, and remains Commentary-only in beta.
- Agent memory access: "if it uses as memory store, agent should be able to call it for memory needs". Agents can query the same memory store; this does not deliver validator outputs to agent channels.
- A11 / baselines: "I'll manually see them few days". Manual quality review; no automated baseline in beta.
- A5 / FR-011 / FR-020: "keep older versions also, hide them". Superseded versions are retained but hidden from recall and default views; a changed flag is informational, not an automatic review request.
- A10 / A15: reviewer said "Sure" to drafting missing success criteria and observed/skipped definitions. Drafted by agent, reviewer to approve: 0 validator outputs reach any agent channel; 0 seeded secrets reach any sink. Observed = response passed through the cheap check; skipped = checked but not sent to the answering validator because it is pure progress; skips counted in Commentary stats.
- A12 / D22: "memories md files are source of truth, we can seed memories built so far from them, but we dont use or update them going forward... We are changing memory solution and at the same time, we are using the same for validator also." Assumption and FR draft: agentmemory replaces VS Code `/memories` md files for agents; existing md files seed it once and are then frozen (not used or updated going forward).
- OPEN: whether agents and validator share one server. The shared-memory direction in D22 conflicts with A1's "only for the validator"; the migration decision is recorded, but server topology still needs reviewer clarification.
