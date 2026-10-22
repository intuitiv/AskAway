# ADR 0038: The Validator answers and learns from a growing conversation stack

- Status: Proposed
- Date: 2026-10-22
- Goal: the Validator goal in [GOALS.md](../../GOALS.md) (G10)

## Context

The reviewer asked whether the Validator takes his inputs with previous context. An audit of the code found:

- The turn-end input is the current turn's previous final response and the reviewer's reply, the AITalk messages since turn start and the whole current final response. It is not a durable stack of every earlier reviewer message and agent response.
- `ValidatorObserver.closeLoop` (compare the earlier prediction with the reviewer's reply, record `matched`, store the rules and guidance it finds) is written and tested, but nothing in `src` calls it (`src/validator/observer.ts:152`). So the Validator never learns from his replies, which is why a search of Priya's own memory returned nothing.
- Only the previous final and its reply are kept per turn (`validatorTriggers.ts`), so spec 004 (custom compaction payload) has no conversation stack to read either.

## Decision

> In a given conversation we have to capture user input and final agent response thats it. We have to keep on capturing it. (2026-10-22)

> Learn: Given U1, A1, You predicted V1, And User response is U2. (2026-10-22)

- One conversation stack per conversation holds only the reviewer's messages (U) and the main agent's final responses (A), in order, appended for the whole conversation. Intermediate messages, tool calls and thinking are not kept.
- **Respond** (answer when the Validator is in charge, predict when it is not): input is U1, A1 ... Un, An.
- **Learn**: when U(n+1) arrives, input is U1 ... An, the prediction Vn and U(n+1). The existing `closeLoop` is called on every reviewer message, compares Vn with U(n+1), records a match or a miss, and stores what it finds in the memory store under the Validator's own scope.
- What to extract from the reviewer's messages: how he answers questions, his priorities and guidance, what is important and what is not, and what he repeats. A matching prediction adds points.
- The same stack is the input spec 004 will read for its compaction payload.
- Tests use a cheap model (Luna, or agy Argon 4) end to end: a scripted conversation of at least three turns, then assert the stack, the predictions, the match records and that a later answer cites something learned from an earlier reply.

## Consequences

Priya's predictions can improve across a conversation, and the stack is one small file other features can reuse. Capturing every reviewer message means secrets must pass the existing redaction gate first. Open points are in the reviewer's question batch of 2026-10-22: the size cap of the stack, how points are counted and shown, and whether the stack survives a conversation switch.
