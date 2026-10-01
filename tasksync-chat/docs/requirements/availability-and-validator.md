# Availability modes and validator agent (planned, none built)

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-PLAN-01 | An overnight run command makes the agent not stop for small choices, hand off at the end and report every decision. | "Do not stop for small choices, create handoff at the end of session, capture all decisions and report at the end" (2026-10-01) | gap |
| R-PLAN-02 | The same mode exists for shorter absences (such as the next hour), where the reviewer is reachable on Telegram, unlike overnight. | "May be they need not be like overnight, i may also need similar stuff for next 1 hr" (2026-10-01) | gap |
| R-PLAN-03 | An availability dropdown tells the agent the reviewer's plan so it can act accordingly. | "we can have an availability drop down, where I'll tell my plan" (2026-10-01) | gap |
| R-PLAN-04 | When the reviewer is away and input nears 300K, the agent hands off automatically. | "Handing off when i am away and input reaches around 300K." (2026-10-01) | gap |
| R-PLAN-05 | A validator agent observes every agent response and answers from ADRs, memories, specs and documents. | "Validator agent should continuously observe agent response" (2026-10-01) | gap |
| R-PLAN-06 | The validator extracts rules and goals from each user reply and stores them against the active spec, task or story. | "extract any knowledge bits or rules or instructions and store them accordingly" (2026-10-01) | gap |
| R-PLAN-07 | After a user replies, the previous agent response and the reply go to the validator so it learns to predict the user's answer. | "we should also send to validator as a first thing after user responds" (2026-10-01) | gap |
| R-PLAN-08 | The validator can enhance a prompt with the context to load, so context arrives in one go. | "it can enhance the user prompt, with what is the context to load" (2026-10-01) | gap |
| R-PLAN-09 | The validator's cost is counted in the shared banner, and a UI shows its responses. | "ofcourse cost of it should be accounted in the shared banner" (2026-10-01) | gap |
| R-PLAN-10 | The validator has a strong prompt backed by evals, and always keeps the spec's ultimate goal in mind. | "Validator can have very strong prompt (write evals for validating it)" (2026-10-01) | gap |
| R-PLAN-11 | Knowledge is deduplicated and kept concise so the same thing is not loaded in different forms. | "deduplicate knowledge and represent them in a concise way" (2026-10-01) | gap |
| R-PLAN-12 | Worker cache may be kept warm by a ping while the main agent uses it, if the price and mechanism allow. | "Cant we just extend its cache to more time by pinging with some dummy message?" (2026-10-01) | gap |
| R-PLAN-13 | Worker cost and the work done by each worker per turn are transparent. | "transparency in worker cost, and work done by it for that turn." (2026-10-01) | gap |
| R-PLAN-14 | Grouped commands may run in a bash or git worker, while single commands stay inline; the decision follows analysis of real conversations. | "If we can group them and run in a worker, thats great, but standalone commands is okay i guess." (2026-10-01) | gap |
