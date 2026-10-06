# AskAway Constitution

Every principle below is already stated in `AGENTS.md` or `.github/copilot-instructions.md`; each cites its source. Nothing here is new policy.

## Core Principles

### I. Agent Owns the Repo; Tests From the Caller's View
The agent owns code organisation, maintenance, tests, skills, prompts and docs. The reviewer uses what is built here daily, so a regression breaks their work elsewhere. Keep the tree organised, remove dead code you introduce, leave no scratch files. Every feature ships a test written from the caller's view; `npm run test:workers` (in `tasksync-chat/`) stays green; deploy only after tests pass; commit focused checkpoints.
Source: `AGENTS.md` § Ownership.

### II. Consistent Experience (top priority)
Consistency across tabs outranks every other UI concern. Before building any UI piece, find and reuse the existing component that shows the same kind of thing (trace, usage banner, toggle, badge, feed). Convert new data into that component's input format at the data boundary; the component stays one shared pure render block. Ordering, expand/collapse, colours, labels and switches behave the same everywhere. Tests assert the reuse.
Source: `AGENTS.md` § Consistent Experience.

### III. Worker Runtime Boundary
The main orchestrator runs in native VS Code Copilot Chat; async workers may run as named OpenCode sessions. OpenCode owns its worker conversation UI, transcript, tool execution and approval prompts; AskAway shows status and observability and opens the live conversation, and does not reimplement or mirror it. One shared local OpenCode server per workspace, never one per worker.
Source: `AGENTS.md` § Worker Runtime Boundary.

### IV. Shared Tools at the MCP Boundary
Worker tools are exposed through the existing AskAway MCP service or a local broker, not by passing VS Code `LanguageModelChatTool` objects across the process boundary. A new tool defines its policy, input/output contract, observability event and secret handling once at that boundary; VS Code-only tools use an adapter behind it.
Source: `AGENTS.md` § Shared Tools.

### V. No Secrets in Transit
Never send secrets through worker messages, MCP arguments, transcripts or telemetry.
Source: `AGENTS.md` § Hooks and Observability.

### VI. Per-Workspace Observability
Observability is per workspace; never aggregate logs across unrelated workspaceStorage folders. Credit totals are recomputed from all readable current-workspace Copilot `main.jsonl` files, skipping malformed lines. Worker tool and lifecycle events and OpenCode `step_finish` token/cache/cost fields are recorded by worker ID and session ID.
Source: `.github/copilot-instructions.md` § Observability Rules; `AGENTS.md` § Hooks and Observability.

### VII. RTK Savings Are Not Copilot Credits
RTK token savings (`rtk gain --daily --format json`) are separate from Copilot credits (`copilotUsageNanoAiu`); never count one as the other. Prefix eligible simple commands with `rtk ` when `~/.askaway-rtk-enabled` exists; never wrap compound commands.
Source: `.github/copilot-instructions.md` § Observability Rules, § RTK.

### VIII. Portable Worker Profiles
Worker profiles are portable specifications (purpose, model, thinking variant, prompt, MCP tool policy, file scope, stop condition, evidence contract). Native VS Code and OpenCode agent definitions are separate adapters of the same profile; their formats and approval behaviour are not assumed interchangeable.
Source: `AGENTS.md` § Worker Profiles.

## Additional Constraints

- Build and deploy steps, and "reload the window" after deploy, follow `.github/copilot-instructions.md` § Build & Deploy AskAway; run `node --check media/webview.js` after editing it.
- UI pieces are testable as pure render blocks and reviewable in Storybook (`AGENTS.md` § Ownership).

## Development Workflow

Spec Kit artifacts follow `specs/005-speckit-guided-flow/Rules.md`: user stories instead of custom phases, one active PR per spec, reviewer approves at the what, how and done gates. Plans run the Constitution Check against the principles above.

## Governance

This constitution restates `AGENTS.md` and `.github/copilot-instructions.md`; when they change, amend this file in the same commit. Amendments need reviewer approval and a version bump: MAJOR removes or redefines a principle, MINOR adds or materially expands one, PATCH clarifies wording. Every plan's Constitution Check and every review verifies compliance; runtime guidance stays in the two source files.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
