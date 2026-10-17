---
name: sk-handoff
description: "Print a no-tool resume checkpoint."
disable-model-invocation: true
---
# /sk.handoff

Use only facts already established in this conversation. Do not call tools or edit files.

Print a checkpoint someone can paste into a new chat and continue from:
- Active spec and stage.
- Completed: what was finished, with the latest verification command and its result.
- Unfinished: open tasks or steps, in order, with what blocks each.
- Decisions and reviewer answers that must not be asked again.
- Resume: one command to run first (for example /sk.continue).

If a fact is not established, write "unknown" instead of guessing.
