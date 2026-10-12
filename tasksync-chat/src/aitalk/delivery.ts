import { AITalkStore } from './store';
import { setCommentaryAITalkMirror } from '../commentary/commentary';
let workspace: string | undefined;
export function configureAITalkDelivery(root: string): void {
    workspace = root;
    setCommentaryAITalkMirror((target, input) => {
        const talk = new AITalkStore(target);
        const state = talk.snapshot(true);
        const author = state.members.find(member => member.kind === (input.authorKind ?? 'agent'));
        if (!author) throw new Error('AITalk participant is not registered');
        if (input.authorKind !== 'validator') return talk.post(input.text, input.replyTo, author.id, input.details, input.kind);
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
        return talk.post(crisp, replyTo, author.id, details || input.details, input.kind);
    });
}
export interface AITalkCaller { recipient: string; workspace?: string }
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
        const result = await handler(args, { ...extra, _meta: undefined });
        const pending = appendAITalkDelivery('', caller);
        return pending ? { ...result, content: [...result.content, { type: 'text', text: pending }] } : result;
    };
}
export function beginAITalkTool(caller?: AITalkCaller): void {
    const root = caller?.workspace ?? workspace;
    if (!root) return;
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
