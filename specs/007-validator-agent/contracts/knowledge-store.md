# Contract — KnowledgeStore (adapter over agentmemory)

Port used by the validator; the only code that knows agentmemory.

```ts
interface KnowledgeStore {
  remember(item: {kind; text; example?; specSlug; storyId?; taskId?}): Promise<{memoryId; deduped: boolean; supersededId?: string}>;
  recall(q: {specSlug; storyId?; taskId?; query: string; limit: number}): Promise<KnowledgeItem[]>;
  health(): Promise<{ok: boolean; error?: string}>;
}
```

## Behaviour
- `remember`: redact secrets first (reject item if unsure); find same normalised text in spec scope -> return `deduped: true`, no write; reverses an existing item -> supersede it with `POST /agentmemory/evolve` (`memoryId`, `newContent`), `supersededId` returned, `changed` derived from it (no stored flag, R-1); else new memory.
- Maps to REST on `AGENTMEMORY_URL` (default `http://127.0.0.1:3111`): `POST /agentmemory/remember` (`content`, `concepts` = `spec:`/`story:`/`task:`/`kind:` tags, `agentId: "validator"`, `project`), `POST /agentmemory/evolve`, `POST /agentmemory/smart-search` (no concepts filter: results are post-filtered by the `spec:` tag), `GET /agentmemory/health`. The server holds `AGENTMEMORY_SECRET` in its env; the client sends it as a Bearer from VS Code SecretStorage and never logs it. Exact fields verified in spike (research R-1).
- Failure: throws a typed error; caller shows it in Commentary and continues (FR-017). No silent fallback to files.
- Observability: one event per call (op, specSlug, ms, ok), no content.
