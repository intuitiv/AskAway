import { AITalkStore } from './store';
let workspace: string | undefined;
export function configureAITalkDelivery(root: string): void { workspace = root; }
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
