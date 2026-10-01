# Shared usage banner (chat, Metrics, Workers)

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-BANNER-01 | One shared banner template is used wherever usage is shown (chat, each worker card), never a look-alike. | "if we reuse the same component and send data by converting into single format, we get consistent experience" (2026-09-24) | test-workers-control-plane.cjs EV-015 |
| R-BANNER-02 | The banner shows the next-input size (last input) and the turn output. | "what is the next input token size, thats what we need to monitor" (2026-09-24) | test-specs-webview-regression.cjs EV-SPECS-WEBVIEW-REGRESSION |
| R-BANNER-03 | Age counts up every second and never freezes. | "Age in worker banner is not counting. They are getting stuck." (2026-09-24) | test-workers-control-plane.cjs EV-015 |
| R-BANNER-04 | Age keeps tracking past 5:00 and restarts when a new request or a new message starts. | "when age is more than 5:00 for some tool, I think it stops tracking" (2026-09-30) | gap |
| R-BANNER-05 | The banner is rebuilt after a window reload and is never blank. | "shared banner is blank why? why it is not getting updated?" (2026-09-25) | test-turn-replay.cjs EV-OBS-RELOAD |
| R-BANNER-06 | Waits are timed from when the provider's last request started, so the 4-minute cache window is honoured. | "we have 4 min timer but github timer could be slightly off" then "optio A is ok" (2026-09-29) | test-cache-clock-waits.cjs EV-CACHE-CLOCK |
| R-BANNER-07 | Worker requests and cost are added live to the shared banner (not to the Metrics tab). | "Total cost should reflect in the shared banner. If we add requests by worker also into shared banner thats better" (2026-10-01) | test-worker-turn-spend.cjs EV-WORKER-TURN-SPEND |
| R-BANNER-08 | The banner shows the total time since the current turn started. | "Can we show total time from when the current turn is running?" (2026-10-01) | gap |
| R-BANNER-09 | Telegram status and final messages carry the same usage, including worker requests and cost. | "the details we send to Telegram should include workers requests, and cost" (2026-10-01) | test-telegram-turn-lifecycle.cjs EV-051 |
| R-BANNER-10 | Cost uses one format everywhere (credits in Metrics versus dollars in Workers should match). | "in metrics tab we shwo credits and in worker tab we show $. Can we show in same format?" (2026-10-01) | gap |
