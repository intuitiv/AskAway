# Goal — 008 Harness Benchmark

"is there any standard simulated workspace, with specs and all, and create some task and run with all agents, and different prompts and see how we can solve the problem with less cost?" (reviewer)

"I want some number to show how efficiently the harness ran." (reviewer)

"For single model, it is model price, but in harness we use combination right" (reviewer)

A fixed simulated workspace and task set let the reviewer compare agent prompts, harnesses and model mixes on accepted work and whole-harness spend, rather than judging a combination by one model's price.

## Outcomes that define done
- **Same problem for everyone.** Each configuration starts from the same workspace, specs, seeded bugs and task set.
- **Acceptance is independent.** A hidden grader decides whether tasks pass; success claims alone never count.
- **Comparable scoreboard.** Pass rate, $, requests, tokens and a labelled harness-efficiency number are visible per configuration.
- **Combination fully accounted.** All participating agents and models, failed work and retries count toward usage and cost.
- **Efficiency is a reviewer decision.** Keep the formula open in spec.md; recommend both context amplification live in the shared banner and $ per accepted task on the scoreboard.
