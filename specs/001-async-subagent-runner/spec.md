# Async Sub-agent Runner

Track a sub-agent the way the `gradle` tool tracks a build: wrap it in a subprocess we own,
return a handle immediately, and let the main agent poll **the process**, not the sub-agent.

## Problem

`runSubagent` blocks its caller for the entire child run. While it is in flight the main agent
can do nothing — it cannot start a second exploration, cannot answer a question, cannot make an
unrelated edit. Sub-agents also start cold every time, so none of the parent's accumulated
context or prompt-cache prefix is reused.

## Goals

- **Fan-out.** Launch several sub-agents at once instead of one after another.
- **Progress, not just a result.** Report what the child is doing while it works, the way a
  Gradle build reports completed and running tasks.
- **Session reuse.** Dispatch repeatedly into a warm session so the child is not cold-started.
- **Cost visibility.** Keep per-child AIU attribution working.

## Non-goals

- Making the sub-agent itself return early. The child runs to completion; only the *tool call*
  returns early.
- Replacing `runSubagent` for the simple one-shot case.
- Unattended auto-approval of tool permissions.

## Shape

`start` spawns an agent CLI as a child process and returns `{runId}`. `status` reports
RUNNING/SUCCESS/FAILED plus progress parsed from the child's own debug log. `wait` blocks until
done, with a timeout. `logs` returns the child's output. `stop` kills it.

Progress comes from the log the child already writes — the same `main.jsonl` /
`runSubagent-*.jsonl` format the budget hook already parses — so no new protocol is needed
between parent and child.

## Open questions

1. Which runtime hosts the child? Copilot CLI, Claude Code headless, or an existing
   `tasksync-opencode` session? The last already has session management.
2. Polling costs a request each time and breaks prompt-cache reuse. Is the rule
   "start many, then one blocking wait-for-all" rather than "start and poll"?
3. A headless child cannot answer an Allow/Allow All prompt. Does it run with a restricted
   read-only toolset, or does it block invisibly?
4. Custom runners do not write `runSubagent-*.jsonl`, which the budget hook sums. What replaces
   that for cost attribution?
5. Does session reuse survive a parent reload, or is a warm session per-window only?

## Value test

The idea pays for itself only if the parent has real work during the child's run. Fan-out and
session reuse pass that test on their own; "trigger and continue" does not, because the parent
usually delegated precisely because it needs the answer.
