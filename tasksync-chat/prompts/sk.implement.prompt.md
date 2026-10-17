---
agent: AskAway Build
description: Pitch and implement exactly one Spec Kit task or approved story.
---

# /sk.implement

Require the Decision Register and Cloud Worker Packet. Give the worker only the packet, selected task row, and matching task-details section; never rely on chat history. Follow .specify/templates/tasks-template.md and its story dependencies. Pitch Task/Story, Plan, Value, and Demo unless already approved. Before editing, state the observable assertion, verification command, and exact expected result. Prove execution; zero matched tests is failure.

Check off a task only after its verification passes. At each story Checkpoint, run its Independent Test, prove its Given/When/Then scenarios, and verify its success metrics. [direct-agent-ready] never bypasses approval. Use /sk.check for convergence.
