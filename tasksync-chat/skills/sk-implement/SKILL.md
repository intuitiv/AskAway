---
name: sk-implement
description: "Pitch and implement exactly one Spec Kit task or approved story."
disable-model-invocation: true
---
# /sk.implement

Require the Decision Register and Cloud Worker Packet. Give the worker only the packet, selected task row, and matching task-details section; never rely on chat history. Follow .specify/templates/tasks-template.md and its story dependencies. Pitch Task/Story, Plan, Value, and Demo unless already approved. Before editing, state the observable assertion, verification command, and exact expected result. Prove execution; zero matched tests is failure.

Check off a task only after its verification passes. At each story Checkpoint, run its Independent Test, prove its Given/When/Then scenarios, and verify its success metrics. [direct-agent-ready] never bypasses approval. Use /sk.check for convergence.

Steps:
1. Resolve the task: use $ARGUMENTS, otherwise the next eligible task found as /sk.continue does. Read implementation-log.md first.
2. Pitch it (Task or Story, Plan, Value, Demo) unless the reviewer already approved it, and wait.
3. Delegate the work to a worker with a self-contained packet: the Cloud Worker Packet, the selected task row, its task-details section, the allowed files, the verification command, and the stop condition. The worker never commits; review its diff yourself.
4. Before any edit, state the observable assertion, the verification command, and the exact expected result.
5. Implement with a test written from the caller's point of view, run the verification, and show the real output. Zero tests matched, or a check that did not run, counts as failure.
6. Only then check the task off and append an entry to implementation-log.md: task ID, files changed, the command, its result, and the date.
7. At a story Checkpoint run its Independent Test, prove each Given/When/Then scenario and verify its success metrics. Merge through the spec's one active PR; never open a PR per day.
8. About every couple of minutes, post a short AITalk status using commentary (action aitalk, kind update): what you are doing, what is done, where blocked. At decisions or when reviewer input is needed, ask immediately (kind heads-up), with options and your recommended default; leave waitSeconds at its default. Unless truly blocked, continue with the default; answers arrive in a later tool result under ADDITIONAL MESSAGES FROM THE USER. At turn end, put still-open questions in the single Response Handoff batch and report evidence, next steps and blockers.
