# Metrics tab

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-METRICS-01 | The Metrics tab covers the current conversation only; worker spend does not appear there. | "Metrics tab be for current conversation alone, as it is today" (2026-10-01) | test-worker-observability.cjs EV-011 |
| R-METRICS-02 | The turn trace shows the worker ID so it can be filtered. | "can we show worker ID in the metrics tab, turn trace? So that i can filter and see more details?" (2026-09-24) | gap |
| R-METRICS-03 | The turn trace is one shared render block that the Workers trace also uses. | "reuse the same UI of turn trace in metrics tab in worker trace also, as we have same set of hooks" (2026-09-24) | test-workers-control-plane.cjs EV-038 |
| R-METRICS-04 | Newest trace rows sit at the bottom, like every other feed. | "Keep most recent one in the bottom. As everything is like that." (2026-09-24) | test-commentary-ui.cjs EV-030c |
| R-METRICS-05 | Tool rows start collapsed and expand and collapse on click. | "tools are always expended. They are not getting collapsed." (2026-09-24) | test-workers-control-plane.cjs EV-038 |
| R-METRICS-06 | Metrics and Workers traces both show credits (Copilot nano-AIU / 1e9; OpenCode dollars x 100), whole numbers from 10 up; the chat banner stays in dollars. | "I see dollars in both metrics and worker trace. Use credits in both. I liked credits as they are mostly integers and easy to understand." (2026-10-01) | test-workers-control-plane.cjs EV-038 |
