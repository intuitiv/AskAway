# AskAway and OpenCode Compatibility

## Ownership (reviewer, 2026-09-24)

The agent owns this entire repo: code organisation, maintenance, tests, skills, prompts, and docs.
The reviewer uses what is built here every day to make their own edits, so a regression here breaks
their work elsewhere. Be careful:
- Keep the tree organised and consistent; remove dead code you introduce; no stray scratch files.
- Every feature ships a test from the caller's view; `npm run test:workers` (in `tasksync-chat/`) must stay green.
- UI pieces are testable as pure render blocks and reviewable in Storybook (`tasksync-chat/storybook/`).
- Deploy only after tests pass; commit focused checkpoints.

## Worker Runtime Boundary

AskAway's main orchestrator runs in native VS Code Copilot Chat. Async workers may run as named
OpenCode sessions. AskAway maps its stable worker ID to the OpenCode session ID, shows worker status
and observability in the VS Code Workers view, and opens the live worker conversation in OpenCode.

OpenCode owns its worker conversation UI, transcript, tool execution, and approval prompts. Do not
reimplement that UI or mirror approval controls in AskAway unless a later requirement explicitly
changes this boundary.

Use one shared local OpenCode server per workspace. A worker command and its viewer must attach to that
same server for live conversation updates. Do not create one server per worker.

## Shared Tools

Use the existing AskAway MCP service as the portable worker tool surface for OpenCode and Claude Code.
Expose shared capabilities through stable MCP tools or a local AskAway broker, not by passing VS Code
extension `LanguageModelChatTool` objects across the process boundary.

When adding a tool, define its policy, input/output contract, observability event, and secret handling
once at the shared boundary. Existing VS Code-only tools may use an adapter behind that boundary.

## Hooks and Observability

Native Copilot hooks are host-specific and do not automatically fire for OpenCode workers. Reuse their
policy and observability behavior through an AskAway worker-hook pipeline driven by OpenCode lifecycle
events: worker start, message update, before tool, after tool, checkpoint, stop, and error.

Capture OpenCode `step_finish` token fields by worker and session: input, output, reasoning, cache
read/write, and cost. Record tool and lifecycle events by worker ID and OpenCode session ID. Never
send secrets through worker messages, MCP arguments, transcripts, or telemetry.

## Worker Profiles

Worker profiles are portable specifications: purpose, model, thinking variant, prompt, MCP tool policy,
file scope, stop condition, and evidence contract. Native VS Code agent definitions and OpenCode agent
definitions are separate adapters for the same profile; do not assume their configuration formats or
approval behavior are interchangeable.

## Proven OpenCode Contract

With GitHub Copilot OAuth, OpenCode accepts `github-copilot/gpt-5.6-luna` and emits JSON events with a
stable `sessionID`, streamed text, and `step_finish` token/cache/cost fields. `opencode run --agent
explore` falls back to the primary `build` agent because `explore` is a subagent; create a primary
AskAway worker profile before relying on that option.