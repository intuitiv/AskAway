import { AsyncLocalStorage } from 'async_hooks';
import { AITalkStore } from './store';
import { roomFor } from './actors';
import { setCommentaryAITalkMirror, setCommentaryAITalkWait } from '../commentary/commentary';
let workspace: string | undefined;
const mcpCaller = new AsyncLocalStorage<AITalkCaller>();
export function configureAITalkDelivery(root: string): void {
    workspace = root;
    configureAITalkReplyWait();
    setCommentaryAITalkMirror((target, input) => {
        const room = roomFor(target);
        const state = room.store.snapshot(true);
        const caller = mcpCaller.getStore();
        const kind = input.authorKind ?? 'agent';
        // A worker posts as itself over MCP; it joins AITalk with its first message.
        if (kind === 'agent' && caller && !state.members.some(member => member.id === caller.recipient && member.kind !== 'worker')) {
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
        const replyTo = state.messages.some(message => message.id === questionId) ? questionId : undefined;
        return room.post(author.id, crisp, { replyTo, details: details || input.details, kind: input.kind }).message;
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
export interface AITalkCaller { recipient: string; workspace?: string; displayName?: string }
/** Maps an OpenCode session id to the AskAway worker running in it; set by the host that owns the worker runtime. */
export type AITalkSessionResolver = (sessionId: string) => { workerId: string; workspace?: string; displayName?: string } | undefined;
let sessionResolver: AITalkSessionResolver | undefined;
export function setAITalkSessionResolver(resolver: AITalkSessionResolver | undefined): void { sessionResolver = resolver; }
/** The worker whose MCP tool call is running, if any. */
export function currentAITalkCaller(): AITalkCaller | undefined { return mcpCaller.getStore(); }
/**
 * The call's identity metadata. The transport `_meta` is the host's word and is trusted; the model controls the arguments, so from
 * them only the OpenCode session id is taken (the plugin overwrites `args._meta` with it). A recipient or workspace in the arguments is never read.
 */
export function callMeta(args: any, extra: any): any {
    const session = args?._meta?.openCodeSessionId;
    return typeof session === 'string' && session ? { ...extra?._meta, openCodeSessionId: session } : extra?._meta;
}
export function mcpAITalkCaller(extra: any): AITalkCaller | undefined {
    const meta = extra?._meta;
    // OpenCode workers send no worker id; the AskAway plugin adds the session id and the runtime knows who runs in it.
    // A session id always goes through the resolver: it never falls back to a recipient.
    const session = meta?.openCodeSessionId;
    if (session !== undefined) return resolveSession(session);
    const recipient = meta?.recipient ?? meta?.workerId ?? meta?.agentId;
    return typeof recipient === 'string' && recipient ? { recipient, workspace: meta.workspacePath, displayName: meta.memberId || meta.profile || meta.displayName } : undefined;
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
        const caller = mcpAITalkCaller(extra);
        if (!caller) return handler(args, extra);
        caller.workspace ??= defaultWorkspace;
        beginAITalkTool(caller);
        const result = await mcpCaller.run(caller, () => handler(args, { ...extra, _meta: undefined }));
        const pending = appendAITalkDelivery('', caller);
        return pending ? { ...result, content: [...result.content, { type: 'text', text: pending }] } : result;
    };
}
/** A main-agent tool call (no caller) means its turn is running: the Agent registers itself. */
export function beginAITalkTool(caller?: AITalkCaller): void {
    const root = caller?.workspace ?? workspace;
    if (!root) return;
    if (caller?.displayName) roomFor(root).workerLifecycle({ id: caller.recipient, displayName: caller.displayName }, true);
    if (!caller || caller.recipient === new AITalkStore(root).agentId()) roomFor(root).registerAgent();
}
export const AITALK_QUEUE_LABEL = 'ADDITIONAL MESSAGES FROM THE USER. These are NOT part of the tool result above; the user sent them while you were working. They take priority: answer each one by calling the AITalk reply tool (commentary action aitalk) with replyTo set to the message id.';
/** Pops every queued message for the recipient and appends them, clearly apart from the tool result. */
export function appendAITalkDelivery(result: string, caller?: AITalkCaller): string {
    const root = caller?.workspace ?? workspace;
    if (!root) return result;
    const store = new AITalkStore(root);
    const recipient = caller?.recipient ?? store.agentId();
    if (!recipient) return result;
    const received = store.takeForTool(recipient);
    return received.length ? `${result}\n\n${AITALK_QUEUE_LABEL}\n${JSON.stringify(received)}` : result;
}

