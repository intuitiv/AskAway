# Goal — 007 Validator Agent

"Then user role becomes explaining new requirement only once." (reviewer, 2026-10-01)

A validator agent watches every agent and worker response, answers from what the reviewer already said (ADRs, memories, specs, Goal/Rules), learns from each reviewer reply, and stores what it learns next to the active spec, story or task, so the reviewer never repeats himself and work can start from anywhere.

## Outcomes that define done
- **Observes continuously.** Every agent or worker response is fed to the validator; it answers the agent's questions from the active spec and its resources before the reviewer has to.
- **Answers like the reviewer.** Its answer should be as close as possible to the reviewer's own, not just correct; it also shares observations, a summary and the impact.
- **Closes the loop.** When the reviewer replies, the previous agent response and the reviewer's reply go to the validator first; it compares with its prediction, extracts knowledge, rules, instructions and goals, and stores them with the active spec, story or task (examples may be captured).
- **Enhances the prompt.** It can add to the reviewer's prompt the context to load, so everything arrives in one go instead of the agent asking for it.
- **Knowledge stays small.** Deduplicated and concise, so the same thing is never loaded in different forms.
- **Visible and accounted.** Its responses show in the UI; its cost is in the shared banner.
- **Starts as an observer.** First a simple observer (a tool backed by an agent run); after tuning it moves to the backend and smooths the process.
