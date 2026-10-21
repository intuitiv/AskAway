import { randomUUID } from 'crypto';
import * as path from 'path';

export interface WebexDraft { recipientLabel: string; text: string; roomId?: string; toPersonEmail?: string; parentId?: string; space?: string }
export type WebexSend = (draft: Readonly<WebexDraft>) => Promise<Record<string, unknown>>;
/** What happened to a queued draft. An edit voids the old id (and any approval aimed at it) and queues `nextId`. */
export interface WebexDraftEvent { id: string; draft: Readonly<WebexDraft>; status: 'sent' | 'failed' | 'rejected' | 'edited'; result?: Record<string, unknown>; nextId?: string }
type Hook = (draft: Readonly<WebexDraft>) => Promise<string>;
type Listener = (event: WebexDraftEvent) => void;
/** One draft card sink per workspace (its AITalk room), keyed by the resolved workspace path; '' is a hook registered without a workspace. */
const registrations = new Map<string, { hook: Hook; listener?: Listener }>();
/** The server owner's registration: where a draft goes when its caller's workspace is unknown. */
let fallback: string | undefined;
let callerWorkspace: (() => string | undefined) | undefined;
let connector: ((workspace: string) => void) | undefined;
let sender: WebexSend | undefined;
/** `key` is the registration that holds the card: approvals and outcomes go back to it. */
const pending = new Map<string, { draft: Readonly<WebexDraft>; send?: WebexSend; key?: string }>();
const keyOf = (workspace?: string) => workspace ? path.resolve(workspace) : '';
/** With no hook and no workspace it unregisters everything; with a workspace only that workspace's hook. `primary` hooks are the fallback (the last one wins). */
export function registerWebexDraftHook(value?: Hook, onOutcome?: Listener, workspace?: string, primary = true): void {
    if (!value) {
        if (workspace === undefined) { registrations.clear(); fallback = undefined; return; }
        const key = keyOf(workspace);
        registrations.delete(key);
        if (fallback === key) { fallback = undefined; }
        return;
    }
    const key = keyOf(workspace);
    registrations.set(key, { hook: value, listener: onOutcome });
    if (primary) { fallback = key; }
}
export function hasWebexDraftHook(): boolean { return registrations.size > 0; }
/** Tells the queue who is calling (the workspace of the worker whose MCP call is running) and how to open a room for a workspace that has no hook yet. */
export function setWebexDraftRouting(resolveCaller?: () => string | undefined, connect?: (workspace: string) => void): void { callerWorkspace = resolveCaller; connector = connect; }
/** The transport for drafts restored after a reload; set by the Webex suite host. */
export function setWebexDraftSender(value?: WebexSend): void { sender = value; }
const notify = (key: string | undefined, event: WebexDraftEvent) => {
    try { registrations.get(key ?? '')?.listener?.(event); } catch { /* The outcome stands even if the card cannot update. */ }
};
/** The caller's own workspace wins; an unknown caller (or a workspace without a room) uses the server owner's. */
function route(workspace = callerWorkspace?.()): string | undefined {
    const key = workspace ? keyOf(workspace) : undefined;
    if (key && !registrations.has(key)) { try { connector?.(key); } catch { /* Fall back to the owner's room. */ } }
    return key && registrations.has(key) ? key : fallback !== undefined && registrations.has(fallback) ? fallback : undefined;
}
export async function postDraftForApproval(draft: WebexDraft): Promise<string> {
    return (await post(draft)).id;
}
async function post(draft: WebexDraft): Promise<{ id: string; key?: string }> {
    const key = route();
    const registration = key === undefined ? undefined : registrations.get(key);
    return { id: registration ? await registration.hook(Object.freeze({ ...draft })) : randomUUID(), key };
}
export async function queueWebexDraft(draft: WebexDraft, send?: WebexSend): Promise<string> {
    const frozen = Object.freeze({ ...draft });
    const { id, key } = await post(frozen);
    if (!id || pending.has(id)) { throw new Error('Invalid draft id.'); }
    pending.set(id, { draft: frozen, send, key });
    return id;
}
/** A draft persisted before a reload returns to the queue under its id; it still needs approval. `workspace` is the room that holds its card. */
export function restoreWebexDraft(id: string, draft: WebexDraft, workspace?: string): void {
    if (id && !pending.has(id)) { pending.set(id, { draft: Object.freeze({ ...draft }), key: workspace === undefined ? undefined : keyOf(workspace) }); }
}
/** The reviewer's permission: sends the queued draft exactly once. */
export async function approveDraft(id: string): Promise<Record<string, unknown>> {
    const entry = pending.get(id);
    const send = entry?.send ?? sender;
    if (!entry || !send) { return { status: 'unavailable' }; }
    pending.delete(id);
    let result: Record<string, unknown>;
    try { result = await send(entry.draft); } catch { result = { status: 'error', reason: 'Webex request failed.' }; }
    notify(entry.key, { id, draft: entry.draft, status: result.status === 'sent' ? 'sent' : 'failed', result });
    return result;
}
export function rejectDraft(id: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    pending.delete(id);
    notify(entry.key, { id, draft: entry.draft, status: 'rejected' });
    return { status: 'rejected' };
}
export function editDraft(id: string, text: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    if (!text.trim()) { return { status: 'invalid' }; }
    pending.delete(id);
    const draft = Object.freeze({ ...entry.draft, text });
    const nextId = randomUUID();
    pending.set(nextId, { draft, send: entry.send, key: entry.key });
    notify(entry.key, { id, draft, status: 'edited', nextId });
    return { status: 'pending', draftId: nextId, recipientLabel: draft.recipientLabel, text };
}
