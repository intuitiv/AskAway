# Tasks
- [x] A1 Shared AITalk rules/render/CSS under media/aitalk; Storybook imports one component; AITalk first, Specs, Trace, Workers, Settings, Chat last. Evidence: test-aitalk-extension.cjs EV-AITALK-EXTENSION; Storybook 28/28.
- [x] A2 Workspace append-only bounded message store, registry ranks/presence policy/proxy config, post/reply/react bridge, user composer quote bar and registry mentions. Evidence: test-aitalk-extension.cjs EV-AITALK-EXTENSION; TypeScript: No errors found.
- [ ] A3 Deliver composer messages via next tool call; remove Chat and ask_user only after delivery replaces them.
  Partial 2026-10-12: LM shared definitions and legacy AskAway registrations append addressed AITalk user/Validator messages once; durable posted/delivered/read events, commentary action aitalk with crisp/details, UI state refresh. Evidence: test-aitalk-delivery.cjs EV-AITALK-DELIVERY. Chat/ask_user retirement and MCP-wide handoff remain; MCP registration is outside this packet's scope. Existing provider question API and CRLF file are untouched.
- [ ] A4 Wire validator question/direct-message/batch triggers to AITalk.
- [ ] A5 Integrate join/leave presence and event-driven delivery/read ticks.
- [ ] A6 Webex draft thumbs-up approval and recipient/full-text permission flow.
- [x] T001 [request] Make Storybook AITalk generic: config registry/ranks, pure rules and render separation, routing/presence/ticks/reactions, Reply quotes, config-only agent story, tests and spec section within packet scope. Evidence: rtk npm --prefix tasksync-chat/storybook test → ℹ tests 23; ℹ pass 23; ℹ fail 0. Registry config, pure routing/rank/presence/events/reactions, Reply quoting, configured agent story and Generic rules spec section implemented.
