import { ValidatorRecords, IndexEntry } from './records';
import { redactRecordOrDrop } from './redact';
import { KnowledgeFact, KnowledgeItem, KnowledgeScope, KnowledgeStore, KnowledgeStoreError } from './knowledgeStore';

interface KnowledgeEntry extends IndexEntry, KnowledgeItem { }

export class AgentmemoryStore implements KnowledgeStore {
    private readonly records: ValidatorRecords;
    private readonly baseUrl: string;

    constructor(workspaceRoot: string, baseUrl: string, private readonly secret: string) {
        const url = new URL(baseUrl);
        if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            url.username || url.password || url.search || url.hash) {
            throw new KnowledgeStoreError('rejected', 'Knowledge index must use a local HTTP endpoint');
        }
        this.baseUrl = baseUrl.replace(/\/$/, '').replace(/\/agentmemory$/, '');
        // One workspace ledger also covers repo-wide facts without an active spec.
        this.records = new ValidatorRecords(workspaceRoot, null);
    }

    private entries(): KnowledgeEntry[] {
        return this.records.index().filter((row): row is KnowledgeEntry =>
            'fact' in row && 'scope' in row && 'rootId' in row && 'id' in row);
    }

    private safe<T>(value: T): T {
        const json = JSON.stringify(value);
        if (!redactRecordOrDrop(value) || (this.secret && json.includes(this.secret))) {
            throw new KnowledgeStoreError('rejected', 'Knowledge input rejected by secret gate');
        }
        return JSON.parse(json);
    }

    private async request(route: string, body?: object): Promise<any> {
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/agentmemory/${route}`, {
                method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch {
            throw new KnowledgeStoreError('unavailable', `Knowledge index ${route} unavailable`);
        }
        if (!response.ok) {
            throw new KnowledgeStoreError('unavailable', `Knowledge index ${route} failed (HTTP ${response.status})`);
        }
        try { return await response.json(); } catch {
            throw new KnowledgeStoreError('invalid-response', `Knowledge index ${route} returned invalid JSON`);
        }
    }

    private async write(fact: KnowledgeFact, scope: KnowledgeScope, previous?: KnowledgeEntry): Promise<KnowledgeItem> {
        const safe = this.safe({ fact, scope });
        if (!safe.fact.text?.trim() || !safe.scope.project?.trim() || !safe.scope.agentId?.trim()) {
            throw new KnowledgeStoreError('rejected', 'Knowledge requires text, project and agentId');
        }
        const concepts = [`project:${safe.scope.project}`, `kind:${safe.fact.kind || 'fact'}`];
        if (safe.scope.spec) concepts.push(`spec:${safe.scope.spec}`);
        if (safe.fact.storyId) concepts.push(`story:${safe.fact.storyId}`);
        if (safe.fact.taskId) concepts.push(`task:${safe.fact.taskId}`);
        const result = await this.request('remember', {
            content: safe.fact.text + (safe.fact.example ? `\nExample: ${safe.fact.example}` : ''),
            agentId: safe.scope.agentId, concepts
        });
        // agentmemory 0.9.x answers { success, memory: { id, ... } }.
        const id = result?.success === true ? result?.memory?.id : undefined;
        if (typeof id !== 'string' || !id || this.entries().some(entry => entry.id === id)) {
            throw new KnowledgeStoreError('invalid-response', 'Knowledge index remember returned no unique id');
        }
        const entry: KnowledgeEntry = this.safe({ id, memoryId: id, ...safe,
            kind: safe.fact.kind || 'fact', specSlug: safe.scope.spec || '_no-spec',
            storyId: safe.fact.storyId, taskId: safe.fact.taskId, from: safe.fact.from,
            ts: Date.now(), rootId: previous?.rootId || id,
            ...(previous ? { supersedesId: previous.id } : {}) });
        if (!this.records.appendIndex(entry)) {
            throw new KnowledgeStoreError('rejected', 'Knowledge record rejected by secret gate');
        }
        return entry;
    }

    remember(fact: KnowledgeFact, scope: KnowledgeScope): Promise<KnowledgeItem> {
        return this.write(fact, scope);
    }

    async recall(query: string, scope: KnowledgeScope, limit: number): Promise<KnowledgeItem[]> {
        this.safe({ query, scope });
        if (!Number.isInteger(limit) || limit < 1) throw new KnowledgeStoreError('rejected', 'Recall limit must be positive');
        const entries = this.entries();
        const superseded = new Set(entries.map(entry => entry.supersedesId).filter(Boolean));
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        const seen = new Set<string>();
        const matches: KnowledgeItem[] = [];
        const cursors = new Set<string>();
        let cursor: string | null = null;
        do {
            const params = new URLSearchParams({ agentId: scope.agentId, limit: String(Math.max(100, limit)) });
            if (query.trim()) params.set('q', query);
            if (cursor) params.set('cursor', cursor);
            const result = await this.request(`memories?${params}`);
            if (!Array.isArray(result?.memories)) throw new KnowledgeStoreError('invalid-response', 'Knowledge index memories returned no memories array');
            for (const hit of result.memories) {
                const id = hit?.id;
                const entry = byId.get(id);
                if (!entry || superseded.has(id) || seen.has(id) || entry.scope.project !== scope.project ||
                    entry.scope.agentId !== scope.agentId || (scope.spec !== undefined && entry.scope.spec !== scope.spec)) continue;
                seen.add(id);
                matches.push(entry);
                if (matches.length === limit) return matches;
            }
            cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
            if (cursor && cursors.has(cursor)) throw new KnowledgeStoreError('invalid-response', 'Knowledge index memories repeated a cursor');
            if (cursor) cursors.add(cursor);
        } while (cursor);
        return matches;
    }

    async supersede(id: string, newFact: KnowledgeFact): Promise<KnowledgeItem> {
        const entries = this.entries();
        const previous = entries.find(entry => entry.id === id);
        if (!previous || entries.some(entry => entry.supersedesId === id)) {
            throw new KnowledgeStoreError('not-found', 'Knowledge version is not current');
        }
        return this.write(newFact, previous.scope, previous);
    }

    async history(id: string): Promise<KnowledgeItem[]> {
        const entries = this.entries();
        const entry = entries.find(row => row.id === id);
        return entry ? entries.filter(row => row.rootId === entry.rootId) : [];
    }

    async export(): Promise<KnowledgeItem[]> { return this.entries(); }
}
