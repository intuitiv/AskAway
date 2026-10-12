import { randomUUID } from 'crypto';

export interface WebexDraft { recipientLabel: string; text: string; roomId?: string; toPersonEmail?: string; parentId?: string }
let hook: ((draft: Readonly<WebexDraft>) => Promise<string>) | undefined;
const pending = new Map<string, () => Promise<Record<string, unknown>>>();
export function registerWebexDraftHook(value?: typeof hook): void { hook = value; }
export function hasWebexDraftHook(): boolean { return !!hook; }
export async function postDraftForApproval(draft: WebexDraft): Promise<string> {
    return hook ? hook(Object.freeze({ ...draft })) : randomUUID();
}
export async function queueWebexDraft(draft: WebexDraft, send: () => Promise<Record<string, unknown>>): Promise<string> {
    const id = await postDraftForApproval(draft);
    if (!id || pending.has(id)) { throw new Error('Invalid draft id.'); }
    pending.set(id, send);
    return id;
}
export async function approveDraft(id: string): Promise<Record<string, unknown>> {
    const send = pending.get(id);
    if (!send) { return { status: 'unavailable' }; }
    pending.delete(id);
    try { return await send(); } catch { return { status: 'error', reason: 'Webex request failed.' }; }
}
