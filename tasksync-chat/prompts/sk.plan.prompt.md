---
agent: AskAway Build
description: Plan the active Spec Kit feature after resolving required clarifications.
---

# /sk.plan

Require a resolved Decision Register and Cloud Worker Packet usable by a fresh worker without chat history. Name an explicit base commit, tag, or remote ref and exact checkout value; never infer it from feature or branch metadata. Stop on [NEEDS CLARIFICATION], TBD, contradiction, unsupported assumption, or deferred decision. Do not generate tasks.

Follow .specify/templates/plan-template.md. Plan dependencies around user stories and their Given/When/Then scenarios; verify each story's success metrics at its checkpoint. Use /sk.check for the checklist before /sk.tasks.

Steps:
1. Read spec.md, the constitution, and any research. If a [NEEDS CLARIFICATION] remains, stop and route to /sk.check.
2. Write plan.md from .specify/templates/plan-template.md: technical context, constitution check, structure, then research.md, data-model.md, contracts/ and quickstart.md where the template calls for them.
3. Decision Register: one row per technical decision with the options considered, the choice, the reason, who decided (reviewer or agent) and its status. No row may stay open, TBD, or deferred.
4. Cloud Worker Packet: a section a fresh worker can follow without chat history: the goal, the explicit base (commit, tag, or remote ref plus the exact checkout value), the areas to touch, the build and test commands, the constraints, the secrets rule (never put a secret in a packet), and the definition of done.
5. Order the user stories and their dependencies. For each story keep its Given/When/Then scenarios, Independent Test, Checkpoint and success metrics. Name which work can run in parallel.
6. Work beyond the next increment goes under ## Later in plan.md as one-line bullets.
7. Report the files written, the number of Decision Register rows, the base value, and the next steps: /sk.check (checklist) then /sk.tasks.
