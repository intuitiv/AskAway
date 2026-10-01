# Implementation Plan: Validator Agent

**Branch**: `007-validator-agent` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-validator-agent/spec.md`

**Status**: Approved by the reviewer 2026-10-02 ("Go ahead"); agentmemory is the knowledge store, pending the T001 spike outcome.

## Summary

A read-only validator observes every agent/worker response, answers from the active spec's sources, predicts the reviewer's reply, learns from the actual reply, and records knowledge per spec/story/task in agentmemory (reviewer rule 2026-10-02). Beta: output appears only in the Commentary tab; nothing is sent to the agent. Reuses the Commentary tab, shared banner cost (`specCostLedger`), worker runtime and eval harness; adds one new module and one new Commentary kind.

## Technical Context

**Language/Version**: TypeScript (VS Code extension, `tasksync-chat/`), Node 20+

**Primary Dependencies**: existing worker runtime (`src/workers/`), Commentary (`src/commentary/`), spec cost ledger (`src/specs/`); agentmemory server (external, Apache-2.0, REST on 127.0.0.1:3111)

**Storage**: agentmemory for knowledge items; append-only jsonl under `.askaway/specs/<slug>/validator/` for responses, predictions, index

**Testing**: `npm run test:workers` (in `tasksync-chat/`), existing eval harness for the three validator suites, Storybook story for the Commentary entry

**Target Platform**: macOS/Linux VS Code extension host + OpenCode workers

**Project Type**: desktop/VS Code extension

**Performance Goals**: validator never delays the agent or reviewer (0 blocking steps, SC-008)

**Constraints**: beta, Commentary-only (FR-018); secrets never leave (FR-016); validator cost < 10% of observed work (provisional); one shared server per workspace

**Scale/Scope**: one reviewer, a few concurrent workers, hundreds of knowledge items per spec

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template (placeholders only), so it imposes no gates. Binding gates come from AGENTS.md instead, and the plan satisfies them:
- Consistent Experience: Commentary list and trace rows reused; banner reused. PASS
- Caller-view test for every feature; `npm run test:workers` stays green. PASS (see tests below)
- Worker boundary: workers via the shared OpenCode server, MCP/broker tool surface, no UI reimplementation. PASS
- Never send secrets through messages, storage or telemetry. PASS (redaction at the boundary)
Re-check after design: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-validator-agent/
├── plan.md
├── research.md          # incl. agentmemory evaluation (R-1)
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── knowledge-store.md
│   ├── validator-observer.md
│   ├── commentary-validator-entry.md
│   └── validator-evals.md
└── tasks.md             # /sk.tasks, not created here
```

### Source Code (repository root)

```text
tasksync-chat/
├── src/validator/
│   ├── observer.ts          # observe / closeLoop / proposeContext, cheap check
│   ├── knowledgeStore.ts    # KnowledgeStore port + agentmemory REST adapter
│   ├── redact.ts            # secret redaction (reuse existing if found)
│   └── records.ts           # jsonl under .askaway/specs/<slug>/validator/
├── src/commentary/commentary.ts   # + item kind 'validator' via internal postValidator (NOT in COMMENTARY_KINDS), + detail, export CREDENTIAL_ANYWHERE
├── src/specs/specCostLedger.ts    # SpecCostTurn + source, reasoning/cache fields; turnKey validator:<id>
├── src/workers/workerProfiles.ts  # + validator profile (read-only)
├── evals/validator/               # answer, enhance, store, cheap-check, secret-leak cases
└── storybook/                     # Commentary validator entry story
```

**Structure Decision**: one new `src/validator/` module behind two ports (KnowledgeStore, worker run); the UI and cost paths are existing components extended by a kind/source value, so the later backend move changes only the run port (FR-014).

## Phases and delivery order (maps to stories)

1. **Spike (T-spike)**: verify agentmemory `/remember`, supersede, and measure the three FR-020 options (dedicated instance, re-save job, `memoryStore.ts`), health, secret handling; record findings in research R-1. Reviewer chooses before step 3.
2. **US1** observer + cheap check + Commentary entry + cost + beta isolation test.
3. **US2** closeLoop, prediction/match (FR-021), KnowledgeStore writes, fresh-agent recall.
4. **US3** context proposal (dismissible, prompt unchanged).
5. **US4** dedup/supersede rules.
6. **US5** evals and gate.

## Risks

- agentmemory decay/auto-forget vs FR-020: mitigated by spike; fallback is the reviewer's choice among a dedicated instance, re-save job or `memoryStore.ts`, measured by T001 (research R-1).
- Extra local runtime (Node + iii engine, 4 ports): documented in quickstart; health shown in Commentary on failure.
- Cheap-check misses a real question: skip rate audited in evals.

## Complexity Tracking

None; no constitution violations.
