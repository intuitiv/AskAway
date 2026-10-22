import { AsyncLocalStorage } from 'async_hooks';
import { AITalkStore } from './store';
import { roomFor } from './actors';
import { validatorContextLine, withValidatorContext } from './validatorContext';
import { setCommentaryAITalkMirror, setCommentaryAITalkWait } from '../commentary/commentary';
let workspace: string | undefined;
const mcpCaller = new AsyncLocalStorage<AITalkCaller>();
export function configureAITalkDelivery(root: string): void {
    workspace = root;
    configureAITalkReplyWait();
    setCommentaryAITalkMirror((target, input) => {
        const caller = mcpCaller.getStore();
        // A call that carried a worker identity the host could not resolve is nobody: it never posts, least of all as the main agent.
        if (caller?.unidentified) return { status: 'REJECTED', reason: 'This call could not be tied to a known worker, so it cannot post to AITalk. Report in your final worker report instead.' };
        const room = roomFor(target);
        const state = room.store.snapshot(true);
        const kind = input.authorKind ?? 'agent';
        // A worker posts as itself over MCP; it joins AITalk with its first message.
        if (kind === 'agent' && caller && !state.members.some(member => member.id === caller.recipient && member.kind !== 'worker')) {
            // Reviewer 2026-10-22 (R-AITALK-45): members post only questions; the main agent posts progress.
            if (input.kind !== 'heads-up' && !(input.replyTo && input.kind !== 'update')) return { status: 'REJECTED', reason: 'Workers post only questions on AITalk (or a direct reply to one), not progress updates. Post a question with kind heads-up (tag the main agent, the Validator, or ask in general), and report progress in your final worker report.' };
            return room.workerPost(caller.recipient, input.text, { replyTo: input.replyTo, details: input.details, kind: input.kind }).message;
        }
        const author = state.members.find(member => member.kind === kind);
        if (!author) throw new Error('AITalk participant is not registered');
        // The main agent's commentary call is a tool call of its running turn: it registers like beginAITalkTool.
        if (kind === 'agent' && (!caller || caller.recipient === author.id)) room.registerAgent();
        // An unregistered actor cannot post; the commentary feed itself carries on.
        if (!room.isRegistered(author.id)) return { status: 'REJECTED', reason: `${author.displayName} is not registered in AITalk` };
        if (kind !== 'validator') return room.post(author.id, input.text, { replyTo: input.replyTo, details: input.details, kind: input.kind }).message;
        const detail = input.detail ?? {};
        const crisp = detail.error ? `Could not check this: ${String(detail.error).slice(0, 240)}`
            : typeof detail.answer === 'string' && detail.answer.trim() ? detail.answer
                : typeof detail.summary === 'string' && detail.summary.trim() ? detail.summary : input.text;
        const details = [
            Array.isArray(detail.sources) && detail.sources.length ? `Sources: ${detail.sources.join(', ')}` : '',
            typeof detail.observations === 'string' && detail.observations ? `Observations: ${detail.observations}` : '',
            typeof detail.impact === 'string' && detail.impact ? `Impact: ${detail.impact}` : '',
        ].filter(Boolean).join('\n');
        const questionId = input.replyTo ?? (typeof detail.observedId === 'string' ? detail.observedId : undefined);
        const parent = state.messages.find(message => message.id === questionId);
        const replyTo = parent?.id;
        const person = (id: string | undefined) => state.members.find(member => member.id === id);
        const agent = state.members.find(member => member.kind === 'agent');
        const line = detail.turnEnd === true ? validatorContextLine({ authorName: agent?.displayName ?? '' }, 'turnEnd')
            : parent ? validatorContextLine({ authorName: person(parent.author)?.displayName ?? '', authorKind: person(parent.author)?.kind, text: parent.text, kind: parent.kind }, 'message')
                : validatorContextLine(undefined, 'observation');
        return room.post(author.id, withValidatorContext(line, crisp), { replyTo, details: details || input.details, kind: input.kind }).message;
    });
}
/** The asker waits briefly for a reply; a reply that arrives in time is handed over now, otherwise it comes with the next tool call. */
export function configureAITalkReplyWait(): void {
    setCommentaryAITalkWait(async (target, posted, seconds) => {
        const room = roomFor(target);
        const reply = await room.awaitReply(posted.id, seconds * 1000);
        if (!reply) return { pending: true, note: 'No reply yet. Carry on with your work; a reply is delivered with your next tool call.' };
        const recipient = mcpCaller.getStore()?.recipient ?? room.store.agentId();
        if (recipient) room.store.track('delivered', recipient, [reply.id]);
        const inReplyTo = room.store.inReplyTo(room.store.snapshot(true), posted.id);
        return { reply: { id: reply.id, author: reply.author, from: room.store.nameOf(room.store.snapshot(true).members, reply.author), text: reply.text, ...(inReplyTo ? { inReplyTo } : {}) } };
    });
}
export interface AITalkCaller { recipient: string; workspace?: string; displayName?: string;
    /** The call carried a transport identity (agy conversation, Claude run token) that no worker owns: it is not the main agent and posts and receives nothing. */
    unidentified?: true }
/** Maps an OpenCode session id to the AskAway worker running in it; set by the host that owns the worker runtime. */
export type AITalkSessionResolver = (sessionId: string) => { workerId: string; workspace?: string; displayName?: string } | undefined;
let sessionResolver: AITalkSessionResolver | undefined;
export function setAITalkSessionResolver(resolver: AITalkSessionResolver | undefined): void { sessionResolver = resolver; }
/** Maps a transport carrier to its worker: an agy conversation id (MCP `_meta`) or a Claude run token (`X-AskAway-Run` header). */
export type AITalkCarrierResolver = (carrier: string) => { workerId: string; workspace?: string; displayName?: string } | undefined;
let agyResolver: AITalkCarrierResolver | undefined;
let runTokenResolver: AITalkCarrierResolver | undefined;
export function setAITalkAgyResolver(resolver: AITalkCarrierResolver | undefined): void { agyResolver = resolver; }
export function setAITalkRunTokenResolver(resolver: AITalkCarrierResolver | undefined): void { runTokenResolver = resolver; }
const AGY_CONVERSATION_KEY = 'antigravity.google/conversation_id';
const RUN_HEADER = 'x-askaway-run';
const UNIDENTIFIED: AITalkCaller = Object.freeze({ recipient: 'unidentified', unidentified: true });
/** The worker whose MCP tool call is running, if any. */
export function currentAITalkCaller(): AITalkCaller | undefined { return mcpCaller.getStore(); }
/**
 * The call's identity metadata. The transport `_meta` is the host's word and is trusted; the model controls the arguments, so from
 * them only the OpenCode session id is taken (the plugin overwrites `args._meta` with it). A recipient or workspace in the arguments is never read.
 */
export function callMeta(args: any, extra: any): any {
    // The internal carrier keys are ours to set, never the transport's or the model's.
    const { agyConversationId: _agy, askawayRunToken: _token, ...transport } = extra?._meta ?? {};
    const carriers: Record<string, string> = {};
    const agy = extra?._meta?.[AGY_CONVERSATION_KEY];
    if (agy !== undefined) carriers.agyConversationId = typeof agy === 'string' ? agy : '';
    const header = extra?.requestInfo?.headers?.[RUN_HEADER];
    if (header !== undefined) carriers.askawayRunToken = typeof header === 'string' ? header : Array.isArray(header) && typeof header[0] === 'string' ? header[0] : '';
    // A transport identity outranks the arguments: a model on such a worker can never pose as an OpenCode session.
    const session = args?._meta?.openCodeSessionId;
    const fromArgs = !Object.keys(carriers).length && typeof session === 'string' && session ? { openCodeSessionId: session } : {};
    return extra?._meta === undefined && !Object.keys(carriers).length && !Object.keys(fromArgs).length ? undefined : { ...transport, ...carriers, ...fromArgs };
}
export function mcpAITalkCaller(extra: any): AITalkCaller | undefined {
    const meta = extra?._meta;
    // agy and Claude workers carry the host's transport identity: a carrier that resolves to no worker is an unidentified caller, never the main agent.
    if (meta?.agyConversationId !== undefined || meta?.askawayRunToken !== undefined) return resolveCarriers(meta.agyConversationId, meta.askawayRunToken);
    // OpenCode workers send no worker id; the AskAway plugin adds the session id and the runtime knows who runs in it.
    // A session id always goes through the resolver: it never falls back to a recipient.
    const session = meta?.openCodeSessionId;
    if (session !== undefined) return resolveSession(session);
    const recipient = meta?.recipient ?? meta?.workerId ?? meta?.agentId;
    return typeof recipient === 'string' && recipient ? { recipient, workspace: meta.workspacePath, displayName: meta.memberId || meta.profile || meta.displayName } : undefined;
}
function resolveCarriers(conversation: unknown, token: unknown): AITalkCaller {
    const lookup = (resolver: AITalkCarrierResolver | undefined, value: unknown) => {
        if (typeof value !== 'string' || !value || !resolver) return undefined;
        try { return resolver(value); } catch { return undefined; }
    };
    const wanted: Array<[AITalkCarrierResolver | undefined, unknown]> = [];
    if (conversation !== undefined) wanted.push([agyResolver, conversation]);
    if (token !== undefined) wanted.push([runTokenResolver, token]);
    const found = wanted.map(([resolver, value]) => lookup(resolver, value));
    const first = found[0];
    // Two carriers that name different workers contradict each other: refuse rather than pick one.
    if (!first || found.some(worker => worker?.workerId !== first.workerId)) return UNIDENTIFIED;
    return { recipient: first.workerId, workspace: first.workspace, displayName: first.displayName };
}
function resolveSession(session: unknown): AITalkCaller | undefined {
    if (typeof session !== 'string' || !session || !sessionResolver) return undefined;
    try {
        const worker = sessionResolver(session);
        return worker ? { recipient: worker.workerId, workspace: worker.workspace, displayName: worker.displayName } : undefined;
    } catch { return undefined; }
}
export function withAITalkMcpDelivery(handler: (args: any, extra: any) => Promise<any>, defaultWorkspace: string) {
    return async (args: any, extra: any) => {
        let caller = mcpAITalkCaller(extra);
        // An agy worker's first tool call can arrive just before the runtime has parsed its init line: look once more.
        if (caller?.unidentified) { await new Promise(resolve => setTimeout(resolve, 400)); caller = mcpAITalkCaller(extra); }
        if (!caller) return handler(args, extra);
        // The identity was consumed here: the handler gets neither the transport `_meta` nor the request headers.
        const inner = { ...extra, _meta: undefined, requestInfo: undefined };
        if (caller.unidentified) return mcpCaller.run(caller, () => handler(args, inner));
        caller.workspace ??= defaultWorkspace;
        beginAITalkTool(caller);
        const result = await mcpCaller.run(caller, () => handler(args, inner));
        const pending = appendAITalkDelivery('', caller);
        return pending ? { ...result, content: [...result.content, { type: 'text', text: pending }] } : result;
    };
}
/** A main-agent tool call (no caller) means its turn is running: the Agent registers itself. */
export function beginAITalkTool(caller?: AITalkCaller): void {
    if (caller?.unidentified) return;
    const root = caller?.workspace ?? workspace;
    if (!root) return;
    if (caller?.displayName) roomFor(root).workerLifecycle({ id: caller.recipient, displayName: caller.displayName }, true);
    if (!caller || caller.recipient === new AITalkStore(root).agentId()) roomFor(root).registerAgent();
}
export const AITALK_QUEUE_LABEL = 'ADDITIONAL MESSAGES FROM THE USER. These are NOT part of the tool result above; the user sent them while you were working. They take priority: answer each one by calling the aitalk tool (action say) with replyTo set to the message id.';
/** Pops every queued message for the recipient and appends them, clearly apart from the tool result. */
export function appendAITalkDelivery(result: string, caller?: AITalkCaller): string {
    if (caller?.unidentified) return result;
    const root = caller?.workspace ?? workspace;
    if (!root) return result;
    const store = new AITalkStore(root);
    const recipient = caller?.recipient ?? store.agentId();
    if (!recipient) return result;
    const received = store.takeForTool(recipient);
    return received.length ? `${result}\n\n${AITALK_QUEUE_LABEL}\n${JSON.stringify(received)}` : result;
}
