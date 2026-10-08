# Reviewer requirements, per UI component and feature

Why this exists: the reviewer asked to "capture what I told as requirements for each UI component and feature so that we know what I asked for at all times, so that we don't make it break." Read the matching file before you touch a component, and keep its rows true.

## Files

| File | Covers |
|---|---|
| [chat-banner.md](chat-banner.md) | The shared usage banner (chat, Metrics, Workers): last input, turn output, cache age, turn timer, worker spend |
| [metrics-tab.md](metrics-tab.md) | Metrics tab: scope, turn trace, worker IDs |
| [workers-tab.md](workers-tab.md) | Workers tab: cards, trace, visibility toggle, server controls, cost tips |
| [live-tab.md](live-tab.md) | Commentary tab (once called Live): feed, goal box, turn panes, Telegram mirror |
| [specs-tab.md](specs-tab.md) | Specs tab: stage bar, All/Completed switches, story groups, per-spec facts |
| [settings.md](settings.md) | Settings, switches, permissions, Telegram and routing choices the reviewer set |
| [worker-tool.md](worker-tool.md) | The `worker` tool: actions, router, retirement, cost per run, profiles and tiers, packets, headless pitfalls |
| [orchestrator.md](orchestrator.md) | Orchestrator and AskAway Build behaviour: delegation, parallel lanes, filler work, verification, commentary rules, handoff |
| [telegram.md](telegram.md) | Telegram live status, commentary, cost and tokens, handoff and replies |
| [observability.md](observability.md) | Per-workspace credits, `copilotUsageNanoAiu`, RTK, cache clock, turn budget |
| [speckit-flow.md](speckit-flow.md) | Stages, `/sk.*` commands, `/sk.check`, stories, one active PR, task budget, plain-text routing |
| [cloud-tasks.md](cloud-tasks.md) | Queueing tasks to the GitHub Copilot cloud agent |
| [availability-and-validator.md](availability-and-validator.md) | Planned: overnight and away modes, auto-handoff near 300K, validator agent (all gaps) |
| [side-channel.md](side-channel.md) | Seeing inside running work, nudging it, side questions that do not derail the main agent |
| [efficiency-score.md](efficiency-score.md) | The per-turn efficiency score, where it is shown, and how the benchmark uses it |
| [tools-and-evals.md](tools-and-evals.md) | Why AskAway's own tools exist, and evals for agent and worker prompts and tools |

The ultimate goals behind all rows are in the repo-level [GOALS.md](../../../GOALS.md); decisions are in [docs/adr/](../../../docs/adr/README.md).

## Row format

Every file holds one markdown table with these columns:

`| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |`

- ID: `R-<AREA>-NN`, unique across the whole folder (for example `R-BANNER-01`).
- Reviewer's words: a short real quote with its date (`YYYY-MM-DD`). Never invented.
- Guarded by: a test file plus its EV id, or a backticked `PASS <label>` line for tests without an EV id, or `gap` when no test asserts it.
- Only what the reviewer asked for; no implementation detail.

## Rule for changes

Newest wording wins; superseded rows are kept struck through with the date that replaced them. The reviewer often corrects himself ("train of thought"), so later messages override earlier ones.

## Sources

`.askaway/reviewer-messages.md`, `specs/*/Goal.md`, `specs/*/Rules.md`, `AGENTS.md` (Consistent Experience rule: one shared component per kind of thing, data converted into its input format).

## Check

`node test-requirements-docs.cjs` (in `tasksync-chat/`, part of `npm run test:workers`) fails on a repeated ID, a row without a date, a README index that misses a file, or a cited EV id / PASS label that no `test-*.cjs` contains.
