# Commentary tab (formerly Live): feed, goal box, turn panes

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-LIVE-01 | ~~The tab is called Live commentary.~~ Replaced 2026-09-24: the tab is named Commentary. | "Rename the tab as comentary." (2026-09-24) | test-commentary-ui.cjs EV-030b |
| R-LIVE-02 | The feed shows the orchestrator's progress in 10-20 plain words per line, so the reviewer can trace it, guide it in time and be ready for questions. | "These are the only 3 reasons why i need live comentary." (2026-09-24) | test-commentary-backend.cjs EV-030 |
| R-LIVE-03 | Commentary is a tool call, not prose. | "isnt it better to have as a tool call?" (2026-09-24) | test-commentary-backend.cjs EV-030d |
| R-LIVE-04 | Only two kinds exist, update and heads-up, and there are no category filters. | "As we dont have those many categories you can remove filtering also" (2026-09-24) | test-commentary-ui.cjs EV-030a |
| R-LIVE-05 | A heads-up names the exact decision or input needed. | "Orchestrator has all the context, it has to be explicit on what it needs." (2026-09-24) | test-eval-graders.cjs EV-034 |
| R-LIVE-06 | Text is plain language, not technical, and may use light markdown, emoji, bold and highlight. | "commentary text is too technical. Can we simplify it further?" (2026-09-24) | test-eval-graders.cjs EV-034 |
| R-LIVE-07 | Lines type in with a typewriter effect. | "i need some smoother transition. like typewriting effect." (2026-09-24) | test-commentary-ui.cjs EV-030b |
| R-LIVE-08 | Lines carry no A.1 / 0.1 / B.1 style labels. | "What do we need A.1, 0.1, B.1 and so on? Remove it." (2026-09-24) | test-commentary-ui.cjs EV-030a |
| R-LIVE-09 | Newest line sits at the bottom, like every other feed; this must not regress. | "Commentary has latest message on top. We fixed it in teh past, but it got reveretd. This is a regression, fix it and add a testcase." (2026-09-25) | test-commentary-ui.cjs EV-030c |
| R-LIVE-10 | At the start of a new turn the previous turn's lines fold into one collapsed pane. | "at the beginning of new turn wrap the current top ones into a turn and collapse." (2026-09-25) | test-commentary-ui.cjs EV-030e |
| R-LIVE-11 | Time and count sit on a second, right-aligned line in smaller bold text so the commentary is not trimmed. | "time can be moved to right in next line in smaller bold text." (2026-10-01) | test-commentary-ui.cjs EV-030e |
| R-LIVE-12 | The goal box is autosaved, with no Save or Clear buttons. | "Main goal should be autosaved. So you can drop save and clear buttons." (2026-09-24) | gap |
| R-LIVE-13 | The goal box is at least 6 lines, has no heading, and the purple border sits on the text box only. | "Main goal box should be slightly bigger. atleast 6 lines." (2026-09-24) | test-commentary-ui.cjs EV-030b |
| R-LIVE-14 | Copy-opener and clear-feed are icons. | "For copy opener and clear feed, show icons." (2026-09-24) | test-commentary-ui.cjs EV-030b |
| R-LIVE-15 | Copy produces an opener for the next conversation. | "give me copy option on top, whcih i'll use as next conversation" (2026-09-24) | test-commentary-backend.cjs EV-030 |
| R-LIVE-16 | The goal and uncleared commentary carry into the next conversation until the reviewer clears them. | "if live comentary is not cleared, the goal and live comentary will be carried to next conversation" (2026-09-24) | test-commentary-backend.cjs EV-031 |
| R-LIVE-17 | Commentary appears only in the workspace that posted it. | "I see commentary from this workspace in another workspace also. IS that expected, i think not" (2026-09-28) | test-commentary-backend.cjs EV-030d |
| R-LIVE-18 | The reviewer is neither bombarded nor missing key events: one line per significant stage, not per tool. | "I dont want to get bombarded with messages at teh same time i dont want to miss any key things" (2026-09-24) | gap |
| R-LIVE-19 | A Storybook story shows the exact tab and a sample conversation of commentary with workers. | "show me in storybook, so that i get tosee exact replica" (2026-09-24) | test-commentary-ui.cjs EV-SB-SAMPLE |
| R-LIVE-20 | Commentary lines go to a live Telegram message that updates in place. | "commentary, we can push to telegram, to a live message" (2026-09-28) | test-telegram-live-commentary.cjs EV-048 |
| R-LIVE-21 | A folded turn's head shows only the commentary text; the time range and count/heads-up line sit inside the expanded pane. | "For commentary if we have collapsible thing, we can hide time and last text under collapse thing." (2026-10-01) | test-commentary-ui.cjs EV-030e |
