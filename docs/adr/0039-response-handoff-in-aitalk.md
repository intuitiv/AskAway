# ADR 0039: The Response Handoff is an AITalk message, and members can be pulled into the room

- Status: Proposed
- Date: 2026-10-22
- Goal: the AITalk goal in [GOALS.md](../../GOALS.md) (G12)
- Builds on: [ADR 0036](0036-aitalk-presence-rules.md) (presence rules). Nothing here changes them.

## Context

The reviewer proposed a pattern and asked whether it makes sense. An audit of the code found:

- Turn end does not post the Response Handoff to AITalk today. It goes to the remote targets (Telegram, Webex) through `HandoffNotifier`, which also formats the turn's total cost (`handoffNotifier.ts`).
- Priya's turn-end post has no `replyTo`: the turn-end id is a hash of the final response, not an AITalk message id (`validatorTriggers.ts`, `delivery.ts`).
- A reply in AITalk is queued for a recipient's next tool call. Nothing submits it to the real Copilot chat as a new message; only the Telegram and Webex reply path does (`telegramConversationReply.ts`).
- Tagging `@Cathy` does not pull her in or start work: mentions route only to running tasks, otherwise a room notice (`actors.ts`, ADR 0036).
- A turn's total cost is one number already (`turnTotals`, `turnBudget.ts`).

## Decision

> We also thought of posting some message at the end of the turn in the chat rght? Can that be Response handoff? That way when Validator replies to agent, it can reply to a specific agent message and in this case, as the actor has left the chat this may need some special processing like posting to last conversation and all. I am giving another requirement here, In case of main agent, only incase of main agent, replying could be responding to the actual conversation. So, Priya can use that. And, I can tag members like Cathy or some otehr member and ask a specific question, even though they are not in teh room, they can be pulled into the room and do the processing and leave by responding to it. I am tryign to establish some pattern here. (2026-10-22)

The decision below is Proposed until the reviewer answers the open questions.

1. At turn end the main agent posts the Next part of its Response Handoff in AITalk as one short message, with the turn's total cost (reviewer, 2026-10-22: "keep aitalk part minimal, may be only Next part not teh whole hand off"). The full handoff stays on Telegram and Webex.
2. The Validator replies to that specific message (a real `replyTo`). If the agent has already left, the reply is still posted under that message.
3. For the main agent only, a reply to its message can be delivered into the real conversation as the next user message. Priya may use this; other members may not.
4. A reviewer tag (`@Cathy`) of a member who is not in the room pulls the member in, starts the work, and the member answers and leaves when its question or answer is settled (the presence rule of ADR 0036 still applies).
5. The turn's stack of reviewer and agent messages is still what the Validator receives to answer or predict (ADR 0038).

## Consequences

A conversation gets one durable summary the Validator and the reviewer can reply to, without the agent being present. Point 3 changes who can write into the live chat, so it needs an explicit guard and a visible marker. Point 4 lets a mention start a worker, which costs money, so it needs the cost and permission rules of the worker tool. The open questions are in the reply of 2026-10-22.
