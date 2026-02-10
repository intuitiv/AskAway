import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AskAwayWebviewProvider } from './webview/webviewProvider';
import { registerTools } from './tools';
import { McpServerManager } from './mcp/mcpServer';
import { ContextManager } from './context';
import { RemoteUiServer, RemoteMessage } from './server/remoteUiServer';
import { WebexService } from './services/webexService';
import { TelegramService } from './services/telegramService';

let mcpServer: McpServerManager | undefined;
let webviewProvider: AskAwayWebviewProvider | undefined;
let contextManager: ContextManager | undefined;
let remoteServer: RemoteUiServer | undefined;
let remoteOutputChannel: vscode.OutputChannel | undefined;

// File-based logger for debugging activation issues
const LOG_FILE = path.join(os.homedir(), 'askaway-debug.log');
function fileLog(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
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
            if (config.mcpServers?.['askaway']) {
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

export function activate(context: vscode.ExtensionContext) {
    // Clear old log file on each activation
    try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
    fileLog('=== AskAway Extension Activation Start ===');
    fileLog(`LOG_FILE: ${LOG_FILE}`);
    fileLog(`extensionUri: ${context.extensionUri.toString()}`);
    fileLog(`extensionPath: ${context.extensionPath}`);

    // Create output channel for logging
    const outputChannel = vscode.window.createOutputChannel('AskAway');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Extension activating...`);
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Debug log at ${LOG_FILE}`);

    try {
        // Initialize context manager for #terminal, #problems features
        fileLog('Step 1: Initializing ContextManager...');
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Initializing ContextManager...`);
        contextManager = new ContextManager();
        context.subscriptions.push({ dispose: () => contextManager?.dispose() });
        fileLog('Step 1: ContextManager OK');

        fileLog('Step 2: Initializing WebviewProvider...');
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Initializing WebviewProvider...`);
        const provider = new AskAwayWebviewProvider(context.extensionUri, context, contextManager);
        webviewProvider = provider;
        fileLog(`Step 2: WebviewProvider OK, viewType="${AskAwayWebviewProvider.viewType}"`);

        // Initialize Webex Service
        fileLog('Step 3: Initializing WebexService...');
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Initializing WebexService...`);
        const webexService = new WebexService(outputChannel);
        provider.setWebexService(webexService);
        fileLog('Step 3: WebexService created');
        
        fileLog('Step 3b: Starting WebexService...');
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Starting WebexService...`);
        webexService.start();
        context.subscriptions.push({ dispose: () => webexService.dispose() });
        fileLog('Step 3b: WebexService started');

        // Watch for Webex configuration changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('askaway.webex')) {
                outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Webex configuration changed, reloading...`);
                webexService.reloadConfig();
                webexService.start(); // re-start if newly configured
            }
        }));

        // Initialize Telegram Service
        fileLog('Step 4: Initializing TelegramService...');
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Initializing TelegramService...`);
        const telegramService = new TelegramService();
        provider.setTelegramService(telegramService);
        context.subscriptions.push({ dispose: () => telegramService.dispose() });
        fileLog('Step 4: TelegramService OK');

        // Watch for Telegram configuration changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('askaway.telegram')) {
                outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Telegram configuration changed, reloading...`);
                telegramService.reloadConfig();
            }
        }));

    // ── Copilot Progress: Track file changes for Webex/Telegram visibility ──
    // When Copilot modifies files, we accumulate a list so it can be
    // included in the message when ask_user is called.

    const fileWatcher = vscode.workspace.onDidChangeTextDocument(e => {
        // Only track workspace files (not output panels, settings, etc.)
        if (e.document.uri.scheme !== 'file') { return; }

        const relativePath = vscode.workspace.asRelativePath(e.document.uri);

        // Track for Webex if active
        if (webexService.getActiveTaskCount() > 0) {
            webexService.trackFileChange(relativePath);
            webexService.notifyCopilotActivity();
        }

        // Track for Telegram if active
        if (telegramService.getActiveTaskCount() > 0) {
            telegramService.trackFileChange(relativePath);
            telegramService.notifyCopilotActivity();
        }
    });
    context.subscriptions.push(fileWatcher);

    // Register the provider and add it to disposables for proper cleanup
    fileLog('Step 5: Registering WebviewViewProvider...');
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AskAwayWebviewProvider.viewType, provider),
        provider // Provider implements Disposable for cleanup
    );
    fileLog(`Step 5: Registered provider with viewType="${AskAwayWebviewProvider.viewType}"`);

    // Register VS Code LM Tools (always available for Copilot)
    fileLog('Step 6: Registering LM tools...');
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Registering LM tools...`);
    try {
        registerTools(context, provider);
        fileLog('Step 6: LM tools registered OK');
    } catch (e) {
        fileLog(`Step 6: ERROR registering LM tools: ${e}`);
        outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Error registering tools: ${e}`);
    }

    // Initialize MCP server manager (but don't start yet)
    fileLog('Step 7: Initializing MCP Server manager...');
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Initializing MCP Server manager...`);
    mcpServer = new McpServerManager(provider);
    fileLog('Step 7: MCP Server manager initialized');

    // Check if MCP should auto-start based on settings and external client configs
    // Deferred to avoid blocking activation with file I/O
    const config = vscode.workspace.getConfiguration('askaway');
    const mcpEnabled = config.get<boolean>('mcpEnabled', false);
    const autoStartIfClients = config.get<boolean>('mcpAutoStartIfClients', true);

    // Start MCP server only if:
    // 1. Explicitly enabled in settings, OR
    // 2. Auto-start is enabled AND external clients are configured
    // Note: Check is deferred to avoid blocking extension activation with file I/O
    if (mcpEnabled) {
        // Explicitly enabled - start immediately without checking external clients
        mcpServer.start();
    } else if (autoStartIfClients) {
        // Defer the external client check to avoid blocking activation
        hasExternalMcpClientsAsync().then(hasClients => {
            if (hasClients && mcpServer) {
                mcpServer.start();
            }
        }).catch(err => {
            console.error('[AskAway] Failed to check external MCP clients:', err);
        });
    }

    // Start MCP server command
    const startMcpCmd = vscode.commands.registerCommand('askaway.startMcp', async () => {
        if (mcpServer && !mcpServer.isRunning()) {
            await mcpServer.start();
            vscode.window.showInformationMessage('AskAway MCP Server started');
        } else if (mcpServer?.isRunning()) {
            vscode.window.showInformationMessage('AskAway MCP Server is already running');
        }
    });

    // Restart MCP server command
    const restartMcpCmd = vscode.commands.registerCommand('askaway.restartMcp', async () => {
        if (mcpServer) {
            await mcpServer.restart();
        }
    });

    // Show MCP configuration command
    const showMcpConfigCmd = vscode.commands.registerCommand('askaway.showMcpConfig', async () => {
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
            const uri = vscode.Uri.file(cfg.path);
            await vscode.commands.executeCommand('vscode.open', uri);
        }
    });

    // Open history modal command (triggered from view title bar)
    const openHistoryCmd = vscode.commands.registerCommand('askaway.openHistory', () => {
        provider.openHistoryModal();
    });

    // Clear current session command (triggered from view title bar)
    const clearSessionCmd = vscode.commands.registerCommand('askaway.clearCurrentSession', async () => {
        const result = await vscode.window.showWarningMessage(
            'Clear all tool calls from current session?',
            { modal: true },
            'Clear'
        );
        if (result === 'Clear') {
            provider.clearCurrentSession();
        }
    });

    // Open settings modal command (triggered from view title bar)
    const openSettingsCmd = vscode.commands.registerCommand('askaway.openSettings', () => {
        provider.openSettingsModal();
    });

    context.subscriptions.push(startMcpCmd, restartMcpCmd, showMcpConfigCmd, openHistoryCmd, clearSessionCmd, openSettingsCmd);

    // ================== Remote UI Server ==================
    
    // Initialize Remote UI Server for web/mobile access
    remoteServer = new RemoteUiServer(context.extensionUri, context);
    context.subscriptions.push(remoteServer);
    
    // Create output channel for remote server info
    remoteOutputChannel = vscode.window.createOutputChannel('AskAway Remote');
    context.subscriptions.push(remoteOutputChannel);

    // Wire up remote server with webview provider
    remoteServer.onGetState(() => provider.getStateForRemote());
    remoteServer.onMessage((message: RemoteMessage, respond) => {
        // Forward message to webview provider
        provider.handleRemoteMessage(message as any);
    });
    
    // Set broadcast callback so webview provider can push updates to remote clients
    provider.setRemoteBroadcastCallback((message) => {
        remoteServer?.broadcast(message as RemoteMessage);
    });

    // Check if remote server should auto-start
    const remoteEnabled = config.get<boolean>('remoteEnabled', false);
    const remotePort = config.get<number>('remotePort', 3000);
    
    if (remoteEnabled) {
        startRemoteServer(remotePort);
    }

    // Initialize context for remote server state (icon toggle)
    vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', false);

    // Start Remote Server command
    const startRemoteCmd = vscode.commands.registerCommand('askaway.startRemote', async () => {
        await startRemoteServer(remotePort);
    });

    // Stop Remote Server command  
    const stopRemoteCmd = vscode.commands.registerCommand('askaway.stopRemote', () => {
        if (remoteServer) {
            remoteServer.stop();
            vscode.commands.executeCommand('setContext', 'askaway.remoteServerRunning', false);
            vscode.window.showInformationMessage('AskAway Remote Server stopped');
        }
    });

    // Show Remote URL command
    const showRemoteUrlCmd = vscode.commands.registerCommand('askaway.showRemoteUrl', () => {
        if (remoteServer) {
            const info = remoteServer.getConnectionInfo();
            if (info.port > 0) {
                showRemoteConnectionInfo(info);
            } else {
                vscode.window.showWarningMessage('AskAway Remote Server is not running. Run "AskAway: Start Remote Server" first.');
            }
        }
    });

    // Toggle Remote Server command (for the title bar button - START)
    const toggleRemoteStartCmd = vscode.commands.registerCommand('askaway.toggleRemoteStart', async () => {
        await startRemoteServer(remotePort);
    });

    // Toggle Remote Server command (for the title bar button - STOP/OPTIONS)
    const toggleRemoteStopCmd = vscode.commands.registerCommand('askaway.toggleRemoteStop', async () => {
        if (remoteServer) {
            const info = remoteServer.getConnectionInfo();
            if (info.port > 0) {
                // Server is running - show options
                const action = await vscode.window.showQuickPick([
                    { label: '$(copy) Copy URL with PIN', description: 'Copy ready-to-use URL for mobile', action: 'copy' },
                    { label: '$(key) Show PIN', description: info.pin, action: 'pin' },
                    { label: '$(link-external) Show All URLs', description: 'View all connection options', action: 'urls' },
                    { label: '$(debug-disconnect) Stop Server', description: 'Stop the remote server', action: 'stop' }
                ], {
                    placeHolder: `Remote Server running on port ${info.port}`
                });
                
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
            }
        }
    });

    // Keep old toggle command for backward compatibility
    const toggleRemoteCmd = vscode.commands.registerCommand('askaway.toggleRemote', async () => {
        if (remoteServer) {
            const info = remoteServer.getConnectionInfo();
            if (info.port > 0) {
                await vscode.commands.executeCommand('askaway.toggleRemoteStop');
            } else {
                await vscode.commands.executeCommand('askaway.toggleRemoteStart');
            }
        }
    });

    context.subscriptions.push(startRemoteCmd, stopRemoteCmd, showRemoteUrlCmd, toggleRemoteStartCmd, toggleRemoteStopCmd, toggleRemoteCmd);

    // ── Webex OAuth Authorization Command ──
    const authorizeWebexCmd = vscode.commands.registerCommand('askaway.authorizeWebex', async () => {
        const config = vscode.workspace.getConfiguration('askaway');
        const clientId = config.get<string>('webex.clientId', '');

        if (!clientId) {
            const action = await vscode.window.showWarningMessage(
                'AskAway: Please set your Webex Client ID first in settings.',
                'Open Settings'
            );
            if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.webex.clientId');
            }
            return;
        }

        const clientSecret = config.get<string>('webex.clientSecret', '');
        if (!clientSecret) {
            const action = await vscode.window.showWarningMessage(
                'AskAway: Please set your Webex Client Secret first in settings.',
                'Open Settings'
            );
            if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.webex.clientSecret');
            }
            return;
        }

        // Start a local HTTP server to receive the OAuth callback
        const http = require('http');
        const callbackPort = 54321;
        const redirectUri = `http://localhost:${callbackPort}/callback`;

        // Use spark:all scope (matches most Webex integrations)
        const scopes = 'spark%3Aall';

        const authUrl = `https://webexapis.com/v1/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}`;

        // Create temporary callback server
        const server = http.createServer(async (req: any, res: any) => {
            const url = new URL(req.url, `http://localhost:${callbackPort}`);
            if (url.pathname === '/callback') {
                const code = url.searchParams.get('code');
                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h2>✅ AskAway: Webex authorized successfully!</h2><p>You can close this tab.</p></body></html>');

                    // Exchange code for tokens
                    try {
                        const tokenResp = await fetch('https://webexapis.com/v1/access_token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({
                                grant_type: 'authorization_code',
                                client_id: clientId,
                                client_secret: clientSecret,
                                code: code,
                                redirect_uri: redirectUri
                            }).toString()
                        });

                        if (tokenResp.ok) {
                            const data = await tokenResp.json() as any;
                            // Save tokens
                            await config.update('webex.accessToken', data.access_token, vscode.ConfigurationTarget.Global);
                            await config.update('webex.refreshToken', data.refresh_token, vscode.ConfigurationTarget.Global);

                            vscode.window.showInformationMessage(
                                `AskAway: Webex authorized! Token expires in ${Math.round(data.expires_in / 3600)}h (auto-refresh enabled).`
                            );

                            // Reload webex service config
                            const webexSvc = webviewProvider?.getWebexService();
                            if (webexSvc) { webexSvc.reloadConfig(); }
                        } else {
                            const err = await tokenResp.text();
                            vscode.window.showErrorMessage(`AskAway: Token exchange failed: ${err}`);
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`AskAway: OAuth error: ${e.message}`);
                    }
                } else {
                    const error = url.searchParams.get('error') || 'Unknown error';
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`<html><body><h2>❌ Authorization failed: ${error}</h2></body></html>`);
                }

                // Close server after handling
                setTimeout(() => server.close(), 1000);
            }
        });

        server.listen(callbackPort, () => {
            console.log(`AskAway: OAuth callback server listening on port ${callbackPort}`);
            vscode.env.openExternal(vscode.Uri.parse(authUrl));
            vscode.window.showInformationMessage('AskAway: Opening Webex authorization page in your browser...');
        });

        server.on('error', (err: any) => {
            vscode.window.showErrorMessage(`AskAway: Could not start OAuth callback server: ${err.message}`);
        });

        // Auto-close after 2 minutes if no callback received
        setTimeout(() => {
            server.close();
        }, 120000);
    });

    // Telegram "Get Chat ID" command
    const getTelegramChatIdCmd = vscode.commands.registerCommand('askaway.getTelegramChatId', async () => {
        await telegramService.getChatId();
    });

    context.subscriptions.push(authorizeWebexCmd, getTelegramChatIdCmd);
    fileLog('=== AskAway Extension Activation Complete ===');
    outputChannel.appendLine(`[${new Date().toISOString()}] AskAway: Activation complete!`);
    } catch (error) {
        fileLog(`CRITICAL ACTIVATION ERROR: ${error}`);
        if (error instanceof Error) {
            fileLog(`Stack: ${error.stack}`);
        }
        outputChannel.appendLine(`[AskAway] CRITICAL ACTIVATION ERROR: ${error}`);
        console.error('AskAway Activation Error:', error);
    }
}

/**
 * Start the remote UI server
 */
async function startRemoteServer(preferredPort: number): Promise<void> {
    if (!remoteServer) return;
    
    try {
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
