# ADR 0034: The communication tool is named aitalk

- Status: Proposed
- Date: 2026-10-22
- Goal: G8 and G12 in [GOALS.md](../../GOALS.md)
- Supersedes: nothing. It renames the tool of [ADR 0008](0008-commentary-narrates-the-agent.md); the Commentary tab is already gone.

## Context

The tool was called `commentary` when it fed the Commentary tab. Today agents use it to post status lines, ask questions and reply in AITalk, so the old name misleads.

## Decision

> "commentary seems not apt for the purpose, do you think we can give a better name? We moved away from commentary tab also." (2026-10-22)

Name the communication tool `aitalk` (LM tool `askaway_aitalk`, MCP tool `aitalk`).

## Consequences

Expose one tool only. Keep feed posting (`post`), add `say` and accept the old `aitalk` action as a deprecated alias. Normalize stale worker policy names (`askaway_commentary`) without registering a second tool. Internal commentary storage and historical quotes stay unchanged.
