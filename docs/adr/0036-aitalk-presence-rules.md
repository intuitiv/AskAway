# ADR 0036: AITalk presence rules: always, per turn, per question

- Status: Proposed
- Date: 2026-10-22
- Goal: the AITalk goal in [GOALS.md](../../GOALS.md) (G12)
- Supersedes: the presence part of [ADR 0021](0021-aitalk-actor-framework.md) and the assignment-time presence of [ADR 0023](0023-agy-first-team-members.md) (R-TEAM-09). Both stay as written; this ADR is the rule that wins.

## Context

Cathy joined AITalk to ask permission for a Webex message and stayed after the reviewer approved it. The release rule looked only at the actors of the process that ran it, and counted every message a worker posted as a question. The Webex approval is settled by the window that owns the card, often not the process the worker posted through, so that process had no actor for Cathy and nobody released her.

## Decision

> After asking for persmission about webex message Cathy joined, but Cathy didnt leave. I and Priya will be in the room always, Main agent will join in the turn beginnign and leaves after the turn ends. And individual members join the room when they ahve question, once all those questions were answered, they should leave the room. This is the behavior. (2026-10-22)

- The reviewer and Priya (the Validator) are always present.
- The main agent joins when its turn starts (or with its first tool call) and leaves when the turn ends (R-AITALK-50).
- Every other member joins only when it posts a question (heads-up) or a Webex permission card. Running a task, reading and reporting never makes a member join.
- A member stays while any of its questions or cards is open and leaves as soon as none is. A question is answered by a reply or a reaction from someone else. An approval card is answered when its draft is settled (👍 sent, 👎 rejected, failed, or edited and then resolved) or when the card is gone from the log. A reaction from another member does not settle a pending card.
- The rule reads the shared store (`Room.releaseAnswered`), not the actors held in one process, and runs after every post, reaction, worker stop and card settlement, so whichever process settles the last item releases the member.

## Consequences

A member leaves exactly when the reviewer has dealt with everything it asked, however it joined. Presence rows from different windows agree because they all derive from the same log. A member's reply to someone else's question does not keep it in the room. A member that joined and has not posted yet is left alone for five seconds so a second process cannot release it between its join and its first message.
