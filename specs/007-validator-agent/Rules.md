# Rules — 007 Validator Agent

Decisions the reviewer stated (2026-10-01). Change a rule only when the reviewer changes it.

- Input: any agent or worker response; after a reviewer message, the previous agent response plus the reviewer's reply, sent to the validator FIRST.
- Sources: ADRs, memories, documents, spec resources; most answers should come from the active spec, task or their related resources.
- Every answer keeps the active spec's ultimate goal (Goal.md) in mind.
- Output: an answer as close to the reviewer's as possible, plus observations, summary and impact.
- Storage: knowledge bits, rules, instructions and goals extracted from reviewer messages are stored with the related spec, story or task (memories preferred over new files); deduplicated and concise.
- Strong prompt, verified by evals: answering questions, improving the prompt, storing observations.
- Delivery: start as a simple observer (a tool; behind it an agent run); optimise later.
- UI shows the validator's responses; its cost counts in the shared banner.
