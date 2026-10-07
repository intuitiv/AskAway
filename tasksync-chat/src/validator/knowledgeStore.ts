export interface KnowledgeScope { project: string; agentId: string; spec?: string }

export interface KnowledgeFact {
    text: string;
    kind?: 'rule' | 'instruction' | 'goal' | 'fact';
    example?: string;
    storyId?: string;
    taskId?: string;
    from?: string;
}

export interface KnowledgeItem {
    id: string;
    fact: KnowledgeFact;
    scope: KnowledgeScope;
    ts: number;
    rootId: string;
    supersedesId?: string;
    /** Informational only: set on a version that replaced an earlier, different one. */
    changed?: boolean;
}

export interface KnowledgeStore {
    remember(fact: KnowledgeFact, scope: KnowledgeScope): Promise<KnowledgeItem>;
    recall(query: string, scope: KnowledgeScope, limit: number): Promise<KnowledgeItem[]>;
    supersede(id: string, newFact: KnowledgeFact): Promise<KnowledgeItem>;
    history(id: string): Promise<KnowledgeItem[]>;
    export(): Promise<KnowledgeItem[]>;
}

export class KnowledgeStoreError extends Error {
    constructor(readonly kind: 'unavailable' | 'invalid-response' | 'rejected' | 'not-found', message: string) {
        super(message);
        this.name = 'KnowledgeStoreError';
    }
}

export const MAX_FACT_CHARS = 280;

/** Canonical form ignores presentation and introductory rule labels, not arbitrary paraphrases. */
export function canonicalFact(text: string): string {
    return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^((please|always|remember|note|rule|that)\s+)+/, '');
}

function concise(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= MAX_FACT_CHARS) return clean;
    const sentence = clean.match(/^.{1,280}?[.!?](?=\s|$)/)?.[0];
    if (sentence) return sentence;
    const cut = clean.slice(0, MAX_FACT_CHARS - 1);
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd() + '\u2026';
}

function conciseFact(fact: KnowledgeFact): KnowledgeFact {
    return { ...fact, text: concise(fact.text ?? ''), ...(fact.example ? { example: concise(fact.example) } : {}) };
}

const sameScope = (a: KnowledgeScope, b: KnowledgeScope) =>
    a.project === b.project && a.agentId === b.agentId && a.spec === b.spec;

/**
 * Dedup, supersede and concision rules over any KnowledgeStore (FR-010, FR-011, FR-020).
 * The inner store's ledger stays authoritative; nothing here ever expires or deletes knowledge.
 */
export class DedupKnowledgeStore implements KnowledgeStore {
    constructor(private readonly inner: KnowledgeStore) { }

    private async current(scope: KnowledgeScope): Promise<KnowledgeItem[]> {
        const all = await this.inner.export();
        const replaced = new Set(all.map(item => item.supersedesId).filter(Boolean));
        return all.filter(item => !replaced.has(item.id) && sameScope(item.scope, scope));
    }

    async remember(fact: KnowledgeFact, scope: KnowledgeScope): Promise<KnowledgeItem> {
        const short = conciseFact(fact);
        const key = canonicalFact(short.text);
        const existing = key && (await this.current(scope)).find(item => canonicalFact(item.fact.text) === key);
        return existing || this.inner.remember(short, scope);
    }

    async recall(query: string, scope: KnowledgeScope, limit: number): Promise<KnowledgeItem[]> {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new KnowledgeStoreError('rejected', 'Recall limit must be positive');
        }
        const all = await this.inner.export();
        const replaced = new Set(all.map(item => item.supersedesId).filter(Boolean));
        const seen = new Set<string>();
        const rows: KnowledgeItem[] = [];
        for (const item of await this.inner.recall(query, scope, Math.max(limit, 100))) {
            if (replaced.has(item.id)) continue;
            const key = canonicalFact(item.fact.text) || item.id;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({ ...item, ...(item.supersedesId ? { changed: true } : {}) });
            if (rows.length === limit) break;
        }
        return rows;
    }

    async supersede(id: string, newFact: KnowledgeFact): Promise<KnowledgeItem> {
        const short = conciseFact(newFact);
        const previous = (await this.inner.export()).find(item => item.id === id);
        if (previous && canonicalFact(previous.fact.text) === canonicalFact(short.text)) {
            const replaced = (await this.inner.export()).some(item => item.supersedesId === id);
            if (!replaced) return previous; // Restated, not reversed: no new version.
        }
        return { ...(await this.inner.supersede(id, short)), changed: true };
    }

    async history(id: string): Promise<KnowledgeItem[]> {
        return (await this.inner.history(id)).map(item => ({ ...item, ...(item.supersedesId ? { changed: true } : {}) }));
    }
    async export(): Promise<KnowledgeItem[]> {
        return (await this.inner.export()).map(item => ({ ...item, ...(item.supersedesId ? { changed: true } : {}) }));
    }
}
