# Rules — 001 Async Sub-agent Runner

Decisions and constraints the reviewer stated. Change a rule only when the reviewer changes it.

## Orchestration
- The orchestrator is the reviewer's proxy: it holds the design intent, gotchas, and limits, and delegates. It must not implement.
- Plan as tracks. Run independent tracks in parallel; serialize only on real dependencies.
- Prefer instruct-then-verify: one worker does the work, a different worker verifies it. The orchestrator often never needs the underlying data.
- Keep orchestrator context small at all times. Pulling transcripts, logs, diffs, or file contents into it is a defect.
- Minimize cost creatively. Cheapest capable tier first, escalate only on evidence.
- Collect durable knowledge in the spec (Goal.md, Rules.md, plan, research). Cross-spec principles go in the constitution.

## Runtime
- Exactly one OpenCode server process serves every workspace. Never one server per workspace or per worker.
- Worker profiles are runtime-only (`~/.askaway/worker-profiles/`), never VS Code agents, because VS Code agents are injected into the main agent's input.
- Workers must not prompt for RTK commands, `/tmp` reads and writes, or reads under `~/VSProjects`. Approval prompts break cache timing.
- Reuse existing code before building: `SessionManager`, `apiPluginStats`, `ensureGlobalServer`, OpenCode's native `--session` resume.
- Herdr is deferred. It cannot supply token or cost facts.
- No VS Code or OpenCode subagent tool (`runSubagent`, OpenCode `task`) for the orchestrator or workers. All delegation goes through AskAway workers (reviewer, 2026-09-24).

## Evidence and quality
- Root cause first. Never special-case a scenario to make it pass.
- Every behavior change ships with an end-to-end test written from the caller's view, able to survive an implementation rewrite.
- Every feature is testable, UI included: render logic is a pure block the test runs as-is. The offline gate is `npm run test:workers` (reviewer, 2026-09-24).
- Exit 0 with zero matched tests is a failure. Acceptance needs named evidence.
- Never delete measured metrics (cost, usage, attribution). They are the data used for prediction.
- Name every task with its cycle, for example `T008 (CY-003)`, and always state progress toward completion.

## Process
- Do not stop for decisions when other executable tasks exist. Log the decision and proceed with independent work.
- Goal.md and Rules.md are read once at conversation start and updated only when a goal or rule actually changes.

## Commentary and focus (reviewer, 2026-09-24)
- The orchestrator narrates every decision, question, and blocker in 10-20 words. Short and plain, never detailed.
- Commentary is a tool call, not prose (reviewer, 2026-09-24): prose also renders in VS Code chat, cannot be extracted reliably, and would show twice.
- The main goal is what the reviewer writes in the goal box. Without one, it is the active spec's current cycle. A side question gets a brief answer, then work returns to the main goal.
- Goal and uncleared commentary carry into the next conversation; the reviewer clears them explicitly.
- Authoring skills are the `launchpad-build-*` set from `~/VSProjects/vibecoding/build/skills-bundle`, not the schema-skills template.
- Adoption auth refreshes with `pega-auth-adoption --headless`; tenant and env iso come from `~/.config/vibecoding/credentials.json`.

## Compaction ideas the reviewer raised (not yet decided)
- Record each turn's user message plus final assistant message as a compact conversation (built: `~/.askaway/compact-chats/`).
- Hand the last turn's handoff to a fresh conversation instead of relying on native compaction.
- Goal and commentary feed as the carry-over payload. Detailed design belongs to Spec 004.
