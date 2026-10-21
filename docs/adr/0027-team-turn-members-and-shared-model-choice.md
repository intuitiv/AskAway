# ADR 0027: Team shows members by Turn spend; model and thinking are one shared choice

- Status: Proposed
- Date: 2026-10-21
- Goal: G18, G5 in [GOALS.md](../../GOALS.md)
- Supersedes: R-TEAM-37 (header row), R-TEAM-45 (every member always visible), R-WORKERS-07/08 (Show completed) and R-WTOOL-09 (archive prune). Other ADR 0024 and 0025 rules stand.

## Context

Show completed, archive and reload sat in a Team header row and did little. Every roster member always showed, most at $0, and every member showed the same model because a row ignored its own. A model change in one workspace stayed in that browser state. agy lists its thinking inside the model name and the thinking dropdown asked again. Worker Turn cost was $0 because the Team state was projected without the turn start.

## Decision

> instead of showing all members, can we show members whose Turn is non Zero? And Validator will be shown always. (2026-10-21)

> When i update model for one member from one workspace, it is not reflecting in another workspace. (2026-10-21)

- Team has no header row. Priya and the main agent always show; others show with Turn spend, a shown task or a working status (R-TEAM-50, R-TEAM-52).
- A member's model and thinking are saved once in `~/.askaway/team/members.json` and read by every workspace, by that member's worker tasks and by Priya (R-TEAM-53).
- The Model dropdown lists each model once, grouped by OpenCode, agy and Claude, thinking stripped; Thinking lists its efforts; agy models are saved with the effort in the name (R-TEAM-54).
- A signed-out agy or Claude shows "Sign in required" with a Sign in button (R-TEAM-55). Build is Sonnet or Argon; Grafana tools go to the test, perf and developer profiles (R-TEAM-56).
- Turn cost reads the ledger since the turn started for every workspace (R-TEAM-51).

## Consequences

The runtime `archive()` and its message are removed; ledger archive records from older versions are still honoured on rehydrate. Claude has no model listing command, so its three aliases stay a fixed list.
