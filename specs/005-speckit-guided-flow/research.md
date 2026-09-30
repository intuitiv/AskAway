# Research — 005 Spec Kit Guided Flow

## R-1 Current Specs tab and stage
- Stage today is **derived**, not stored: `deriveStage()` in `tasksync-chat/src/specs/specKitScanner.ts` (~L285) returns `needs-clarify | specified | planned | tasks-ready | in-progress | done` from artifacts and ticks.
- Activity uses file mtimes (`newestMtime`/`oldestMtime`); no git.
- All/Completed switches already exist (`webviewProvider.ts` ~L6871 markup, `media/webview.js` `initSpecsTab` ~L5600, `visibleSpecs` ~L5764) and are covered by `test-specs-webview-regression.cjs`. FR-007 is already delivered; US1 only re-verifies it.
- Decision: replace `deriveStage` with `impliedStage` (Spec Kit names) and add stored stage from run records (Decision Register D-1…D-5).

## R-2 Staleness by commit order
- Considered: file mtimes (rejected: checkout/rebase rewrites mtimes; reviewer asked for commit order); commit timestamps (rejected: rebases and clock skew reorder); ancestry via `git merge-base --is-ancestor` (chosen, D-7).
- Cost: per spec one `git log --name-only` over `specs/<slug>` gives last commit per file in one call; ancestry checks only for dependent pairs (≤10 per spec).

## R-3 Per-spec storage
- Existing: `specCostLedger.ts` writes one JSON ledger per workspace under `~/.askaway` (single file, rewritten) keyed by active slug.
- Spec requires in-repo, one file per run (FR-014). Chosen: append-only files under `.askaway/specs/<slug>/runs/`; the old ledger is imported once (D-16).
- `.askaway/` currently holds only cowork outputs (gitignored by intent). `.askaway/specs/` becomes tracked (D-17).

## R-4 Prompt assets
- `/sk.*` text is generated from `SPEC_KIT_PROMPTS` in `src/specs/specKitPromptAssets.ts`; the constants `acceptance`, `categories`, `gates` inject AC-TNNN/CAC/PAC and phase categories into every wrapper. These contradict Rules.md ("No CY-NNN, PAC, or CAC in new specs") and are removed in US2.
- The installed user-level copies (`~/Library/Application Support/Code/User/prompts/sk.*.prompt.md`) currently still require cycles/PAC; they are regenerated from the assets.

## R-5 Workers
- `worker` LM tool: `src/workers/workerTools.ts`; router `src/workers/workerRouter.ts` (`route` ~L69) queues per worker and returns a `runId` immediately; no per-track build cap exists → added in US6.
- Profiles loaded from `~/.askaway/worker-profiles`; OpenCode agents synced by `syncOpenCodeAgents()`.

## R-6 Telegram
- `usageLine()` in `src/commentary/telegramLive.ts` (~L77) already adds request count, cost and tokens to live status (commit `88978c9`). FR-016 is delivered; US4 adds a regression test asserting every status message carries both.

## R-7 GitHub
- Only `tools/pr-daily-facts.cjs` talks to GitHub, via `gh` CLI (repo, PR, checks, review threads). Reuse `gh` for PR state/creation/ready (no Octokit, no new token).

## R-8 Plain-text routing
- Routing is model judgement; it lives in the AskAway Build agent instructions and prompt assets. It is measured with an eval set (10 labelled messages) in `tasksync-chat/evals/` run by the existing `run-evals.cjs` + `graders.cjs` (SC-004 ≥ 9/10).
