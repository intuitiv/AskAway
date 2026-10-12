# AITalk shared production component

| ID | Requirement (one plain sentence) | Reviewer's words (date) | Guarded by |
|---|---|---|---|
| R-AITALK-01 | Production and Storybook import one shared rules/render/CSS component; participant identity, rank, presence policy and proxy permission come from the registry, not role branches in the chat renderer. | "Make sure that aiTalk tab is very generic, and it should be easily extensible. Rules are simple and common for every one. User trumps Validator trumps Main agent trumps worker." (2026-10-12) | test-aitalk-extension.cjs EV-AITALK-EXTENSION |
| R-AITALK-02 | AITalk is first, followed by Specs, Trace, Workers and Settings; Chat remains last until A3 replaces its delivery. | "Order of the tabs will be, Commentary, Specs, Trace, Workers, Settings" (2026-10-11); "Name: AITalk or aiTalk" (2026-10-11); A1/A2 packet retains Chat until A3 (2026-10-12) | test-aitalk-extension.cjs EV-AITALK-EXTENSION |
| R-AITALK-03 | User composer posts, replies and reactions persist as bounded append-only workspace events, reload through the shared renderer, and mentions/reply quotes route from the registry without delivering to the agent before A3. | "User responses will take ultimate priority" (2026-10-11); "Each answer should be its own message" (2026-10-12) | test-aitalk-extension.cjs EV-AITALK-EXTENSION |
