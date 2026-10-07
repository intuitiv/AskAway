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
