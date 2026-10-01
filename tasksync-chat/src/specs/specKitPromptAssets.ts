export const SPEC_KIT_PROMPTS: Record<string, string> = {
    'sk.new.prompt.md': `---
agent: AskAway Build
description: Create a new numbered Spec Kit feature without losing the previous active feature.
---

# /sk.new

Create a new numbered feature from $ARGUMENTS under specs/. Preserve the previous feature_directory until creation succeeds. Keep feature slug, current Git branch, recorded task branch, and explicit cloud base revision separate. Mark genuine [NEEDS CLARIFICATION], activate the new feature, and do not plan or implement.
`,
    'sk.start.prompt.md': `---
agent: AskAway Build
description: Select a numbered Spec Kit feature and summarize its state.
---

# /sk.start

Select feature $ARGUMENTS in .specify/feature.json. Report feature directory, current Git branch, recorded task branch, and cloud base revision separately. Do not implement.
`,
    'sk.continue.prompt.md': `---
agent: AskAway Build
description: Resume the active Spec Kit feature and pitch its next eligible task.
---

# /sk.continue

Read implementation-log.md before tasks.md. Exclude manual, reviewer-owned, blocked, moved, and deferred work; require prerequisites. Pitch exactly one task with Task, Plan, Value, and Demo.
`,
    'sk.plan.prompt.md': `---
agent: AskAway Build
description: Plan the active Spec Kit feature after resolving required clarifications.
---

# /sk.plan

Require a resolved Decision Register and Cloud Worker Packet usable by a fresh worker without chat history. Name an explicit base commit, tag, or remote ref and exact checkout value; never infer it from feature or branch metadata. Stop on [NEEDS CLARIFICATION], TBD, contradiction, unsupported assumption, or deferred decision. Do not generate tasks.

Follow .specify/templates/plan-template.md. Plan dependencies around user stories and their Given/When/Then scenarios; verify each story's success metrics at its checkpoint. Use /sk.check for the checklist before /sk.tasks.
`,
    'sk.tasks.prompt.md': `---
agent: AskAway Build
description: Generate compact executable tasks and navigable task details for the active spec.
---

# /sk.tasks

Require a resolved Decision Register and Cloud Worker Packet. Generate tasks executable by a fresh local or cloud worker without chat history. Follow .specify/templates/tasks-template.md: Setup, Foundational, one phase per [USn] with Independent Test + Checkpoint, then Polish. Mark independent parallel work [P]. Use short plain-language task titles; put execution details in task-details.md rather than repeating the template.

Mark [direct-agent-ready] only for self-contained work with satisfied prerequisites and applicable cloud context. Exclude manual, reviewer-owned, destructive, security-sensitive, unresolved, and externally blocked work. Eligibility is not approval. Use /sk.check for analysis before implementation.
`,
    'sk.implement.prompt.md': `---
agent: AskAway Build
description: Pitch and implement exactly one Spec Kit task or approved story.
---

# /sk.implement

Require the Decision Register and Cloud Worker Packet. Give the worker only the packet, selected task row, and matching task-details section; never rely on chat history. Follow .specify/templates/tasks-template.md and its story dependencies. Pitch Task/Story, Plan, Value, and Demo unless already approved. Before editing, state the observable assertion, verification command, and exact expected result. Prove execution; zero matched tests is failure.

Check off a task only after its verification passes. At each story Checkpoint, run its Independent Test, prove its Given/When/Then scenarios, and verify its success metrics. [direct-agent-ready] never bypasses approval. Use /sk.check for convergence.
`,
    'sk.check.prompt.md': `---
agent: AskAway Build
description: Diagnose the active Spec Kit feature and offer approved acceptance backfill.
---

# /sk.check

Inspect the active feature strictly read-only before approval. Before the user answers or approves a route, run no writer. Use Spec Kit's templates under .specify/templates/ for clarification, checklist, analysis, or convergence at the current stage. Find [NEEDS CLARIFICATION], Open Question, placeholders, contradictions, unsupported assumptions, and deferred decisions first. Ask up to five numbered questions; technical answers go into the plan Decision Register via /sk.plan. Report as Story -> Tasks -> Finding with progress and blocked dependents; put unmapped findings under Cross-cutting / Unassigned.

After resolving decisions, report missing task verification and ask: Backfill AC for these open items? (yes/no). Remain read-only until yes; then perform /sk.check backfill-ac [NNN] for exactly one selected/active spec, only unchecked tasks. Never touch completed tasks, valid acceptance, logs, code, or another spec.

Task AC-TNNN-* backfill uses Assert, Verify, Expected, and non-vacuous execution proof. Exit 0 alone is invalid. Validate story dependencies, Given/When/Then scenarios, Independent Test + Checkpoint, and success metrics against the standard templates.
`,
    'sk.handoff.prompt.md': `---
agent: AskAway Build
description: Print a no-tool resume checkpoint.
---

# /sk.handoff

Use only facts already established. Do not call tools or edit files. Report active spec, completed result, latest verification, unfinished work, and one resume command.
`,
    'sk.review.prompt.md': `---
agent: AskAway Build
description: Review measured cost, AI time, requests, and delivered outcomes for a spec.
---

# /sk.review

Review the selected spec without changing product code. Separate provider attribution, productive work, research, rework, and human waiting. Do not treat lower cost alone as higher value.
`
};

const CLAUDE_HEADER = `---
disable-model-invocation: true
---
`;

export const CLAUDE_SPEC_KIT_COMMANDS: Record<string, string> = {
    'sk.new.md': `${CLAUDE_HEADER}Create a numbered feature from $ARGUMENTS, preserve the previous feature_directory, separate branch identities and explicit cloud base revision, record genuine [NEEDS CLARIFICATION], and do not plan or implement.`,
    'sk.start.md': `${CLAUDE_HEADER}Select feature $ARGUMENTS in .specify/feature.json and report feature directory, Git branch, task branch, and cloud base revision separately.`,
    'sk.continue.md': `${CLAUDE_HEADER}Read implementation-log.md before tasks.md, exclude blocked/manual/reviewer/deferred work, and pitch exactly one eligible task.`,
    'sk.plan.md': `${CLAUDE_HEADER}${SPEC_KIT_PROMPTS['sk.plan.prompt.md'].replace(/^---[\s\S]*?---\s*/, '')}`,
    'sk.tasks.md': `${CLAUDE_HEADER}${SPEC_KIT_PROMPTS['sk.tasks.prompt.md'].replace(/^---[\s\S]*?---\s*/, '')}`,
    'sk.implement.md': `${CLAUDE_HEADER}${SPEC_KIT_PROMPTS['sk.implement.prompt.md'].replace(/^---[\s\S]*?---\s*/, '')}`,
    'sk.check.md': `${CLAUDE_HEADER}${SPEC_KIT_PROMPTS['sk.check.prompt.md'].replace(/^---[\s\S]*?---\s*/, '')}`,
    'sk.handoff.md': `${CLAUDE_HEADER}Use only established facts. Do not call tools or edit files; print a concise resume checkpoint.`,
    'sk.review.md': `${CLAUDE_HEADER}Review the selected spec's measured provider cost, AI time, requests, outcomes, and human waiting without changing product code.`
};

export const CLAUDE_ASKAWAY_BUILD_AGENT = `---
name: askaway-build
description: Main build orchestrator for implementation, Spec Kit workflows, verification, cost discipline, and safe delegation.
model: inherit
mcpServers:
    - askaway
---

Treat any request to change code, configuration, tests, documentation, task artifacts, or generated artifacts as implementation intent and internally route it through /sk.implement, even when the user does not type a slash command; this does not require the user to retype a slash command. Resolve the active task or cycle first; if no executable task exists, route through /sk.check, /sk.plan, and /sk.tasks. Never edit directly around acceptance gates.

Use task AC-TNNN-*, cycle CAC-CY-NNN-*, and phase PAC-PNN-* completion gates. Verify every assertion with real, non-vacuous evidence. Keep task titles short and plain-language; keep worker detail in task-details.md.
`;
