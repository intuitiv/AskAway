# Remote requirements coverage

Artifact map only, not a claim that all listed guards were rerun. Reviewer wording stays in [telegram.md](../../../tasksync-chat/docs/requirements/telegram.md); newest availability rows win. test-goals-docs.cjs validates every R-TELE row, FR/story mapping and guard artifact.

| Row | FR | Story | Guard / gap |
|---|---|---|---|
| R-TELE-01 | FR-001/039 | US2 | test-availability-updates.cjs |
| R-TELE-02 | FR-002/039 | US2 | test-availability-updates.cjs |
| R-TELE-03 | FR-003 | US2 | test-telegram-live-commentary.cjs |
| R-TELE-04 | FR-004/039 | US2 | test-availability-updates.cjs |
| R-TELE-05 | FR-005/034/039 | US2/6 | test-webex-turn-thread.cjs; test-availability-updates.cjs |
| R-TELE-06 | FR-006 | US2 | test-remote-channel-parity.cjs (provider status/final combined totals and workers) |
| R-TELE-07 | FR-007 | US2 | test-remote-channel-parity.cjs (banner ordering) |
| R-TELE-08 | FR-008/035 | US2/6 | test-webex-turn-thread.cjs |
| R-TELE-09 | FR-009 | US2 | test-telegram-turn-lifecycle.cjs; test-remote-channel-parity.cjs |
| R-TELE-10 | FR-010 | US2/3 | test-webex-remote-adapter.cjs (workspace/General routing only) |
| R-TELE-11 | FR-011 | US2 | test-webex-ask-user.cjs |
| R-TELE-12 | FR-012 | US2 | test-cloud-digest.cjs |
| R-TELE-13 | FR-013/026 | US2/3 | test-webex-remote-adapter.cjs (partial); bounds/automatic edit retry gap |
| R-TELE-14 | FR-014 | US2/3 | test-remote-handoff.cjs; test-webex-remote-adapter.cjs (PDF bytes only) |
| R-TELE-15 | FR-015 | US2 | full event coverage gap |
| R-TELE-16 | FR-016 | US2 | test-remote-channel-parity.cjs (provider worker share/count/IDs, requests/cache/efficiency/cost/tokens) |
| R-TELE-17 | FR-017/039 | US2 | test-availability-updates.cjs |
| R-TELE-18 | FR-018 | US2 | test-remote-channel-contract.cjs; test-remote-channel-parity.cjs |
| R-TELE-19 | FR-019 | US2 | test-remote-channel-parity.cjs (existing Telegram adapter retained) |
| R-TELE-20 | FR-020/027 | US1 | test-webex-token-command.cjs |
| R-TELE-21 | FR-021 | US3 | test-webex-reply-poll.cjs |
| R-TELE-22 | FR-022/031 | US3 | test-webex-workspace-space.cjs |
| R-TELE-23 | FR-023/031 | US4 | test-share-with-me-webex.cjs SKIP; live arrival gap |

| R-TELE-24 | FR-027/029 | US1 | test-webex-token-command.cjs |
| R-TELE-25 | FR-029/030 | US1 | test-webex-token-command.cjs |
| R-TELE-26 | FR-030 | US1 | test-webex-token-command.cjs |
| R-TELE-27 | FR-029 | US1 | test-webex-token-command.cjs |
| R-TELE-28 | FR-029 | US1 | test-webex-token-command.cjs |
| R-TELE-29 | FR-028/034 | US5/6 | test-webex-incoming-webhook.cjs; live notification deferred |
| R-TELE-30 | FR-028 | US5 | test-webex-incoming-webhook.cjs |
| R-TELE-31 | FR-028 | US5 | gap: no incoming-webhook creation API found |
| R-TELE-32 | FR-031 | US1/3 | test-webex-workspace-space.cjs |
| R-TELE-33 | FR-031 | US3/4 | test-webex-workspace-space.cjs |
| R-TELE-34 | FR-032 | US2/3 | test-remote-polling-status.cjs |
| R-TELE-35 | FR-032 | US2/3 | test-webex-live-reply.cjs |
| R-TELE-36 | FR-034 | US6 | superseded; test-webex-turn-thread.cjs |
| R-TELE-37 | FR-033 | US6 | superseded no-cards rule; test-webex-turn-thread.cjs |
| R-TELE-38 | FR-033/034/039 | US6 | test-availability-updates.cjs |
| R-TELE-39 | FR-033/034/039 | US6 | test-availability-updates.cjs |
| R-TELE-40 | FR-035 | US6 | test-webex-turn-thread.cjs |
| R-TELE-41 | FR-037/038/040 | US7 | test-webex-tools-suite.cjs |
| R-TELE-42 | FR-011 | US2 | test-webex-ask-user.cjs |
| R-TELE-43 | FR-040 | US7 | test-webex-tools-suite.cjs |
| R-TELE-44 | FR-041 | US7 | test-webex-tools-suite.cjs |

Superseded row variants share their original ID and are governed by the latest cited availability/combined-final rules. No live notification or full-parity closure.
