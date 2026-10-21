import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ToolDefinition } from '../workers/workerTools';
import type { WebexToolDeps } from './webexTools';
import { hasWebexDraftHook, queueWebexDraft, approveDraft, editDraft, setWebexDraftSender, WebexDraft } from './webexDrafts';

export interface WebexSuiteDeps extends WebexToolDeps {
    cacheDir: string;
    download(url: string): Promise<{ bytes: Buffer; name: string }>;
    extract?(file: string): Promise<string>;
}
const id = z.string().min(1).max(1000);
const since = z.string().datetime({ offset: true });
const clean = (value: unknown) => String(value ?? '').replace(/\b(?:Bearer\s+\S+|(?:access_token|refresh_token|client_secret)\s*[:=]\s*\S+)/gi, '[redacted]').slice(0, 1000);
export function webexSuiteTools(deps: WebexSuiteDeps): ToolDefinition[] {
    const get = async (endpoint: string): Promise<any> => {
        const response = await deps.request('GET', endpoint);
        if (!response.ok) { throw new Error('Request failed.'); }
        return response.json();
    };
    const post = async (draft: Readonly<WebexDraft>) => {
        const { roomId, toPersonEmail, parentId, text } = draft;
        const response = await deps.request('POST', '/messages', { ...(roomId ? { roomId } : { toPersonEmail }), text, ...(parentId ? { parentId } : {}) });
        if (!response.ok) { throw new Error('Request failed.'); }
        return { status: 'sent', id: clean((await response.json() as any).id) };
    };
    setWebexDraftSender(post);
    const send = async (args: any) => {
        if (Number(!!args.roomId) + Number(!!args.toPersonEmail) !== 1 || !args.text.trim()) { return { status: 'invalid' }; }
        // The reviewer sees the space by name; the id stays the fallback label.
        const space = args.roomId ? await get(`/rooms/${encodeURIComponent(args.roomId)}`).then(room => clean(room?.title), () => '') : '';
        const draft: WebexDraft = { recipientLabel: space || (args.roomId ?? args.toPersonEmail), text: args.text,
            ...(args.roomId ? { roomId: args.roomId } : { toPersonEmail: args.toPersonEmail }), ...(args.parentId ? { parentId: args.parentId } : {}), ...(space ? { space } : {}) };
        const draftId = await queueWebexDraft(draft, post);
        if (!hasWebexDraftHook() && await deps.approve(draft) === 'approved') { return approveDraft(draftId); }
        return { status: 'pending', draftId, recipientLabel: draft.recipientLabel, text: args.text };
    };
    const messages = async (args: any) => {
        if (Number(!!args.roomId) + Number(!!args.personEmail) !== 1) { return { status: 'invalid' }; }
        const params = new URLSearchParams({ max: String(args.max ?? 50) });
        params.set(args.roomId ? 'roomId' : 'personEmail', args.roomId ?? args.personEmail);
        if (args.parentId) { params.set('parentId', args.parentId); }
        const data = await get(`/messages?${params}`);
        const rows = (data.items ?? []).slice(0, args.max ?? 50).filter((row: any) =>
            (!args.since || Date.parse(row.created) > Date.parse(args.since)) &&
            (!args.fromEmail || row.personEmail?.toLowerCase() === args.fromEmail.toLowerCase()) &&
            (!args.parentId || row.parentId === args.parentId));
        return { status: 'ok', items: rows.map((row: any) => Object.fromEntries(
            ['id', 'roomId', 'parentId', 'personEmail', 'created', 'text'].filter(key => typeof row[key] === 'string').map(key => [key, clean(row[key])]))), hasMore: (data.items ?? []).length >= (args.max ?? 50) };
    };
    const definitions: ToolDefinition[] = [];
    const add = (name: string, inputSchema: z.ZodObject<any>, run: (args: any) => Promise<any>) => {
        definitions.push({ name, inputSchema, description: `Webex worker only: ${name}. No secrets. Sends remain pending until reviewer approval.`, run: async (input: any) => {
            const parsed = inputSchema.safeParse(input);
            if (!parsed.success) { return { status: 'invalid' }; }
            try { return await run(parsed.data); } catch { return { status: 'error', reason: 'Webex request failed.' }; }
        } });
    };
    add('webex_find_space', z.object({ name: id }).strict(), async args => {
        const data = await get('/rooms?sortBy=lastactivity&max=100');
        return { status: 'ok', items: (data.items ?? []).filter((row: any) => row.title?.toLowerCase().includes(args.name.toLowerCase())).slice(0, 50).map((row: any) => ({ id: clean(row.id), title: clean(row.title) })) };
    });
    add('webex_read', z.object({ roomId: id.optional(), personEmail: z.string().email().optional(), since: since.optional(), max: z.number().int().min(1).max(50).optional() }).strict(), messages);
    add('webex_thread', z.object({ roomId: id, parentId: id }).strict(), messages);
    add('webex_wait_reply', z.object({ roomId: id, parentId: id.optional(), fromEmail: z.string().email().optional(), since }).strict(), messages);
    add('webex_send', z.object({ roomId: id.optional(), toPersonEmail: z.string().email().optional(), text: id, parentId: id.optional() }).strict(), send);
    add('webex_edit_draft', z.object({ draftId: id, text: id }).strict(), async args => editDraft(args.draftId, args.text));
    add('webex_reply', z.object({ messageId: id, text: id }).strict(), async args => {
        const message = await get(`/messages/${encodeURIComponent(args.messageId)}`);
        return send({ roomId: message.roomId, parentId: message.parentId || args.messageId, text: args.text });
    });
    add('webex_attachments', z.object({ messageId: id }).strict(), async args => {
        const message = await get(`/messages/${encodeURIComponent(args.messageId)}`);
        await fs.mkdir(deps.cacheDir, { recursive: true });
        const items = [];
        for (const url of (message.files ?? []).slice(0, 10)) {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.hostname !== 'webexapis.com' || !parsed.pathname.startsWith('/v1/contents/')) { throw new Error('Unsafe content URL.'); }
            const file = await deps.download(url);
            const extension = path.extname(path.basename(file.name)).toLowerCase();
            const target = path.join(deps.cacheDir, `${randomUUID()}${extension}`);
            await fs.writeFile(target, file.bytes, { mode: 0o600 });
            let text: string | undefined;
            if (['.txt', '.md'].includes(extension)) { text = file.bytes.toString('utf8'); }
            else if (['.pdf', '.docx'].includes(extension) && deps.extract) { try { text = await deps.extract(target); } catch { /* Return the downloaded file for model analysis. */ } }
            items.push({ path: target, ...(text !== undefined ? { text: clean(text) } : { extraction: 'file fallback' }) });
        }
        return { status: 'ok', items };
    });
    add('webex_style_card', z.object({}).strict(), async () => {
        // A missing card is normal on a fresh workspace: the worker then writes plainly instead of failing.
        const card = await fs.readFile(path.join(deps.cacheDir, 'style-card.md'), 'utf8').catch(() => '');
        return card ? { status: 'ok', text: card.split('\n').slice(0, 40).join('\n') } : { status: 'ok', text: '', note: 'No style card yet; write short, plain replies.' };
    });
    return definitions;
}
