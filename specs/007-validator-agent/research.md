# Research — 007 Validator Agent

## R-1 agentmemory evaluation (reviewer rule, 2026-10-02)

Source: README of https://github.com/rohitg00/agentmemory, fetched 2026-10-02 (web fetch succeeded). Facts below are from that README; items marked VERIFY are not stated precisely there and are checked in task T-spike before relying on them.

**What it is**: a persistent memory server for coding agents ("Your coding agent remembers everything"), built on the iii engine. Captures observations (via hooks), compresses them into searchable memory, and recalls context. Works with OpenCode, Copilot CLI, Claude Code, Cursor and any MCP client; all agents share one server.

**How it stores**: iii-engine KV state, file-based by default (one JSON file per scope under `~/Library/Application Support/agentmemory` on macOS; override with `--data-dir` / `AGENTMEMORY_DATA_DIR`); optional Redis (`AGENTMEMORY_STATE_BACKEND=redis`). No external DB by default. Memories have a version chain: a superseded version leaves every search index but history is kept. Memories carry `agentId` and `project`; `?agentId=` scopes search.

**How it retrieves**: `smart-search` fuses BM25 + vector + graph (RRF). Keyless default is BM25 only (vectors off); `EMBEDDING_PROVIDER=local` enables on-device `all-MiniLM-L6-v2` (model downloaded on first use). Reported LongMemEval-S R@5 95.2% (vendor measured).

**Interface**:
- REST on `127.0.0.1:3111` (135 endpoints): `POST /agentmemory/remember`, `/smart-search`, `/forget`, `GET /health`, `/livez`, `/memories`. Bearer auth when `AGENTMEMORY_SECRET` is set.
- MCP: `@agentmemory/mcp` stdio shim; 54 tools with a server reachable via `AGENTMEMORY_URL`, 7 without (`memory_save`, `memory_recall`, `memory_smart_search`, `memory_sessions`, `memory_export`, `memory_audit`, `memory_governance_delete`).
- CLI (`agentmemory`, `status`, `stop`, `doctor`), iii functions over `ws://localhost:49134`, a viewer on `:3113`.

**License**: Apache-2.0. **Runtime**: Node 20+, a pinned iii-engine v0.22.1 binary (auto-installed on macOS/Linux with curl, sh, tar; Docker or WSL2 otherwise); four local ports 3111/3112/3113/49134; one shared server, not per-workspace.

**Lifecycle caveat**: it has decay, consolidation and auto-forget by default ("stale memories auto-evict"). That conflicts with FR-020 (kept until the reviewer changes it). VERIFY: whether decay/auto-forget can be switched off or exempted for the validator's `agentId`; if not, the adapter must re-save or the Decision below is revisited.

**Decision**: Use agentmemory as the validator's knowledge store (reviewer rule), reached through its REST API by a thin `KnowledgeStore` adapter in the extension; the validator never depends on agentmemory types elsewhere.

**Rationale**: the reviewer named it; it gives dedup-friendly supersede versioning (FR-010/FR-011), hybrid retrieval with no external DB, and a viewer for the reviewer to audit what was recorded. REST is the simplest portable path from the extension and from OpenCode workers (shared MCP boundary in AGENTS.md can reuse the same server later). Memories are preferred over files (Rules.md), which matches.

**How the validator records facts per spec/story/task**: each Knowledge item is one `remember` call with `agentId = "validator"`, `project = <workspace slug>`, and `concepts` tags: `spec:<slug>` (e.g. `spec:007-validator-agent`), optional `story:US2`, optional `task:T012`, `kind:rule|instruction|goal|fact|example`, plus `source:reviewer-reply`. Content is the concise rule text (an example is stored in the same call under a labelled line). Recall for an answer is `smart-search` with `project`, `agentId = "validator"` and the `spec:` tag; story/task tags narrow it. A reversed decision is a supersede of the existing memory (flagged `changed`), never a second entry. Spec-level facts keep the existing names (`SpecFacts`, `.askaway/specs/<slug>/`); the agentmemory id of each item is mirrored in a small `.askaway/specs/<slug>/validator/index.jsonl` so the spec folder stays the join point and the store can be rebuilt.

**Alternatives considered**:
- Existing `memoryStore.ts` (markdown files + local-model search): zero new runtime and already in the repo, but no versioning or supersede, no graph, and the reviewer asked for agentmemory. Kept as the rejected-for-now fallback; not used silently (a failure is shown per FR-017).
- Plain files under `.askaway/specs/<slug>/`: tracked and diffable but violates "memories preferred over new files" and grows duplicates.
- agentmemory via MCP stdio only: portable to workers but adds a process per call and exposes 7 tools without the server; REST chosen, MCP kept for later linking.
- Auto-capture hooks (OpenCode plugin): rejected; the validator records only extracted knowledge, not raw transcripts (secrets and size, FR-016/FR-010).

**Open research items (VERIFY in spike T-spike)**: exact request fields for `/remember` (`concepts`, `agentId`, `project`) and the supersede call; exemption from decay/auto-forget; startup and health handling when port 3111 is taken by another instance; use `AGENTMEMORY_SECRET` from SecretStorage, never from files.

## R-2 Observation and cheap check (FR-019)
- Every response is observed. A cheap check (rules first: no `?`, no decision words, short status like "done", "running", "ok"; no model call) skips pure progress updates. Uncertain cases go to the validator. Skips are counted so the miss rate can be audited in evals.
- Rejected: only questions/decisions (misses implicit decisions); every response unfiltered (cost, SC-007).

## R-3 Commentary tab reuse
- `src/commentary/commentary.ts` holds `CommentaryStore` with kinds `update | heads-up`, 20-word cap per item and a goal opener. Validator answers are longer (observations, summary, impact, sources, match). Decision: add a kind `validator` rendered by the same Commentary list component and trace-row renderer; the word cap applies only to the existing two kinds; no second tab or look-alike (Consistent Experience). Dismissal of a context suggestion reuses the existing item clear behaviour.

## R-4 Cost
- `src/specs/specCostLedger.ts` (`recordSpecTurn`) already records turn cost per spec and feeds the shared banner. Decision: validator runs record a turn with source `validator`; the banner needs no new component. Per-source attribution covers the "several agents at once" edge case.

## R-5 Run backend
- Validator run = a worker via `src/workers/workerRouter.ts` / OpenCode runtime with a portable worker profile (`workerProfiles.ts`), read-only, no tool that can send to the agent (beta rule). Its prompt is stored with the profile and evaluated by the existing `evalScoreboard.ts` / `evals/` harness (three suites: answer, enhance, store).
- Rejected: separate server per validator (AGENTS.md: one shared server per workspace).

## R-6 Secrets (FR-016)
- Before any text reaches the validator, the store or Commentary, a redaction pass drops secret-shaped strings and the whole item if redaction is uncertain. Reuse the existing redaction used for worker transcripts if present (VERIFY by grep in T-spike); otherwise add one shared function.

## R-7 Beta boundary (FR-018)
- No code path writes validator output to an agent or worker input. A test asserts the agent-send surface is untouched by a validator run.
