# ADR 0033: agy and Claude workers are identified by transport carriers the model cannot set

- Status: Proposed
- Date: 2026-10-22
- Goal: the AITalk goal in [GOALS.md](../../GOALS.md) (G12)
- Supersedes: nothing. It completes [ADR 0030](0030-aitalk-queued-delivery-and-worker-identity.md), whose Consequences left agy and Claude workers without identity.

## Context

OpenCode workers are known to the AskAway MCP server through a plugin (R-AITALK-36..44). agy and Claude workers had no identity, so the server treated their calls as the main agent: no queued AITalk message reached them and the rule "members post only questions" (R-AITALK-45) could not apply. Two spikes proved a carrier for each that the model does not control.

## Decision

> Finsih these gaps in agy and claude (2026-10-22)

- agy: every tool call carries MCP `params._meta['antigravity.google/conversation_id']`, equal to the conversation id in agy's stream-json `init` event and stable across `--conversation` resumes. The runtime learns it from that event; the server maps it to the worker (`workerForAgyConversation`).
- Claude: the per-run `--mcp-config` carries the header `X-AskAway-Run: <random token>` with `--strict-mcp-config`. The runtime makes one random token per launch, keeps it in memory only and drops it when the process ends; the server maps it to the worker (`workerForRunToken`). The launcher also allows the AskAway tools the profile lists, including `commentary` (the worker tool stays denied).
- The server reads only the transport (`extra._meta`, `extra.requestInfo.headers`). From the arguments it still takes only the OpenCode session id, and only when no transport carrier is present, so a model cannot pose as another worker or session.
- A carrier that no worker owns (unknown conversation, unknown or expired token, two carriers naming different workers) is an unidentified caller: not the main agent. It pops no queue, registers nothing and cannot post to AITalk; its other tools run as before.

## Consequences

Queued AITalk messages reach agy and Claude workers once on their next tool call, and their posts follow R-AITALK-45 and are attributed to the member. The Claude token is a credential: the launcher writes the per-run MCP config to a private 0600 file and passes its path, so the token is not in the process command line; the file is deleted when the run ends.

## Known limits

- **Fail closed.** An agy conversation id or a Claude token that no AskAway worker owns is an unidentified worker: it cannot post to AITalk and receives no queue. This includes the reviewer's own interactive agy sessions and an Antigravity IDE that uses the same MCP server: they send a conversation id the runtime never started, so they lose AITalk posting and queue delivery over this server. Their other tools still work. We chose this over treating them as the main agent, which would let any outside session post as the main agent.
- **Unknown OpenCode session id keeps the legacy behaviour.** It is treated as no caller (the main-agent path), not as unidentified. The OpenCode plugin also tags the reviewer's own OpenCode sessions, so failing those closed would break the reviewer's normal use. Aligning it is a later decision.
- **First agy tool call can race the init event.** The runtime learns the conversation id from the first stream-json line of the agy process (`init`), when its stdout handler parses that line in `launchProcess` (`openCodeRuntime.ts`, `run.sessionId` and `sessionsByWorker`). If the model's first MCP call reaches the server before that line is processed, that call is unidentified and fails closed (no queue, no post); every later call and every resumed run is identified, because the id is already known. Registration is already as early as the stream allows: nothing earlier than the first line carries the id. A cheap hardening, not yet done: when an agy conversation id is unknown, wait briefly (a few hundred milliseconds) and look it up again before declaring the call unidentified.
