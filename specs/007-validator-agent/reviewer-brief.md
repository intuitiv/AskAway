# Reviewer brief — 007 Validator Agent

Status 2026-10-06: `/sk.check` re-run done (`checklists/analyze.md`, section "Re-run 2026-10-06"). Tasks T001-T004b can start now. T005-T008 wait for your answers below.

## What you asked for

- 2026-10-01: "Then user role becomes explaining new requirement only once." (Goal.md)
- 2026-10-01 (Rules.md): the validator gets any agent or worker response, and after your message the previous response plus your reply, FIRST. It answers as close to you as possible, with observations, summary and impact. It stores rules, instructions and goals with the spec, story or task, deduplicated and short. Strong prompt verified by evals. Start as a simple observer, optimise later. Its cost counts in the shared banner.
- 2026-10-02 (beta, Rules.md): "we are in beta phase, I want to see validator response in Commentary before it going to the agent. Once i get confidence we will link later, with some cautions and all." So: Commentary only, nothing is sent to the agent.
- 2026-10-02 (Rules.md): "For validator we need a memory store for recording stuff, for that we can use, https://github.com/rohitg00/agentmemory".
- 2026-10-02 (spec Clarifications): observe every response, with a cheap check that skips pure progress updates; stored knowledge is kept until you change it; targets 60/70/80/10% are provisional and reset after a first-week measurement; prompt enhancement is a dismissible suggestion in Commentary; the prediction match is shown in Commentary.

## Design in short

- One new module `tasksync-chat/src/validator/` behind two ports: knowledge store and worker run.
- A read-only validator profile runs through the existing worker runtime; it has no send-to-agent tool.
- A cheap check skips progress-only updates; the skip is counted and visible.
- The answer cites its source, or says "no source answers". It never guesses.
- Output goes to the Commentary tab through a new internal `postValidator`, shown with the shared trace-row block. Agents cannot post kind `validator`.
- Cost is a separate row in the shared banner (`validator:<id>` key), never overwriting the observed row.
- When you reply, the pair goes to the validator first; it records how close its prediction was and shows it.
- Rules from your reply are stored in agentmemory with tags `spec:`, `story:`, `task:`; a reversed decision supersedes the old one.
- A secret anywhere in reply, response or sources drops the whole item.
- A validator failure never blocks anyone and is shown.
- Prompt proposals show in Commentary only; the agent prompt stays byte-identical.
- Three eval suites (answer, enhance, store) plus cheap-check and secret-leak cases gate the prompt.

## Decisions taken

- Store: agentmemory (your rule), through a thin REST adapter.
- Beta: Commentary-only (FR-018).
- Agent-facing Commentary kinds stay `update` and `heads-up`.
- Task budget fits: 12 open tasks, no cycle.
- Constitution v1.0.0 is now the plan gate (plan.md still to be rewritten against it, finding N1).

## Questions for you

### A1 Store lifecycle (blocks T005, T008) — recommend (a)
agentmemory forgets and consolidates for the whole server, with no per-agent exemption, which breaks "kept until you change it".
- (a) A dedicated validator-only agentmemory instance with `AUTO_FORGET_ENABLED=false` and `CONSOLIDATION_ENABLED=false`, own port, data dir and instance name. Safe, per workspace; costs one more local daemon.
- (b) Shared instance plus a re-save job from `index.jsonl`. Survives eviction, not consolidation rewriting your wording.
- (c) Existing `tasksync-chat/src/memory/memoryStore.ts`. No new runtime, but not what you asked for.

### A4 "Validator first" ordering (blocks T006) — recommend (a)
- (a) Validator is first in the queue, the agent send never waits for it.
- (b) Wait up to N seconds, then send anyway.
In beta (a) is simplest and meets "no blocking".

### A11 Baselines — recommend (a)
- (a) Defer the SC-002 and SC-004 baselines to the first-week measurement (SC-002 only exists after linking).
- (b) Sample past replies before launch for a baseline.

### A20 Status of the checklists — recommend (a)
- (a) Resolve the gaps (A1 to A12), then tick the checklists and set spec Status.
- (b) Accept all gaps as beta limits and record that.

## agentmemory vs VS Code memories

| | agentmemory | VS Code /memories |
|---|---|---|
| Organising | tags, project and agent scoping | markdown files loaded by path |
| Search | hybrid BM25 / vector | none |
| Changes | supersede with version history | none |
| Workers | REST and MCP | files only |
| Ops cost | Node plus iii-engine daemon on 4 local ports; forget and consolidation settings are global | zero |

`memoryStore.ts` already has local search, but no versioning. Recommendation: (a), a dedicated instance, since it keeps your rule (agentmemory) and keeps knowledge until you change it.
