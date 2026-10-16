# ADR 0025: Team Edit is the member profile; Integrations share one control set

- Status: Proposed
- Date: 2026-10-16
- Goal: G18, G5 in [GOALS.md](../../GOALS.md)
- Supersedes: R-TEAM-20 (Edit with model, thinking and agent-file fields) and the agy-off default of 2026-10-16. Other ADR 0024 rules stand.

## Context

Edit opened the agent prompt, which duplicated the Agent file link. agy shipped switched off, so its models looked gone. Claude joined OpenCode and agy as a subscription the reviewer wants to see.

## Decision

> Edit is supposed to edit profile, like name, pic and so on, but it is opening agent prompt. We already have Agent file link to open and edit. Edit is to edit profile. (2026-10-16)

> Actually we have claude subscription also. So, include a separate section, like Integrations. For each we have few common items. - enable/disable - recheck/refresh: opencode will be restart server, claude and agy will check if the corresponding things will be working or not - last check when. Do not have specific text like run agy and sign in and so on. a simple refresh button should work for all 3. (2026-10-16)

- Edit opens one shared inline form (name, role, status line, picture) in the product and Storybook; model and thinking stay on the row; Agent file opens the prompt (R-TEAM-48).
- Settings → Integrations shows OpenCode, agy and Claude with the same switch, one Refresh and a last-checked time, no instruction text (R-SETTINGS-15). OpenCode's Refresh is the confirmed server restart. agy ships on; Claude ships off and is a status only.

## Consequences

Member overrides and pictures live in `~/.askaway/team/` and `~/.askaway/profile/avatars/`, never in the repo or the package.
