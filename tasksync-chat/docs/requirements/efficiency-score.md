# Efficiency score and benchmark

Covers the per-turn cost-to-work score, where it is shown and how the benchmark uses it.

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-SCORE-01 | Each turn has one cost-to-work efficiency number showing how well it was done irrespective of outcome, with higher numbers better. | "This is like a number which can tell how well a turn was done, irrespective of outcome. Higher the number better it is." (2026-10-08) | gap |
| R-SCORE-02 | The efficiency score includes cost, input tokens, workers, requests, cache misses and output tokens. | "It will include cost, input tokens, workers, requests, cache miss, output token" (2026-10-08) | gap |
| R-SCORE-03 | The score should stay high regardless of turn duration, and a drop signals that something is not optimal. | "Score should be always high. No matter how long it ran. If it drops that means we are doing something unoptimal." (2026-10-08) | gap |
| R-SCORE-04 | The shared banner shows the efficiency score so the reviewer can monitor it and see what can be improved. | "Shared banner so that I monitor and see what can be done better" (2026-10-08) | gap |
| R-SCORE-05 | The benchmark uses the efficiency score to tune tools and prompts and raise the score. | "Benchmark will use it and tune tools, tune prompts and add stuff to increase the number." (2026-10-08) | gap |
| R-SCORE-06 | Telegram and other observability surfaces show the efficiency score for monitoring. | "Other observability places like telegram and all so that I can monitor" (2026-10-08) | gap |
| R-SCORE-07 | The benchmark separately reports whether the required task was completed, while the reviewer judges live turns. | "Benchmark will tell whether it completed the required task or not. And I'll decide whether it did well on live turns." (2026-10-08) | gap |
