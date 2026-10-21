# ADR 0030: AITalk queues messages for the next tool call; OpenCode workers identify themselves through a plugin

- Status: Proposed
- Date: 2026-10-21
- Goal: the AITalk goal in [GOALS.md](../../GOALS.md)
- Supersedes: nothing. It completes spec 003 task A3 and extends R-AITALK-14 (ticks) and R-AITALK-34 (reply wait).

## Context

A message the reviewer types while an agent is running must reach that agent on its next tool call, labelled so the agent does not mistake it for tool output, with ticks that show where it is. A live run with a real cheap model showed that OpenCode workers send no caller identity on MCP calls, so the existing delivery wrapper never saw a worker recipient and nothing was delivered to workers.

## Decision

> When agent asks to call a tool, we should pop all questions from queue and respond with along with actual tool response.(then we should respond back with a double tick) (2026-10-21)

- The recipient's queue is popped once on its next tool call and appended under 'ADDITIONAL MESSAGES FROM THE USER', each item with the original question (`inReplyTo`) when it answers one (R-AITALK-37, R-AITALK-39).
- Ticks: single when queued, double when popped, blue when the recipient posts or its turn or run ends (R-AITALK-36, R-AITALK-38).
- AskAway writes a small OpenCode plugin (`askaway-identity.js`) next to the agent files it already writes. Its `tool.execute.before` hook replaces the `_meta` of `askaway_*` tool calls with the OpenCode session id; the server maps that session to the worker. Identity from the arguments is never trusted beyond that session id, so a model cannot read another worker's queue.
- Real-model checks (`npm run test:live-aitalk`, Luna) cover direction change, question, answer to the agent's question, several queued messages and the Validator (R-AITALK-41).

## Consequences

The plugin file is the only thing AskAway adds to the OpenCode config directory besides its agents; `opencode.json` is never edited. agy and Claude workers have no identity mechanism yet, so queued delivery to them is not covered.
