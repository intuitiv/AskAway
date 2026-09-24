# Worker Side-Channel Communication

Provide a visible, asynchronous communication lane for humans and AskAway-owned workers. A human can
ask, suggest, steer, approve, or share state without taking over the main task conversation. Workers
can use the same routed channel to communicate with other workers.

This feature applies to workers spawned by the AskAway async runner in `001-async-subagent-runner`,
not native VS Code sub-agents created through `runSubagent`.

## Problem

AskAway workers may continue independently for minutes and may run concurrently. Today a reviewer can
communicate only through the main agent, which hides the worker's current state, serializes feedback,
and makes pair programming with a specific worker impractical. Workers also lack an explicit way to
exchange findings or request help without copying context through the parent.

## Goals

- **Human to worker.** Let a person ask a question, offer a suggestion, provide state, steer future
  work, answer a worker question, or grant an approval to a named worker or run.
- **Worker to human.** Show progress, findings, questions, decisions awaiting approval,
  acknowledgments, and terminal outcomes without requiring the main agent to relay them.
- **Worker to worker.** Route explicit messages between AskAway workers with clear sender, recipient,
  purpose, and correlation identity.
- **Visible in VS Code.** Make conversations, pending actions, delivery state, and worker identity
  inspectable in the AskAway VS Code UI.
- **Non-blocking by default.** Keep workers running while informational messages and ordinary questions
  are handled; block only the action that requires direction, approval, or refreshed access.
- **Auditable steering.** Record when a direction was received, acknowledged, accepted, rejected,
  superseded, or applied and which checkpoint follows from it.
- **Bounded context.** Answer and route from compact worker checkpoints rather than cloning full worker
  transcripts into every side conversation.

## Non-goals

- Supporting native VS Code `runSubagent` children that AskAway does not own.
- Turning every side-channel message into a worker instruction.
- Silently changing a worker's goal, acceptance criteria, permissions, or file ownership.
- Sending secrets, tokens, passwords, or credential values through a model-visible message.
- Replacing the main task conversation or the worker's execution transcript.
- Requiring Webex, Telegram, or another remote transport for the first version.

## Conversation model

A side-channel conversation has a stable `channelId` and is scoped to a workspace. Each message has:

```text
messageId, channelId, senderId, recipientIds, workerId, runId,
correlationId, class, body, createdAt, deliveryState,
requiresAcknowledgment, checkpointRevision, sourceRevision
```

The sender and recipient may be a human, the main AskAway agent, or an AskAway worker. `workerId` is
stable across submissions; `runId` identifies the active execution. A message to a logical worker when
no run is active remains queued until a new run is accepted or the sender cancels it.

Supported message classes are:

- **Question.** Requests an answer and does not change execution by itself.
- **Suggestion.** Offers an option for consideration; the worker records whether it adopted or declined
  it, but no acknowledgment is required unless requested.
- **Status or finding.** Reports progress, evidence, availability, or other informational state.
- **Direction.** Changes priorities or constraints for future work after explicit acknowledgment.
- **Approval request or response.** Pauses and resumes only the dependent action.
- **Worker handoff.** Sends a bounded finding, artifact reference, or request between workers without
  transferring ownership implicitly.
- **System event.** Reports lifecycle, delivery, expiration, cancellation, or validity changes.

Directions are never inferred from questions, suggestions, or status messages. A direction that
conflicts with the worker's accepted task, product requirements, ownership boundary, or safety policy
is surfaced to the human and remains unapplied. Approval messages authorize only the named operation
and run; they are not reusable blanket permission.

## Delivery and execution

Posting a message returns immediately with its stable identity and delivery state. Delivery states are
`QUEUED`, `DELIVERED`, `ACKNOWLEDGED`, `APPLIED`, `ANSWERED`, `REJECTED`, `SUPERSEDED`, `FAILED`,
`EXPIRED`, or `CANCELLED`.

Messages to a running worker enter at an explicit checkpoint boundary so they do not mutate an
in-flight model request. Urgent direction may request cancellation of the current run, but cancellation
and the replacement submission remain separate visible operations. Ordinary messages never trigger an
unbounded model loop.

Worker-to-worker delivery uses the same contract. The receiving worker sees a compact sender snapshot
and referenced evidence, not the sender's complete transcript. A reply retains `correlationId` so the
human and parent agent can follow the exchange. Messaging does not grant the receiving worker access to
files, tools, permissions, or secrets it did not already have.

The initial operations are:

```text
channel_post   channel_list   channel_read   channel_reply
channel_ack    channel_cancel channel_watch
```

`channel_watch` reports new messages and state transitions without requiring frequent polling. The
implementation may use extension events or a bounded wait, but the API must not require the caller to
spin on `channel_read`.

## Checkpoint answers

The side channel receives a versioned worker snapshot containing:

```text
objective, accepted constraints, current task, current action,
last completed action, changed files, latest test result,
blockers, open questions, last checkpoint, source revision,
context validity, pending directions and approvals
```

A lightweight local model may draft answers or summarize old messages asynchronously. Generated text
is marked as a draft until accepted by the worker or clearly shown as checkpoint-derived. Deterministic
state and verified evidence are never overwritten by model-generated summaries. If the local model is
unavailable, delivery and the structured checkpoint remain functional.

## VS Code experience

The AskAway panel exposes a **Workers** view with a side-channel timeline for each worker. The first
version must provide:

- a worker list showing role, run state, current action, unread count, and pending-question or approval
  indicators;
- a selectable conversation timeline showing human-to-worker, worker-to-human, and worker-to-worker
  messages with sender, recipient, timestamp, class, and delivery state;
- a composer targeted at a specific worker or run, with an explicit class selector for Question,
  Suggestion, Direction, and Approval response;
- visible acknowledgment and applied/rejected state for directions;
- a focused queue of questions and approvals requiring human action;
- links from messages to referenced files, test evidence, worker logs, and checkpoints when available;
- cancellation and retry controls for queued or failed messages.

Informational traffic must not interrupt the editor or steal focus. Questions and approvals may show a
badge or notification, but opening the AskAway panel remains the authoritative full history. The UI
must clearly distinguish a direct worker response from a local-model draft and from a system event.

## Persistence and retention

Persist channels and delivery state per workspace using bounded append-only records. Preserve explicit
directions, approvals, rejections, terminal answers, correlations, and evidence references. Compact old
informational exchanges after extracting their outcome, but retain a searchable archive and record the
checkpoint revision that consumed each applied direction.

After extension reload, queued messages, unanswered questions, pending approvals, and the latest
delivery state remain visible. If the target run is no longer active, mark the message stale or queued
for the logical worker rather than claiming it was delivered.

## Security and trust

- Never include secret values in message bodies, checkpoints, logs, notifications, or local-model
  prompts. A credential response records only that the human refreshed access out of band.
- Enforce workspace and worker authorization before reading or posting to a channel.
- Escape rendered message content and validate file links against the workspace boundary.
- Treat worker-produced statements as claims until backed by referenced evidence or explicitly marked
  as unverified.
- Preserve the sender and original body; edits create a superseding message rather than rewriting
  history.

## Acceptance criteria

1. A human can post a question to a running AskAway worker, immediately receive a message handle, keep
   using the main agent, and later see the worker's correlated answer in the VS Code AskAway panel.
2. A worker can ask a human a non-blocking question while continuing independent work; only a named
   dependent action waits for the answer.
3. A human direction is visibly acknowledged and either applied at a checkpoint, rejected with a
   reason, or left pending; it never silently changes an in-flight request.
4. One AskAway worker can send a correlated finding to another, and the VS Code timeline shows both
   endpoints and delivery outcome without granting new permissions.
5. Reloading VS Code preserves unread messages, pending questions and approvals, correlations, and
   delivery states for the workspace.
6. A local summarizer failure does not prevent posting, delivery, structured status display, or access
   to the last known-good checkpoint.
7. Secret values are neither accepted by the side-channel composer nor persisted in channel records;
   credential refresh is confirmed out of band.

## Dependencies

- `001-async-subagent-runner` owns worker/run identity, lifecycle, checkpoints, cancellation, resume,
  model execution, and tool policy.
- This feature owns message identity, routing, classification, persistence, steering semantics, and
  VS Code presentation.

## Open decisions

1. Which directions may be applied at the next checkpoint without additional parent-agent review?
2. Should a channel target one worker, one run, or a named group by default?
3. What retention limit balances auditability with bounded local storage?
4. Which notification classes warrant a VS Code notification instead of only a panel badge?
5. Should remote transports be adapters over the same channel in this feature or a later feature?

## Value test

The feature succeeds when a reviewer can pair with a specific AskAway worker through VS Code while the
main agent and other workers continue useful work, and when every steering action remains explicit,
attributable, bounded, and recoverable after reload.