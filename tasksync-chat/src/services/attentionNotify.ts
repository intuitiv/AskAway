import * as vscode from 'vscode';

export interface AttentionItem {
    id: string;
    text: string;
    kind?: string;
    pending?: boolean;
    to?: string;
    mentions?: readonly string[];
}
export interface AttentionState { mode?: string; focused: boolean; visible: boolean }
export function needsAttention(item: AttentionItem, state: AttentionState): boolean {
    const trigger = item.kind === 'heads-up'
        || (item.kind === 'question' && item.pending === true && item.to === 'user')
        || item.mentions?.includes('user') === true
        || /(^|\s)@user\b/i.test(item.text);
    return !!item.id && !!item.text.trim() && trigger && state.mode === 'here' && (!state.focused || !state.visible);
}
export interface AttentionHost {
    state(): AttentionState;
    show(text: string, action: string): PromiseLike<string | undefined>;
    open(): PromiseLike<unknown>;
}
export function createAttentionNotifier(host: AttentionHost): (item: AttentionItem) => Promise<void> {
    const shown = new Set<string>();
    return async item => {
        if (shown.has(item.id) || !needsAttention(item, host.state())) return;
        shown.add(item.id);
        if (await host.show(item.text, 'Open AITalk') === 'Open AITalk') await host.open();
    };
}
let active: ((item: AttentionItem) => Promise<void>) | undefined;
export async function notifyAttention(item: AttentionItem): Promise<void> { await active?.(item); }
export function registerAttentionNotify(options: {
    availability(): { mode: string } | undefined;
    view(): vscode.WebviewView | undefined;
}): vscode.Disposable {
    const notify = createAttentionNotifier({
        state: () => ({ mode: options.availability()?.mode, focused: vscode.window.state.focused, visible: options.view()?.visible === true }),
        show: (text, action) => vscode.window.showInformationMessage(text, action),
        open: async () => {
            await vscode.commands.executeCommand('askAwayView.focus');
            const view = options.view();
            view?.show(true);
            await view?.webview.postMessage({ type: 'switchTab', tab: 'aitalk' });
        },
    });
    active = notify;
    return { dispose: () => { if (active === notify) active = undefined; } };
}
