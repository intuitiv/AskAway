# Rules — 005 Spec Kit Guided Flow

Decisions the reviewer stated (2026-09-29 and 2026-09-30). Change a rule only when the reviewer changes it.

## Spec Kit usage
- Use the whole Spec Kit framework, and follow the standard structure of each artifact from `.specify/templates/` (spec `**Status**: Draft` is the acceptance marker).
- Use user stories instead of custom phases and cycles: the standard tasks template already has Setup, Foundational, one phase per `[USn]` (Independent Test + Checkpoint), then Polish. Parallel work uses the standard `[P]` marker. No `CY-NNN`, `PAC`, or `CAC` in new specs.
- Story acceptance is its Given/When/Then scenarios; a story's success metrics are verified after the story is complete.
- All commands are `/sk.*`. Quality gates (clarify, checklist, analyze, converge) all live under ONE command, `/sk.check`, not separate commands.
- Flow: specify → `/sk.check` (clarify) → plan → `/sk.check` (checklist) → tasks → `/sk.check` (analyze) → implement → `/sk.check` (converge).
- Always track the current stage per spec, named as Spec Kit names it. The Specs tab shows the stage's button (plan, tasks, implement…) and `/sk.check` at all times; the matching agent runs for the stage.
- Link all commands so plain text works without Spec Kit.
- `/sk.continue`, `/sk.handoff` and `/pr-daily` are extension flows, not Spec Kit stages, but must stay consistent with the flow.
- Working on a non-active feature is fine; no active-feature guard.

## Delivery and PRs
- One active PR per spec. A story is 3–5 days to a week of work; merge its PR at the story checkpoint, then open a new PR for the rest. Never one PR per day.
- Ultimate goal: features mergeable as soon as possible, smaller tasks, more context, no repeating the same thing again and again, less cost.

## Cloud tasks (GitHub)
- Delegate flagged tasks to the Copilot cloud agent (`speckit.taskstoissues` idea) so work runs while the reviewer is offline. Plan this part very carefully.
- A flagged task has a button to queue it; the extension polls periodically and updates its status.
- Update the same branch (the active PR), not a new branch per task. The model should be selectable.
- The message sent to the cloud agent states the stage, the task and what to do; context is referenced from committed artifacts, not repeated.

## Orchestrator and workers
- Workers keep the main conversation short AND parallelise tasks.
- The orchestrator is a technical manager: it understands Spec Kit, the spec flow, code changes, the repo, the application, and how to split tasks. It could do the job but delegates, knows what each task is and how to do it, and verifies (or has another worker verify) before accepting any change. It is smarter than the reviewer and thinks of what the reviewer did not.
- The orchestrator may use the terminal only for one standalone command; anything needing more commands goes to a `build` worker.
- A `build` worker has the tools of AskAway Build but runs in OpenCode. Two independent tasks may go to two build workers; guard against abuse (at most two at once per track, disjoint files only).
- Workers are not limited to Luna: use Sonnet (or the right tier) when the work needs it.
- A worker that runs longer than 4 minutes must not block the orchestrator: the call returns an ID and the orchestrator checks back later.

## Specs tab and Telegram
- Too many specs in a live workspace: the Specs tab has two switches, **All** (specs other than the active one) and **Completed**.
- Per-spec data (branch, active PR, cost spent, agent time, …) is stored in `.askaway/`, mapped to the spec name, and displayed.
- Telegram status messages carry cost and tokens with the status.
