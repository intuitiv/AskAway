# Webex migration research — 2026-10-12

Binding sources: [spec.md](spec.md), [GOALS.md](../../GOALS.md) G7 and section 4 Webex answers/turn thread, [ADR 0018](../../docs/adr/0018-webex-replaces-telegram.md), and [telegram.md](../../tasksync-chat/docs/requirements/telegram.md). No live network discovery or credential inspection was performed.

| Finding | Evidence / decision | Rejected alternative |
|---|---|---|
| Existing RemoteChannel owns shared transport | src/services/remoteChannel.ts, webexService.ts, telegramService.ts | Duplicate channel-specific caller/render logic |
| Existing callers cover Commentary, turns, handoff, digest and ask_user | plan.md caller table | Assume adapter tests alone prove all callers |
| Personal-token self-posts never notify | GOALS Webex notifications; spec US5/6 | Claim delivery proves phone notification |
| Incoming webhook is outbound alert-only, text/markdown, no usable id or parentId | spec clarification / US6 | Inbound listener, exposed laptop, cards or assumed returned root id |
| Webex has no long-poll API | spec clarification / FR-021 | Invent long-poll support instead of REST polling/backoff |
| Track posted/processed IDs, not sender identity | src/services/webexService.ts ledger; FR-025 | Exclude the reviewer's same-person replies |
| Own General is AskAway General | GOALS 2026-10-09 General; R-TELE-33 | Select built-in General or another team's space |
| Final metrics currently contain only input/output/cost | src/services/handoffNotifier.ts TurnMetricsSnapshot/telegramHandoffUpdate | Assert full worker metrics without a production caller fix |
| Failed edits return false; sendText does not bound oversized content | src/services/webexService.ts editLive/sendText | Treat manual retry as retained automatic recovery |
| Source scope mismatch blocks rule fixes | Actual src/services/** and src/commentary/**, packet permits other directories | Move/refactor files merely to bypass allowed scope |

## Open verification, not new design questions

US5 live notification evidence stays deferred under this packet; webhook design is already confirmed and bots are prohibited. T018/T022 live delivery stays open without ASKAWAY_WEBEX_LIVE=1; tests must still fake SecretStorage/Keychain (FR-036). No unresolved bot decision is reintroduced. Source edits require the reviewer/orchestrator to include the actual paths. Scope, live skips and outside-scope failures remain explicit blockers, never substituted acceptance criteria.
