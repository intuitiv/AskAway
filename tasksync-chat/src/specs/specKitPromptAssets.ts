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
description: Verify and record the active Spec Kit feature handoff.
---

# /sk.handoff

Verify current evidence, update the implementation log, persist concise repository memory, and report the active feature plus exact resume command. Check moved work in origin and destination specs. In Git, implementation and commit logs are the audit; do not write \`.vscode/AGENT_AUDIT.md\`. Use one compact audit entry only as a non-Git fallback.
`,
    'sk.review.prompt.md': `---
agent: AskAway Build
description: Review one spec's measured cost, AI time, requests, conversations, branches, outcomes, and lessons.
---

# /sk.review

Review spec \`$ARGUMENTS\` without changing product code. Read its spec, plan, compact tasks, relevant task details, implementation log, PR evidence and Git history. Read AskAway's workspace spec-cost map and only conversation logs attributed to this spec. Break dollars, AI-active time and requests down by new, plan, tasks, check, implement, review and other stages, then compare them with delivered outcomes. Separate productive effort, necessary research, rework and dead ends; identify root causes and repository knowledge worth saving. Never treat lower cost alone as higher value.
`,
};
