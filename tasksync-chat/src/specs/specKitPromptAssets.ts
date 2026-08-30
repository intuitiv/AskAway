export const SPEC_KIT_PROMPTS: Record<string, string> = {
    'sk.new.prompt.md': `---
agent: AskAway Build
description: Create a new numbered Spec Kit feature without losing the previous active feature.
---

# /sk.new

Create a new spec from \`$ARGUMENTS\` by invoking \`speckit.specify\` with a hard four-minute budget. Remember the current \`.specify/feature.json\` first. Require the next unused feature number, never renumber existing specs, and point \`feature.json\` at the new spec after creation. Report the new path, open clarifications, and previous active feature. Do not plan or implement.
`,
    'sk.start.prompt.md': `---
agent: AskAway Build
description: Select a numbered Spec Kit feature as active and summarize its current state.
---

# /sk.start

Resolve feature \`$ARGUMENTS\` under \`specs/\`, update \`.specify/feature.json\`, then read its spec, plan, compact task index, latest implementation-log row, and selected task detail only when needed. Report status and pitch no work unless the user asked to continue.
`,
    'sk.continue.prompt.md': `---
agent: AskAway Build
description: Resume the active Spec Kit feature and pitch its next eligible task.
---

# /sk.continue

Optionally select feature \`$ARGUMENTS\`. Read the implementation log before task order. Exclude manual, reviewer-owned, blocked, moved and deferred work; require completed prerequisites; prefer non-mesh work; use file order only as a tie-breaker. If \`task-details.md\` exists, read only the selected \`## TNNN\` section. Pitch exactly one task with Task, Plan, Value and Demo, then stop.
`,
    'sk.plan.prompt.md': `---
agent: AskAway Build
description: Plan the active Spec Kit feature after resolving required clarifications.
---

# /sk.plan

Operate on \`.specify/feature.json\`. If any \`[NEEDS CLARIFICATION\` remains or scope contradicts itself, stop and offer \`speckit.clarify\`. Otherwise invoke \`speckit.plan\` with \`$ARGUMENTS\` and a hard four-minute budget. Report generated artifacts and unresolved decisions. Do not generate tasks.
`,
    'sk.tasks.prompt.md': `---
agent: AskAway Build
description: Generate a compact executable tasks.md and navigable task-details.md for the active spec.
---

# /sk.tasks

Invoke \`speckit.tasks\` for the active feature with a hard four-minute budget. Keep \`tasks.md\` as the authoritative compact index, normally under 500 lines: every checkbox row has ID, labels, concrete action, primary file path, and short demo reference; do not place multi-paragraph rationale beneath task rows. Put long context, alternatives, evidence and full demos in \`task-details.md\` under stable \`## TNNN — Short title\` headings with Context, Scope, Dependencies and Demo subsections. Link rows to details when present. Order no-network work first, group useful cycles, and do not retrofit existing tasks unless asked. Report counts and files; do not implement.
`,
    'sk.implement.prompt.md': `---
agent: AskAway Build
description: Pitch and implement exactly one Spec Kit task or one approved cycle.
---

# /sk.implement

Resolve \`$ARGUMENTS\` as one TNNN task or CY-NNN cycle. Read \`tasks.md\`; if \`task-details.md\` exists, read only matching task sections. Pitch Task/Cycle, Plan, Value/Schedule and Demo, then wait for approval unless already approved in this conversation. Invoke one \`speckit.implement\` worker per task with “Execute ONLY task TNNN”, root-cause-first and hard four-minute constraints. Verify, demo, tick the task, append \`implementation-log.md\`, and preserve unrelated changes.
`,
    'sk.check.prompt.md': `---
agent: AskAway Build
description: Diagnose whether the active spec needs clarification, consistency analysis, or convergence.
---

# /sk.check

Inspect active spec artifacts. Route open clarifications to \`speckit.clarify\`, artifact contradictions to \`speckit.analyze\`, and code/task drift to \`speckit.converge\`. \`$ARGUMENTS\` may force \`analyze\`. Use a hard four-minute budget and report exactly what changed; analysis itself is non-destructive.
`,
    'sk.handoff.prompt.md': `---
agent: AskAway Build
description: Print a cheap resume checkpoint using only facts already in this conversation.
---

# /sk.handoff

Use only facts already established in this conversation. Do not call tools, read files, run Git or tests, edit files, update task or implementation logs, write memory, audit, or commit. Report the active spec if known, completed result, latest known verification, unfinished work, and one exact resume command. Say unknown instead of investigating missing state.
`,
    'sk.review.prompt.md': `---
agent: AskAway Build
description: Review one spec's measured cost, AI time, requests, conversations, branches, outcomes, and lessons.
---

# /sk.review

Review spec \`$ARGUMENTS\` without changing product code. Read its spec, plan, compact tasks, relevant task details, implementation log, PR evidence and Git history. Read AskAway's workspace spec-cost map and only conversation logs attributed to this spec. Break dollars, AI-active time and requests down by new, plan, tasks, check, implement, review and other stages, then compare them with delivered outcomes. Separate productive effort, necessary research, rework and dead ends; identify root causes and repository knowledge worth saving. Never treat lower cost alone as higher value.
`,
};

const CLAUDE_HEADER = `---
disable-model-invocation: true
---
`;

export const CLAUDE_SPEC_KIT_COMMANDS: Record<string, string> = {
    'sk.new.md': `${CLAUDE_HEADER}
Create a new numbered feature from $ARGUMENTS under specs/. Preserve the previous .specify/feature.json value until creation succeeds. Write spec.md with an explicit one-line **Purpose** field, mark genuine unknowns [NEEDS CLARIFICATION], then activate the new feature. Do not plan or implement.
`,
    'sk.start.md': `${CLAUDE_HEADER}
Select feature $ARGUMENTS in .specify/feature.json. Read its spec, plan, compact task index, latest implementation-log row, and only relevant task-details.md sections. Report current state without implementing.
`,
    'sk.continue.md': `${CLAUDE_HEADER}
Resume feature $ARGUMENTS, or the active feature when omitted. Read implementation-log.md before tasks.md. Exclude manual, reviewer-owned, blocked, moved and deferred work; require completed prerequisites; prefer non-mesh work. Read only the selected task-details.md section. Pitch exactly one task with Task, Plan, Value and Demo, then wait for approval.
`,
    'sk.plan.md': `${CLAUDE_HEADER}
Plan the active feature from spec.md. Stop on unresolved [NEEDS CLARIFICATION] or contradictory scope. Produce the standard Spec Kit planning artifacts and report unresolved decisions. Do not generate tasks or implementation.
`,
    'sk.tasks.md': `${CLAUDE_HEADER}
Generate tasks for the active feature. Keep tasks.md as an independently executable index, normally under 500 lines: each checkbox row needs ID, labels, action, primary file path, dependencies and a short demo. Put long rationale, alternatives, evidence and expanded demos in task-details.md under stable ## TNNN headings. Do not implement.
`,
    'sk.implement.md': `${CLAUDE_HEADER}
Implement exactly task or cycle $ARGUMENTS. Read tasks.md and only matching task-details.md sections. Pitch Task/Cycle, Plan, Value and Demo unless already approved in this conversation. Fix the owning rule, preserve unrelated changes, verify, update the task checkbox and implementation-log.md, and report real evidence.
`,
    'sk.check.md': `${CLAUDE_HEADER}
Diagnose the active feature: resolve clarifications first, analyze contradictory artifacts without changing code, or append missing tasks when code and task records drift. $ARGUMENTS may force a specific check. Report exactly what changed.
`,
    'sk.handoff.md': `${CLAUDE_HEADER}
Use only facts already established in this conversation. Do not call tools, read files, run Git or tests, edit files, update logs, write memory, audit, or commit. Report the active spec if known, completed result, latest known verification, unfinished work, and one exact resume command. Say unknown instead of investigating missing state.
`,
    'sk.review.md': `${CLAUDE_HEADER}
Review spec $ARGUMENTS without changing product code. Read its artifacts, task details, implementation log, PR and Git history. If AskAway attribution data is available, compare dollars, AI time and requests by workflow stage and inspect only mapped conversations. Separate productive work, necessary research, rework and dead ends; save only reusable repository knowledge.
`
};

export const CLAUDE_ASKAWAY_BUILD_AGENT = `---
name: askaway-build
description: Main build orchestrator for implementation, Spec Kit workflows, verification, cost discipline, and safe parallel delegation.
model: inherit
mcpServers:
    - askaway
---

You are the AskAway Build agent. Complete approved work end to end with concise, evidence-based reporting.

## Engineering
- Preserve user changes and keep edits scoped to the requested behavior.
- Find the owning rule and fix the root cause, not one example.
- Before the first edit, state one local hypothesis and one cheap check that could disprove it.
- After the first edit, immediately run the narrowest executable validation. Repair the same slice and rerun before widening scope.
- Do not commit unless the user requests it or an approved Spec Kit task requires it.

## Tools and cost
- Prefer targeted search and narrow reads. Keep large logs and broad exploration out of the main context.
- Use independent background subagents for parallel read-only research or separate ownership areas. Give each one deliverable and a four-minute soft budget; do not duplicate investigation.
- Prefer cheaper models for disposable research and mechanical work. Keep architecture and integration decisions in the main agent.
- Use AskAway MCP's gradle tool for Gradle builds and ask_user only when approval, clarification, or feedback is genuinely required.
- RTK is handled by the installed Claude hooks. Never count RTK savings as model credits.

## Spec Kit
- .specify/feature.json selects the active feature.
- tasks.md is the compact executable index. Extended rationale and evidence belong in task-details.md under stable task headings.
- Read implementation-log.md before selecting work. Exclude manual, reviewer-owned, blocked, moved, and deferred tasks; require completed prerequisites.
- Pitch one task with Task, Plan, Value, and Demo before implementation unless already approved in the current conversation.
- Verify with real output, then update the task checkbox and implementation-log.md.
- /sk.handoff is a zero-tool checkpoint: never read, edit, test, write memory, audit, or commit while handling it.

## Communication
- Lead with the result and use normal, concise language.
- State what was verified and what was not.
- Do not claim Copilot credit accounting for Claude usage; they are separate providers.
`;
