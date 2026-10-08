# Architecture Decision Records

Each ADR records a decision **the reviewer stated**, quoted from his own messages. It is not a
description of what the code does: requirements stay when the implementation changes.
The goals behind them are in [GOALS.md](../../GOALS.md).

## Rules
- The Decision section quotes the reviewer verbatim, with the date of the message.
- Agents write `Status: Proposed`. Only the reviewer moves an ADR to Accepted, Rejected or Superseded.
- A later message that changes a decision gets a new ADR that supersedes the old one; the old one is kept.
- No implementation detail in a Decision: no code file names, config keys or enums.
- Check: `node tasksync-chat/test-goals-docs.cjs` (part of `npm run test:workers`).

## Index

| ADR | Decision | Goal | Status |
|---|---|---|---|
| [0001](0001-spec-kit-is-mandatory-and-invisible.md) | Spec Kit is mandatory and invisible; plain dictation drives the whole flow | G1, G2 | Proposed |
| [0002](0002-every-ask-is-a-tracked-task.md) | Every ask is a tracked task; nothing is silently dropped | G3 | Proposed |
| [0003](0003-ask-questions-in-one-batch.md) | Questions go to the reviewer in one batch | G4 | Proposed |
| [0004](0004-delegate-to-reusable-parallel-workers.md) | Delegate to reusable workers and run non-functional work in parallel | G5 | Proposed |
| [0005](0005-keep-warm-workers-alive.md) | Keep warm workers alive with a cheap ping so their context is reused | G5 | Proposed |
| [0006](0006-observability-of-every-turn-and-worker.md) | Every turn and worker shows cost, tokens, cache, requests and score | G6 | Proposed |
| [0007](0007-telegram-is-a-remote-control.md) | Telegram mirrors VS Code and can reply to it | G7 | Proposed |
| [0008](0008-commentary-narrates-the-agent.md) | Commentary narrates what the agent does and where it is blocked | G8 | Proposed |
| [0009](0009-cloud-tasks-on-demand.md) | Cloud tasks run on demand, at story or task level, and notify when done | G9 | Proposed |
| [0010](0010-validator-agent-learns-the-reviewer.md) | The validator learns the reviewer in beta, then answers for him when live | G10 | Proposed |
| [0011](0011-availability-decides-when-validator-takes-charge.md) | The reviewer's availability decides when the validator takes charge | G11 | Proposed |
| [0012](0012-side-channel-to-running-work.md) | A side channel shows running work, nudges it, and takes side questions | G12 | Proposed |
| [0013](0013-efficiency-score-is-cost-to-work.md) | The efficiency score is cost to work, outcome-independent, always high | G13 | Proposed |
| [0014](0014-own-tools-prompts-and-evals.md) | Own tools cut cost and add control; prompts and tools have evals | G14 | Proposed |
| [0015](0015-command-surface.md) | The `/sk.*` and recurring commands are the command surface | G15 | Proposed |
| [0016](0016-consistent-experience.md) | One shared component per kind of thing, for a consistent experience | G16 | Proposed |
