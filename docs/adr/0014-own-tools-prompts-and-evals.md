# ADR 0014: Own tools, prompts and evals
- Status: Accepted (reviewer, 2026-10-08)
- Date: 2026-10-08
- Goal: G14 in [GOALS.md](../../GOALS.md)

## Context
The reviewer wants less cost without losing reliability or control. Tools and prompts should support reuse rather than make him repeat work. Their value needs to be checked through evals.

## Decision
Own tools and prompts to reduce cost and increase reliability, reuse and control. Evaluate worker prompts and tools, and agent prompts including Build and Orchestrator.

> Tools like gradle, read_doc, budget, and others are more to reduce cost and increase reliability and reuse and more control. (2026-10-08)

> Workers agent prompts and their tools and evals for their agent prompts and sub agents like Build, Orchestrator (2026-10-08)

## Consequences
- Tools are judged by cost reduction, reliability, reuse and control.
- Worker prompts and their tools have evals.
- Build and Orchestrator prompts have evals.
- Owning a tool or prompt alone is not evidence that it meets these goals.

## Related
- [Tools and evals requirements](../../tasksync-chat/docs/requirements/tools-and-evals.md)
- G14 names no spec in [GOALS.md](../../GOALS.md).
