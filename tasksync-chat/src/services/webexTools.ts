import { z } from 'zod';

export const webexToolSchema = z.object({
    action: z.enum(['spaces', 'read', 'thread', 'search', 'people', 'send']),
    max: z.number().int().positive().optional(),
    roomId: z.string().trim().min(1).max(1000).optional(),
    parentId: z.string().trim().min(1).max(1000).optional(),
    mine: z.boolean().optional(),
    query: z.string().trim().min(1).max(1000).optional(),
    email: z.string().email().max(1000).optional(),
    displayName: z.string().trim().min(1).max(1000).optional(),
    toPersonEmail: z.string().email().max(1000).optional(),
    text: z.string().min(1).max(1000).optional(),
}).strict();

export type WebexToolInput = z.infer<typeof webexToolSchema>;
export interface WebexToolDeps {
    request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{
        ok: boolean; json(): Promise<unknown>; headers?: { get(name: string): string | null };
    }>;
    approve(draft: { recipientLabel: string; text: string; parentId?: string }): Promise<'approved' | 'denied' | 'unavailable'>;
}

type Row = Record<string, unknown>;
const credential = /\b(?:Bearer\s+\S+|(?:access_token|refresh_token|client_secret|authorization)\s*[:=]\s*\S+)/gi;
const trim = (value: unknown): string => typeof value === 'string' ? value.replace(credential, '[redacted]').slice(0, 1000) : '';

/** Auth, enabled gating and approval UI belong to the host; this boundary never receives a token. */
export async function runWebexTool(input: unknown, deps: WebexToolDeps): Promise<Record<string, unknown>> {
    const parsed = webexToolSchema.safeParse(input);
    if (!parsed.success || Object.values(parsed.data).some(value => typeof value === 'string' && trim(value) !== value)) {
        return { status: 'invalid', reason: 'Invalid Webex tool input.' };
    }
    const args = parsed.data;
    const max = Math.min(args.max ?? 20, 50);
    try {
        if (args.action === 'send') {
            if (!args.text?.trim() || Number(!!args.roomId) + Number(!!args.toPersonEmail) !== 1) {
                return { status: 'invalid', reason: 'Send needs text and exactly one recipient.' };
            }
            const recipientLabel = args.toPersonEmail ?? args.roomId!;
            const draft = { recipientLabel, text: args.text, ...(args.parentId ? { parentId: args.parentId } : {}) };
            let approval: string;
            try { approval = await deps.approve(draft); } catch { approval = 'unavailable'; }
            if (approval !== 'approved') { return { status: 'draft', recipientLabel, text: args.text }; }
            const response = await deps.request('POST', '/messages', {
                ...(args.roomId ? { roomId: args.roomId } : { toPersonEmail: args.toPersonEmail }),
                text: args.text, ...(args.parentId ? { parentId: args.parentId } : {}),
            });
            if (!response.ok) { return { status: 'error', reason: 'Webex request failed.' }; }
            const data = await response.json() as Row;
            return { status: 'sent', recipientLabel, id: trim(data.id) };
        }
        const params = new URLSearchParams({ max: String(max) });
        let endpoint = '/messages';
        if (args.action === 'spaces') { endpoint = '/rooms'; params.set('sortBy', 'lastactivity'); }
        else if (args.action === 'people') {
            if (Number(!!args.email) + Number(!!args.displayName) !== 1) { return { status: 'invalid', reason: 'People needs email or displayName.' }; }
            endpoint = '/people';
            params.set(args.email ? 'email' : 'displayName', args.email ?? args.displayName!);
        } else {
            if (!args.roomId || (args.action === 'thread' && !args.parentId) || (args.action === 'search' && !args.query)) {
                return { status: 'invalid', reason: 'Messages need a room and the action-specific thread or search value.' };
            }
            params.set('roomId', args.roomId);
            if (args.action === 'thread') { params.set('parentId', args.parentId!); }
        }
        let owner = '';
        if (args.action === 'read' && args.mine) {
            const me = await deps.request('GET', '/people/me');
            if (!me.ok) { return { status: 'error', reason: 'Webex request failed.' }; }
            owner = trim((await me.json() as Row).id);
            if (!owner) { return { status: 'error', reason: 'Webex owner unavailable.' }; }
        }
        const response = await deps.request('GET', `${endpoint}?${params}`);
        if (!response.ok) { return { status: 'error', reason: 'Webex request failed.' }; }
        const data = await response.json() as Row;
        const rows = Array.isArray(data.items) ? data.items as Row[] : [];
        const scanned = rows.slice(0, max);
        const selected = scanned.filter(row => (!owner || row.personId === owner)
            && (args.action !== 'search' || String(row.text ?? row.markdown ?? '').toLowerCase().includes(args.query!.toLowerCase())));
        const fields = args.action === 'spaces' ? ['id', 'title', 'type', 'teamId', 'lastActivity']
            : args.action === 'people' ? ['id', 'displayName'] : ['id', 'roomId', 'parentId', 'personId', 'personEmail', 'created', 'text'];
        const items = selected.map(row => Object.fromEntries(fields.filter(key => typeof row[key] === 'string')
            .map(key => [key, trim(row[key])] )));
        return { status: 'ok', items, scanned: scanned.length, max,
            hasMore: rows.length > max || !!response.headers?.get('Link'),
            truncated: rows.length > max || selected.some(row => fields.some(key => typeof row[key] === 'string' && (row[key] as string).length > 1000)),
            ...(args.action === 'search' || owner ? { scope: 'last messages only' } : {}),
        };
    } catch { return { status: 'error', reason: 'Webex request failed.' }; }
}
