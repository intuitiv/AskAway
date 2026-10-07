import { z } from 'zod';
import { KnowledgeStore, KnowledgeStoreError } from './knowledgeStore';
import { redactRecordOrDrop } from './redact';
import type { ToolDefinition } from '../workers/workerTools';

export function memoryTool(source: () => Promise<KnowledgeStore>, project: string): ToolDefinition {
    const inputSchema = z.object({
        action: z.enum(['view', 'search', 'remember', 'update', 'history', 'export']),
        scope: z.enum(['user', 'repo']).default('repo'),
        agentId: z.string().min(1).default('agents'),
        spec: z.string().optional(), query: z.string().optional(),
        text: z.string().min(1).optional(), id: z.string().min(1).optional(),
        limit: z.number().int().positive().default(100),
    });
    return {
        name: 'askaway_memory',
        description: 'Shared local memory: view/list, search, remember, update (supersede), history, export (JSONL including older versions). User/repo scope and agentId isolate knowledge. Use agentId agents for shared agent memory; validator uses validator. Markdown sources are frozen after one-time migration.',
        inputSchema,
        run: async input => {
            const args = inputSchema.parse(input);
            if (!redactRecordOrDrop(args)) throw new KnowledgeStoreError('rejected', 'Memory input rejected by secret gate');
            const store = await source();
            const scope = { project: args.scope === 'user' ? '_user' : project, agentId: args.agentId, spec: args.spec };
            const all = (await store.export()).filter(item => item.scope.project === scope.project &&
                item.scope.agentId === scope.agentId && (scope.spec === undefined || item.scope.spec === scope.spec));
            const replaced = new Set(all.map(item => item.supersedesId));
            if (args.action === 'export') return { jsonl: all.map(item => JSON.stringify(item)).join('\n') + (all.length ? '\n' : '') };
            if (args.action === 'view' && !args.query) return all.filter(item => !replaced.has(item.id)).slice(0, args.limit);
            if (args.action === 'view' || args.action === 'search') return store.recall(args.query || '', scope, args.limit);
            if (args.action === 'remember') {
                if (!args.text) throw new KnowledgeStoreError('rejected', 'remember requires text');
                return store.remember({ text: args.text }, scope);
            }
            if (!args.id || !all.some(item => item.id === args.id)) throw new KnowledgeStoreError('not-found', 'Memory item not found in scope');
            if (args.action === 'history') return store.history(args.id);
            if (!args.text) throw new KnowledgeStoreError('rejected', 'update requires text');
            return store.supersede(args.id, { text: args.text });
        },
    };
}
