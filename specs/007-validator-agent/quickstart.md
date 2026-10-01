# Quickstart — 007 Validator Agent (beta, Commentary only)

1. Start the memory store: `npx -y @agentmemory/agentmemory@latest` (Node 20+; REST on `127.0.0.1:3111`). Check `curl http://localhost:3111/agentmemory/livez`. Optional: `EMBEDDING_PROVIDER=local` in `~/.agentmemory/.env` for semantic recall.
2. Put a decision in `specs/<slug>/Rules.md` and make that spec active.
3. Have an agent or worker respond with a question that the rule covers. Open the Commentary tab: a validator entry shows answer, source, observations, summary, impact. The shared banner cost increased. The agent received nothing.
4. Ask something no rule covers: the entry says no source answers it.
5. Reply as the reviewer with a different decision and a new rule. Commentary shows the prediction match; the rule appears in agentmemory (viewer `http://localhost:3113`) tagged `spec:<slug>`.
6. Start a fresh agent on the same spec and ask a related question: the Commentary answer cites the stored rule.
7. Stop agentmemory and respond again: a visible validator failure appears; the agent/reviewer flow is not delayed.
8. Evals: `npm run test:workers` (in `tasksync-chat/`) plus the validator eval suites (answer, enhance, store); a prompt change must not lower any score.

Pass = Story 1 acceptance scenarios 1-4, Story 2 scenarios 1-3 and 6, SC-006 and SC-008 observed.
