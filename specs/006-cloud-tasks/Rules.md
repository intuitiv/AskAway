# Rules — 006 Cloud Tasks

Decisions the reviewer stated. Binding 005 rules: `specs/005-speckit-guided-flow/Rules.md` § "Cloud tasks (GitHub)". Change a rule only when the reviewer changes it.

## Time cap (2026-10-06; confirmed 2026-10-07)
- "61 minutes is okay. I think it is reasonable to have cap on time."
- Reviewer 2026-10-07: "Okay. We dont want to be more than that also." Each cloud task has a per-run wall-clock cap (spec FR-024): default 50 min, hard max 59 min, never above. This also caps T004; the earlier 61-minute budget is superseded.

## Live proof and open decisions (2026-10-07)
- T004 reviewer-named PR: https://github.com/Pega-ProductEngineering/model-calculation-service-app-logic/pull/1603.
- F7 and F21: decided 2026-10-07, see below.

## Merging (2026-10-07, F7)
- "PR merge is done by human. Not done automatically." / "do not merge PRs." AskAway never merges a PR. The plan's required-status merge block (C-8) is dropped; the Specs tab only shows that a cloud task is still working.

## Go/no-go (2026-10-07, F21)
- "I want a demo for it, before i enable it in production." T004 is a demo run with the reviewer; cloud tasks stay off in production until the reviewer approves after that demo.

## Model (2026-10-06)
- "Sure": the PR-default model fallback is accepted per FR-008 "where GitHub allows" (analyze F13).

## Scope (2026-10-06)
- Whole-story delegation to GitHub is wanted, not excluded (Goal.md; Later US6; analyze F22).
