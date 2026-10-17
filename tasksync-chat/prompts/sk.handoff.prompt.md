---
agent: AskAway Build
description: Print a no-tool resume checkpoint covering done, assumptions, learnings, observations and what to pick next.
---

# /sk.handoff

Use only facts already established in this conversation. Do not call tools or edit files. The reader is the next conversation, which has none of this chat's history, so write everything it needs to continue without asking again.

Print one checkpoint, ready to paste into a new chat, with these sections in this order. Write "none" for an empty section and "unknown" for a fact that is not established; never guess.

1. **Where we are**: the active spec, its stage as Spec Kit names it, and the one-line goal.
2. **Done**: what was completed, each item with its evidence (the verification command and its real result, the commit, or the file). List what was checked off.
3. **Assumptions**: what was assumed, why, and how to check each one. Mark any that could change the work.
4. **Decisions and rules in force**: the reviewer's decisions, answers and standing rules from this conversation, in his words where possible, so they are not asked again.
5. **Learnings**: what was found out that is not obvious from the code (root causes, pitfalls, commands that work, things that failed and why).
6. **Observations**: things noticed but not acted on (risks, odd behaviour, debt, follow-ups) and anything left unverified.
7. **Not finished**: open tasks and steps, in order, with what blocks each and which are waiting on the reviewer.
8. **Pick up next**: the single best next task and why it is first, then the next two. Give the one command to start with (for example /sk.continue).

Keep each bullet to one line. Do not repeat the same fact in two sections.
