import { AsyncLocalStorage } from 'async_hooks';
import { AITalkStore } from './store';
import { roomFor } from './actors';
import { setCommentaryAITalkMirror } from '../commentary/commentary';
let workspace: string | undefined;
const mcpCaller = new AsyncLocalStorage<AITalkCaller>();
export function configureAITalkDelivery(root: string): void {
    workspace = root;
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
export interface AITalkCaller { recipient: string; workspace?: string }
/** The worker whose MCP tool call is running, if any. */
export function currentAITalkCaller(): AITalkCaller | undefined { return mcpCaller.getStore(); }
export function mcpAITalkCaller(extra: any): AITalkCaller | undefined {
    const meta = extra?._meta;
    const recipient = meta?.recipient ?? meta?.workerId ?? meta?.agentId;
    return typeof recipient === 'string' && recipient ? { recipient, workspace: meta.workspacePath } : undefined;
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
    if (!caller) roomFor(root).registerAgent();
    const store = new AITalkStore(root);
    const recipient = caller?.recipient ?? store.agentId();
    if (recipient) store.markRead(recipient);
}
export function appendAITalkDelivery(result: string, caller?: AITalkCaller): string {
    const root = caller?.workspace ?? workspace;
    if (!root) return result;
    const store = new AITalkStore(root);
    const recipient = caller?.recipient ?? store.agentId();
    if (!recipient) return result;
    const received = store.takeForTool(recipient);
    return received.length ? `${result}\n\nAITalk addressed messages (user instructions take priority):\n${JSON.stringify(received)}` : result;
}
