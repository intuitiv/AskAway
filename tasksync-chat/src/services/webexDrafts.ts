import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { assertHumanLabel } from './assistant/provider';
import type { ApprovalOutcome, ApprovalRequest } from './assistant/provider';

/**
 * A queued outbound action waiting for the reviewer's 👍. `recipientLabel` and `text` keep their old names because settled and
 * pending cards are stored with them; `provider`, `action`, `details`, `files` and `internal` come from an `ApprovalRequest`.
 * `internal`, `roomId` and `parentId` are ids the executor needs: they stay in this process and in a host-only file keyed by draft id,
 * never in the AITalk card (`humanDraft` strips them; `threaded` says a legacy draft is a thread reply).
 */
export interface WebexDraft {
    recipientLabel: string; text: string; roomId?: string; toPersonEmail?: string; parentId?: string; space?: string;
    provider?: string; action?: string; details?: Record<string, string>; files?: string[]; internal?: Record<string, string>;
    /** The space or person name did not resolve: the draft shows a placeholder and refuses to send until a name is supplied. */
    unresolved?: boolean;
    /** Human-safe stand-in for `parentId` on a stored card. */
    threaded?: boolean;
}
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
const pending = new Map<string, { draft: Readonly<WebexDraft>; send?: WebexSend; key?: string; waiter?: (outcome: ApprovalOutcome) => void }>();
/** Executors for drafts that carry a provider (restored after a reload too); legacy drafts without one use `sender`. */
const executors = new Map<string, WebexSend>();
export const UNRESOLVED_LABEL = 'a space';
const providerLabel = (draft: Readonly<WebexDraft>) => { const id = draft.provider ?? 'webex'; return id.charAt(0).toUpperCase() + id.slice(1); };
interface PrivateParts { internal?: Record<string, string>; roomId?: string; parentId?: string }
const privateOf = (draft: Readonly<WebexDraft>): PrivateParts => ({ ...(draft.internal ? { internal: draft.internal } : {}), ...(draft.roomId ? { roomId: draft.roomId } : {}), ...(draft.parentId ? { parentId: draft.parentId } : {}) });
/** The draft as a card may store it: names, text, details and file names only; no raw room, message or thread id and no file path. */
export function humanDraft(draft: Readonly<WebexDraft>): WebexDraft {
    const { internal: _internal, roomId: _roomId, parentId, ...rest } = draft;
    return parentId || draft.threaded ? { ...rest, threaded: true } : { ...rest };
}
/** Host-only side store keyed by draft id (a file beside the room log, never part of a room snapshot), so a reload can restore what the executor needs. */
const privateFile = (key?: string) => key ? path.join(key, '.askaway', 'aitalk', 'webex-draft-private.json') : undefined;
function readPrivate(key?: string): Record<string, PrivateParts> {
    const file = privateFile(key);
    try { return file ? JSON.parse(fs.readFileSync(file, 'utf8')) ?? {} : {}; } catch { return {}; }
}
function changePrivate(key: string | undefined, change: (all: Record<string, PrivateParts>) => void): void {
    const file = privateFile(key);
    if (!file) { return; }
    try {
        const all = readPrivate(key);
        change(all);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(all), { mode: 0o600 });
        fs.renameSync(`${file}.tmp`, file);
    } catch { /* A lost side file only means a card cannot be restored after a reload. */ }
}
const savePrivate = (key: string | undefined, id: string, draft: Readonly<WebexDraft>) => { const parts = privateOf(draft); if (Object.keys(parts).length) { changePrivate(key, all => { all[id] = parts; }); } };
const dropPrivate = (key: string | undefined, id: string) => { if (key && id in readPrivate(key)) { changePrivate(key, all => { delete all[id]; }); } };
const isHuman = (value?: string): value is string => { if (!value) { return false; } try { assertHumanLabel(value); return true; } catch { return false; } };
/** A label that looks like an id never reaches a card: it becomes a placeholder and the draft cannot be sent until the name resolves. */
export function withHumanLabel(draft: WebexDraft): WebexDraft {
    const label = [draft.recipientLabel, draft.space].find(isHuman);
    const { space: _space, ...rest } = draft;
    if (label) { return { ...rest, recipientLabel: label, ...(isHuman(draft.space) ? { space: draft.space } : {}) }; }
    return { ...rest, recipientLabel: UNRESOLVED_LABEL, space: UNRESOLVED_LABEL, unresolved: true };
}
/** The request the reviewer is asked to approve; legacy drafts are Webex sends. */
export function approvalRequestOf(draft: Readonly<WebexDraft>): ApprovalRequest {
    return { provider: draft.provider ?? 'webex', action: draft.action ?? 'send', targetLabel: draft.recipientLabel, body: draft.text,
        ...(draft.details ? { details: draft.details } : {}), ...(draft.files ? { files: draft.files } : {}) };
}
export function draftFromApproval(req: ApprovalRequest, internal?: Record<string, string>): WebexDraft {
    return { recipientLabel: req.targetLabel, space: req.targetLabel, text: req.body, provider: req.provider, action: req.action,
        ...(req.details ? { details: { ...req.details } } : {}), ...(req.files ? { files: [...req.files] } : {}), ...(internal ? { internal: { ...internal } } : {}) };
}
const sidecars = new WeakMap<ApprovalRequest, { internal?: Record<string, string>; queued: (id: string) => void }>();
/** Attaches the executor's private ids to a request (it has no id field) and returns the draft id once a card has queued it. */
export function prepareApproval(req: ApprovalRequest, internal?: Record<string, string>): Promise<string> {
    return new Promise(resolve => sidecars.set(req, { internal, queued: resolve }));
}
export function setDraftExecutor(provider: string, value?: WebexSend): void { if (value) { executors.set(provider, value); } else { executors.delete(provider); } }
const executorFor = (draft: Readonly<WebexDraft>): WebexSend | undefined => draft.provider ? executors.get(draft.provider) : sender;
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
    try { registrations.get(key ?? '')?.listener?.({ ...event, draft: humanDraft(event.draft) }); } catch { /* The outcome stands even if the card cannot update. */ }
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
    const id = registration ? await registration.hook(Object.freeze(humanDraft(withHumanLabel({ ...draft })))) : randomUUID();
    if (registration) { savePrivate(key, id, draft); }
    return { id, key };
}
/**
 * The generic approval handler's queue: a card for the request, in the calling worker's workspace. Resolves to undefined when no
 * card sink exists (fail closed: nothing is queued or sent). `outcome` settles when the reviewer decides; a draft restored after
 * a reload has no waiter, its card settles it.
 */
export async function queueApprovalDraft(req: ApprovalRequest): Promise<{ id: string; outcome: Promise<ApprovalOutcome> } | undefined> {
    const key = route();
    const registration = key === undefined ? undefined : registrations.get(key);
    if (!registration) { return undefined; }
    const sidecar = sidecars.get(req);
    const draft = Object.freeze(withHumanLabel(draftFromApproval(req, sidecar?.internal)));
    const id = await registration.hook(Object.freeze(humanDraft(draft)));
    if (!id || pending.has(id)) { throw new Error('Invalid draft id.'); }
    savePrivate(key, id, draft);
    let waiter!: (outcome: ApprovalOutcome) => void;
    const outcome = new Promise<ApprovalOutcome>(resolve => { waiter = resolve; });
    pending.set(id, { draft, key, waiter });
    sidecar?.queued(id);
    return { id, outcome };
}
export async function queueWebexDraft(draft: WebexDraft, send?: WebexSend): Promise<string> {
    const frozen = Object.freeze({ ...draft });
    const { id, key } = await post(frozen);
    if (!id || pending.has(id)) { throw new Error('Invalid draft id.'); }
    pending.set(id, { draft: Object.freeze(withHumanLabel({ ...frozen })), send, key });
    return id;
}
/** A draft persisted before a reload returns to the queue under its id; it still needs approval. `workspace` is the room that holds its card. */
export function restoreWebexDraft(id: string, draft: WebexDraft, workspace?: string): void {
    if (!id || pending.has(id)) { return; }
    const key = workspace === undefined ? undefined : keyOf(workspace);
    pending.set(id, { draft: Object.freeze({ ...draft, ...readPrivate(key)[id] }), key });
}
/** The reviewer's permission: sends the queued draft exactly once. */
export async function approveDraft(id: string): Promise<Record<string, unknown>> {
    const entry = pending.get(id);
    const send = entry?.send ?? (entry ? executorFor(entry.draft) : undefined);
    if (!entry || !send) { return { status: 'unavailable' }; }
    if (entry.draft.unresolved) { return { status: 'unresolved', reason: 'The space or person name is not resolved yet, so nothing was sent.' }; }
    pending.delete(id);
    dropPrivate(entry.key, id);
    let result: Record<string, unknown>;
    try { result = await send(entry.draft); } catch { result = { status: 'error', reason: `The ${providerLabel(entry.draft)} request failed.` }; }
    notify(entry.key, { id, draft: entry.draft, status: result.status === 'sent' || result.status === 'done' ? 'sent' : 'failed', result });
    entry.waiter?.({ status: 'approved', result });
    return result;
}
export function rejectDraft(id: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    pending.delete(id);
    dropPrivate(entry.key, id);
    notify(entry.key, { id, draft: entry.draft, status: 'rejected' });
    entry.waiter?.({ status: 'rejected' });
    return { status: 'rejected' };
}
/** An edit voids the old id (and any approval aimed at it) and queues the changed draft under a new one. */
function requeue(id: string, entry: NonNullable<ReturnType<typeof pending.get>>, draft: Readonly<WebexDraft>): Record<string, unknown> {
    pending.delete(id);
    const nextId = randomUUID();
    pending.set(nextId, { draft, send: entry.send, key: entry.key, waiter: entry.waiter });
    savePrivate(entry.key, nextId, draft);
    dropPrivate(entry.key, id);
    notify(entry.key, { id, draft, status: 'edited', nextId });
    return { status: 'pending', draftId: nextId, recipientLabel: draft.recipientLabel, text: draft.text };
}
export function editDraft(id: string, text: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    if (!text.trim() || entry.draft.action === 'delete') { return { status: 'invalid' }; }
    return requeue(id, entry, Object.freeze({ ...entry.draft, text }));
}
/** Supplies the name for a draft that showed a placeholder; the card asks again with the name. */
export function resolveDraftLabel(id: string, label: string): Record<string, unknown> {
    const entry = pending.get(id);
    if (!entry) { return { status: 'unavailable' }; }
    if (!isHuman(label)) { return { status: 'invalid' }; }
    const { unresolved: _unresolved, ...rest } = entry.draft;
    return requeue(id, entry, Object.freeze({ ...rest, recipientLabel: label, ...(rest.toPersonEmail ? {} : { space: label }) }));
}
