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
| [0001](0001-spec-kit-is-mandatory-and-invisible.md) | Spec Kit is mandatory and invisible; plain dictation drives the whole flow | G1, G2 | Accepted |
| [0002](0002-every-ask-is-a-tracked-task.md) | Every ask is a tracked task; nothing is silently dropped | G3 | Accepted |
| [0003](0003-ask-questions-in-one-batch.md) | Questions go to the reviewer in one batch | G4 | Accepted |
| [0004](0004-delegate-to-reusable-parallel-workers.md) | Delegate to reusable workers and run non-functional work in parallel | G5 | Accepted |
| [0005](0005-keep-warm-workers-alive.md) | Keep warm workers alive with a cheap ping, at most 4 per worker, so their context is reused | G5 | Accepted |
| [0006](0006-observability-of-every-turn-and-worker.md) | Every turn and worker shows cost, tokens, cache, requests and score | G6 | Accepted |
| [0007](0007-telegram-is-a-remote-control.md) | Telegram mirrors VS Code and can reply to it | G7 | Accepted |
| [0008](0008-commentary-narrates-the-agent.md) | Commentary narrates what the agent does and where it is blocked | G8 | Accepted |
| [0009](0009-cloud-tasks-on-demand.md) | Cloud tasks run on demand, at story or task level, and notify when done | G9 | Accepted |
| [0010](0010-validator-agent-learns-the-reviewer.md) | The validator is a decisioning engine with memory: it learns the reviewer in beta (agent-called tool first), then answers for him when live | G10 | Accepted |
| [0011](0011-availability-decides-when-validator-takes-charge.md) | The reviewer's availability decides when the validator takes charge | G11 | Accepted |
| [0012](0012-side-channel-to-running-work.md) | A side channel shows running work, nudges it, and takes side questions | G12 | Accepted |
| [0013](0013-efficiency-score-is-cost-to-work.md) | The efficiency score is cost to work, outcome-independent, always high | G13 | Accepted |
| [0014](0014-own-tools-prompts-and-evals.md) | Own tools cut cost and add control; prompts and tools have evals | G14 | Accepted |
| [0015](0015-command-surface.md) | The `/sk.*` and recurring commands are the command surface | G15 | Accepted |
| [0016](0016-consistent-experience.md) | One shared component per kind of thing, for a consistent experience | G16 | Accepted |
| [0017](0017-never-break-a-requirement.md) | Never break a stated requirement; the validator decides from these documents | G17 | Proposed |
| [0018](0018-webex-replaces-telegram.md) | Webex replaces Telegram as the remote channel, with the same features | G7 | Accepted |
| [0019](0019-cloud-task-done-shares-pr-link.md) | A finished cloud task shares its PR link; the reviewer finishes it by hand | G9 | Proposed |
| [0020](0020-webex-browser-oauth-manual-callback.md) | Webex browser OAuth uses the confirmed localhost redirect and manual return through a local masked prompt | G7 | Proposed |
| [0021](0021-aitalk-actor-framework.md) | AITalk is an actor framework; the chat widget only renders data and emits intents | G8 | Proposed |
| [0022](0022-cloud-change-merged-tested-pushed.md) | A cloud change is merged locally, tested, then pushed; supersedes ADR 0019's no-push rule | G9 | Proposed |
| [0023](0023-agy-first-team-members.md) | agy runtime before Team; member rows, tasks, assignment-time presence; supersedes 0021 presence rule only | G18, G5, G8 | Proposed |
| [0024](0024-team-storybook-review-and-model-comparison.md) | Existing Storybook format, simple names/profiles and collapsible tasks; review one prompt before comparing three models | G18, G5, G13 | Proposed |
| [0025](0025-team-edit-is-profile-and-integrations.md) | Team Edit is the member profile; Integrations (OpenCode, agy, Claude) share switch, Refresh and last-checked | G18, G5 | Proposed |
| [0027](0027-team-turn-members-and-shared-model-choice.md) | Team shows members by Turn spend; one shared model and thinking choice; sign-in and Grafana | G18, G5 | Proposed |
| [0028](0028-team-compact-cards.md) | Team compact vibrant cards, rotating status, Show all toggle | G18 | Proposed |
| [0029](0029-team-one-edit-button.md) | Team cards: one Edit button, Month under Turn, global availability seed | G18 | Proposed |
| [0026](0026-hooks-and-sk-commands-in-copilot-harness.md) | Hooks fail open and get sandbox grants; /sk.* ship as prompt files (Local), sk-* skills (Copilot) and Claude commands | G15 | Proposed |
