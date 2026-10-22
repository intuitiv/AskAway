import * as path from 'path';
import { assertApprovalRequest, assertHumanLabel, isOpaqueRef, requestApproval } from './provider';
import type { ApprovalRequest } from './provider';
import { draftFromApproval, prepareApproval, setDraftExecutor, withHumanLabel } from '../webexDrafts';
import type { WebexDraft } from '../webexDrafts';

/**
 * Outbound Webex actions for Cathy (spec 009 T045, R-CATHY-05): send, reply, edit message, delete message and upload.
 * Each one resolves names through the resolver, builds an `ApprovalRequest` (names only) and submits it through `requestApproval`;
 * the action runs only after the reviewer approves the AITalk card. Without a card sink the result is `unavailable` and nothing is
 * posted, unless the host passed an explicit `modalFallback` (R-TELE-43).
 */

// --- Types: the resolver contract (specs/009-webex-remote-channel/contracts/assistant-tools.md section 2), declared here until webexResolver.ts is imported. ---
export interface ResolverCandidate { ref: string; label: string; kind: string; detail?: string }
export type Resolved =
    | { status: 'ok'; ref: string; label: string; _internal: { id: string } }
    | { status: 'ambiguous'; candidates: ResolverCandidate[] }
    | { status: 'not_found'; query: string }
    | { status: 'stale_ref'; hint: string };
export interface ResolvedMessage {
    status?: 'ok';
    space: Resolved;
    thread?: Resolved;
    mine: boolean;
    /** The message itself (needed to edit, delete or reply under a thread root): its own Resolved, or its internal id and its thread root's. */
    message?: Resolved;
    messageId?: string;
    rootId?: string;
    /** Who wrote it and a short quote, so a card can name the message in words. */
    author?: string;
    snippet?: string;
}
export interface WebexResolver {
    space(name: string): Promise<Resolved>;
    person(nameOrEmail: string): Promise<Resolved>;
    message(ref: string): Promise<ResolvedMessage | Extract<Resolved, { status: 'stale_ref' }>>;
    latestFrom(person: string, space: string): Promise<Resolved>;
}

export interface WebexActionDeps {
    resolver: WebexResolver;
    request(method: string, endpoint: string, body?: unknown): Promise<{ ok: boolean; json(): Promise<any> }>;
    /** Uploads local files to a message target (multipart is the host's job). Without it `upload` is refused up front. */
    uploadFiles?(target: Record<string, string>, files: string[], text: string): Promise<{ id?: string }>;
    /** Only the host supplies this, only for when AITalk is unavailable. Absent means no modal and no send. */
    modalFallback?(req: ApprovalRequest): Promise<'approved' | 'rejected' | 'unavailable'>;
}

export type ActionResult = Record<string, unknown> & { status: string };
export interface WebexActions {
    send(args: { to: string; text: string; thread?: string; files?: string[] }): Promise<ActionResult>;
    reply(args: { to: string; text: string }): Promise<ActionResult>;
    editMessage(args: { ref: string; text: string }): Promise<ActionResult>;
    deleteMessage(args: { ref: string }): Promise<ActionResult>;
    upload(args: { to: string; files: string[]; text?: string; thread?: string }): Promise<ActionResult>;
    dispose(): void;
}

const PROVIDER = 'webex';
const human = (value?: string): string | undefined => { try { return value ? assertHumanLabel(value) : undefined; } catch { return undefined; } };
const quoted = (message: { author?: string; snippet?: string }): string | undefined => human(message.snippet ? `${message.author ? `${message.author}: ` : ''}${message.snippet}` : undefined);
const trimmed = (text: unknown): string => typeof text === 'string' ? text.trim() : '';
const passThrough = (resolved: Exclude<Resolved, { status: 'ok' }>): ActionResult => resolved.status === 'ambiguous'
    ? { status: 'ambiguous', candidates: resolved.candidates.slice(0, 10).map(({ ref, label, kind, detail }) => ({ ref, label, kind, ...(detail ? { detail } : {}) })) }
    : resolved.status === 'not_found' ? { status: 'not_found', query: resolved.query } : { status: 'stale_ref', hint: resolved.hint };
type Target = { resolved: Extract<Resolved, { status: 'ok' }>; kind: 'space' | 'person' };

export function createWebexActions(deps: WebexActionDeps): WebexActions {
    const { resolver } = deps;

    const execute = async (draft: Readonly<WebexDraft>): Promise<Record<string, unknown>> => {
        const i = draft.internal ?? {};
        const dest: Record<string, string> = i.roomId ? { roomId: i.roomId } : i.toPersonEmail ? { toPersonEmail: i.toPersonEmail } : i.toPersonId ? { toPersonId: i.toPersonId } : {};
        const call = async (method: string, endpoint: string, body?: unknown) => {
            const response = await deps.request(method, endpoint, body);
            if (!response.ok) { throw new Error('Request failed.'); }
            return response;
        };
        switch (draft.action) {
            case 'send': case 'reply': {
                const response = await call('POST', '/messages', { ...dest, text: draft.text, ...(i.parentId ? { parentId: i.parentId } : {}) });
                return { status: 'sent', id: String((await response.json() as any)?.id ?? '') };
            }
            case 'edit':
                await call('PUT', `/messages/${encodeURIComponent(i.messageId)}`, { roomId: i.roomId, text: draft.text });
                return { status: 'done' };
            case 'delete':
                await call('DELETE', `/messages/${encodeURIComponent(i.messageId)}`);
                return { status: 'done' };
            case 'upload': {
                if (!deps.uploadFiles) { throw new Error('Upload is not available.'); }
                const sent = await deps.uploadFiles({ ...dest, ...(i.parentId ? { parentId: i.parentId } : {}) }, JSON.parse(i.files ?? '[]'), draft.text);
                return { status: 'sent', id: String(sent?.id ?? '') };
            }
            default: throw new Error('Unknown action.');
        }
    };
    setDraftExecutor(PROVIDER, execute);

    /** The one path every outbound action takes: requestApproval, then (only after approval) the executor. */
    const submit = async (req: ApprovalRequest, internal: Record<string, string>): Promise<ActionResult> => {
        try { assertApprovalRequest(req); } catch (error) { return { status: 'invalid', reason: (error as Error).message }; }
        const queued = prepareApproval(req, internal);
        const decision = requestApproval(req);
        decision.catch(() => undefined);
        let first: { id: string } | { outcome: Awaited<typeof decision> };
        try { first = await Promise.race([queued.then(id => ({ id })), decision.then(outcome => ({ outcome }))]); } catch { return { status: 'error', reason: 'The approval card could not be posted.' }; }
        if ('id' in first) { return { status: 'pending', draftId: first.id, target: req.targetLabel, text: req.body }; }
        const draft = withHumanLabel(draftFromApproval(req, internal));
        if (first.outcome.status === 'rejected') { return { status: 'rejected' }; }
        let approved = first.outcome.status === 'approved';
        if (!approved) {
            if (!deps.modalFallback) { return { status: 'unavailable', reason: 'AITalk is not available, so nothing was sent.' }; }
            let answer: string;
            try { answer = await deps.modalFallback(req); } catch { answer = 'unavailable'; }
            if (answer === 'rejected') { return { status: 'rejected' }; }
            approved = answer === 'approved';
        }
        if (!approved) { return { status: 'unavailable', reason: 'AITalk is not available, so nothing was sent.' }; }
        try { return { ...(await execute(draft)) } as ActionResult; } catch { return { status: 'error', reason: 'Webex request failed.' }; }
    };

    /**
     * The one space or person the name means. Spaces and people are both looked up and an exact name match across both wins; if an exact
     * space AND an exact person match, or only partial matches exist, the candidates go back to the caller. The host never guesses who gets a message.
     */
    const target = async (to: string): Promise<Target | ActionResult> => {
        const asked = to.trim();
        // An email address names exactly one person.
        if (asked.includes('@')) { const byEmail = await resolver.person(asked); return byEmail.status === 'ok' ? { resolved: byEmail, kind: 'person' } : passThrough(byEmail); }
        const space = await resolver.space(asked);
        const person = await resolver.person(asked);
        const found = (resolved: Resolved, kind: 'space' | 'person'): Target | undefined => resolved.status === 'ok' ? { resolved, kind } : undefined;
        if (isOpaqueRef(asked)) { return found(space, 'space') ?? found(person, 'person') ?? passThrough(space as Exclude<Resolved, { status: 'ok' }>); }
        const same = (label: string) => label.trim().toLowerCase() === asked.toLowerCase();
        const exactCount = (resolved: Resolved) => resolved.status === 'ok' ? Number(same(resolved.label)) : resolved.status === 'ambiguous' ? resolved.candidates.filter(candidate => same(candidate.label)).length : 0;
        if (exactCount(space) + exactCount(person) === 1) {
            const chosen = exactCount(space) ? found(space, 'space') : found(person, 'person');
            if (chosen) { return chosen; }
        }
        const candidates = [space, person].flatMap((resolved, index): ResolverCandidate[] => resolved.status === 'ok' ? [{ ref: resolved.ref, label: resolved.label, kind: index ? 'person' : 'space' }]
            : resolved.status === 'ambiguous' ? resolved.candidates : []);
        if (candidates.length) { return passThrough({ status: 'ambiguous', candidates }); }
        return passThrough((space.status === 'ok' ? person : space) as Exclude<Resolved, { status: 'ok' }>);
    };
    const isTarget = (value: Target | ActionResult): value is Target => 'resolved' in value;
    const destination = (found: Target): Record<string, string> => found.kind === 'space' ? { roomId: found.resolved._internal.id }
        : found.resolved._internal.id.includes('@') ? { toPersonEmail: found.resolved._internal.id } : { toPersonId: found.resolved._internal.id };
    const named = (label: string, field: string): ActionResult | undefined => human(label) ? undefined : { status: 'unresolved', reason: `The ${field} name did not resolve to something the reviewer can read, so nothing was queued.` };
    const withDetails = (details: Record<string, string | undefined>) => {
        const clean = Object.fromEntries(Object.entries(details).filter(([, value]) => human(value)));
        return Object.keys(clean).length ? { details: clean as Record<string, string> } : {};
    };

    type Root = { space: Extract<Resolved, { status: 'ok' }>; parentId: string; label: string };
    /** The thread a message belongs to (or the message itself when it starts one). */
    const threadRoot = async (ref: string): Promise<Root | ActionResult> => {
        const message = await resolver.message(ref);
        if (message.status === 'stale_ref') { return passThrough(message); }
        if (message.space.status !== 'ok') { return passThrough(message.space); }
        const root = message.thread?.status === 'ok' ? message.thread : message.message?.status === 'ok' ? message.message : undefined;
        const parentId = root?._internal.id ?? message.rootId ?? message.messageId;
        if (!parentId) { return { status: 'error', reason: 'The thread could not be resolved.' }; }
        return { space: message.space, parentId, label: quoted(message) ?? root?.label ?? '' };
    };
    const isRoot = (value: Root | ActionResult): value is Root => 'parentId' in value;

    const send: WebexActions['send'] = async args => {
        const text = trimmed(args.text);
        if (!text) { return { status: 'invalid' }; }
        if (args.files?.length) { return upload({ to: args.to, files: args.files, text, thread: args.thread }); }
        const found = await target(args.to);
        if (!isTarget(found)) { return found; }
        const refused = named(found.resolved.label, 'target');
        if (refused) { return refused; }
        let parentId: string | undefined;
        let threadLabel: string | undefined;
        if (args.thread) {
            const root = await threadRoot(args.thread);
            if (!isRoot(root)) { return root; }
            if (found.kind === 'space' && root.space._internal.id !== found.resolved._internal.id) { return { status: 'invalid', reason: 'That thread is in a different space.' }; }
            parentId = root.parentId; threadLabel = root.label;
        }
        return submit({ provider: PROVIDER, action: 'send', targetLabel: found.resolved.label, body: text, ...withDetails({ Thread: threadLabel }) },
            { ...destination(found), ...(parentId ? { parentId } : {}) });
    };

    const reply: WebexActions['reply'] = async args => {
        const text = trimmed(args.text);
        if (!text) { return { status: 'invalid' }; }
        const latest = /^latest from (.+?) in (.+)$/i.exec(args.to.trim());
        let ref = args.to;
        if (latest) {
            const message = await resolver.latestFrom(latest[1], latest[2]);
            if (message.status !== 'ok') { return passThrough(message); }
            ref = message.ref;
        }
        const root = await threadRoot(ref);
        if (!isRoot(root)) { return root; }
        const refused = named(root.space.label, 'space');
        if (refused) { return refused; }
        return submit({ provider: PROVIDER, action: 'reply', targetLabel: root.space.label, body: text, ...withDetails({ Thread: root.label }) },
            { roomId: root.space._internal.id, parentId: root.parentId });
    };

    /** Edit and delete touch one existing message, and only the reviewer's own: others' messages are refused before any card. */
    const ownMessage = async (ref: string): Promise<{ space: Extract<Resolved, { status: 'ok' }>; message: Extract<Resolved, { status: 'ok' }> } | ActionResult> => {
        const found = await resolver.message(ref);
        if (found.status === 'stale_ref') { return passThrough(found); }
        if (found.space.status !== 'ok') { return passThrough(found.space); }
        if (!found.mine) { return { status: 'refused', reason: 'Only your own messages can be edited or deleted.' }; }
        const id = found.message?.status === 'ok' ? found.message._internal.id : found.messageId;
        if (!id) { return { status: 'error', reason: 'The message could not be resolved.' }; }
        return { space: found.space, message: { status: 'ok', ref, label: quoted(found) ?? (found.message?.status === 'ok' ? found.message.label : ''), _internal: { id } } };
    };
    const isOwn = (value: Awaited<ReturnType<typeof ownMessage>>): value is { space: Extract<Resolved, { status: 'ok' }>; message: Extract<Resolved, { status: 'ok' }> } => 'space' in value && 'message' in value;

    const editMessage: WebexActions['editMessage'] = async args => {
        const text = trimmed(args.text);
        if (!text) { return { status: 'invalid' }; }
        const own = await ownMessage(args.ref);
        if (!isOwn(own)) { return own; }
        const refused = named(own.space.label, 'space');
        if (refused) { return refused; }
        return submit({ provider: PROVIDER, action: 'edit', targetLabel: own.space.label, body: text, ...withDetails({ Message: own.message.label }) },
            { roomId: own.space._internal.id, messageId: own.message._internal.id });
    };

    const deleteMessage: WebexActions['deleteMessage'] = async args => {
        const own = await ownMessage(args.ref);
        if (!isOwn(own)) { return own; }
        const refused = named(own.space.label, 'space');
        if (refused) { return refused; }
        const shown = human(own.message.label);
        return submit({ provider: PROVIDER, action: 'delete', targetLabel: own.space.label, body: shown ? `Delete your message: ${shown}` : 'Delete your message.' },
            { roomId: own.space._internal.id, messageId: own.message._internal.id });
    };

    const upload: WebexActions['upload'] = async args => {
        if (!deps.uploadFiles) { return { status: 'unavailable', reason: 'Uploading files is not available.' }; }
        const files = (args.files ?? []).filter(file => typeof file === 'string' && file.trim());
        if (!files.length) { return { status: 'invalid' }; }
        const found = await target(args.to);
        if (!isTarget(found)) { return found; }
        const refused = named(found.resolved.label, 'target');
        if (refused) { return refused; }
        let parentId: string | undefined;
        let threadLabel: string | undefined;
        if (args.thread) {
            const root = await threadRoot(args.thread);
            if (!isRoot(root)) { return root; }
            if (found.kind === 'space' && root.space._internal.id !== found.resolved._internal.id) { return { status: 'invalid', reason: 'That thread is in a different space.' }; }
            parentId = root.parentId; threadLabel = root.label;
        }
        return submit({ provider: PROVIDER, action: 'upload', targetLabel: found.resolved.label, body: trimmed(args.text) || 'Sending the files listed below.',
            files: files.map(file => path.basename(file)), ...withDetails({ Thread: threadLabel }) },
            { ...destination(found), ...(parentId ? { parentId } : {}), files: JSON.stringify(files) });
    };

    return { send, reply, editMessage, deleteMessage, upload, dispose: () => setDraftExecutor(PROVIDER) };
}
