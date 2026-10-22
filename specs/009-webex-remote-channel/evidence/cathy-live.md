# Cathy live Webex smoke test (T047)

Date: 2026-10-22

## Tools called

- `webex_inbox` — 1 call (limit 20)
- `webex_find` — 1 call (query "Vinayak", kind person)
- `webex_read` — 3 calls (1 to read the "Nirvana" space and confirm the latest Vinayak message; 2 follow-up verification reads that both failed, see below)
- `webex_reply` — 1 call (queued the draft)
- `aitalk` — 2 calls (1 heads-up that succeeded; 1 "update"-kind follow-up that was rejected because workers may only post questions, not updates)

## Space and message

Space: **Nirvana**

`webex_find` returned three people named Vinayak (Chowsalkar, Malviya, Raina). Only **Vinayak Chowsalkar** appears in the inbox/space data, so he's the one with an actual recent message to the reviewer's spaces. His latest message in Nirvana was itself a thread reply to Rahul Rathore's PR-review request:

> "sure Rahul, will check this"

(first 80 chars shown in full — the message is short). This was the message replied to.

## Draft and outcome

Queued via `webex_reply` targeting "latest from Vinayak Chowsalkar in Nirvana" with text `Thank you!`. A pending draft card was posted in AITalk automatically (showing "Draft · Webex reply · Nirvana / Thread: Vinayak Chowsalkar: sure Rahul, will check this / Thank you!").

Posted one `aitalk` heads-up naming the Nirvana space and asking for 👍. The reviewer approved almost immediately: **"👍 Approved: sent to Nirvana."**

**Outcome: approved and sent.**

An older unapproved Cathy draft from yesterday may still exist elsewhere — it was left untouched; no action was taken on it.

## Surprising / notable

- A second `aitalk` call (kind "update") to acknowledge the approval was rejected: workers may only post questions/heads-ups on AITalk, not progress updates — that's reserved for the main agent.
- Two follow-up `webex_read` calls on the "Nirvana" thread (to independently verify the sent message) both failed with `HTTP 503` ("Webex could not read those messages"). This looked like a transient Webex API issue, not a contract mismatch — the approval outcome was already confirmed via the AITalk reply, so the send itself is not in doubt, but direct read-back verification was not possible at this time.
- No other contract deviations observed: `webex_inbox` and `webex_find` responses matched their documented shapes (names + refs only, no ids).
