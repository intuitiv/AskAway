const acceptance = 'Every task has stable AC-TNNN-* acceptance IDs. Every acceptance criterion requires an objective observable assertion, an executable verification method/command, and an exact expected result. Prove execution with named nonzero test evidence, exact output/value/count, or an artifact predicate; exit 0 alone is insufficient. Add context only when relevant and omit empty boilerplate. Acceptance is the required outcome; Demo is proof after it passes and cannot replace acceptance.';
const categories = 'Classify phases and tasks as design-high-care, logic, codegen, adr-docs, tests, small-change, or integration-ops. Design-high-care is serial, reviewer-gated, and states expected decisions, exclusions, rejected alternatives, and reviewer-owned choices.';
const gates = 'Use task AC-TNNN-*, cycle CAC-CY-NNN-*, and phase PAC-PNN-* as separate completion gates. A task, cycle, or phase cannot close until every applicable assertion passes.';

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

Use a gated incremental waterfall: requirements/decisions, architecture/contracts, foundation, usable feature increments, integration/migration, release/operations. Every phase has entry criteria, an integrated demonstrable increment, stable PAC-PNN-* assertions, verification command, exact expected result, evidence, downstream unlocks, and one-writer boundaries. Every implementation phase delivers demonstrable value.

${acceptance}
${categories}
${gates}
`,
    'sk.tasks.prompt.md': `---
agent: AskAway Build
description: Generate compact executable tasks and navigable task details for the active spec.
---

# /sk.tasks

Require a resolved Decision Register and Cloud Worker Packet. Generate tasks executable by a fresh local or cloud worker without chat history. Generate tasks in gated incremental-waterfall order with phase entry criteria, concrete deliverables, PAC-PNN-* assertions/evidence, and downstream unlocks. Keep tasks.md compact; use short plain-language task titles, ideally 3-8 words. Put paths, inputs, constraints, dependencies, acceptance, and demos in task-details.md.

${acceptance}
${categories}
Add CAC-CY-NNN-* integration acceptance for every cycle. Mark [direct-agent-ready] only when a fresh worker has self-contained paths, prerequisites, open gates, detailed non-vacuous AC, and applicable cloud context. Exclude manual, reviewer-owned, design-high-care, migration, destructive, security-sensitive, unresolved, and externally blocked work. Eligibility is not approval.
`,
    'sk.implement.prompt.md': `---
agent: AskAway Build
description: Pitch and implement exactly one Spec Kit task or approved cycle.
---

# /sk.implement

Require the Decision Register and Cloud Worker Packet. Give the worker only the packet, selected task row, and matching task-details section; never rely on chat history. Follow incremental-waterfall order and do not start a downstream phase before its predecessor gate passes. Pitch Task/Cycle, Plan, Value, and Demo unless already approved. Before editing, restate the phase entry gate and each AC-TNNN-* objective assertion, verification command, and exact expected result. Run every assertion and prove execution; zero matched tests is failure.

Check off a task only after all AC-TNNN-* pass. Close a cycle only after member AC and CAC-CY-NNN-* pass. Unlock a phase only after member work and PAC-PNN-* pass. [direct-agent-ready] never bypasses approval or gates.
`,
    'sk.check.prompt.md': `---
agent: AskAway Build
description: Diagnose the active Spec Kit feature and offer approved acceptance backfill.
---

# /sk.check

Inspect the active feature strictly read-only before approval. Before the user answers or approves a route, run no writer. Find [NEEDS CLARIFICATION], Open Question, TBD/Unknown/placeholders, contradictions, unsupported assumptions, and deferred decisions first. Ask up to five numbered questions when needed; product answers go through clarification and technical answers go into the plan Decision Register via /sk.plan. Report as Phase -> Cycle -> Tasks -> Finding with progress and blocked dependents. Put unmapped findings under Cross-cutting / Unassigned and never invent cycle membership.

After diagnosis finds no unresolved decisions, report open tasks, cycles, and phases with missing or invalid acceptance and ask exactly: Backfill AC for these open items? (yes/no). Remain read-only until the user answers yes. A yes answer internally performs the same exactly-one-spec backfill as /sk.check backfill-ac [NNN]; the alias remains supported for automation. Resolve exactly one selected/active spec. Backfill only unchecked tasks and affected open cycles/phases. Never touch completed tasks, valid acceptance, logs, code, or another spec.

Every new or repaired AC-TNNN-*, CAC-CY-NNN-*, and PAC-PNN-* has Assert, Verify, and Expected fields plus non-vacuous execution proof. Exit 0 alone is invalid.
Validate the incremental waterfall, phase predecessor gates, and all three completion levels. Report gaps under Phase -> Cycle -> Tasks -> Finding.
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
    'sk.plan.md': `${CLAUDE_HEADER}Require a resolved Decision Register and Cloud Worker Packet without chat history. Name an explicit base commit, tag, or remote ref and exact checkout value; never infer it from feature or branch metadata. Stop on [NEEDS CLARIFICATION] or unresolved decisions; route questions to /sk.check. Do not generate tasks.

Use a gated incremental waterfall with phase entry criteria, integrated demonstrable increments, PAC-PNN-* assertions/evidence, predecessor gating, downstream unlocks, and one-writer boundaries.

${acceptance}
${categories}
${gates}`,
    'sk.tasks.md': `${CLAUDE_HEADER}Require a resolved Decision Register and Cloud Worker Packet. Generate tasks executable by a fresh local or cloud worker without chat history. Generate short plain-language task titles and gated incremental-waterfall tasks with PAC-PNN-* phase assertions and CAC-CY-NNN-* cycle acceptance.

${acceptance}
${categories}
Mark [direct-agent-ready] only for self-contained, open-gate, non-vacuously accepted work; exclude manual, reviewer-owned, design-high-care, migration, destructive, security-sensitive, unresolved, external-blocked, or missing-cloud-context work. Eligibility is not approval.`,
    'sk.implement.md': `${CLAUDE_HEADER}Require a resolved Decision Register and Cloud Worker Packet. Implement exactly the selected task or cycle through the /sk.implement pipeline. Follow incremental-waterfall order and do not start a downstream phase before its predecessor gate passes. Give a fresh worker only the packet, task row, and matching task-details section without chat history. Require the packet, phase entry gate, and each AC-TNNN-* objective assertion, verification command, and exact expected result before editing. Prove every assertion with non-vacuous evidence; exit 0 with zero matches fails. Require task AC, cycle CAC-CY-NNN-*, and phase PAC-PNN-* before completion.`,
    'sk.check.md': `${CLAUDE_HEADER}Diagnose strictly read-only. Before the user answers or approves a route, run no writer. Find [NEEDS CLARIFICATION], Open Question, TBD/Unknown/placeholders, contradictions, unsupported assumptions, and deferred decisions. Ask up to five numbered questions; record technical answers in the plan Decision Register. Report as Phase -> Cycle -> Tasks -> Finding with progress, blocked phase/cycle counts, blocked dependents, and Cross-cutting / Unassigned for unmapped findings. After no unresolved decisions, report missing acceptance for open tasks/cycles/phases and ask: Backfill AC for these open items? (yes/no). Remain read-only until yes; yes internally performs exactly-one-spec /sk.check backfill-ac [NNN]. Resolve exactly one selected/active spec. Backfill only unchecked tasks and affected open cycles/phases. Never touch completed tasks or valid acceptance. Validate the incremental waterfall and separate AC-TNNN-*, CAC-CY-NNN-*, and PAC-PNN-* gates. New AC/CAC/PAC requires Assert, Verify, Expected, and non-vacuous proof; exit 0 alone is invalid.`,
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
