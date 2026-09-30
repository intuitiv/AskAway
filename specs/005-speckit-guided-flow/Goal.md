# Goal — 005 Spec Kit Guided Flow

"I transfer context and what I need to build to you, and the agent should do most of the work with less cost." Spec Kit is the tool for that: the extension drives the flow so the reviewer does not have to know it.

## Outcomes that define done
- **Mergeable as soon as possible.** Small tasks, enough context in the artifacts, and nothing explained twice: context is written once in spec, plan and constitution and reused by every worker.
- **The reviewer only does three things.** Say what they want in plain words, answer the few questions asked, and approve at three gates: what (spec), how (plan), done (converge + readiness). The extension decides everything else.
- **Plain text works without Spec Kit knowledge.** Every command is linked, so a normal message is routed to the right stage; `/sk.*` stay as shortcuts.
- **The stage is always known.** Each spec tracks its current stage by Spec Kit's names, and the Specs tab suggests the next step with its button plus `/sk.check`.
- **Stories are the unit of work.** Standard user stories replace custom phases and cycles; each story is 3–5 days to a week, verified by its Independent Test and success criteria, and merged through one active PR.
- **Work continues while the reviewer is offline.** Flagged tasks are queued to the GitHub Copilot cloud agent on the active PR's branch, polled, and shown with their status. The reviewer is counting on this; plan it carefully.
- **The orchestrator is a technical manager, better than the reviewer at it.** It knows Spec Kit, the repo, the application and how to split work; it thinks of what the reviewer did not; it delegates and parallelises, and accepts a change only after verification.
- **Per-spec facts are tracked and shown.** Branch, active PR, cost spent and agent time are stored per spec in `.askaway/`, mapped by spec name, and displayed.
