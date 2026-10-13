# ADR 0021: AITalk is an actor framework; the chat widget only renders data and emits intents

- Status: Proposed
- Date: 2026-10-13
- Goal: G8 in [GOALS.md](../../GOALS.md)
- Supersedes: "a worker is present while it runs" and ticks on every message ([AITalk requirements](../../tasksync-chat/docs/requirements/aitalk.md) R-AITALK-12 to R-AITALK-17 replace them)

## Context

AITalk mixed presence, routing and delivery into the store and the widget. The reviewer saw Validator answers with no visible question, an Agent `@Validator` message with no answer, the Agent posting while missing from the participants, workers joining when created, ticks on Agent and Validator messages, a shaking avatar menu and broken markdown.

## Decision

> Thats i told implement the aitalk chat box separately independnt of the implemenation. Just feed the data and react to whats happening on from chat box. (2026-10-13)

> And when the turn starts, it should register, if agent is not registered, even agent cannot post messages. (2026-10-13)

> worker joins when it posts the message, and it leaves when all the messages posted by it are answered. (2026-10-13)

> Single tick is for user messages. not for validator/Agent/worker. (2026-10-13)

- The widget (`media/aitalk/talkController.js`, `talkRender.js`) gets only data: registered actors, messages, typing, tick states. It emits user intents: post, reply, react, @mention. Storybook feeds it simulated actors (`storybook/prototypes/simulatedActors.js`); the extension feeds real ones. Snapshots patch changed regions only, so open menus, focus and scroll survive.
- `src/aitalk/actors.ts` holds the `Room`: actors register and unregister (banner "X joined" / "X left"); an unregistered actor cannot post. Actors receive a message with a tracker, a reply to their own message, or a reaction; they post, reply, react and type.
- User messages route: `@tag` → that actor, reply → owner of the replied message, otherwise → Validator. The receiving actor drives the tracker: sent, delivered, read. Ticks render only on user messages.
- Validator registers at activation and answers what is routed to it by calling the Validator model, in-thread. `askaway_validator` posts the Agent's question as an Agent message `@Validator`; the answer replies to it.
- The Agent registers at turn start (and with its first tool call of a turn) and leaves at turn end. Workers register when they post and leave once all their messages are answered.
- Message bodies, including Read more, use one safe markdown renderer (`media/aitalk/markdown.js`): HTML is escaped first, links are http(s) only.

## Consequences

- New participants are new actors; the widget and the routing rules do not change.
- Worker and Validator modules stay free of `src/aitalk` imports; the extension injects the callbacks.

## Related

- [AITalk requirements](../../tasksync-chat/docs/requirements/aitalk.md) R-AITALK-12 to R-AITALK-17
- [ADR 0016](0016-consistent-experience.md) one shared component
