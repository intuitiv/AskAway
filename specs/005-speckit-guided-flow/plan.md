# Implementation Plan: Spec Kit Guided Flow

**Branch**: `005-speckit-guided-flow` (spec directory) | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-speckit-guided-flow/spec.md`; binding inputs [Goal.md](Goal.md), [Rules.md](Rules.md).

**Status**: Draft (awaiting reviewer approval at the "how" gate)

## Summary

Make the stage of every spec a stored fact, keep it honest against the artifacts and git, and let everything that talks about a spec (Specs tab, `/sk.*` wrappers, `/sk.continue`, `/sk.handoff`, `/pr-daily`, Telegram, the orchestrator) read that one fact. Per-spec facts (stage, branch, PR, cost, agent time, readiness) live as append-only run records under `.askaway/specs/<slug>/`. Task lists switch to the standard Spec Kit story structure; the scanner learns story phases and keeps rendering legacy cycles. The orchestrator gets code-enforced dispatch rules (≤2 build workers per track, disjoint files, scope check) and story checkpoints are verified by a verify worker before a PR is shown ready.

## Branch identities

| Identity | Value |
|---|---|
| Feature directory / slug | `specs/005-speckit-guided-flow` / `005-speckit-guided-flow` |
| Checked-out branch at planning | `main` (HEAD `308d65b`) |
| `tasks.md` branch provenance | not yet generated |
| Target work branch | one active PR branch per story, named `005-us<N>-<short>` (created at the story's first commit; see D-12) |
| Cloud worker base | not applicable to 005 (cloud work is feature 006) |

## Technical Context

**Language/Version**: TypeScript 5.x (extension host, `tasksync-chat/src`), plain ES2020 JavaScript for the webview (`tasksync-chat/media/webview.js`), Node ≥18 `.cjs` tests and tools.

**Primary Dependencies**: VS Code extension API, esbuild bundle, `git` CLI, `gh` CLI (already used by `tools/pr-daily-facts.cjs`), OpenCode worker runtime (`src/workers/*`). No new runtime dependency.

**Storage**: JSON files in the repo under `.askaway/specs/<slug>/` (tracked by git); existing `~/.askaway/` home files stay for non-spec data.

**Testing**: Node `.cjs` outside-in tests added to `npm run test:workers` (`tasksync-chat/package.json`); webview render blocks tested through the VM extraction pattern of `test-specs-webview-regression.cjs`; Storybook stories for new render blocks; one eval set for plain-text routing in `tasksync-chat/evals/`.

**Target Platform**: VS Code desktop on macOS (primary), Linux; OpenCode workers on the same host.

**Project Type**: VS Code extension + webview + hooks/tools.

**Performance Goals**: Specs tab scan of 50 specs ≤ 300 ms including git staleness (one batched `git log` per spec, results cached by HEAD + dirty set).

**Constraints**: One writer per file (append-only run records); no secrets in `.askaway/`; must not break older cycle-based specs; `/sk.*` prompt text is generated from `src/specs/specKitPromptAssets.ts` (single source).

**Scale/Scope**: ≤100 specs per workspace, ≤500 tasks per spec, ≤10k run records per spec.

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so there are no ratified principles to check. Until it is ratified, the gate applies the reviewer-owned rules already binding in this repo (`AGENTS.md`, `.github/copilot-instructions.md`, [Rules.md](Rules.md)):

| Rule (source) | This plan |
|---|---|
| Reuse the existing component; convert data at the boundary (AGENTS.md "Consistent Experience") | Story rows reuse the existing spec-card/phase render blocks; readiness text is one pure function used by Specs tab, Telegram and PR text (D-9). PASS |
| Every feature ships an outside-in test; `npm run test:workers` stays green (AGENTS.md "Ownership") | Every story adds a caller-view test to `test:workers` (see Testing per story). PASS |
| UI pieces are pure render blocks reviewable in Storybook | New blocks `renderStageBar`, `renderStoryGroup`, `renderSpecFacts`, `renderReadiness` get stories. PASS |
| Never count RTK savings as Copilot credits; credits = `copilotUsageNanoAiu` / 1e9 | Run record `cost.nanoAiu` comes only from Copilot logs / OpenCode `step_finish`; RTK not included. PASS |
| Use the repo's existing word (core rule -3.4) | Stage names are Spec Kit's (`specify`, `clarify`, `plan`, `checklist`, `tasks`, `analyze`, `implement`, `converge`); "story", "Checkpoint", "Independent Test" from the tasks template. PASS |
| Root cause first; no case-specific branches (core rule 1) | Stage/staleness are computed by one module for every spec. PASS |
| New frameworks/stores need an ADR | No new framework or store (JSON files in an existing folder). PASS |

## Decision Register

Every question found while planning, with its answer. Product answers come from the reviewer's words; technical answers are recorded here.

| ID | Question | Answer | Rationale | Source |
|---|---|---|---|---|
| D-1 | Does the stored stage mean the step last completed or the next one? | Last completed step. `specify` + no plan → next is `/sk.check` (clarify). | Matches US1 scenario 1 and US3 scenario 3. | spec.md US1/US3 |
| D-2 | Where is the stored stage kept without two writers on one file? | Each run record carries `stageAfter`; the stored stage is the `stageAfter` of the newest run record (by `endedAt`, tie → file name). No separate stage file. | FR-014 "one file per run" makes a shared stage file a second writer; deriving from run records keeps one writer per file. | FR-001, FR-014, Rules "per-spec data" |
| D-3 | What is the stage when a spec has no run records (older specs)? | Stage implied by artifacts (D-4), marked `source: "artifacts"`; no mismatch is shown. | Older specs must still render (FR-010) and nothing was stored for them. | FR-005, FR-010 |
| D-4 | How are artifacts mapped to an implied stage? | Any ticked task → `implement`; `tasks.md` with no ticks → `tasks`; `checklists/*.md` with plan → `checklist`; `plan.md` → `plan`; `## Clarifications` session in spec → `clarify`; `spec.md` → `specify`. `analyze` and `converge` are only known from run records (they write no artifact). | Spec Kit stores nothing else; gates without artifacts need the record. | Spec Kit templates, FR-005 |
| D-5 | What is a mismatch? | Stored stage requires an artifact that is missing (e.g. stored `tasks`, no `tasks.md`), or implied stage is ahead of stored stage by more than one step. Shown with both names; next step follows the artifacts. | Edge case "Stored stage points past a missing artifact". | spec.md Edge Cases |
| D-6 | Staleness dependency graph? | `spec.md` → `plan.md`, `checklists/*`; `plan.md` → `research.md`, `data-model.md`, `contracts/**`, `quickstart.md`, `tasks.md`; `spec.md` → `tasks.md`. A dependent is stale when any upstream changed later. | Mirrors Spec Kit's generation order. | FR-006 |
| D-7 | How is "changed later by git commit order" computed? | For each artifact: dirty (`git status --porcelain`) or untracked → rank ∞. Else last commit touching it (`git log -1 --format=%H -- <file>`); B is later than A when A ≠ B and `git merge-base --is-ancestor A B`. Equal ranks are not stale; two dirty files are equal. Non-git workspace → staleness off, shown as "no git". | Commit order, not mtimes, per reviewer; ancestry handles rebases and clock skew. | FR-006, Assumptions |
| D-8 | What sizes plain-text work as "direct change"? | Direct change only when ALL hold: ≤3 files in one module, no change to a public contract/format/setting/prompt asset, revertible by one commit, no open question. Otherwise specify. Ambiguous → specify. | Reviewer: "sized by ambiguity, blast radius and reversibility"; plan defines thresholds (spec Assumptions). | FR-012, spec Assumptions |
| D-9 | How is the readiness summary made identical in three places? | One JSON result per converge run (`readiness` in the run record) rendered by one pure function `readinessLines(result)` in `src/specs/readiness.ts`; the webview receives the lines, Telegram and `/pr-daily` call the same function. | "Identical" by construction, not by three copies. | FR-025, AGENTS.md consistency |
| D-10 | What is a "track" for the two-build-worker cap? | One spec slug. At most two `build` runs whose packet names the same spec may be RUNNING at once; runs for different specs are different tracks. Runs without a spec go to track `_default`. | Parallel work is per spec in 005; the cap guards abuse per feature. | FR-020, Rules "at most two at once per track" |
| D-11 | How are "disjoint files" known before a build worker runs? | The dispatch packet must list `allowedPaths` (globs). Admission refuses a build run whose globs overlap a RUNNING build run's globs on the same track (glob overlap = any literal-prefix match either way). After the run, scope check = `git diff --name-only <base>..<head>` ⊆ `allowedPaths`. | Enforced in code (router) rather than trusted to the prompt. | FR-020, FR-021 |
| D-12 | Who opens the story PR and how is "one active PR" kept? | The orchestrator opens a draft PR with `gh pr create --draft` at the story's first push; its URL is written to the run record (`pr`). Active PR = newest run record's `pr` whose state (`gh pr view --json state`) is OPEN. A second open PR for the same spec is shown as a warning. Merge stays a reviewer action. | "One active PR per spec"; "merging stays a reviewer action". | FR-017, Rules "Delivery and PRs", spec Assumptions |
| D-13 | What does "shown ready to merge" do on GitHub? | Specs tab badge + readiness summary in PR text; if the PR is a draft, `gh pr ready` converts it. Nothing merges automatically. | Visible to the reviewer where they merge; reversible (`gh pr ready --undo`). | FR-018 |
| D-14 | How does a verify worker know a story's SCs? | Success criteria lines ending `Verified by: USn[, USm]` map to stories; the checkpoint packet includes the story's Independent Test text and those SC IDs. | Spec already carries `Verified by:` on every SC. | FR-018, spec SCs |
| D-15 | What counts as "cost spent" and "agent time"? | `cost.nanoAiu` = Copilot `copilotUsageNanoAiu` for main-chat turns (existing aggregation) + OpenCode `step_finish` cost for workers, both attributed to the spec named by the run; `agentMs` = wall-clock of the run. Totals are sums over run records. RTK savings excluded. | Observability rules in copilot-instructions; spec Assumption "summed wall-clock". | FR-014, FR-015 |
| D-16 | What happens to the existing home-dir spec-cost ledger (`src/specs/specCostLedger.ts`)? | It stays the source for main-chat turn cost; at turn end the hook writes one run record per spec touched. The card reads only run records. Existing ledger rows are imported once into one `imported-<date>.json` run record per spec. | Reuse existing aggregation; one place to read. | FR-014, AGENTS.md reuse |
| D-17 | Is `.askaway/specs/` committed? | Yes, tracked in git (spec: "stored per spec in the repo"); other `.askaway/*` files stay ignored. Run records hold no secrets and no prompt text. | Spec wording; 006 packets also live there and must be committed. | FR-014, 006 FR-004 |
| D-18 | How do wrappers stop emitting CY/PAC/CAC? | `SPEC_KIT_PROMPTS` in `src/specs/specKitPromptAssets.ts` is rewritten to the story structure; the `acceptance`, `categories`, `gates` constants that demand AC/CAC/PAC are removed; the installed copies under the user prompts folder are regenerated from it. | FR-011; one source of prompt text. | Rules "Spec Kit usage" |
| D-19 | Does the orchestrator's "one standalone command" rule get enforced in code? | Yes: the existing PreToolUse hook denies a terminal command containing `&&`, `||`, `;`, `|` or a redirect when the calling agent is the orchestrator, with a message pointing to a build worker. | Prompt-only rules drift; hooks already run for every tool call. | FR-022 |
| D-20 | What is the spec acceptance marker value? | `**Status**: Draft` until the reviewer approves; approval changes it to `**Status**: Approved`. The Specs tab shows the value. | Rules: "spec `**Status**: Draft` is the acceptance marker". Value name is a reviewer confirmation item (see Open follow-ups). | FR-008 |
| D-21 | Hook points for 006 (FR-027)? | (a) stored stage via `readSpecFacts(slug)`; (b) run-record store API `appendRunRecord(slug, record)`; (c) task tags parsed by the scanner into `task.tags: string[]` (e.g. `P`, `US1`, `cloud`, `local:<reason>`), rendered on the task row. | 006 needs exactly these three. | FR-027 |

Open follow-ups (not blocking planning; decisions above are the defaults until the reviewer says otherwise): D-17 (commit run records), D-20 (`Approved` as the value).

## Architecture

```mermaid
flowchart LR
  subgraph Repo
    A[specs/<slug>/*.md] --> S
    R[.askaway/specs/<slug>/runs/*.json] --> F
  end
  G[git log / status] --> ST[staleness.ts]
  S[specKitScanner.ts] --> M[specFacts.ts]
  ST --> M
  F[runRecords.ts] --> M
  M -->|SpecSummary + facts| W[webviewProvider → webview.js Specs tab]
  M --> C[/sk.continue, /sk.handoff, /pr-daily via tools/spec-facts.cjs]
  RD[readiness.ts readinessLines] --> W
  RD --> T[telegramLive.ts]
  RD --> P[/pr-daily PR text]
  O[Orchestrator] -->|dispatch packet| WR[workerRouter.ts admission]
  WR --> WK[OpenCode build/verify workers]
  WK -->|run record| F
```

Control flow for a stage step: wrapper (`/sk.plan` …) runs → on completion the Stop hook (installed by `src/extension.ts`; existing Stop handler ~L279 already stamps turn completion) calls `appendRunRecord` with `stageBefore`, `stageAfter`, cost, time, branch, PR → Specs tab watcher (existing, `webviewProvider.ts` ~L3895) rescans → card shows new stage, next step, buttons.

## Interfaces and contracts

See [contracts/](contracts/) and [data-model.md](data-model.md).

- `src/specs/stages.ts` — `SPEC_STAGES` ordered list, `nextStep(stage)`, `impliedStage(artifacts)`, `stageMismatch(stored, implied, artifacts)`.
- `src/specs/staleness.ts` — `artifactRanks(root, files): Map<file, Rank>`; `staleArtifacts(root, slug): StaleEntry[]`.
- `src/specs/runRecords.ts` — `appendRunRecord(root, slug, rec)`, `readRunRecords(root, slug)`, `specFacts(records)`.
- `src/specs/readiness.ts` — `readinessLines(result): string[]`.
- `src/specs/specKitScanner.ts` — adds `task.tags`, `task.story`, `spec.stories[]`, `spec.stage` (stored or implied), `spec.impliedStage`, `spec.mismatch`, `spec.stale[]`, `spec.facts`.
- `tools/spec-facts.cjs` — CLI `node tools/spec-facts.cjs <slug> --json` printing the same facts for wrappers, `/pr-daily`, `/sk.handoff`.
- `src/workers/workerRouter.ts` — admission rule `admitBuild(track, allowedPaths)`; `scopeCheck(base, head, allowedPaths)`.

## Ownership boundaries (one writer per area)

| Area | Files | Story |
|---|---|---|
| Stage + staleness | `src/specs/stages.ts`, `src/specs/staleness.ts`, scanner stage fields | US1 |
| Specs tab UI | `media/webview.js` Specs section, `media/main.css`, provider Specs markup | US1, US2 (sequential) |
| Story parsing | `src/specs/specKitScanner.ts` `parseTasks` | US2 |
| Prompt assets | `src/specs/specKitPromptAssets.ts`, user prompt copies | US2, US3 |
| Run records + facts | `src/specs/runRecords.ts`, `tools/spec-facts.cjs`, Stop-hook writer installed by `src/extension.ts` | US4 |
| Telegram | `src/commentary/telegramLive.ts` | US4, US7 |
| PR + checkpoint | `src/specs/checkpoint.ts`, `tools/pr-daily-facts.cjs` | US5 |
| Orchestrator dispatch | `src/workers/workerRouter.ts`, orchestrator agent md, PreToolUse guard installed by `src/extension.ts` (next to the RTK gate ~L130) | US6 |
| Readiness | `src/specs/readiness.ts` | US7 |

## Compatibility and migration

- Older specs (001, 003, 004) keep `CY-NNN` tags and `.specify/cycles.md`; the scanner keeps the cycle path. Story grouping applies when phase headings match `Phase N: User Story N` or tasks carry `[USn]`.
- `SpecStage` values change from derived labels (`needs-clarify`, `planned` …) to Spec Kit names. The webview maps old labels nowhere else (only the scanner produces them); both sides change in the same commit.
- Existing `specCostLedger` rows are imported once (D-16).

## Failure behavior

- `git` missing or not a repo → staleness `unavailable`, shown once on the card; stage still works.
- Malformed run record → skipped, counted in `facts.skippedRecords`, shown as a warning; never crashes the scan.
- `gh` missing/unauthenticated → PR shows "PR unknown (gh unavailable)"; checkpoint result BLOCKED, never PASS.
- Verify worker cannot run the Independent Test → story result BLOCKED, PR not marked ready.

## Security

- Run records contain no prompt text, tokens, or env values; writer uses an allow-list of fields.
- `gh` uses the developer's existing auth; no credential is stored.
- Hook denial messages never echo the command's arguments beyond the operator found.

## Performance

- Git queries batched: one `git status --porcelain -- specs/<slug>` and one `git log --format=%H%x09 --name-only -- specs/<slug>` per spec, parsed once; results cached keyed by `HEAD` sha + porcelain output.

## Observability

- Each run record is itself the event. The Specs tab shows `skippedRecords`, staleness availability, and the gh state.

## Rollback

- All changes are in-repo code; revert the story PR. Run records are data and can stay (readers ignore unknown fields).

## Environment and commands

- Build: `cd tasksync-chat && npx tsc -p ./ --noEmit && node esbuild.js`
- Webview syntax: `node --check media/webview.js`
- Tests: `cd tasksync-chat && npm run test:workers` → expected final line with 0 failures.
- Deploy (local): per `.github/copilot-instructions.md`, then reload window.
- Secrets used: none new. `gh` auth must be present for US5.

## Implementation order (stories are the phases)

| Phase | Deliverable | Depends on | Parallel-safe inside |
|---|---|---|---|
| Setup | Test fixtures: sample repo generator `tasksync-chat/test-fixtures/specs-sample.cjs` (specs at each stage, one legacy cycle spec, git history) | — | — |
| Foundational | `stages.ts`, `runRecords.ts` (append/read/facts) with tests; scanner exposes `task.tags`; `.gitignore` tracks `.askaway/specs/` | Setup | `stages.ts` ‖ `runRecords.ts` |
| US1 | Stored stage + mismatch + staleness on the card; stage button + `/sk.check` + next step | Foundational | `staleness.ts` ‖ render blocks |
| US2 | Story parsing + story groups on the card; prompt assets rewritten to stories | Foundational | parser ‖ prompt assets |
| US3 | Routing rules in AskAway Build agent + prompt assets; `/sk.continue` `/sk.handoff` `/pr-daily` read `tools/spec-facts.cjs`; routing eval (10 messages) | US1 | eval set ‖ prompt edits |
| US4 | Hook writes run records; card facts; ledger import; Telegram cost+tokens confirmed | Foundational | — |
| US5 | Checkpoint verify packet, PR state via gh, ready badge | US2, US4 | — |
| US6 | Router admission (track cap, disjoint globs), scope check, orchestrator hook | US2 | router ‖ hook |
| US7 | `readiness.ts` + converge output + three surfaces | US4 | — |
| Polish | Storybook stories, docs in `tasksync-chat/README.md`, deploy | all | — |

Each story ends at its Checkpoint: its Independent Test (spec.md) passes as an automated test in `test:workers`, the SCs marked `Verified by: USn` are checked, the story PR is ready for the reviewer.

## Cloud Worker Packet (template for any story task)

- **Repository**: `github.com/<owner>/TaskSync` (origin of this workspace).
- **Base**: the story branch head sha written in the task's packet; checkout `git checkout <sha>` then work on the story branch.
- **Allowed paths**: the task's files from the Ownership table.
- **Required inputs**: `specs/005-speckit-guided-flow/{spec,plan,data-model}.md`, `contracts/`, `Rules.md`.
- **Produced artifacts**: code + one test in `tasksync-chat/test-*.cjs` added to `test:workers`.
- **Verification**: `cd tasksync-chat && npx tsc -p ./ --noEmit && node --check media/webview.js && npm run test:workers` → 0 failures, and the named new test prints its pass line.
- **Completion**: verification passes; `git diff --name-only` ⊆ allowed paths; report lists commands and outputs. Stop and ask on any behaviour not decided in this plan.

## Project Structure

### Documentation (this feature)

```text
specs/005-speckit-guided-flow/
├── Goal.md  Rules.md  spec.md
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/  (run-record.schema.json, spec-facts-cli.md, dispatch-packet.md)
├── checklists/
└── tasks.md   (next: /sk.tasks)
```

### Source Code

```text
tasksync-chat/
├── src/specs/      specKitScanner.ts (edit) stages.ts staleness.ts runRecords.ts readiness.ts checkpoint.ts (new) specKitPromptAssets.ts (edit)
├── src/workers/    workerRouter.ts (edit: admission, scope check)
├── src/commentary/ telegramLive.ts (edit: readiness lines)
├── src/webview/    webviewProvider.ts (edit: Specs markup, messages)
├── media/          webview.js main.css (edit: stage bar, story groups, facts, readiness)
├── src/extension.ts  installs run-record writer (Stop) and orchestrator command guard (PreToolUse) hook scripts
├── tools/          spec-facts.cjs (new), pr-daily-facts.cjs (edit)
├── evals/          routing set (new)
└── test-*.cjs      one per story
```

**Structure Decision**: single existing extension project; no new package.

## Complexity Tracking

None.

## Later

Moved out of tasks.md by the task budget; each becomes tasks when US1–US2 close.

- US3: `tools/spec-facts.cjs` per contracts/spec-facts-cli.md + test; routing rules (D-8) in AskAway Build agent and `sk.continue`/`sk.handoff`/`/pr-daily`; routing eval (10 labelled messages, ≥9/10).
- US4: Stop-hook run-record writer; worker runs write records; one-time ledger import (D-16); `renderSpecFacts` on the card; test for concurrent writers, card totals, Telegram cost+tokens.
- US5: `src/specs/checkpoint.ts` verify packet + record; active PR via `gh` (D-12, D-13); test with stubbed worker/gh (PASS→ready, FAIL/BLOCKED→not ready, new story→new PR).
- US6: router admission (track cap, glob overlap, `allowedPaths` required); `scopeCheck`; orchestrator PreToolUse guard (D-19); orchestrator agent text; `test-orchestrator-dispatch.cjs`.
- US7: `src/specs/readiness.ts` (`readinessLines`, PASS without evidence → BLOCKED); used by Specs tab, Telegram, `/pr-daily`; `test-readiness-surfaces.cjs`.
- Polish: Storybook stories for the new render blocks; README "Guided flow"; quickstart run + deploy.
