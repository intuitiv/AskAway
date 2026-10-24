# Feature Specification: Active conversation and main-chat keep-alive

**Feature Branch**: `011-active-conversation` (planning identifier; no branch created)
**Created**: 2026-10-24
**Status**: DRAFT, scouting only. Nothing is built. The reviewer asked: "I dont want to implement that in a hurry. Just do scouting work."
**Input**: GOALS.md AITalk, Team, Trace, G5 keep-alive; ADR 0005; ADR 0036; ADR 0038; spec 010; [scouting.md](scouting.md) (evidence, file:line).

## Problem

AskAway keeps its state per workspace, but the reviewer works in several Copilot chat conversations in one window. When a new conversation starts, the old one's AITalk room, Trace and Team view are gone from the screen. He also spends money on keep-alive pings for conversations he no longer needs.

## Reviewer's words (verbatim)

1. "I can have multiple conversations in one vscode, when another conversation starts, old one goes away. Is it possible to support multiple conversations? If yes, I'll add more details, Like store everythign per conversation and when i change active tab to something other conversation, show stuff about that coversation." (2026-10-23/24)
2. "Active means the tab which is active. If i open any vscode copilot conversation, i want that corresponding askaway tab shoould be shown. It is not just AITalk, even Trace, Team are respect to the tab." (2026-10-23/24)
3. "I dont want to implement that in a hurry. Just do scouting work." (2026-10-24)
4. "Even pings also need some thinking. Becasue we can ping fine, but sometimes i dont need to keep the conversation alive, for that keeping alive is unnecessary cost. So, include this also in the new spec." (2026-10-24)
5. "We already have a ping button ... 6 pings for main session, the one in vscode, not workers ... I want that to be auto in the conditions i mentioned [session under 200K, handoff not done, at most 6]... there can be sessions, where i do handoff. So in such case, i dont use that anymore, so i need a way to say that that session is not needed for keep alive." (2026-10-24)

## Goals (what the reviewer wants, plainly)

- G-A. Several conversations in one window, each with its own AITalk room, Trace and Team view.
- G-B. The AskAway tab follows the conversation he is looking at, for every tab, not only AITalk.
- G-C. The main-session Ping runs by itself when: context under 200K, handoff not done, at most 6 pings.
- G-D. He can mark a conversation "no keep-alive" so finished sessions cost nothing.
- G-E. No hurry. Slices that are small, reversible and tested from the caller's view.

## What scouting found (short; details in scouting.md)

1. The extension cannot read which chat has focus with a stable API. The chat editor tab has no typed input and the side bar chat has none at all. Hook payloads carry `session_id` but no hook fires on a tab switch. Reliable today: "the conversation that last had activity". Possible, unverified: match an active chat editor tab to a session by title.
2. Some data is already per conversation (Validator stack, cache clock per session, `mainTurns`). The AITalk room, its spool, the reminder clock and the metrics view are per workspace.
3. The Ping button posts to whichever chat is focused and fills the input box. Made automatic as it is, it can overwrite a draft, hit the wrong chat, collide with a running turn and add a phantom turn.
4. A cache-hit ping costs about 0.1 of a full prompt; a miss costs about 1.25 (repo rate table). Six pings cost about 0.6 of a prompt and cover about 30 minutes, so an unneeded keep-alive is a real cost.
5. No automatic signal says "this conversation is finished". Every turn ends with a Response Handoff, so a handoff in the text proves nothing. `/sk.handoff` being sent is a strong hint. Only the reviewer's switch is certain.

## Part 1: Active conversation

### Definition options for "active"

- A1. Last activity wins. Active = the session with the latest hook event or request start. Works everywhere, including separate windows (each window keeps its own). Does not follow a pure tab switch until the next message.
- A2. Active tab matching. Use `tabGroups` for chat editor tabs and match the tab title to a session title. Follows a pure tab switch for editor chats; unreliable for same titles; no signal for the side bar chat.
- A3. Reviewer picks. A conversation selector in the AskAway header (a dropdown of recent conversations with titles). Always correct, costs a click.
- A4. Mixed (recommended): A1 by default, A2 as a bonus when it matches uniquely, A3 as the override. A manual pick holds until a new activity from another session, or until he clears it.

### Storage options

- S-1. Keep workspace storage; filter by a `conversationId` field on each record. Smallest change to files, read paths filter. Old data stays valid (no field = the workspace default conversation).
- S-2. A folder per conversation: `<workspace>/.askaway/conversations/<sessionId>/aitalk/...`. Clean isolation, simple deletion, more path changes (`src/aitalk/store.ts:21-23` and the spool).
- S-3. Only what the reviewer sees changes: keep one store, add a per-conversation read view. Not enough for G-A, since the room itself is shared.

Recommended: S-1 first for AITalk (append a `conversationId`; same files), because it keeps the append-only logs and the existing tests; move to S-2 only if the reviewer wants delete/export per conversation.

### Pros and cons

| Option | Pros | Cons |
|---|---|---|
| A1 | Stable APIs only; works in every window | Lags a tab switch |
| A2 | Follows the tab without a message | Needs a live probe; title match can be wrong; no sidebar signal |
| A3 | Always right | Manual |
| A4 | Best of all three | A little more code and states to explain |
| S-1 | Small change; keeps history; reversible | Every reader must filter |
| S-2 | Isolation; easy delete | Many paths; migration of old logs |

### Requirements for any option (draft, none approved)
- FR-001 Each conversation has its own AITalk room, Trace rows, cost and Team activity; switching shows that conversation's data through the same shared render blocks (Consistent Experience: `traceRowsHtml`, the AITalk controller, Team cards).
- FR-002 Existing presence rules hold per conversation (reviewer and Priya always present; main agent joins at turn start, leaves at turn end).
- FR-003 The conversation key is workspace root plus session id, the same as the Validator stack (ADR 0038).
- FR-004 Data from before this spec belongs to a default conversation and stays visible.
- FR-005 Webex and Telegram keep one thread per turn as today; the conversation is part of the message header, nothing else changes there.

## Part 2: Main-chat keep-alive

### Behaviour the reviewer described
Auto ping a main VS Code session when: context is under 200K, handoff is not done, and fewer than 6 pings have been sent. A per-conversation way to say "no keep-alive". Workers keep their own rule (at most 4, ADR 0005).

### Switch options
- K-1. On until handoff. Auto while eligible; `/sk.handoff` sent turns it off for that conversation.
- K-2. Off by default with a one-click opt-in next to Ping. No surprise cost, but the reviewer must remember.
- K-3. Per-conversation toggle next to Ping, default on, auto-off after N pings with no reply from the reviewer (N = 6 anyway).
- K-4. Mixed (recommended): K-3 plus K-1: default on; turns off when `/sk.handoff` is sent, when the context passes 200K, after 6 pings, or when he flips it; visible state "Keep alive: on, 2 of 6" beside Ping.

### Safety rules (required before the ping is automatic)
- It targets one session by id, never the focused chat. Without a verified way to submit into a specific session (scouting 1.1 S5, unverified) the auto ping stays off.
- It never runs while a turn or a sub-agent is running (`mainTurns`, `subagent-inflight.json`).
- It never runs when the chat has an unsent draft (`inputState.inputText` non-empty) or when the target is not the conversation that is cooling.
- Only the window that owns the workspace pings.
- The ping text is recognised so its reply does not post "Next" to AITalk, Webex or Telegram and does not count as reviewer activity.
- Stop on any error; never retry in a loop.

### Cost table (ratios from the repo's rates, scouting 3.4)
| Case | Relative cost of the next turn |
|---|---|
| Warm (cache hit) | 0.1 x prompt |
| Cold (rewrite 5 min cache) | 1.25 x prompt |
| Six pings kept warm 30 min | 0.6 x prompt spent first |

Break-even: six pings pay off only if the reviewer returns inside the warm window. That is why the default must stop at handoff and 200K.

## Rollout in small slices (each ends green, no big switch)

1. Slice 0, probe (no feature): a hidden developer command logs tab info, hook events on a tab switch and the open-session command arguments. Confirms scouting section 1.3. Test: none shipped; findings go in scouting.md.
2. Slice 1, conversation id everywhere it is free: carry `sessionId` on new AITalk messages, metrics rows and cache stamps (field only, no UI). Test: a message posted from two session ids is stored with each id; old data still reads.
3. Slice 2, "active conversation" selector (A1 plus A3): header dropdown of recent conversations; Metrics and Trace filter by it. Test: two conversations in a fixture, switching shows only that one's rows through `traceRowsHtml`.
4. Slice 3, AITalk and Team follow the selection. Test: the AITalk controller renders the chosen room; presence per conversation holds.
5. Slice 4, tab follow (A2) if the probe says it is reliable. Test: simulated tab change event.
6. Slice 5, Ping fixes: ping a given session, refuse on draft, running turn or sub-agent; per-conversation "Keep alive" switch and counter, still manual. Test: handler refuses in each hazard; counter stops at 6.
7. Slice 6, auto ping: runs on the cache clock for eligible conversations (under 200K, no handoff, fewer than 6, switch on). Test: fake clock, fake chat port, asserts one ping per window, none after `/sk.handoff`.

Tests follow the repo style: caller view, plain `node test-*.cjs`, run by `npm run test:workers`. Each slice adds requirement rows with the reviewer's quote; a row that contradicts a current one first needs his words (AGENTS.md).

## Questions only the reviewer can answer

Each has options and a recommendation. Plain language.

1. What counts as "active" when you switch tabs without sending a message?
   (a) The last conversation that did something. (b) The tab you look at, when VS Code lets us tell. (c) A dropdown you set. Recommended: (c) first, add (b) if the test shows it works; (a) as the fallback.
2. Do worker members (Build, Cathy and so on) belong to one conversation or to the whole workspace?
   (a) Workspace, shown in every conversation. (b) The conversation that started them. Recommended: (b) for the rows and cost, with a "show all" toggle.
3. Should old conversations disappear from AskAway? (a) Keep all, you delete. (b) Keep the last N, such as 10. (c) Keep 7 days. Recommended: (b), 10.
4. Should the Priya (Validator) conversation stack and the AITalk room be the same list? Recommended: yes, one conversation list for both, as ADR 0038 already keys the stack this way.
5. Keep alive default: (a) on until handoff, (b) off with one-click opt-in, (c) on, auto-off after 6 pings. Recommended: (a) plus (c) together.
6. Is 200K the cut-off for the main session, and is it the last request's input size? Recommended: yes, using the last input size we already read; show it as "Keep alive off: over 200K".
7. Does "handoff done" mean that you sent `/sk.handoff`? Recommended: yes. A Response Handoff at the end of every turn does not count.
8. Is a main-session ping allowed when you have an unsent draft? Recommended: no, skip and try next window, and tell you once.
9. Should the ping send to a specific chat even if it means opening that chat in the background? Recommended: only if the probe shows a safe way; else keep the ping manual and fix its hazards only.
10. ADR 0005 says 4 pings for workers and M23-03 asks 6 for the main chat. Confirm: workers 4, main 6, not shared?
11. Where should the keep-alive switch live: beside Ping in Metrics only, or also in the conversation dropdown?
12. Two VS Code windows on one workspace: the window you are using owns the pings, correct?

## Out of scope
Cloud tasks, Webex and Telegram redesign, changing the cache TTL or native Copilot settings, workers' own keep-alive (ADR 0005).

## Done means
This spec is reviewed; the reviewer answers the questions; then each slice gets its own tasks.md, rows and tests. Until then nothing in tasksync-chat/ changes.
