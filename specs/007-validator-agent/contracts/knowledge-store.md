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
- `remember`: redact secrets first (reject item if unsure); find same normalised text in spec scope -> return `deduped: true`, no write; reverses an existing item -> supersede it (`changed`); else new memory.
- Maps to REST on `AGENTMEMORY_URL` (default `http://127.0.0.1:3111`): `POST /agentmemory/remember` (`content`, `concepts` = `spec:`/`story:`/`task:`/`kind:` tags, `agentId: "validator"`, `project`), `POST /agentmemory/smart-search`, `GET /agentmemory/health`. Bearer from `AGENTMEMORY_SECRET` (SecretStorage). Exact fields verified in spike (research R-1).
- Failure: throws a typed error; caller shows it in Commentary and continues (FR-017). No silent fallback to files.
- Observability: one event per call (op, specSlug, ms, ok), no content.
