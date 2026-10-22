# Spec 010 (Team) reconciliation, 2026-10-22

Read-only pass over tasks.md, plan.md, requirements/team.md, ADR 0023–0036, GOALS.md, git log and the Team/agy/AITalk tests. No source code changed. Budget rule (tools/task-budget.cjs): at most 12 open tasks and 6 per story.

Result: 32 unchecked tasks became 21 DONE, 2 OBSOLETE (T034, T035) and 9 folded into 5 open slices (T042–T046). T043 and T046 are NEEDS-REVIEWER; T042, T044, T045 are OPEN work. T016, T020, T012, T015 were judged DONE because evidence exists (a stricter reader may reopen T016: its live proof is plan.md:38 and commit 83f6d9b, not a fresh run).

## Open slices
- T042 [US1] live agy proof: T003, T017, T018, T019.
- T043 [US2] NEEDS-REVIEWER: T007 plus the live look of T012.
- T044 [US3] @member routing by stable ID: T010, T026 (routing half).
- T045 [US4] final proof and gap closure: T013, plus CPO photo upgrade and package privacy from T005/T008.
- T046 [US3] NEEDS-REVIEWER: T021 avatar after reload.

## Table
| Task | Summary | State | Evidence |
|---|---|---|---|
| T001 | agy discovery, denial, usage/cost recheck | DONE | plan.md:36-38; R-TEAM-18 test-agy-runtime.cjs EV-WORKER-AGY; R-TEAM-30 EV-TEAM-SHELL |
| T002 | agy as alternate runtime for any profile | DONE | test-agy-runtime.cjs EV-WORKER-AGY, EV-AGY-READONLY-MODE; test-agy-tools.cjs EV-AGY-TOOLS; test-worker-identity-agy-claude.cjs; ADR 0033; commit 3abd741 |
| T003 | real scoped edit/build/test on agy + OpenCode regression | OPEN (in T042) | live Argon edits exist (plan.md:38-40) but closing proof T017–T019 missing |
| T004 | named roster and grouping | DONE | src/team/roster.ts via test-team-shell.cjs EV-TEAM-SHELL; spec.md:35,81; README.md:36-42 |
| T005 | member photos shared by AITalk and Team | DONE | R-TEAM-68/69/70 EV-TEAM-COMPACT, EV-AITALK-MEMBER-PHOTOS; EV-AITALK-USER-PHOTO; commits 3528acd, d1abfe2 (packaging/upgrade part in T045) |
| T006 | revise prototype per ADR 0024 | DONE | test-team-storybook.cjs; EV-TEAM-COMPACT; ADR 0028/0029 |
| T007 | Storybook sign-off and GIF | NEEDS-REVIEWER (T043) | GIFs shipped (README.md:66), compact cards approved (R-TEAM-66) but no explicit approval recorded |
| T008 | profile identity, navigation, agent-file intent | DONE | EV-TEAM-ACTIONS; EV-TEAM-EDIT-PROFILE; EV-TEAM-SHELL; EV-AITALK-CLICK-FOCUS (CPO upgrade part in T045) |
| T009 | Team rename, member rows, Priya pinned | DONE | EV-TEAM-SHELL; EV-TEAM-COMPACT; EV-TEAM-PILL-COUNT; EV-TEAM-PRIYA-TRACE |
| T010 | @member to running task via stable ID | OPEN (T044) | R-TEAM-09 note: routing of @member questions is a gap; queued delivery exists (R-AITALK-36/37/47) but no @Alias-to-task test |
| T012 | AITalk bugs: pinned, late agent, question order, typing | DONE | R-AITALK-51/50/26/27/28 EV-AITALK-MEMBER-PRESENCE, EV-AITALK-AGENT-PRESENCE, EV-AITALK-NATIVE-START, EV-AITALK-MCP-QUESTION, EV-AITALK-SHARED-TYPING; commit f8c3f18 (live look in T043) |
| T013 | final suites, requirement-gap closure | OPEN (T045) | no test checks the package for avatar.png; many R-TEAM rows still say gap |
| T014 | truthful README/CHANGELOG | DONE | README.md:36-42,58-66; CHANGELOG.md; commits deacdcc, 69fcd45 |
| T015 | agy MCP boundary | DONE | T039; R-TEAM-34 EV-AGY-TOOLS and live copilot_memory call; commit 5e578ab |
| T016 | agy edit + shell + denied command | DONE | plan.md:38; EV-AGY-APPROVE; EV-AGY-CONTINUE; EV-AGY-VERIFY-LOOP; EV-WORKER-AGY deny=FAILED; commit 83f6d9b |
| T017 | reload independence with real window reload | OPEN (T042) | test-agy-runtime.cjs:222-244 reloads a runtime object only |
| T018 | two-task + reuse accounting reconciliation | OPEN (T042) | raw usage once with fake CLI (test-agy-runtime.cjs:136,146); no live reconciliation |
| T019 | gate, deploy marker, post-deploy reload and dispatch | OPEN (T042) | no post-deploy agy dispatch recorded |
| T020 | Argon High defaults | DONE | EV-WORKER-ARGON-HIGH-DEFAULT; real Argon runs; ADR 0024:38; GOALS.md:749 |
| T021 | installed avatar visual acceptance | NEEDS-REVIEWER (T046) | hash matched (plan.md:47); only the reviewer can confirm after reload |
| T025 | existing tab contract | DONE | EV-TEAM-SHELL |
| T026 | simple names, notices, stable-ID mentions | OPEN (routing half in T044) | names/notices done: EV-AITALK-TEAM, EV-AITALK-NAMES; render keeps stable IDs (test-aitalk-team-production.cjs:32-44) |
| T027 | remove top pills | DONE | R-TEAM-24, R-TEAM-64; EV-TEAM-COMPACT; ADR 0028 |
| T028 | portrait-left row, bigger avatar | DONE | R-TEAM-69 EV-TEAM-COMPACT; commit 3528acd |
| T029 | model and effort dropdowns | DONE | R-TEAM-54 EV-TEAM-MODEL-SELECTION; EV-TEAM-RUNTIME-SETTINGS |
| T030 | profile edit form | DONE | R-TEAM-48/66 EV-TEAM-EDIT-PROFILE; EV-TEAM-ACTIONS; EV-TEAM-COMPACT |
| T031 | counted task pills | DONE | R-TEAM-43 EV-TEAM-PILL-COUNT |
| T032 | remove rollup and tip panel | DONE | R-TEAM-23/40 EV-TEAM-NO-TIPS |
| T033 | shared task-card block | DONE | test-workers-control-plane.cjs:154-167; test-team-compact.cjs:513 |
| T034 | three-model comparison launch | OBSOLETE | ADR 0024:38 (Sol dropped, Argon High chosen); GOALS.md:749 |
| T035 | comparison report | OBSOLETE | same as T034 |
| T040 | 2026-10-16 screenshot fixes | DONE | EV-TEAM-STABLE; EV-TEAM-SHELL; test-team-production-render.cjs:447,450; test-trace-tab.cjs:50; EV-AITALK-MEMBER-PHOTOS; EV-AITALK-TEAM |

Already closed before this pass: T011, T022, T023, T024, T036, T037, T038, T039, T041.
