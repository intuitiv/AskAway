# Research — 006 Cloud Tasks

Sources: GitHub docs fetched 2026-09-30 ("Using Copilot cloud agent on GitHub", "Changing the AI model for GitHub Copilot cloud agent", "Configuring settings for GitHub Copilot cloud agent", "About GitHub Copilot cloud agent").

## R-1 Route
- "You can mention `@copilot` in a comment on any pull request … By default, Copilot pushes commits directly to the pull request branch." → chosen route (C-1).
- Issue assignment: Copilot raises a new PR; ignores later issue comments → rejected as default (spec FR-007).
- "Copilot only responds to comments from people who have write access" → push-permission refusal (C-21).

## R-2 Signals
- "When Copilot starts a new session in response to your comment, an eyes emoji (👀) reaction appears on the comment. A 'Copilot has started work' event appears in the pull request timeline." → C-4. Exact timeline event name is not documented → recorded in US1 fixture.
- "Copilot remembers context from previous sessions on the same pull request" → packets can stay short.

## R-3 Model
- "When submitting a pull request comment … through the GitHub web interface, select a model with the model picker. Copilot uses the model from the original pull request by default."
- "Model selection … only supported when … mentioning @copilot in a pull request comment on GitHub.com … Where a model picker is not available, Auto will be used." → API/CLI-posted comment most likely uses PR default/Auto; US1 proves it (C-3).

## R-4 Actions
- "By default, GitHub Actions workflows will not run automatically when Copilot pushes changes to a pull request." Admin can disable "Require approval for workflow runs" under Settings → Copilot → Cloud agent. Warning: unreviewed code can reach secrets. → C-19; spec assumption corrected.

## R-5 Limits
- "Each Copilot cloud agent session has a maximum execution time of 59 minutes" (can be shortened by `timeout-minutes` in `copilot-setup-steps.yml`) → C-17.
- "Copilot can only work on one branch at a time" → per-PR serialisation default (C-5).
- Rulesets that restrict commit authors block the agent unless Copilot is a bypass actor → US1 records if refused.
- Cost: "Copilot cloud agent uses GitHub Actions minutes and AI credits" with no per-session price → duration + model only (FR-013).

## R-6 Local integration points
- `gh` CLI already used in `tasksync-chat/tools/pr-daily-facts.cjs` (repo meta, PR state, checks, GraphQL threads) → reuse, inject exec for tests.
- Workers feed shared row renderer `traceRowsHtml` (Metrics + Workers traces) → reuse for cloud runs (C-20).
- Telegram live status `src/commentary/telegramLive.ts` → digest reuses the same delivery.
