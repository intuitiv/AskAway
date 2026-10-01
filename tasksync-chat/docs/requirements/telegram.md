# Telegram

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-TELE-01 | A new user message opens a new live Telegram message, and the previous one stops being polled. | "we start new message on new user message and we stop polling when we get another new message" (2026-09-28) | test-telegram-turn-lifecycle.cjs EV-051 |
| R-TELE-02 | Commentary updates the same Telegram message in place. | "update the same on telegram" (2026-09-28) | test-telegram-live-commentary.cjs EV-048 |
| R-TELE-03 | A heads-up is flagged so it stands out. | "so that i'll be prepared" (2026-09-24) | test-telegram-live-commentary.cjs EV-048 |
| R-TELE-04 | The live status line refreshes about every 2 minutes and warns when the agent looks stuck. | "updates every 2 min so that if agent is stuck or errored out, i'll can track" (2026-09-28) | test-telegram-turn-lifecycle.cjs EV-053-LIVE |
| R-TELE-05 | The final response arrives as a new, notifying message that replaces the live one. | "Sometimes i dont get telegram notification when task is finished" (2026-09-29) | test-telegram-turn-lifecycle.cjs EV-051 |
| R-TELE-06 | Status and final messages carry cost and tokens, including worker requests and cost. | "the details we send to Telegram should include workers requests, and cost" (2026-10-01) | test-worker-turn-spend.cjs EV-WORKER-TURN-SPEND |
| R-TELE-07 | The handoff message orders banner, handoff and details, and a later turn posts the current handoff without lag. | "I start on vscode and swithc to telegram. When i go on mobil, i want to see the status." (2026-09-28) | test-telegram-handoff.cjs EV-TELEGRAM-HANDOFF |
| R-TELE-08 | A Telegram reply reaches the conversation, and a VS Code reply stops Telegram polling. | "sometimes i'll respond to them from telegram, once all messages forom queue are finished" (2026-09-28) | test-telegram-conversation-reply.cjs EV-TELEGRAM-CONVERSATION-REPLY |
| R-TELE-09 | Queued messages can be watched on Telegram, and the turn closes when the next queued message arrives. | "most fo the times i'll queue some messages and watch on telegram" (2026-09-28) | test-telegram-turn-lifecycle.cjs EV-051 |
| R-TELE-10 | Another workspace shows only live conversation status, not this workspace's commentary. | "only live conversation status should be shown there" (2026-09-28) | test-telegram-turn-lifecycle.cjs EV-053-LIVE |
| R-TELE-11 | ask_user is either removed or reused as the side channel with agents. | "ask_user was a old tool, we may either rmeove it or reuse the same for side channel" (2026-09-28) | gap |
| R-TELE-12 | A cloud-task morning digest goes to Telegram (PR, evidence, duration, model, blocker, decision needed). | "morning digest: PR, evidence, duration, model, blocker, decision needed" (2026-09-30) | gap |
