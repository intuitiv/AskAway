# GOALS — what the reviewer wants from AskAway

The single place for what the reviewer wants from this project. It says **what**, never **how**.
Read it before any work in this repo. The reviewer's own words are the source: they are kept verbatim
in [section 4](#4-reviewers-words-verbatim) and quoted in every decision and requirement.

## How the documents fit

| Layer | Where | Holds |
|---|---|---|
| Goals | `GOALS.md` (this file) | The ultimate outcomes, in the reviewer's words plus a plain elaboration |
| Decisions | [docs/adr/](docs/adr/README.md) | One ADR per standing decision, quoting the reviewer. `Proposed` until the reviewer accepts it |
| Requirements | [tasksync-chat/docs/requirements/](tasksync-chat/docs/requirements/README.md) | One row per requirement: plain sentence, dated quote, the test that guards it (or `gap`) |
| Coverage | [docs/goals-coverage.md](docs/goals-coverage.md) | Each goal → spec story, requirement row and test, or `GAP` |
| Specs | `specs/NNN-*/` | Spec Kit spec, plan and tasks for the work that delivers a goal |
| Backlog | [specs/BACKLOG.md](specs/BACKLOG.md) | Asks and gaps not yet inside a spec |

Rules for every agent:
- Newest wording wins. A new reviewer message that changes a goal adds a dated line; the old line is struck through, never deleted.
- Never edit the reviewer's verbatim words. Elaboration may clarify, never add a wish the reviewer did not state.
- Only the reviewer changes an ADR status. Agents write `Proposed`.
- A goal with no spec story and no requirement row is a gap: it gets a backlog row the same turn.
- These documents are the validator's knowledge (G10, G17). A wrong or stale line becomes a wrong decision.

## 1. Ultimate goal

> "I transfer context and what I need to build to you, and the agent should do most of the work with less cost." (2026-09-29, [005 Goal](specs/005-speckit-guided-flow/Goal.md))

> "Here I am describing what I need, not how to achieve them. These are my ultimate goals of this project. Make sure that you get them right." (2026-10-08)

In one line: the reviewer dictates what he needs; Spec Kit runs behind the scenes; reusable workers do
the detail in parallel; the reviewer sees cost, progress and blockers anywhere (banner, commentary,
Telegram); and a validator that has learned his answers keeps the work moving while he is away.

## 2. Goals by area

Each area: the goal, the outcomes that define done, the decision record, the requirement rows, and the spec.

### G1 Dictate once, the flow runs itself
- The reviewer dictates a requirement and chats in VS Code. Behind the scenes it goes through specify, clarify, plan, tasks and implement.
- Once the agent knows what is needed, the feature is implemented without the reviewer.
- The reviewer is interrupted only for one batch of questions, the approval gates, or a genuine blocker.
- Decision: [ADR 0001](docs/adr/0001-spec-kit-is-mandatory-and-invisible.md) · Requirements: [speckit-flow.md](tasksync-chat/docs/requirements/speckit-flow.md) · Spec: [005](specs/005-speckit-guided-flow/spec.md)

### G2 Spec Kit is mandatory and invisible; the Specs tab mirrors it
- Spec Kit is mandatory. The extension lets the reviewer use it without knowing its internals or commands.
- Artifacts follow the standard structure: user stories with acceptance criteria, tasks per story, and `[P]` parallel tasks that really run in parallel.
- When the reviewer gives more tasks or recommendations, they go into Spec Kit tasks.
- The Specs tab reflects the same state the flow is in.
- Specs show user stories and tasks, not phases or cycles; ~~older specs migrate to this pattern~~ the Specs tab reverse-maps the tasks in tasks.md onto the stories in spec.md, without rewriting any spec file (2026-10-08).
- Decision: [ADR 0001](docs/adr/0001-spec-kit-is-mandatory-and-invisible.md) · Requirements: [speckit-flow.md](tasksync-chat/docs/requirements/speckit-flow.md), [specs-tab.md](tasksync-chat/docs/requirements/specs-tab.md) · Spec: [005](specs/005-speckit-guided-flow/spec.md)

### G3 Never miss a task
- Every ask in every message is tracked (Spec Kit tasks or the backlog) and closed with evidence, or reported as waiting with the reason.
- Decision: [ADR 0002](docs/adr/0002-every-ask-is-a-tracked-task.md) · Requirements: [orchestrator.md](tasksync-chat/docs/requirements/orchestrator.md)

### G4 Questions in one batch
- When the agent has questions, it asks them all in one message so the reviewer answers in one shot.
- Fewer interruptions; the validator learns the reviewer's answers over time.
- Decision: [ADR 0003](docs/adr/0003-ask-questions-in-one-batch.md) · Requirements: [orchestrator.md](tasksync-chat/docs/requirements/orchestrator.md)

### G5 Delegate to reusable, optimal workers; work in parallel
- Detail work goes to multiple, reusable workers so the main conversation does not carry that data and pay for it again.
- Workers are optimal and reused.
- Warm workers are kept alive with a cheap ping (for example "reply ok"), ~~3–4 times~~ at most 4 pings per worker (2026-10-08), so their context is reused instead of expiring and being recreated.
- Non-functional work (quality and similar) runs in parallel workers, so the main agent stays busy while it delegates.
- Worker observability is visible in the shared banner and in Telegram.
- Decisions: [ADR 0004](docs/adr/0004-delegate-to-reusable-parallel-workers.md), [ADR 0005](docs/adr/0005-keep-warm-workers-alive.md) · Requirements: [worker-tool.md](tasksync-chat/docs/requirements/worker-tool.md), [workers-tab.md](tasksync-chat/docs/requirements/workers-tab.md), [orchestrator.md](tasksync-chat/docs/requirements/orchestrator.md) · Spec: [001](specs/001-async-subagent-runner/)

### G6 Observability of every turn and worker
- For each turn: cost, the workers' share of it, requests, input tokens, output tokens, cache percent, number of workers with their details, and the efficiency score.
- Shown in the shared banner and in Telegram.
- Decision: [ADR 0006](docs/adr/0006-observability-of-every-turn-and-worker.md) · Requirements: [observability.md](tasksync-chat/docs/requirements/observability.md), [chat-banner.md](tasksync-chat/docs/requirements/chat-banner.md), [metrics-tab.md](tasksync-chat/docs/requirements/metrics-tab.md)

### G7 Telegram: monitor and reply remotely
- Whatever happens in VS Code reaches Telegram, so the reviewer monitors remotely.
- The reviewer can respond to VS Code from Telegram. This already works (2026-10-08).
- His org flagged Telegram: Telegram is switched off, and Webex becomes the remote channel with the same features (2026-10-08). Design choices are open question 11.
- Webex decisions (2026-10-08): the Telegram code stays, toggled off; the token is set through a command; replies are polled (no webhook, the laptop is never exposed); team `self` gets one space per workspace, and its General space plays the role of Telegram's General; share-with-me sends documents to self.General instead of Telegram.
- Decision: [ADR 0007](docs/adr/0007-telegram-is-a-remote-control.md), [ADR 0018](docs/adr/0018-webex-replaces-telegram.md) · Requirements: [telegram.md](tasksync-chat/docs/requirements/telegram.md) · Spec: [009](specs/009-webex-remote-channel/spec.md)

### G8 Commentary shows what the agent is doing
- In orchestrator mode, commentary gives a high-level view of what the agent is doing, where it is blocked, and whether it needs help.
- Purpose: the reviewer cannot read, digest and respond within 5 minutes; commentary lets him prepare for the agent's response and steer when it heads in a different direction.
- Later, once the validator has proven its worth, the validator monitors the flow and suggests to the agent immediately, and the agent can ask the validator when in doubt.
- Commentary reaches Telegram as a live feed, not only the periodic status (2026-10-08).
- Decision: [ADR 0008](docs/adr/0008-commentary-narrates-the-agent.md) · Requirements: [live-tab.md](tasksync-chat/docs/requirements/live-tab.md), [orchestrator.md](tasksync-chat/docs/requirements/orchestrator.md)

### G9 Cloud tasks, only when the reviewer wants them
- Used to run work online while the reviewer is away, or to run things in parallel. Entirely on the reviewer's demand.
- Any independently runnable part can go to the cloud: a user story or a single task.
- It runs on GitHub, its progress is tracked, and the reviewer is notified when it is done so he can review and merge the PR.
- ~~Cloud work commits to the spec's one active PR; once the story is done, its latest changes are pulled to local (2026-10-08).~~ Superseded the same day: cloud work commits to the spec's one active PR; once a cloud task is done, AskAway shares its PR link and the reviewer reviews and finishes it by hand ([ADR 0019](docs/adr/0019-cloud-task-done-shares-pr-link.md)).
- Decision: [ADR 0009](docs/adr/0009-cloud-tasks-on-demand.md) · Requirements: [cloud-tasks.md](tasksync-chat/docs/requirements/cloud-tasks.md) · Spec: [006](specs/006-cloud-tasks/)

### G10 Validator agent learns the reviewer
- The validator is a decisioning engine with memory, not a simple memory tool: it decides what the reviewer would decide, and memory is one of its inputs.
- It decides from this file, the ADRs and the requirement rows, plus what it learned from the reviewer's replies.
- Knows everything the reviewer wants: instructions, guidelines, best practices, the ultimate goal and the immediate goal.
- Learns from the reviewer's responses: answers the agent's questions, compares its answers with the reviewer's real ones, and improves until it can act while the reviewer is away overnight.
- **Beta phase:** observes user messages and (occasionally, or through a tool the agent calls) assistant messages, the agent-called tool first (2026-10-08); predicts the reviewer's reply to the final assistant response and shows it with how good it is; always reads the reviewer's real reply and learns from it; serves as the memory tool (loads existing memories without deleting them, stores new ones from the agent, gives existing ones back).
- **Live phase:** answers for the reviewer when he is not available; the memory tool works as in beta; it reads commentary and tells the reviewer what is going wrong.
- It acts as the reviewer when he is away from keyboard (2026-10-08).
- The reviewer switches the live phase on with a setting, off by default. While live and he is Away, it answers low-risk, reversible questions (the agent gets the answer with sources when it asks), holds the rest, flags drift seen in commentary, and gives him a digest when he is back (2026-10-08).
- Agents reach memory only through the AskAway memory tool; the VS Code memory tool is removed from their tool lists (2026-10-08).
- Decision: [ADR 0010](docs/adr/0010-validator-agent-learns-the-reviewer.md) · Requirements: [availability-and-validator.md](tasksync-chat/docs/requirements/availability-and-validator.md) · Spec: [007](specs/007-validator-agent/)

### G11 Availability decides when the validator takes charge
- The reviewer often starts something and goes away or logs off. He sets his availability: away for 30 minutes, a few hours, or until he says he is back.
- Availability tells the validator when to take charge.
- Decision: [ADR 0011](docs/adr/0011-availability-decides-when-validator-takes-charge.md) · Requirements: [availability-and-validator.md](tasksync-chat/docs/requirements/availability-and-validator.md) · Spec: [007](specs/007-validator-agent/)

### G12 Side channel into running work
- The reviewer can see what is going on inside a worker, to decide whether he must act (for example run a command).
- He can nudge the agent to think in a different way.
- He can ask a side question during the current task without the main agent drifting off its topic and forgetting what it was doing.
- Decision: [ADR 0012](docs/adr/0012-side-channel-to-running-work.md) · Requirements: [side-channel.md](tasksync-chat/docs/requirements/side-channel.md) · Spec: [003](specs/003-worker-side-channel/)

### G13 Efficiency score and benchmark
- One number per turn that tells how well the turn was done, irrespective of outcome. Higher is better. It is cost to work.
- It includes cost, input tokens, workers, requests, cache misses and output tokens.
- It should always be high, no matter how long the turn ran. A drop means something is not optimal.
- Used in three places: the shared banner (to see what can be done better), the benchmark (to tune tools and prompts and raise the number), and Telegram and other observability.
- The benchmark separately tells whether the required task was completed; the reviewer judges live turns.
- Decision: [ADR 0013](docs/adr/0013-efficiency-score-is-cost-to-work.md) · Requirements: [efficiency-score.md](tasksync-chat/docs/requirements/efficiency-score.md) · Spec: [008](specs/008-harness-benchmark/)

### G14 Own tools, prompts and evals
- Tools such as `gradle`, `read_doc`, the turn budget and others exist to reduce cost and increase reliability, reuse and control. The reviewer listed the existing tools; no new tool is asked for (2026-10-08).
- Agent prompts (Build, Orchestrator), worker prompts and their tools have evals.
- Decision: [ADR 0014](docs/adr/0014-own-tools-prompts-and-evals.md) · Requirements: [tools-and-evals.md](tasksync-chat/docs/requirements/tools-and-evals.md)

### G15 Commands
- Spec Kit commands: `/sk.start`, `/sk.continue`, `/sk.plan`, `/sk.tasks`, `/sk.check`, `/sk.handoff`. They stay shortcuts; plain text reaches the same stages.
- Recurring commands: `/pr-daily` (the reviewer wrote `/pr_daily`; the repo's command is `/pr-daily`).
- Decision: [ADR 0015](docs/adr/0015-command-surface.md) · Requirements: [speckit-flow.md](tasksync-chat/docs/requirements/speckit-flow.md)

### G16 Consistent experience (standing, 2026-09-24)
- One shared component per kind of thing; new data is converted into that component's input format, so every tab looks and behaves the same.
- Decision: [ADR 0016](docs/adr/0016-consistent-experience.md) · Source: [AGENTS.md](AGENTS.md)

### G17 Never break a requirement
- Every change keeps the reviewer's stated requirements true. A change that would contradict one waits for his new words.
- When he changes his mind, the documents change the same turn: verbatim words, requirement row, superseding ADR.
- These documents are the validator's knowledge, so a wrong row becomes a wrong decision.
- Decision: [ADR 0017](docs/adr/0017-never-break-a-requirement.md) · Requirements: [orchestrator.md](tasksync-chat/docs/requirements/orchestrator.md) · Guard: [AGENTS.md](AGENTS.md) "Never break a requirement"

## 3. Open questions

Collected for one batch to the reviewer. Each answer becomes a dated line in the matching goal above.

1. **Keep-alive count (G5).** Does "keep workers alive for 3-4 times" mean at most 3–4 pings per idle worker (about one prompt-cache window each), after which it may expire? The earlier rule R-WTOOL-24 allowed two pings; this message replaces it. **Answered 2026-10-08: 4 pings per worker.**
2. **Cloud PR (G9).** "take that PR back and review and merge": one PR per delegated story or task, or commits on the spec's one active PR branch as decided on 2026-09-30? **Answered 2026-10-08: the same active PR, and pull the latest changes to local once the story is done.**
3. **Validator observation (G10).** In beta, start with the tool the agent calls, or with periodic observation of assistant messages? **Answered 2026-10-08: tool first.**
4. **Unfinished line (G10).** The message has "Validator agent should" with nothing after it before "In beta phase". Was something else meant there? **Answered 2026-10-08: the validator should behave as listed below it, in beta and in prod (live).**
5. **Homes for the 8 gaps** in [docs/goals-coverage.md](docs/goals-coverage.md): G2 new-ask capture, G3 ask ledger and G4 question batch extend spec 005; G7 reply-from-Telegram gets a new Telegram spec; G8, G10 and G11 live-phase validator become a later 007 release; G14 own tools extend spec 001. Agree? **Answered 2026-10-08:** G7 already works (no new spec); G2/G3/G4 yes, into 005; live validator (G8, G10, G11) yes, designed against 007 (item 9); G14 needs nothing new, the tools exist.
6. **ADR status.** All 16 ADRs are `Proposed`. Accept them as written, or list the ones to change? **Answered 2026-10-08: all 16 accepted.**
7. **Stopping md memory auto-load (G10, 007 T013).** After the one-time seed into the memory store, how do the `/memories` md files stop entering the conversation? (a) move them to an archive folder, bytes unchanged (recommended); (b) keep them in place and switch off VS Code's memory auto-load, if a setting allows it; (c) replace each with a one-line pointer to the memory tool. **Answered 2026-10-08: remove the VS Code memory tool from the agents' tool lists, so they use the AskAway memory tool.**
8. **Waiting on your live look** (no question, just a reload and a glance): 005 T015 worker spend in the shared banner and Telegram, and 005 T016 Specs tab and commentary polish. Both are built; they stay unticked until you accept them live. **Shared banner accepted 2026-10-08** ("Shared banner looks good"); the Telegram status and the Specs tab polish still await a look.
9. **Live validator design (G10, G11).** "It should act as me when i am away from keyboard." To discuss against 007's own design: what it may decide alone, how the agent receives its answer, and how the reviewer reviews its decisions when back. **Answered 2026-10-08: recommendations accepted (answer low-risk reversible questions, hold the rest; answer returned to the asking agent with sources; only while Away; digest on return; flag drift only), and a setting, off by default, that the reviewer turns on when he is happy.**
10. **Specs as stories and tasks (G2).** How older specs that use phases or cycles migrate to user stories and tasks. **Answered 2026-10-08: do not rewrite anything; reverse-map tasks.md tasks onto spec.md stories in the Specs tab.**
11. **Webex instead of Telegram (G7).** Which Webex token (a bot, or his own account through the existing OAuth integration), full Telegram parity or a minimum, keep or delete the Telegram code, one channel picker or two switches, where the token is stored, and how replies arrive. See [ADR 0018](docs/adr/0018-webex-replaces-telegram.md). **Answered 2026-10-08:** keep the Telegram code toggled off; token through a command; poll for replies, no webhook; one space per workspace in team `self`, its General space like Telegram's General; share-with-me to self.General. Still open: Webex does not notify you about your own posts, so a final message sent with your own token will not ping you (a bot would).

## 4. Reviewer's words, verbatim

### 2026-10-08

> I want to call out what i want out of the features and want to write them down at repo level so that that will act as a guidelines or requrements or features or something.
> ELaborate the below ones with specs and other docs. And create ADRs and requirements or any file so that we have single place what i want, ultimately.
>
> **Important goals for me: Here I am describing what I need, not how to achieve them.**
> These are my ultimate goals of this project. Make sure that you get them right.
> I should get seamless speck usage through this extension. And specs tab should reflect the same.
> Delegate things to multiple and reusable workers so that we dont just bloat the same conversation with all the data, and pay that cost.
> In Orchestrator mode, Commentary gives some high level idea what agent is doing where it is blocking so that I'll be prepared as a human, I cannot read, digest and respond with in 5 min. But… once Validator agent proves to be worth then it can monitor the flow and suggest immediately to the agent or agent can ask validator when in doubt.
>
> My flow is generally like I dictate some requirement and chat with vscode and behind the scenes it should go through spec creation, clarify, plan, tasks and so on and once agent knows about what I need, then onwards feature should be implemented without me also.
> And when agent has questions, it should ask me in bulk so that I'll respond to all in one shot. This is also for reducing my interruption and Validator agent will know my requirements and it will learn what I need over time.
>
> Never miss any task I ask for, use speckit tasks to track them if needed.
>
> Do much work in parallel, like quality and other non functionals so that main agent is busy when it delegates tasks to workers.
>
> **Observability:**
> - Observability is very important to me. How much cost a turn incurred. How much workers share
> - Requests, input tokens, output tokens, cache percent, number of workers and their details and efficiency score.
> - I should get whatever is happening in vscode in telegram and monitor remotely.
> - I should be able to respond to vscode from telegram
>
> **Specs:**
> Speckit is mandatory and it has lot of steps. This extension should help user do without knowing about internals or commands of speckit.
> Use tasks in speckit when user gives more tasks or recommendation.
> Use standard speck kit structure like user story and acceptance criteria. Tasks for each story and parallel tasks and, these parallel tasks can be run in parallel.
>
> **Workers:**
> Workers should be optimal.
> Observability of workers should be visible to me in shared banner and telegram.
> Reuse workers.
> Keep workers alive for 3-4 times, by pinging some message, like "reply ok" and all so that we can reuse the context instead of expiring it and recreating them again.
>
> **Commentary:**
> Commentary is important in agents these days. I am not able to understand what's going on with in agent till the very end. Where it is did it stuck somewhere or does it need any help and all. Comentary will help me understand the thought process and prepare for agent response and guide when it is going in a dfiferent direction.
>
> **Cloud actions:**
> Cloud actions are more for running taks online when I am away or run things in parallel. This is completely when user needs it.
> It could be at User story level or it can also be at task level. Whatever part is independly runnable that can be delegated to Cloud.
> This should trigger on GitHub actions and track the progress and when done it should notify me. So that I can take that PR back and review and merge.
>
> **Validator agent:**
> Validator knows everything about what I want. All instructions and guidelines and best practices and ultimate goal and immediate goal and everything. It'll learn from my responses and try to answer agents questions and compare teh same with my responses and learn. Over the time it will start picking my brain so that validator agent can do stuff when I am away over night or not near laptop and all.
> Validator agent should
> In beta phase:
> - Observe user messages and assistant messages(occasionally, or we can have a tool so that agent calls it)
> - Predict response from final assistant response and show it to me on how good it is. I'll read assistant response and read validators answers to it and give my reply
> - Read user responses always and learn from them for next response
> - Serves as a memory tool, loads existing ones, without deleting them. Creates new memories form agent, gives existing ones back to agent
>
> When it is live:
> - It serves as me when I am not online or available.
> - Memory tool will work as is.
> - It can read commentary and suggest user what's wrong.
>
> **User availability:**
> Generally I run something and go away or log off for the day. In such case, I set the availability like away for next 30 min or few hours or away till say I am online and all.
> This helps validator agent when to take charge.
>
> **Side channel communication:**
> With worker tools, I am not able to see what's going in side. This helps me
> - Decide if I need to do anything, like run some commands and all
> - Nudge agent to think in a different way
> - Ask some side question while doing current task. This is important. Currently when I ask in main agent, then topic gets diverted to a different direction altogether and forgets what it has been doing.
>
> **Benchmark:**
> - Efficiency score: This is like a number which can tell how well a turn was done, irrespective of outcome. Higher the number better it is. It will include cost, input tokens, workers, requests, cache miss, output token
> - We use it 3 places.
>     - Shared banner so that I monitor and see what can be done better
>     - Benchmark will use it and tune tools, tune prompts and add stuff to increase the number.
>     - Other observability places like telegram and all so that I can monitor
> - Score should be always high. No matter how long it ran. If it drops that means we are doing something unoptimal. It's more like cost to work.
> - Benchmark will tell whether it completed the required task or not. And I'll decide whether it did well on live turns.
>
> **Misc:**
> Tools like gradle, read_doc, budget, and others are more to reduce cost and increase reliability and reuse and more control.
> Workers agent prompts and their tools and evals for their agent prompts and sub agents like Build, Orchestrator
> Commands like /sk.continue, /sk.start, /sk.handoff, /sk.check, /sk.tasks, /sk.plan
> Recurring commands like /pr_daily

### 2026-10-08, later

> Update current repos AGENTS.md  file or anything so that we dont break any requirements. And ultimately this will go to validator agent.
> Remember validator is not a simple memory tool. It is a decisioning engine, with memory.

### 2026-10-08, answers

> 4 pings per worker
> validator - tool first
> accept all 16
> Still reviewing, 2, 4, 5. i'll respond them later do otehr work.

### 2026-10-08, answers 2

> I gave this whole conversation so that you know holistic view of this project.
>
> 2: Sure same PR will reduce the load, but we need to pull latest changes to local, once the story is done.
> 4: I mean Validator agent should behave as below, in beta phase and when it is in prod.
> 8: Replying to vscode from telegram already works. yes to cpaturing tasks. yes to live validator.
> I think we already have all tools.  I just listed all of them.
>
> I think validator has its own design. Lets discuss how it is done in there. I told what i am expecting. It should act as me when i am away from keyboard.
>
> 7: We remove vscode memory tool from the agent' tool list, tahts how it will ask new memory tool instead of vscode one. Thats how ou stop loading it.
>
> Spec should show User stories and tasks not phases/cycles. lets see how we can migrate them to this pattern. Shared banner looks good.

### 2026-10-08, answers 3

> At some point, if i can get live feed of comentary on telegram. Currently i get periodic status, how mcuh cost spent and how many workers and running, basically shared banner is shared in telegram also. If we send commentary, that oeuld be great.
>
> I say when it is ready for live. May be add some setting, when i am happy, i'll turn it on. by default it is off.
> Stories are in spec. And tasks.md have tasks, we need to reverse map and show them in specs tab. DO not rewrite anything. All i am asking for is whats there already in spec files.
>
> And yes i am accepting your recomendations
> Add a test case for all these things real and live so that we dont break stuff

### 2026-10-08, Webex

> And another thing i want to add is, my org reported issue of using telegram, so can we turn telegram off and use webex instead? I can give telegram token. Same thing should just work for webex also.

### 2026-10-08, Webex answers

> Keep telegram code, it is just toggled off.
> Token storage is through command.
>
> I am aware of webhooks, but we cannot expose my laptop to public api. So, our option is long poll, like we do for telegram
> There is a concept called team and we can create spaces for those teams. I created a team called `self`. So we follow the same thing as telegram, we create a space per workspace and post message there. And we have a General space also, so we use it same as that of General of telegram.
>
> Once i give token, you can explore alll these spaces in a worker and get all the team ids, and all kinds of things.
>
> And another thing is, we need to change share-with-me script also. This is what caught IT attention. We send docs to self.General space instead of telegram.
>
> 006 T021: For cloud, may be you can share PR link once that task is done so that i'll review and manually do stuff from it
>
> ~/.webex.md file has client id and secret. and other stuff.
