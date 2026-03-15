import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CONFIG_NAMESPACE, OUTPUT_CHANNEL_NAME, MCP_SERVER_NAME } from './constants/branding';
import { AskAwayWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';
import { ContextManager } from './context';
import { PlanEditorProvider } from './plan/planEditorProvider';

// Heavy modules loaded lazily to avoid blocking activation
// RemoteUiServer imports express + socket.io (expensive)
// WebexService, TelegramService do network/config I/O
type RemoteUiServerType = import('./server/remoteUiServer').RemoteUiServer;
type RemoteMessageType = import('./server/remoteUiServer').RemoteMessage;
type WebexServiceType = import('./services/webexService').WebexService;
type TelegramServiceType = import('./services/telegramService').TelegramService;

let mcpServer: McpServerManager | undefined;
let webviewProvider: AskAwayWebviewProvider | undefined;
let contextManager: ContextManager | undefined;
let remoteServer: RemoteUiServerType | undefined;
let remoteOutputChannel: vscode.OutputChannel | undefined;
let planEditor: PlanEditorProvider | undefined;
let telegramServiceInstance: TelegramServiceType | undefined;
let activationOutputChannel: vscode.OutputChannel | undefined;

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    }
    return String(error);
}

function logRuntime(message: string, details?: unknown): void {
    const timestamp = new Date().toISOString();
    const suffix = details !== undefined
        ? ` ${typeof details === 'string' ? details : JSON.stringify(details)}`
        : '';
    activationOutputChannel?.appendLine(`[${timestamp}] AskAway Runtime: ${message}${suffix}`);
}

// Memoized result for external MCP client check (only checked once per activation)
let _hasExternalMcpClientsResult: boolean | undefined;

/**
 * Check if external MCP client configs exist (Kiro, Cursor, Antigravity)
 * This indicates user has external tools that need the MCP server
 * Result is memoized to avoid repeated file system reads
 * Uses async I/O to avoid blocking the extension host thread
 */
async function hasExternalMcpClientsAsync(): Promise<boolean> {
    // Return cached result if available
    if (_hasExternalMcpClientsResult !== undefined) {
        return _hasExternalMcpClientsResult;
    }

    const configPaths = [
        path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
        path.join(os.homedir(), '.cursor', 'mcp.json'),
        path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
    ];

    for (const configPath of configPaths) {
        try {
            const content = await fs.promises.readFile(configPath, 'utf8');
            const config = JSON.parse(content);
            // Check if askaway is registered
            if (config.mcpServers?.[MCP_SERVER_NAME]) {
                _hasExternalMcpClientsResult = true;
                return true;
            }
        } catch {
            // File doesn't exist or parse error - continue to next path
        }
    }
    _hasExternalMcpClientsResult = false;
    return false;
}

/**
 * Detect installed extensions that are likely to conflict with AskAway's ask_user tool.
 * Primary known conflict is upstream TaskSync shipping the same tool name.
 */
function findConflictingTaskSyncExtension(): vscode.Extension<any> | undefined {
    const explicitIds = ['4regab.tasksync'];

    for (const id of explicitIds) {
        const ext = vscode.extensions.getExtension(id);
        if (ext) {
            return ext;
        }
    }

    return vscode.extensions.all.find(ext => {
        if (ext.id.toLowerCase() === 'intuitiv.askaway') {
            return false;
        }

        const packageJson = ext.packageJSON as { name?: string; displayName?: string } | undefined;
        const name = (packageJson?.name || '').toLowerCase();
        const displayName = (packageJson?.displayName || '').toLowerCase();
        return name === 'tasksync' || displayName === 'tasksync';
    });
}

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    activationOutputChannel = outputChannel;
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Extension activating...`);

    const conflictingTaskSync = findConflictingTaskSyncExtension();
    if (conflictingTaskSync) {
        const conflictMessage = `AskAway detected a potential tool conflict with installed extension "${conflictingTaskSync.id}". Disable TaskSync (or AskAway) to avoid ask_user routing issues.`;
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: ${conflictMessage}`);
        vscode.window.showWarningMessage(
            conflictMessage,
            'Open Extensions'
        ).then(selection => {
            if (selection === 'Open Extensions') {
                vscode.commands.executeCommand('workbench.view.extensions');
            }
        });
    }

    try {
        // Initialize context manager for #terminal, #problems features
        logRuntime('Creating ContextManager', { type: typeof ContextManager });
        contextManager = new ContextManager();
        context.subscriptions.push({ dispose: () => contextManager?.dispose() });

        logRuntime('Creating AskAwayWebviewProvider', {
            providerType: typeof AskAwayWebviewProvider,
            viewType: AskAwayWebviewProvider?.viewType
        });
        const provider = new AskAwayWebviewProvider(context.extensionUri, context, contextManager);
        webviewProvider = provider;

        // Register the provider EARLY so sidebar loads fast
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(AskAwayWebviewProvider.viewType, provider),
            provider
        );

        // Register VS Code LM Tools (critical for Copilot — must be early)
        logRuntime('Registering language model tools');
        registerTools(context, provider);

        // Initialize Plan Board editor (lightweight, no I/O at init)
        logRuntime('Creating PlanEditorProvider', { type: typeof PlanEditorProvider });
        planEditor = new PlanEditorProvider(context.extensionUri);
        provider.setPlanEditor(planEditor);
        context.subscriptions.push(planEditor);
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.openPlanBoard', () => planEditor?.open())
        );

        // ── Commands — registered synchronously, reference lazy-loaded services ──

        // Send current input command (for Keyboard Shortcuts)
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.sendMessage', () => {
                provider.triggerSendFromShortcut();
            })
        );

        // MCP commands
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.startMcp', async () => {
                if (mcpServer && !mcpServer.isRunning()) {
                    await mcpServer.start();
                    vscode.window.showInformationMessage('AskAway MCP Server started');
                } else if (mcpServer?.isRunning()) {
                    vscode.window.showInformationMessage('AskAway MCP Server is already running');
                }
            }),
            vscode.commands.registerCommand('askaway.restartMcp', async () => {
                if (mcpServer) { await mcpServer.restart(); }
            }),
            vscode.commands.registerCommand('askaway.showMcpConfig', async () => {
                const config = (mcpServer as any).getMcpConfig?.();
                if (!config) {
                    vscode.window.showErrorMessage('MCP server not running');
                    return;
                }
                const selected = await vscode.window.showQuickPick(
                    [
                        { label: 'Kiro', description: 'Kiro IDE', value: 'kiro' },
                        { label: 'Cursor', description: 'Cursor Editor', value: 'cursor' },
                        { label: 'Antigravity', description: 'Gemini CLI', value: 'antigravity' }
                    ],
                    { placeHolder: 'Select MCP client to configure' }
                );
                if (!selected) return;
                const cfg = config[selected.value];
                const configJson = JSON.stringify(cfg.config, null, 2);
                const message = `Add this to ${cfg.path}:\n\n${configJson}`;
                const action = await vscode.window.showInformationMessage(message, 'Copy to Clipboard', 'Open File');
                if (action === 'Copy to Clipboard') {
                    await vscode.env.clipboard.writeText(configJson);
                    vscode.window.showInformationMessage('Configuration copied to clipboard');
                } else if (action === 'Open File') {
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(cfg.path));
                }
            })
        );

        // Session commands
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.openHistory', () => provider.openHistoryModal()),
            vscode.commands.registerCommand('askaway.newSession', () => provider.startNewSession()),
            vscode.commands.registerCommand('askaway.clearCurrentSession', async () => {
                const result = await vscode.window.showWarningMessage(
                    'Clear all tool calls from current session?',
                    { modal: true },
                    'Clear'
                );
                if (result === 'Clear') { provider.clearCurrentSession(); }
            }),
            vscode.commands.registerCommand('askaway.openSettings', () => provider.openSettingsModal())
        );

        // Remote server commands (lazy — actual server loaded in deferred block)
        const remotePort = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<number>('remotePort', 3000);
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.startRemote', async () => {
                await ensureRemoteServer(context, provider);
                await startRemoteServer(remotePort);
            }),
            vscode.commands.registerCommand('askaway.stopRemote', () => {
                if (remoteServer) {
                    remoteServer.stop();
                    vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', false);
                    vscode.window.showInformationMessage('AskAway Remote Server stopped');
                }
            }),
            vscode.commands.registerCommand('askaway.showRemoteUrl', () => {
                if (remoteServer) {
                    const info = remoteServer.getConnectionInfo();
                    if (info.port > 0) { showRemoteConnectionInfo(info); }
                    else { vscode.window.showWarningMessage('AskAway Remote Server is not running.'); }
                }
            }),
            vscode.commands.registerCommand('askaway.toggleRemoteStart', async () => {
                await ensureRemoteServer(context, provider);
                await startRemoteServer(remotePort);
            }),
            vscode.commands.registerCommand('askaway.toggleRemoteStop', async () => {
                if (!remoteServer) return;
                const info = remoteServer.getConnectionInfo();
                if (info.port <= 0) return;
                const action = await vscode.window.showQuickPick([
                    { label: '$(copy) Copy URL with PIN', description: 'Copy ready-to-use URL for mobile', action: 'copy' },
                    { label: '$(key) Show PIN', description: info.pin, action: 'pin' },
                    { label: '$(link-external) Show All URLs', description: 'View all connection options', action: 'urls' },
                    { label: '$(debug-disconnect) Stop Server', description: 'Stop the remote server', action: 'stop' }
                ], { placeHolder: `Remote Server running on port ${info.port}` });
                if (action?.action === 'copy') {
                    const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
                    await vscode.env.clipboard.writeText(`${networkUrl}?pin=${info.pin}`);
                    vscode.window.showInformationMessage('URL with PIN copied to clipboard');
                } else if (action?.action === 'pin') {
                    await vscode.env.clipboard.writeText(info.pin);
                    vscode.window.showInformationMessage(`PIN ${info.pin} copied to clipboard`);
                } else if (action?.action === 'urls') {
                    showRemoteConnectionInfo(info);
                } else if (action?.action === 'stop') {
                    remoteServer.stop();
                    vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', false);
                    vscode.window.showInformationMessage('AskAway Remote Server stopped');
                }
            }),
            vscode.commands.registerCommand('askaway.toggleRemote', async () => {
                if (remoteServer) {
                    const info = remoteServer.getConnectionInfo();
                    if (info.port > 0) { await vscode.commands.executeCommand('askaway.toggleRemoteStop'); }
                    else { await vscode.commands.executeCommand('askaway.toggleRemoteStart'); }
                } else {
                    await vscode.commands.executeCommand('askaway.toggleRemoteStart');
                }
            })
        );

        // Webex/Telegram commands (services loaded in deferred block)
        context.subscriptions.push(
            vscode.commands.registerCommand('askaway.authorizeWebex', async () => {
                const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                const clientId = config.get<string>('webex.clientId', '');
                if (!clientId) {
                    const action = await vscode.window.showWarningMessage('AskAway: Please set your Webex Client ID first.', 'Open Settings');
                    if (action === 'Open Settings') { vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.webex.clientId'); }
                    return;
                }
                const clientSecret = config.get<string>('webex.clientSecret', '');
                if (!clientSecret) {
                    const action = await vscode.window.showWarningMessage('AskAway: Please set your Webex Client Secret first.', 'Open Settings');
                    if (action === 'Open Settings') { vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.webex.clientSecret'); }
                    return;
                }
                const http = require('http');
                const callbackPort = 54321;
                const redirectUri = `http://localhost:${callbackPort}/callback`;
                const scopes = 'spark%3Aall';
                const authUrl = `https://webexapis.com/v1/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;
                const server = http.createServer(async (req: any, res: any) => {
                    const url = new URL(req.url, `http://localhost:${callbackPort}`);
                    if (url.pathname === '/callback') {
                        const code = url.searchParams.get('code');
                        if (code) {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end('<html><body><h2>AskAway: Webex authorized!</h2><p>You can close this tab.</p></body></html>');
                            try {
                                const tokenResp = await fetch('https://webexapis.com/v1/access_token', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: new URLSearchParams({
                                        grant_type: 'authorization_code', client_id: clientId,
                                        client_secret: clientSecret, code, redirect_uri: redirectUri
                                    }).toString()
                                });
                                if (tokenResp.ok) {
                                    const data = await tokenResp.json() as any;
                                    await config.update('webex.accessToken', data.access_token, vscode.ConfigurationTarget.Global);
                                    await config.update('webex.refreshToken', data.refresh_token, vscode.ConfigurationTarget.Global);
                                    vscode.window.showInformationMessage(`AskAway: Webex authorized! Token expires in ${Math.round(data.expires_in / 3600)}h.`);
                                    webviewProvider?.getWebexService()?.reloadConfig();
                                } else {
                                    vscode.window.showErrorMessage(`AskAway: Token exchange failed: ${await tokenResp.text()}`);
                                }
                            } catch (e: any) {
                                vscode.window.showErrorMessage(`AskAway: OAuth error: ${e.message}`);
                            }
                        } else {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(`<html><body><h2>Authorization failed: ${url.searchParams.get('error') || 'Unknown error'}</h2></body></html>`);
                        }
                        setTimeout(() => server.close(), 1000);
                    }
                });
                server.listen(callbackPort, () => {
                    vscode.env.openExternal(vscode.Uri.parse(authUrl));
                    vscode.window.showInformationMessage('AskAway: Opening Webex authorization page...');
                });
                server.on('error', (err: any) => { vscode.window.showErrorMessage(`AskAway: OAuth callback error: ${err.message}`); });
                setTimeout(() => server.close(), 120000);
            }),
            vscode.commands.registerCommand('askaway.getTelegramChatId', async () => {
                if (telegramServiceInstance) { await telegramServiceInstance.getChatId(); }
                else { vscode.window.showWarningMessage('Telegram service not initialized yet.'); }
            })
        );

        // Initialize remote server context
        vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', false);

        // ── Deferred initialization — heavy services loaded AFTER sidebar is ready ──
        setImmediate(async () => {
            try {
                // Dynamically import heavy modules to avoid blocking activation
                const webexModule = await import('./services/webexService');
                const telegramModule = await import('./services/telegramService');
                const { WebexService } = webexModule;
                const { TelegramService } = telegramModule;

                logRuntime('Deferred modules loaded', {
                    webexModuleKeys: Object.keys(webexModule),
                    telegramModuleKeys: Object.keys(telegramModule),
                    webexCtorType: typeof WebexService,
                    telegramCtorType: typeof TelegramService
                });

                if (typeof WebexService !== 'function') {
                    throw new Error('WebexService import is not a constructor function');
                }
                if (typeof TelegramService !== 'function') {
                    throw new Error('TelegramService import is not a constructor function');
                }

                // Initialize Webex Service
                const webexService = new WebexService(outputChannel);
                provider.setWebexService(webexService);
                webexService.start();
                context.subscriptions.push({ dispose: () => webexService.dispose() });

                context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.webex`)) {
                        webexService.reloadConfig();
                        webexService.start();
                    }
                }));

                // Initialize Telegram Service
                const telegramService = new TelegramService();
                telegramServiceInstance = telegramService;
                provider.setTelegramService(telegramService);
                context.subscriptions.push({ dispose: () => telegramService.dispose() });

                context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.telegram`)) {
                        telegramService.reloadConfig();
                    }
                }));

                // File change tracker for Webex/Telegram
                context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
                    if (e.document.uri.scheme !== 'file') return;
                    const relativePath = vscode.workspace.asRelativePath(e.document.uri);
                    if (webexService.getActiveTaskCount() > 0) {
                        webexService.trackFileChange(relativePath);
                        webexService.notifyCopilotActivity();
                    }
                    if (telegramService.getActiveTaskCount() > 0) {
                        telegramService.trackFileChange(relativePath);
                        telegramService.notifyCopilotActivity();
                    }
                }));

                // MCP Server
                mcpServer = new McpServerManager(provider);
                const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                const mcpEnabled = config.get<boolean>('mcpEnabled', false);
                const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);
                if (mcpEnabled) {
                    mcpServer.start();
                } else if (autoStartIfClients) {
                    hasExternalMcpClientsAsync().then(hasClients => {
                        if (hasClients && mcpServer) { mcpServer.start(); }
                    }).catch(() => {});
                }

                // Auto-start Remote Server if configured
                const remoteEnabled = config.get<boolean>('remoteEnabled', false);
                if (remoteEnabled) {
                    logRuntime('Remote auto-start requested', { remotePort: config.get<number>('remotePort', 3000) });
                    await ensureRemoteServer(context, provider);
                    await startRemoteServer(config.get<number>('remotePort', 3000));
                }

            } catch (err) {
                logRuntime('Deferred initialization failed', formatError(err));
                console.error('[AskAway] Deferred init error:', err);
            }
        });

    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Activation complete!`);
    } catch (error) {
        console.error('AskAway Activation Error:', error);
        logRuntime('Activation failed', formatError(error));
        outputChannel.appendLine(`[AskAway] CRITICAL ACTIVATION ERROR: ${error}`);
    }
}

/**
 * Lazily load and initialize the Remote UI Server (imports express + socket.io)
 */
async function ensureRemoteServer(context: vscode.ExtensionContext, provider: AskAwayWebviewProvider): Promise<void> {
    if (remoteServer) return;

    const remoteModule = await import('./server/remoteUiServer');
    const { RemoteUiServer } = remoteModule;
    type RemoteMessage = import('./server/remoteUiServer').RemoteMessage;

    logRuntime('Remote server module loaded', {
        moduleKeys: Object.keys(remoteModule),
        remoteCtorType: typeof RemoteUiServer
    });

    if (typeof RemoteUiServer !== 'function') {
        throw new Error('RemoteUiServer import is not a constructor function');
    }

    remoteServer = new RemoteUiServer(context.extensionUri, context);
    context.subscriptions.push(remoteServer);

    // Create output channel for remote server info
    if (!remoteOutputChannel) {
        remoteOutputChannel = vscode.window.createOutputChannel('AskAway Remote');
        context.subscriptions.push(remoteOutputChannel);
    }

    // Wire up remote server with webview provider
    remoteServer.onGetState(() => provider.getStateForRemote());
    remoteServer.onMessage((message: RemoteMessage, _respond) => {
        provider.handleRemoteMessage(message as any);
    });
    provider.setRemoteBroadcastCallback((message) => {
        remoteServer?.broadcast(message as RemoteMessage);
    });
}

/**
 * Start the remote UI server
 */
async function startRemoteServer(preferredPort: number): Promise<void> {
    if (!remoteServer) return;
    
    try {
        logRuntime('Starting remote server', { preferredPort });
        const port = await remoteServer.start(preferredPort);
        const info = remoteServer.getConnectionInfo();
        
        // Update context for icon toggle
        vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', true);
        
        // Show in output channel
        remoteOutputChannel?.clear();
        remoteOutputChannel?.appendLine('='.repeat(50));
        remoteOutputChannel?.appendLine('  AskAway Remote Server Started');
        remoteOutputChannel?.appendLine('='.repeat(50));
        remoteOutputChannel?.appendLine('');
        remoteOutputChannel?.appendLine(`📱 Access from your phone or browser:`);
        remoteOutputChannel?.appendLine('');
        info.urls.forEach(url => {
            remoteOutputChannel?.appendLine(`   ${url}`);
        });
        remoteOutputChannel?.appendLine('');
        remoteOutputChannel?.appendLine(`🔐 PIN: ${info.pin}`);
        remoteOutputChannel?.appendLine('');
        remoteOutputChannel?.appendLine('Tip: Use the network URL (192.168.x.x) to access from mobile');
        remoteOutputChannel?.appendLine('='.repeat(50));
        remoteOutputChannel?.show(true);
        
        // Show notification with quick action
        const action = await vscode.window.showInformationMessage(
            `AskAway Remote running on port ${port}. PIN: ${info.pin}`,
            'Copy URL',
            'Show Details'
        );
        
        if (action === 'Copy URL') {
            const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
            await vscode.env.clipboard.writeText(`${networkUrl}?pin=${info.pin}`);
            vscode.window.showInformationMessage('URL copied to clipboard');
        } else if (action === 'Show Details') {
            showRemoteConnectionInfo(info);
        }
    } catch (err) {
        logRuntime('Remote server start failed', formatError(err));
        vscode.window.showErrorMessage(`Failed to start Remote Server: ${err}`);
    }
}

/**
 * Show remote connection info in a QuickPick
 */
async function showRemoteConnectionInfo(info: { urls: string[]; pin: string; port: number }): Promise<void> {
    const items = [
        { label: '$(key) PIN', description: info.pin, detail: 'Enter this PIN on your phone' },
        ...info.urls.map(url => ({
            label: url.includes('localhost') ? '$(globe) Local URL' : '$(broadcast) Network URL',
            description: url,
            detail: url.includes('localhost') ? 'Access from this computer' : 'Access from phone/tablet on same WiFi'
        })),
        { label: '$(copy) Copy Network URL with PIN', description: '', detail: 'Copy ready-to-use URL for mobile' }
    ];
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'AskAway Remote Connection Info'
    });
    
    if (selected) {
        if (selected.label.includes('Copy')) {
            const networkUrl = info.urls.find(u => !u.includes('localhost')) || info.urls[0];
            await vscode.env.clipboard.writeText(`${networkUrl}?pin=${info.pin}`);
            vscode.window.showInformationMessage('URL with PIN copied to clipboard');
        } else if (selected.description) {
            await vscode.env.clipboard.writeText(selected.description);
            vscode.window.showInformationMessage('Copied to clipboard');
        }
    }
}

export async function deactivate() {
    // Save current tool call history to persisted history before deactivating
    if (webviewProvider) {
        webviewProvider.saveCurrentSessionToHistory();
        webviewProvider = undefined;
    }

    if (remoteServer) {
        remoteServer.dispose();
        remoteServer = undefined;
    }

    if (mcpServer) {
        await mcpServer.dispose();
        mcpServer = undefined;
    }
}
