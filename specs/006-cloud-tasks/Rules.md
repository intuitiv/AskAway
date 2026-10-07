# Rules — 006 Cloud Tasks

Decisions the reviewer stated. Binding 005 rules: `specs/005-speckit-guided-flow/Rules.md` § "Cloud tasks (GitHub)". Change a rule only when the reviewer changes it.

## Time cap (2026-10-06; confirmed 2026-10-07)
- "61 minutes is okay. I think it is reasonable to have cap on time."
- Reviewer 2026-10-07: "Okay. We dont want to be more than that also." Each cloud task has a per-run wall-clock cap (spec FR-024): default 50 min, hard max 59 min, never above. This also caps T004; the earlier 61-minute budget is superseded.

## Live proof and open decisions (2026-10-07)
- T004 used throwaway PR #1608, superseding #1603: "use throwaway PR. And cloud agent is enabled, but not sure if it require approval or not, but try and test it". Evidence: `evidence/proof-2026-10-07.md`.
- F7 and F21: decided 2026-10-07, see below.

## Merging (2026-10-07, F7)
- "PR merge is done by human. Not done automatically." / "do not merge PRs." AskAway never merges a PR. The plan's required-status merge block (C-8) is dropped; the Specs tab only shows that a cloud task is still working.

## Go/no-go (2026-10-07, F21)
- "I want a demo for it, before i enable it in production." T004 is a demo run with the reviewer; cloud tasks stay off in production until the reviewer approves after that demo.
- After demo, reviewer: "Sure productise cloud thing. As it is triggered only when i ask for it. Not always." **GO**: productise; every cloud task requires an explicit reviewer request. Never automatically queue eligible tasks, launch on startup or schedule by default; a Held task can proceed only under its existing explicit request.
- Observed route: Copilot eyes reactions, `copilot_work_started`/`copilot_work_finished`, `[PROOF-1]`/`[PROOF-1b]` commits on the SAME branch, genuine `Copilot` reports. Sessions sequential, so one active attempt per PR. First start ~1 min after request; pushes ~2 min each (113 s and 165 s); start-to-report 77 s/50 s.
- Models self-reported only: Claude Sonnet 5.5 when requested, GPT-5.6 Terra when not; selection enforcement not proven. GitHub Actions `copilot` ran without an observed approval hold; repo approval setting/ordinary workflows not captured. GO does not erase those limits.

## Model (2026-10-06)
- "Sure": the PR-default model fallback is accepted per FR-008 "where GitHub allows" (analyze F13).

## Model preference (2026-10-07)
- Reviewer: "Regarding sonnet, use Sol 6.1 instead of Terra. Using Sonnet is also okay in some cases."
- Prefer Sol 6.1 (`github-copilot/gpt-6.1-sol`) for mid-tier work; Claude Sonnet 5.5 remains an explicit option where GitHub allows selection. Historical model self-reports above are observations, not recommendations; selection enforcement remains unverified.

## Scope (2026-10-06)
- Whole-story delegation to GitHub is wanted, not excluded (Goal.md; Later US6; analyze F22).
