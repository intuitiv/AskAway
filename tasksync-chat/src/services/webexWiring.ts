import * as vscode from 'vscode';
import * as path from 'path';
import { CONFIG_NAMESPACE } from '../constants/branding';
import { registerWebexAuthCommands, WebexAuth } from './webexAuth';
import { WebexStatus } from './webexStatus';
import type { WebexService } from './webexService';
import type { CommentaryStore } from '../commentary/commentary';
import type { TelegramLiveCommentary } from '../commentary/telegramLive';
import type { AskAwayWebviewProvider } from '../webview/webviewProvider';

export function publishWebex(provider: Pick<AskAwayWebviewProvider, 'getWebexService' | 'setWebexService'>,
    handleReply: (taskId: string, text: string, user: string) => void): void {
    const service = provider.getWebexService();
    if (!service) { return; }
    const { isTelegramHandoffTaskId, submitTelegramConversationReply } = require('./telegramConversationReply') as typeof import('./telegramConversationReply');
    provider.setWebexService(service);
    service.onReply(async (taskId: string, text: string, user: string) => {
        if (isTelegramHandoffTaskId(taskId)) { await submitTelegramConversationReply(text); }
        else { handleReply(taskId, text, user); }
    });
}

export function wireWebex(context: vscode.ExtensionContext,
    provider: Pick<AskAwayWebviewProvider, 'getWebexService' | 'setWebexService' | 'getTurnActivity'>,
    outputChannel: vscode.OutputChannel | undefined, commentary: CommentaryStore,
    handleReply: (taskId: string, text: string, user: string) => void,
    logRuntime: (message: string, data?: any) => void,
    formatError: (error: unknown) => any) {
    const auth = new WebexAuth(context.secrets);
    const publish = () => publishWebex(provider, handleReply);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const status = root ? new WebexStatus(root, auth, outputChannel,
        () => provider.getWebexService()?.getTokenStatus() ?? { hasToken: false }) : undefined;
    registerWebexAuthCommands(context, async () => {
        await status?.record('sign-in');
        await provider.getWebexService()?.reloadConfig();
        await vscode.commands.executeCommand('askaway.webexDiscover');
        await provider.getWebexService()?.reloadConfig();
        publish();
    }, auth);
    context.subscriptions.push(vscode.commands.registerCommand('askaway.webexDiscover', async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { await vscode.window.showWarningMessage('AskAway: Open a workspace to discover Webex spaces.'); return; }
        const { setupWebex } = await import('./webexSpaces');
        const { WebexIncomingWebhook } = await import('./webexIncomingWebhook');
        await setupWebex(auth, { fsPath: folder.uri.fsPath, name: folder.name }, {
            status,
            onFailure: code => provider.getWebexService()?.setSetupFailure(code),
            onResolved: () => new WebexIncomingWebhook(context.secrets, undefined, undefined, undefined, status).prompt(folder.uri.fsPath, context.workspaceState),
            refresh: () => provider.getWebexService()?.refreshAccessToken() ?? Promise.resolve(undefined)
        });
        const service = provider.getWebexService();
        if (service) { await service.reloadConfig(); publish(); }
    }));
    return async function initialize(): Promise<{ service?: WebexService; relay?: TelegramLiveCommentary }> {
        let service: WebexService | undefined;
        let relay: TelegramLiveCommentary | undefined;
        try {
            const module = await import('./webexService');
            await status?.record('activation');
            const { WebexService } = module;
            logRuntime('Webex module loaded', { moduleKeys: Object.keys(module), ctorType: typeof WebexService });
            if (typeof WebexService !== 'function') { throw new Error('WebexService import is not a constructor function'); }
            const { WebexIncomingWebhook } = await import('./webexIncomingWebhook');
            const incoming = new WebexIncomingWebhook(context.secrets, undefined, undefined, undefined, status);
            context.subscriptions.push(vscode.commands.registerCommand('askaway.configureWebexNotifications', async () => {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (folder) { await incoming.configure(folder.uri.fsPath); }
            }));
            service = new WebexService(outputChannel, auth, undefined, {}, incoming);
            await service.reloadConfig();
            provider.setWebexService(service);
            publish();
            const { ensureWebexWorkspace } = await import('./webexSpaces');
            const ensureWorkspace = async () => {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (folder) { await ensureWebexWorkspace(auth, { fsPath: folder.uri.fsPath, name: folder.name }, {
                    status,
                    onFailure: code => { service?.setSetupFailure(code); provider.setWebexService(service); },
                    onResolved: () => incoming.prompt(folder.uri.fsPath, context.workspaceState)
                }); }
            };
            await ensureWorkspace();
            await service.reloadConfig();
            publish();
            service.start();
            const liveRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (liveRoot) {
                const { TelegramLiveCommentary, relayCommentaryToTelegram, webexLivePoster } = await import('../commentary/telegramLive');
                const poster = webexLivePoster(service, path.basename(liveRoot));
                relay = new TelegramLiveCommentary(() => poster, path.basename(liveRoot), { activity: () => provider.getTurnActivity() });
                context.subscriptions.push(relayCommentaryToTelegram(relay, commentary, liveRoot, () => service?.resolveHandoffs()));
            }
            context.subscriptions.push({ dispose: () => service?.dispose() });
            context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
                if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.webex`) && service) {
                    await status?.record('setting change');
                    service.setSetupFailure();
                    service.stop();
                    await service.reloadConfig();
                    await ensureWorkspace();
                    await service.reloadConfig();
                    publish();
                    if (vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false)) { service.start(); }
                }
            }));
        } catch (error) {
            await status?.record('activation', { exception: error instanceof Error ? error.message : String(error) });
            logRuntime('Webex deferred init failed', formatError(error));
            console.error('[AskAway] Webex deferred init error:', error);
        }
        return { service, relay };
    };
}
