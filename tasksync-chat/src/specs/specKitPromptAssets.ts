export const SPEC_KIT_PROMPTS: Record<string, string> = {
    'sk.new.prompt.md': `---
agent: AskAway Build
description: Create a new numbered Spec Kit feature without losing the previous active feature.
---

# /sk.new

Create a new numbered feature from $ARGUMENTS (the reviewer's plain description) under specs/. Preserve the previous feature_directory until creation succeeds. Keep feature slug, current Git branch, recorded task branch, and explicit cloud base revision separate; never derive one from another.

Steps:
1. Read .specify/feature.json and remember its feature_directory. Do not change it yet.
2. List specs/ and take the next number (highest NNN + 1, zero padded). Make a short kebab-case slug from the description.
3. Create specs/NNN-slug/spec.md from .specify/templates/spec-template.md: prioritized user stories (P1 first), each independently testable, with Given/When/Then acceptance scenarios, functional requirements, success criteria, and **Status**: Draft. Write what and why, never how.
4. Mark every genuine gap as [NEEDS CLARIFICATION: question], at most five. Choose a sensible default for everything else and list it under Assumptions.
5. Only after the files exist, set feature_directory in .specify/feature.json to the new folder (activate the new feature).
6. Report the path, the number, the stories found, the open [NEEDS CLARIFICATION] items, and the next command: /sk.check. Do not plan or implement.
`,
    'sk.start.prompt.md': `---
agent: AskAway Build
description: Select a numbered Spec Kit feature and summarize its state.
---

# /sk.start

Select feature $ARGUMENTS (a number such as 002, or a slug) in .specify/feature.json and orient. If no argument is given, list specs/ with each spec's stage and ask which one, as a single question.

Steps:
1. Resolve the argument to exactly one specs/NNN-* folder. If none or several match, list the candidates and stop.
2. Set feature_directory in .specify/feature.json. Make no other edit.
3. Report these four separately and never infer one from another: feature directory, current Git branch, recorded task branch, and cloud base revision (say "not set" when none is recorded).
4. Report the stage the way Spec Kit names it: which of spec.md, plan.md, tasks.md and implementation-log.md exist, whether any derived artifact is older than the one it derives from (stale), open [NEEDS CLARIFICATION] items, open versus done tasks, and the one command to run next (/sk.check, /sk.plan, /sk.tasks, /sk.implement or /sk.continue).

Do not implement.
`,
    'sk.continue.prompt.md': `---
agent: AskAway Build
description: Resume the active Spec Kit feature and pitch its next eligible task.
---

# /sk.continue

Resume the active feature in .specify/feature.json. If the file is missing, say to run /sk.start NNN and stop.

Steps:
1. Read implementation-log.md before tasks.md: what is done, the evidence, what is blocked and why.
2. Build the candidate list from unchecked tasks whose prerequisites are done. Exclude manual, reviewer-owned, blocked, moved, and deferred work. Prefer the earliest user story (P1 first); take a [P] task only when its files are independent of work in flight.
3. If no task is eligible, say why and route: open questions go to /sk.check, a missing plan to /sk.plan, missing tasks to /sk.tasks, everything done to /sk.check for convergence.
4. Pitch exactly one task with Task (ID and title), Plan (three to five steps and the files), Value (what the reviewer can see), and Demo (the command and its expected result). Stop for approval; once approved, continue with /sk.implement.
`,
    'sk.plan.prompt.md': `---
agent: AskAway Build
description: Plan the active Spec Kit feature after resolving required clarifications.
---

# /sk.plan

Require a resolved Decision Register and Cloud Worker Packet usable by a fresh worker without chat history. Name an explicit base commit, tag, or remote ref and exact checkout value; never infer it from feature or branch metadata. Stop on [NEEDS CLARIFICATION], TBD, contradiction, unsupported assumption, or deferred decision. Do not generate tasks.

Follow .specify/templates/plan-template.md. Plan dependencies around user stories and their Given/When/Then scenarios; verify each story's success metrics at its checkpoint. Use /sk.check for the checklist before /sk.tasks.

Steps:
1. Read spec.md, the constitution, and any research. If a [NEEDS CLARIFICATION] remains, stop and route to /sk.check.
2. Write plan.md from .specify/templates/plan-template.md: technical context, constitution check, structure, then research.md, data-model.md, contracts/ and quickstart.md where the template calls for them.
3. Decision Register: one row per technical decision with the options considered, the choice, the reason, who decided (reviewer or agent) and its status. No row may stay open, TBD, or deferred.
4. Cloud Worker Packet: a section a fresh worker can follow without chat history: the goal, the explicit base (commit, tag, or remote ref plus the exact checkout value), the areas to touch, the build and test commands, the constraints, the secrets rule (never put a secret in a packet), and the definition of done.
5. Order the user stories and their dependencies. For each story keep its Given/When/Then scenarios, Independent Test, Checkpoint and success metrics. Name which work can run in parallel.
6. Work beyond the next increment goes under ## Later in plan.md as one-line bullets.
7. Report the files written, the number of Decision Register rows, the base value, and the next steps: /sk.check (checklist) then /sk.tasks.
`,
    'sk.tasks.prompt.md': `---
agent: AskAway Build
description: Generate compact executable tasks and navigable task details for the active spec.
---

# /sk.tasks

Require a resolved Decision Register and Cloud Worker Packet. Generate tasks executable by a fresh local or cloud worker without chat history. Follow .specify/templates/tasks-template.md: Setup, Foundational, one phase per [USn] with Independent Test + Checkpoint, then Polish. Mark independent parallel work [P]. Use short plain-language task titles; put execution details in task-details.md rather than repeating the template.

Steps:
1. Read plan.md (Decision Register and Cloud Worker Packet), spec.md and the active feature's task template. If the plan is not ready, stop and route to /sk.plan or /sk.check.
2. Write tasks.md, one row per task: - [ ] T001 [cloud or local tag] [P] [USn] short plain-language title. primary/file/path. Add AC-TNNN-* acceptance references per the /sk.check rules.
3. Write task-details.md with one section per task under a heading of the form ## T001 — title: why, files, prerequisites, and the verification (Assert, Verify, Expected). Implementations read only their own section.
4. Run the task budget below and report its PASS line.

Mark [direct-agent-ready] only for self-contained work with satisfied prerequisites and applicable cloud context. Exclude manual, reviewer-owned, destructive, security-sensitive, unresolved, and externally blocked work. Eligibility is not approval. Use /sk.check for analysis before implementation.

Cloud eligibility: tag every task after its task ID with [cloud] only when it is self-contained, estimated well inside ~45 minutes, has no open questions and needs no local services. Otherwise use [local: <reason>] with the applicable reason: local service, open question, > 45 min, or not self-contained. Keep these tags separate from [direct-agent-ready]. For example: T001 [cloud] [US1] Validate a pure parser; T002 [local: local service] [US1] Verify against a local service. Eligibility only exposes a Queue in cloud affordance; cloud tasks start only on an explicit reviewer request. Never automatically queue eligible tasks or launch them on startup, polling or schedules.


**Task budget (reviewer, 2026-09-28: "speckit goes crazy and creates 100s of tasks").** Generate only the next increment: at most 12 open tasks in the spec and at most 6 per cycle. One task = one outcome the reviewer can see, with its own test; merge rows that share a file and a test, and never emit a task per class, per file, or per checklist item. Work beyond the increment goes into \`plan.md\` under \`## Later\` as one-line bullets, not tasks. After \`speckit.tasks\` returns, run \`node tasksync-chat/tools/task-budget.cjs\` (active spec). On FAIL, merge or move rows to \`## Later\` yourself and rerun until it prints PASS; report the PASS line. Never raise the limits unless the reviewer asks.
`,
    'sk.implement.prompt.md': `---
agent: AskAway Build
description: Pitch and implement exactly one Spec Kit task or approved story.
---

# /sk.implement

Require the Decision Register and Cloud Worker Packet. Give the worker only the packet, selected task row, and matching task-details section; never rely on chat history. Follow .specify/templates/tasks-template.md and its story dependencies. Pitch Task/Story, Plan, Value, and Demo unless already approved. Before editing, state the observable assertion, verification command, and exact expected result. Prove execution; zero matched tests is failure.

Check off a task only after its verification passes. At each story Checkpoint, run its Independent Test, prove its Given/When/Then scenarios, and verify its success metrics. [direct-agent-ready] never bypasses approval. Use /sk.check for convergence.

Steps:
1. Resolve the task: use $ARGUMENTS, otherwise the next eligible task found as /sk.continue does. Read implementation-log.md first.
2. Pitch it (Task or Story, Plan, Value, Demo) unless the reviewer already approved it, and wait.
3. Delegate the work to a worker with a self-contained packet: the Cloud Worker Packet, the selected task row, its task-details section, the allowed files, the verification command, and the stop condition. The worker never commits; review its diff yourself.
4. Before any edit, state the observable assertion, the verification command, and the exact expected result.
5. Implement with a test written from the caller's point of view, run the verification, and show the real output. Zero tests matched, or a check that did not run, counts as failure.
6. Only then check the task off and append an entry to implementation-log.md: task ID, files changed, the command, its result, and the date.
7. At a story Checkpoint run its Independent Test, prove each Given/When/Then scenario and verify its success metrics. Merge through the spec's one active PR; never open a PR per day.
8. About every couple of minutes, post a short AITalk status using commentary (action aitalk, kind update): what you are doing, what is done, where blocked. At decisions or when reviewer input is needed, ask immediately (kind heads-up), with options and your recommended default; leave waitSeconds at its default. Unless truly blocked, continue with the default; answers arrive in a later tool result under ADDITIONAL MESSAGES FROM THE USER. At turn end, put still-open questions in the single Response Handoff batch and report evidence, next steps and blockers.
`,
    'sk.check.prompt.md': `---
agent: AskAway Build
description: Diagnose the active Spec Kit feature and offer approved acceptance backfill.
---

# /sk.check

Choose the check that matches the stage the active feature has reached, and say which one you ran:
- spec.md written: clarify (questions that would change code or tests).
- plan.md written: checklist (quality of the requirements and plan).
- tasks.md written: analyze (spec, plan and tasks agree; every requirement has a task).
- during or after implementation: converge (what is built versus what the spec says).

Inspect the active feature strictly read-only before approval. Before the user answers or approves a route, run no writer. Use Spec Kit's templates under .specify/templates/ for clarification, checklist, analysis, or convergence at the current stage. Find [NEEDS CLARIFICATION], Open Question, placeholders, contradictions, unsupported assumptions, and deferred decisions first. Ask up to five numbered questions; technical answers go into the plan Decision Register via /sk.plan. Report as Story -> Tasks -> Finding with progress and blocked dependents; put unmapped findings under Cross-cutting / Unassigned.

After resolving decisions, report missing task verification and ask: Backfill AC for these open items? (yes/no). Remain read-only until yes; then perform /sk.check backfill-ac [NNN] for exactly one selected/active spec, only unchecked tasks. Never touch completed tasks, valid acceptance, logs, code, or another spec.

Task AC-TNNN-* backfill uses Assert, Verify, Expected, and non-vacuous execution proof. Exit 0 alone is invalid. Validate story dependencies, Given/When/Then scenarios, Independent Test + Checkpoint, and success metrics against the standard templates.
`,
    'sk.handoff.prompt.md': `---
agent: AskAway Build
description: Print a no-tool resume checkpoint covering done, assumptions, learnings, observations and what to pick next.
---

# /sk.handoff

Use only facts already established in this conversation. Do not call tools or edit files. The reader is the next conversation, which has none of this chat's history, so write everything it needs to continue without asking again.

Print one checkpoint, ready to paste into a new chat, with these sections in this order. Write "none" for an empty section and "unknown" for a fact that is not established; never guess.

1. **Where we are**: the active spec, its stage as Spec Kit names it, and the one-line goal.
2. **Done**: what was completed, each item with its evidence (the verification command and its real result, the commit, or the file). List what was checked off.
3. **Assumptions**: what was assumed, why, and how to check each one. Mark any that could change the work.
4. **Decisions and rules in force**: the reviewer's decisions, answers and standing rules from this conversation, in his words where possible, so they are not asked again.
5. **Learnings**: what was found out that is not obvious from the code (root causes, pitfalls, commands that work, things that failed and why).
6. **Observations**: things noticed but not acted on (risks, odd behaviour, debt, follow-ups) and anything left unverified.
7. **Not finished**: open tasks and steps, in order, with what blocks each and which are waiting on the reviewer.
8. **Pick up next**: the single best next task and why it is first, then the next two. Give the one command to start with (for example /sk.continue).

Keep each bullet to one line. Do not repeat the same fact in two sections.
`,
    'sk.review.prompt.md': `---
agent: AskAway Build
description: Review measured cost, AI time, requests, and delivered outcomes for a spec.
---

# /sk.review

Review the selected spec ($ARGUMENTS, else the active feature) without changing product code.

Evidence to read: the spec's cost ledger under ~/.askaway/spec-cost for this workspace, the .askaway/specs folder for the spec, implementation-log.md, tasks.md, and the Specs tab figures (provider cost, AI time, requests).

Report:
1. Measured provider cost, AI time and request count, split by stage (specify, check, plan, tasks, implement, converge) and by main agent versus workers.
2. Separate productive work, research, rework (tasks redone or reverted) and human waiting.
3. Delivered outcomes: stories whose Checkpoint passed, tasks done, and what remains.
4. Cost per delivered outcome and where it was highest.
5. Two or three concrete changes that would cut cost or time without losing quality.

Do not treat lower cost alone as higher value. Say plainly when a figure is missing.
`
};

const CLAUDE_HEADER = `---
disable-model-invocation: true
---
`;

export const CLAUDE_SPEC_KIT_COMMANDS: Record<string, string> = Object.fromEntries(
    Object.entries(SPEC_KIT_PROMPTS).map(([file, text]) => [
        file.replace('.prompt.md', '.md'),
        `${CLAUDE_HEADER}${text.replace(/^---[\s\S]*?---\s*/, '')}`
    ])
);

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
