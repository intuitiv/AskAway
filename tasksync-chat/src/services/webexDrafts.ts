import { randomUUID } from 'crypto';

export interface WebexDraft { recipientLabel: string; text: string; roomId?: string; toPersonEmail?: string; parentId?: string; space?: string }
export type WebexSend = (draft: Readonly<WebexDraft>) => Promise<Record<string, unknown>>;
/** What happened to a queued draft. An edit voids the old id (and any approval aimed at it) and queues `nextId`. */
export interface WebexDraftEvent { id: string; draft: Readonly<WebexDraft>; status: 'sent' | 'failed' | 'rejected' | 'edited'; result?: Record<string, unknown>; nextId?: string }
let hook: ((draft: Readonly<WebexDraft>) => Promise<string>) | undefined;
let listener: ((event: WebexDraftEvent) => void) | undefined;
let sender: WebexSend | undefined;
const pending = new Map<string, { draft: Readonly<WebexDraft>; send?: WebexSend }>();
export function registerWebexDraftHook(value?: typeof hook, onOutcome?: typeof listener): void { hook = value; listener = onOutcome; }
export function hasWebexDraftHook(): boolean { return !!hook; }
/** The transport for drafts restored after a reload; set by the Webex suite host. */
export function setWebexDraftSender(value?: WebexSend): void { sender = value; }
const notify = (event: WebexDraftEvent) => { try { listener?.(event); } catch { /* The outcome stands even if the card cannot update. */ } };
export async function postDraftForApproval(draft: WebexDraft): Promise<string> {
    return hook ? hook(Object.freeze({ ...draft })) : randomUUID();
}
export async function queueWebexDraft(draft: WebexDraft, send?: WebexSend): Promise<string> {
    const frozen = Object.freeze({ ...draft });
    const id = await postDraftForApproval(frozen);
    if (!id || pending.has(id)) { throw new Error('Invalid draft id.'); }
    pending.set(id, { draft: frozen, send });
    return id;
}
/** A draft persisted before a reload returns to the queue under its id; it still needs approval. */
export function restoreWebexDraft(id: string, draft: WebexDraft): void {
    if (id && !pending.has(id)) { pending.set(id, { draft: Object.freeze({ ...draft }) }); }
}
/** The reviewer's permission: sends the queued draft exactly once. */
export async function approveDraft(id: string): Promise<Record<string, unknown>> {
    const entry = pending.get(id);
    const send = entry?.send ?? sender;
    if (!entry || !send) { return { status: 'unavailable' }; }
    pending.delete(id);
    let result: Record<string, unknown>;
    try { result = await send(entry.draft); } catch { result = { status: 'error', reason: 'Webex request failed.' }; }
    notify({ id, draft: entry.draft, status: result.status === 'sent' ? 'sent' : 'failed', result });
    return result;
}
export function rejectDraft(id: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    pending.delete(id);
    notify({ id, draft: entry.draft, status: 'rejected' });
    return { status: 'rejected' };
}
export function editDraft(id: string, text: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    if (!text.trim()) { return { status: 'invalid' }; }
    pending.delete(id);
    const draft = Object.freeze({ ...entry.draft, text });
    const nextId = randomUUID();
    pending.set(nextId, { draft, send: entry.send });
    notify({ id, draft, status: 'edited', nextId });
    return { status: 'pending', draftId: nextId, recipientLabel: draft.recipientLabel, text };
}
