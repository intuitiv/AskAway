# Research — 007 Validator Agent

## R-1 agentmemory evaluation (reviewer rule, 2026-10-02)

### T001 result — spike 2026-10-07; binding adapter decision

Reviewer: "Lets keep them under an interface and use agentmemory for now. We can migrate to others if needed." This decision and the real local agentmemory **0.9.30** spike supersede the older R-1 assumptions below about project persistence, filtered search and verified evolve/history contracts. Spike artifacts: `.askaway/analyst/agentmemory-spike.cjs`, `agentmemory-README.md`, `agentmemory-routes.txt`; today's observed results supplied in the implementation packet, not a new live probe in T005.

- Local spike ran zero-LLM with `EMBEDDING_PROVIDER=local` and provider keys unset. This avoids the earlier inherited-key OpenAI attempt; it is not proof of embedding-cache network isolation or restart durability.
- `POST /agentmemory/remember` returned HTTP 201 and `id`; stored `agentId`, but **not project**. Use `project:<name>` in `concepts`, alongside optional `spec:`, `story:`, `task:` and `kind:` tags. Never depend on the server's project field for isolation.
- `POST /agentmemory/search` has no documented project/agent request filters. README lines 1553–1562 describe shared/isolated modes and `?agentId=` on isolated endpoints, not a `/search` body contract. Retrieval ranked mostly lexically; paraphrase recall was weak. Over-fetch ranked candidates, then filter against our authoritative project/agent/spec ledger; unknown IDs are never trusted.
- No verified supersede/update/history request contract. README 1057, 1084, 1390 and 1809–1833 claim version chains/features, but do not establish callable contracts; route names alone are insufficient. Do not guess `/evolve` bodies.
- Export/import exists; `POST /agentmemory/import` with `strategy=skip` worked non-destructively. Cross-store migration remains unverified.
- Bearer authentication uses the existing local secret at `~/.agentmemory/secret`; the adapter receives it via its constructor, never reads that file, logs it or puts it in request bodies/records. Only the Authorization header carries it.
- `/agentmemory/consolidation/status.enabled=false` confirmed. Auto-forget/decay status and occupied-port adoption are not claimed verified by this result; lifecycle and disabling retention automation belong to T011.

**T005 design**: `knowledgeStore.ts` owns the portable `remember(fact, scope)`, `recall(query, scope, limit)`, `supersede(id, newFact)`, `history(id)`, `export()` interface; scope is `{project, agentId, spec?}`. `agentmemoryStore.ts` uses agentmemory only as the search index. `ValidatorRecords` writes redacted append-only `index.jsonl` under the workspace's `.askaway/specs/_no-spec/validator/`; each row includes the fact, exact scope, returned memory ID, root version ID and optional superseded ID. The shared workspace ledger also supports facts without an active spec. New versions append, preserving old statements; recall excludes every superseded ID and post-filters exact scope. History/export read the authoritative ledger, not undocumented server history/export shapes. Remember/recall throw typed visible errors on index failure; no offline recall fallback. No automatic expiry, LLM calls, guessed version APIs or legacy-memory migration in this adapter.

**Evidence**: `rtk node tasksync-chat/test-knowledge-store.cjs` → `PASS EV-KNOWLEDGE-STORE: HTTP scope isolation, append-only supersede/history, secret gate, visible server-down errors`. Fake HTTP server mimics unfiltered stale/duplicate candidates, 201 IDs without project metadata and index outages; ledger reopening retains history and supersede filtering. This proves adapter behaviour, not stronger upstream search guarantees.

### Historical evaluation (2026-10-02; superseded where noted above)

Source: upstream `main` README, generated REST/config references, and source at https://github.com/rohitg00/agentmemory (checked 2026-10-02).

**What it is**: a persistent memory server for coding agents ("Your coding agent remembers everything"), built on the iii engine. Captures observations (via hooks), compresses them into searchable memory, and recalls context. Works with OpenCode, Copilot CLI, Claude Code, Cursor and any MCP client; all agents share one server.

**How it stores**: iii-engine KV state, file-based by default (one JSON file per scope under `~/Library/Application Support/agentmemory` on macOS; override with `--data-dir` / `AGENTMEMORY_DATA_DIR`); optional Redis (`AGENTMEMORY_STATE_BACKEND=redis`). No external DB by default. Memories have a version chain: a superseded version leaves every search index but history is kept. Memories carry `agentId` and `project`; `?agentId=` scopes search.

**How it retrieves**: `smart-search` fuses BM25 + vector + graph (RRF). Keyless default is BM25 only (vectors off); `EMBEDDING_PROVIDER=local` enables on-device `all-MiniLM-L6-v2` (model downloaded on first use). Reported LongMemEval-S R@5 95.2% (vendor measured).

**Interface**:
- REST on `127.0.0.1:3111` (135 endpoints): `POST /agentmemory/remember`, `/smart-search`, `/forget`, `GET /health`, `/livez`, `/memories`. Bearer auth when `AGENTMEMORY_SECRET` is set.
- MCP: `@agentmemory/mcp` stdio shim; 54 tools with a server reachable via `AGENTMEMORY_URL`, 7 without (`memory_save`, `memory_recall`, `memory_smart_search`, `memory_sessions`, `memory_export`, `memory_audit`, `memory_governance_delete`).
- CLI (`agentmemory`, `status`, `stop`, `doctor`), iii functions over `ws://localhost:49134`, a viewer on `:3113`.

**License**: Apache-2.0. **Runtime**: Node 20+, a pinned iii-engine v0.22.1 binary (auto-installed on macOS/Linux with curl, sh, tar; Docker or WSL2 otherwise); four local ports 3111/3112/3113/49134; one shared server, not per-workspace.

**Lifecycle caveat / (a)**: Auto-forget is globally enabled by default (hourly); set `AUTO_FORGET_ENABLED=false` to disable its timer. Consolidation/decay is separately controlled by `CONSOLIDATION_ENABLED`; it defaults off without an LLM provider, otherwise on, and `CONSOLIDATION_ENABLED=false` disables it. `CONSOLIDATION_DECAY_DAYS` defaults to 30 (age threshold, not an off switch). These are process-wide, not per-agentId/project; `agentmemory` documents no exemption/pin field. Auto-forget can expire `ttlDays` memories, mark contradictions non-latest, and evict low-value old observations. Sources: [src/index.ts:2718-2738 (`AUTO_FORGET_ENABLED` timer)](https://github.com/rohitg00/agentmemory/blob/main/src/index.ts#L2718-L2738); [src/config.ts:2340-2412 (`isConsolidationEnabled`, `getConsolidationDecayDays`)](https://github.com/rohitg00/agentmemory/blob/main/src/config.ts#L2340-L2412); [src/functions/auto-forget.ts: memory TTL/contradiction/observation handling](https://github.com/rohitg00/agentmemory/blob/main/src/functions/auto-forget.ts); [README.md:1532-1536, consolidation configuration](https://github.com/rohitg00/agentmemory/blob/main/README.md#consolidation).

**Decision**: Use agentmemory as the validator's knowledge store (reviewer rule), reached through its REST API by a thin `KnowledgeStore` adapter in the extension; the validator never depends on agentmemory types elsewhere.

Consequence: KnowledgeStore adapter must re-save / pin items when a shared instance must retain lifecycle behavior for other agents — otherwise disable global `AUTO_FORGET_ENABLED` and `CONSOLIDATION_ENABLED`; the replay mechanism is checking canonical validator IDs and re-posting missing items with `POST /agentmemory/remember` (omit `ttlDays`).

**Rationale**: the reviewer named it; it gives dedup-friendly supersede versioning (FR-010/FR-011), hybrid retrieval with no external DB, and a viewer for the reviewer to audit what was recorded. REST is the simplest portable path from the extension and from OpenCode workers (shared MCP boundary in AGENTS.md can reuse the same server later). Memories are preferred over files (Rules.md), which matches.

**How the validator records facts per spec/story/task**: each Knowledge item is one `remember` call with `agentId = "validator"`, `project = <workspace slug>`, and `concepts` tags: `spec:<slug>` (e.g. `spec:007-validator-agent`), optional `story:US2`, optional `task:T012`, `kind:rule|instruction|goal|fact|example`, plus `source:reviewer-reply`. Content is the concise rule text (an example is stored in the same call under a labelled line). Recall for an answer is `smart-search` with `project` and `agentId = "validator"`; encode tags in the query/content as needed, since smart-search's documented REST body has no concepts filter. A reversed decision updates the existing version with `POST /agentmemory/evolve` (`memoryId`, `newContent`, optional `newTitle`/`newType`), rather than inventing a `changed` flag. Spec-level facts keep the existing names (`SpecFacts`, `.askaway/specs/<slug>/`); the agentmemory id of each item is mirrored in a small `.askaway/specs/<slug>/validator/index.jsonl` so the spec folder stays the join point and the store can be rebuilt. Source: [src/triggers/api.ts: smart-search and evolve contracts](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L1619-L1671).

**Alternatives considered**:
- Existing `memoryStore.ts` (markdown files + local-model search): zero new runtime and already in the repo, but no versioning or supersede, no graph, and the reviewer asked for agentmemory. Kept as the rejected-for-now fallback; not used silently (a failure is shown per FR-017).
- Plain files under `.askaway/specs/<slug>/`: tracked and diffable but violates "memories preferred over new files" and grows duplicates.
- agentmemory via MCP stdio only: portable to workers but adds a process per call and exposes 7 tools without the server; REST chosen, MCP kept for later linking.
- Auto-capture hooks (OpenCode plugin): rejected; the validator records only extracted knowledge, not raw transcripts (secrets and size, FR-016/FR-010).

**REST contract / (b)**: `POST /agentmemory/remember` requires `content`; accepts optional `type`, `concepts`, `files`, `ttlDays`, `sourceObservationIds`, `project`, and `agentId`. Update/supersede is `POST /agentmemory/evolve` with required `memoryId`, `newContent`, and optional `newTitle`, `newType`; it evolves that current memory into a new version. Sources: [src/triggers/api.ts: remember handler/path](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L1445-L1495); [src/triggers/api.ts: evolve handler/path](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L1832-L1865); [README, API](https://github.com/rohitg00/agentmemory/blob/main/README.md#api).

**Search scope / (c)**: `POST /agentmemory/smart-search` accepts `query`, `expandIds`, `limit`, `project`, `includeLessons`, `agentId`, `sessionId`, and `source`; both `project` and `agentId` are passed to `mem::smart-search`. `agentId` filtering is documented for isolated mode (`AGENTMEMORY_AGENT_SCOPE=isolated`); per-request agentId overrides are supported. Sources: [src/triggers/api.ts: smart-search handler/path](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L1619-L1671); [README, multi-agent scoping](https://github.com/rohitg00/agentmemory/blob/main/README.md#multi-agent-memory).

**Port and health / (d)**: if agentmemory's own `/agentmemory/livez` responds on the selected REST port, startup exits instead of starting a duplicate and advises using the existing REST/MCP server, choosing `--instance`, or stopping it. A generic foreign port holder is not adopted as agentmemory; the source documents the port-in-use condition and recommends finding the holder or choosing `--port <N>` (or `III_REST_PORT`), not automatic fallback. Health endpoints are `GET /agentmemory/health` (auth middleware applies if a secret is configured) and `GET /agentmemory/livez` (public). Sources: [src/cli.ts:1943-1963, duplicate-server guard](https://github.com/rohitg00/agentmemory/blob/main/src/cli.ts#L1943-L1963); [src/triggers/api.ts:495-580, health/liveness routes](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L495-L580); [README.md:1480-1508, Ports/port conflict](https://github.com/rohitg00/agentmemory/blob/main/README.md#ports).

**Authentication / (e)**: configure `AGENTMEMORY_SECRET` in the server environment (or `~/.agentmemory/.env`); REST clients pass its value as `Authorization: Bearer <secret>`. For MCP, pass `AGENTMEMORY_SECRET` in the MCP process `env` (typically inherited from the shell); the shim forwards it when calling the configured `AGENTMEMORY_URL`. Sources: [README.md:1674-1687, REST auth/API](https://github.com/rohitg00/agentmemory/blob/main/README.md#api); [README.md:713-726, standard MCP block and environment inheritance](https://github.com/rohitg00/agentmemory/blob/main/README.md#other-agents); [src/triggers/api.ts:80-94, bearer auth check](https://github.com/rohitg00/agentmemory/blob/main/src/triggers/api.ts#L80-L94).

## R-2 Observation and cheap check (FR-019)
- Every response is observed. A cheap check (rules first: no `?`, no decision words, short status like "done", "running", "ok"; no model call) skips pure progress updates. Uncertain cases go to the validator. Skips are counted so the miss rate can be audited in evals.
- Rejected: only questions/decisions (misses implicit decisions); every response unfiltered (cost, SC-007).

## R-3 Commentary tab reuse
- `src/commentary/commentary.ts` holds `CommentaryStore` with kinds `update | heads-up`, 20-word cap per item and a goal opener. Validator answers are longer (observations, summary, impact, sources, match). Decision: add a kind `validator` to `CommentaryItem` only, NOT to `COMMENTARY_KINDS` (verified: that array feeds the MCP `z.enum` and `post()` validation, so adding it would let an agent forge validator output). Written through a separate internal `postValidator()`; rendered by the same Commentary list component and trace-row renderer; the word cap applies only to the existing two kinds; no second tab or look-alike (Consistent Experience). Dismissal of a context suggestion reuses the existing item clear behaviour.

## R-4 Cost
- `src/specs/specCostLedger.ts` (`recordSpecTurn`) already records turn cost per spec and feeds the shared banner. Decision: validator runs record a turn with source `validator` under its own `turnKey` `validator:<responseId>` (the ledger upserts by turnKey+specSlug, so reusing the observed turn's key would overwrite it); the row gains optional `source`, `reasoningTokens`, `cacheReadTokens`, `cacheWriteTokens` (verified: `SpecCostTurn` today has only requests, inputTokens, outputTokens, nanoAiu). The banner needs no new component. Per-source attribution covers the "several agents at once" edge case.

## R-5 Run backend
- Validator run = a worker via `src/workers/workerRouter.ts` / OpenCode runtime with a portable worker profile (`workerProfiles.ts`), read-only, no tool that can send to the agent (beta rule). Its prompt is stored with the profile and evaluated by the existing `evalScoreboard.ts` / `evals/` harness (three suites: answer, enhance, store).
- Rejected: separate server per validator (AGENTS.md: one shared server per workspace).

## R-6 Secrets (FR-016)
- Before any text reaches the validator, the store or Commentary, a redaction pass drops secret-shaped strings and the whole item if redaction is uncertain. Reuse `CREDENTIAL_ANYWHERE` in `src/commentary/commentary.ts` (verified: exists as a non-exported const, used by `promptExcerpt`; T002 exports it). There is no worker-transcript redaction to reuse. Coverage: the reviewer's reply, the observed response and the sources read (ADRs, memories).

## R-7 Beta boundary (FR-018)
- No code path writes validator output to an agent or worker input. A test asserts the agent-send surface is untouched by a validator run.
