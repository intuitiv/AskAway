# RemoteChannel contract

`tasksync-chat/src/services/remoteChannel.ts` defines configured gating, workspace/General destination resolution, formatted text with plain fallback, opaque string-or-number message IDs, live editing, a new final message, PDF/Markdown files, questions, reply callbacks and task cancellation. Existing callers are not rerouted by T005/T009.

Services are workspace-bound; `destination(workspace, general)` resolves routing metadata and `sendText` accepts it explicitly. Other lifecycle operations use the bound workspace destination. Telegram delegates to its existing send/edit/final/document/question/reply code, preserving notification and deletion behavior. Webex uses POST/PUT/DELETE messages and multipart files, waits for Retry-After, and excludes recorded own-post IDs rather than the reviewer's person ID. A failed deletion keeps the live message. Personal-token final posts cannot promise a device notification; bot identity remains US5.

Posted-ID persistence and missing-space creation remain T006/T015/T017; this adapter boundary keeps IDs during the service lifetime. Caller parity and lifecycle rerouting remain T008/T010–T013. Verify with `rtk node tasksync-chat/test-remote-channel-contract.cjs` and the packet's Telegram/auth/discovery regressions.
