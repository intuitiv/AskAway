# ADR 0026: Hooks and /sk.* commands work in the Copilot harness

- Status: Proposed
- Date: 2026-10-17
- Goal: G15 in [GOALS.md](../../GOALS.md)

## Context

VS Code 1.140 made the Copilot harness (Copilot SDK, agent host) the default. Three changes broke AskAway:
- It runs `~/.copilot/hooks/*.json` inside the session sandbox when `chat.agent.sandbox.enabled` is on. AskAway's scripts under `~/.askaway` failed with exit 126, and a failed `preToolUse` hook is fail-closed, so every tool call was denied (see the [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)).
- It does not load prompt files, so `/sk.*` prompt files never appear; it loads skills, whose names cannot contain dots (see [Migrate customizations](https://code.visualstudio.com/docs/agent-customization/migrate-customizations)).
- Migrating a profile to it converted prompts to `sk-*` skills and removed the originals, and an earlier cleanup had dropped the extension's installer for them.

## Decision

> Hooks are not working and commands /sk.* are not showing up. Explore and see what we can do. THis happened after recent October VScode update. (2026-10-17)

- Every AskAway Copilot hook command ends with `|| exit 0`, so a script the sandbox cannot start never blocks the agent.
- On activation the extension adds `~/.askaway` (read/write) and the workspace-storage and Copilot session-state folders (read-only) to `chat.agent.sandbox.fileSystem.userConfiguredPaths`, keeping the reviewer's own entries and anything he denied.
- The extension installs `/sk.*` as prompt files (Local harness), `sk-*` skills (Copilot harness: the command is `/sk-plan`, not `/sk.plan`) and Claude commands, and refreshes them on every activation.
- The conversation hooks ship in the package and are installed with the others.

## Consequences

- An AskAway hook can fail quietly in the sandbox; the Output channel logs the grant and the install, and Copilot shows one warning per failed hook.
- The `sk.*` and `sk-*` names are AskAway's; edits to them are overwritten. Other skills and prompts are untouched.
- The sandbox grant lets sandboxed agent commands write `~/.askaway`, where the hook scripts live; the reviewer can deny it in the setting.

## Related
- [Tools and evals requirements](../../tasksync-chat/docs/requirements/tools-and-evals.md)
- [Spec Kit flow requirements](../../tasksync-chat/docs/requirements/speckit-flow.md)
- [ADR 0015: Command surface](0015-command-surface.md)
