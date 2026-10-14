# AskAway and OpenCode Compatibility

What the reviewer wants, in one place: [GOALS.md](GOALS.md) (goals), [docs/adr/](docs/adr/README.md)
(his decisions), [tasksync-chat/docs/requirements/](tasksync-chat/docs/requirements/README.md) (testable rows).
Read GOALS.md before starting any work here.

## Never break a requirement (reviewer, 2026-10-08)

"Update current repos AGENTS.md file or anything so that we dont break any requirements."
- Before changing a feature or UI component, read its goal in GOALS.md, its ADR and its requirement rows.
  The change must keep every row true.
- A change that contradicts a row or an ADR needs the reviewer's new words first; never rewrite a requirement to
  fit the code. When he gives them: add them verbatim with the date to GOALS.md section 4, strike the old row and
  add the new one, and write a superseding ADR (`Proposed`).
- A new reviewer ask about what he wants gets its requirement row (quote + date) in the same turn; a new goal
  also gets a GOALS.md section and an ADR.
- A row marked `gap` has no test. When you touch that area, add a caller-view test and cite it in the row.
- `npm run test:workers` (in `tasksync-chat/`) must stay green; it runs the docs checks EV-REQUIREMENTS-DOCS and
  EV-GOALS-DOCS.
- These documents are the validator's knowledge. The validator is a decisioning engine with memory, not a simple
  memory tool: it decides what the reviewer would decide from GOALS.md, the ADRs, the requirement rows and what it
  learned from his replies. A wrong or stale row becomes a wrong decision, so keep them true, short and quoted.

## Keep the public READMEs current (reviewer, 2026-10-14)

"I think on every update we need to update those files, thats what people see."
- `tasksync-chat/README.md` is the Marketplace page and `README.md` is the repo front page. On every user-visible update,
  update both, `package.json` description/keywords and the CHANGELOG so they show the current product, never legacy AskAway.
- Current motto: spec-based development; OpenCode workers to delegate tasks; the AITalk room; Telegram and Webex
  integration; keep-alive pings, timers, tracing and the other extras. Requirement R-DOCS-01.

## Ownership (reviewer, 2026-09-24)

The agent owns this entire repo: code organisation, maintenance, tests, skills, prompts, and docs.
The reviewer uses what is built here every day to make their own edits, so a regression here breaks
their work elsewhere. Be careful:
- Keep the tree organised and consistent; remove dead code you introduce; no stray scratch files.
- Every feature ships a test from the caller's view; `npm run test:workers` (in `tasksync-chat/`) must stay green.
- UI pieces are testable as pure render blocks and reviewable in Storybook (`tasksync-chat/storybook/`).
- Deploy only after tests pass; commit focused checkpoints.

## Consistent Experience — top priority (reviewer, 2026-09-24)

"If we reuse the same component and send data by converting into single format, we get consistent
experience." Consistency across tabs outranks every other UI concern.
- Before building any UI piece, find the existing component that shows the same kind of thing
  (trace, usage banner, toggle, badge, feed) and reuse it. Never build a second look-alike.
- Convert new data into the existing component's input format at the data boundary; the component
  stays one shared pure render block (e.g. `traceRowsHtml` serves the Metrics trace and the Workers trace).
- Same behaviour everywhere: ordering (newest at the bottom), expand/collapse, colours, labels, switches.
- Tests assert the reuse: the new view's output contains the shared component's output.

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