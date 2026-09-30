# Quickstart — verify 005 end to end

Prerequisites: `git`, `gh` (authenticated), Node ≥18, AskAway built from `tasksync-chat/`.

1. Build and test
   ```bash
   cd tasksync-chat
   npx tsc -p ./ --noEmit
   node esbuild.js
   node --check media/webview.js
   npm run test:workers        # expect: 0 failed
   ```
2. Stage facts for a spec
   ```bash
   node tools/spec-facts.cjs 005 --json   # storedStage, nextStep, stale[], stories[]
   ```
3. Staleness: edit `specs/005-speckit-guided-flow/spec.md` without committing, rerun step 2 → `plan.md` listed with `upstream-dirty`.
4. Specs tab: deploy locally (see `.github/copilot-instructions.md`), reload window, open Specs tab → the card shows stage, the stage button, `/sk.check`, next step, story groups with progress, facts (branch, PR, cost, agent time).
5. Orchestrator cap: run `node test-orchestrator-dispatch.cjs` → prints `admission: 2 running, 1 queued (track-cap)` and `overlap queued`.
6. Readiness: `node test-readiness-surfaces.cjs` → identical lines for Specs tab, Telegram, PR text; a check without evidence is `BLOCKED`.
