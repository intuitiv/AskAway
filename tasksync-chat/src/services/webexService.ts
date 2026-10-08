import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CONFIG_NAMESPACE } from '../constants/branding';
import { WebexAuth, readWebexCredentials, isWebexToken } from './webexAuth';
import { WebexIncomingWebhook, isIncomingWebhookSender } from './webexIncomingWebhook';
import type { RemoteChannel, RemoteDestination, RemoteMessageId, RemoteReply } from './remoteChannel';

// ── Interfaces ─────────────────────────────────────────────────

interface TrackedTask {
    taskId: string;
    messageId: string;   // Webex message ID of the posted card
    question: string;
    choices?: string[];
    timestamp: number;
    handoff?: boolean;
}

// ── Constants ──────────────────────────────────────────────────

// Backoff schedule in seconds: 2s, 2s, 5s, 10s, 30s, 60s, then 60s for ~20min, then 5min
// Indices 0-5 = quick ramp-up, 6-25 = stay at 60s (~20min), 26+ = 300s (5min)
const POLL_BACKOFF_SCHEDULE_S = [
    2, 2, 5, 10, 30, 60,          // indices 0-5: ramp up
    60, 60, 60, 60, 60,           // indices 6-10: hold 60s
    60, 60, 60, 60, 60,           // indices 11-15: hold 60s
    60, 60, 60, 60, 60,           // indices 16-20: hold 60s
    60, 60, 60, 60, 60,           // indices 21-25: hold 60s (~20 min of 60s polls)
    300                            // index 26+: 5 minutes
];
const EXPIRY_MS = 36 * 60 * 60 * 1000;  // 36 hours
const CARD_VERSION = '1.3';
const WEBEX_API = 'https://webexapis.com/v1';

// ── Service ────────────────────────────────────────────────────

export class WebexService implements RemoteChannel {
    private _postedMessageIds = new Set<string>();
    private _enabled: boolean = false;
    private _accessToken: string | undefined;
    private _roomId: string | undefined;
    private _tokenFilePath: string | undefined;
    private _pollingTimer: NodeJS.Timeout | undefined;
    private _activeTasks: Map<string, TrackedTask> = new Map();
    private _processedMsgIds: Set<string> = new Set();
    private _myPersonId: string | undefined;  // cached to avoid repeated /people/me
    private _onResponseReceived: ((taskId: string, response: string, user: string) => void) | undefined;

    // ── Backoff polling state ──
    private _pollTickIndex: number = 0;      // index into POLL_BACKOFF_SCHEDULE_S
    private _pollCount: number = 0;          // total polls since last card posted

    // ── Copilot activity tracking ──
    private _lastCopilotActivity: number = 0; // timestamp of last known Copilot action
    private _copilotIdleThresholdMs: number = 5 * 60 * 1000; // 5 min idle → stale

    // ── File change tracking ──
    private _recentFileChanges: string[] = [];

    // ── OAuth credentials ──
    private _clientId: string | undefined;
    private _clientSecret: string | undefined;
    private _refreshToken: string | undefined;

    private _ready: Promise<void> = Promise.resolve();
    private _refreshing: Promise<string | undefined> | undefined;
    private _ledgerPath: string | undefined;
    private _polling = false;

    constructor(private logger?: vscode.OutputChannel, private auth?: WebexAuth, private credentialsFile?: string,
        private remoteOptions: { baseUrl?: string; wait?: (ms: number) => Promise<void> } = {}, private incoming?: WebexIncomingWebhook) {
        this._ready = this.reloadConfig();
    }

    // ── Configuration ──────────────────────────────────────────

    public reloadConfig(): Promise<void> {
        this._ready = this._reloadConfig();
        return this._ready;
    }

    private setupFailure?: number;
    public setSetupFailure(status?: number): void { this.setupFailure = status; }

    public async refreshAccessToken(): Promise<string | undefined> {
        await this._ready;
        return this._refreshAccessToken();
    }

    private async _reloadConfig(): Promise<void> {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        this._enabled = config.get<boolean>('webex.enabled', false);
        this._roomId = config.get<string>('webex.roomId', '');
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            try {
                const facts = JSON.parse(fs.readFileSync(path.join(root, '.askaway/webex-spaces.json'), 'utf8'));
                this._roomId = facts.self?.workspaceRoomId || this._roomId;
            } catch { /* Setup has not resolved this workspace yet. */ }
        }
        const ledgerPath = root ? path.join(root, '.askaway/webex-messages.json') : undefined;
        if (ledgerPath && this._ledgerPath !== ledgerPath) {
            this._ledgerPath = ledgerPath;
            try {
                const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
                if (ledger.roomId === this._roomId) {
                    this._postedMessageIds = new Set<string>(ledger.posted.slice(-500));
                    this._processedMsgIds = new Set<string>(ledger.processed.slice(-500));
                    this._activeTasks = new Map(ledger.tasks.slice(-500).map((task: TrackedTask) => [task.taskId, task]));
                }
            } catch { /* A new workspace has no message ledger yet. */ }
        }
        this._tokenFilePath = config.get<string>('webex.tokenFilePath', '');
        const directToken = config.get<string>('webex.accessToken', '');

        this.logger?.appendLine(`[WebexService] Reloading config. Enabled: ${this._enabled}`);

        // OAuth credentials for auto-refresh
        this._clientId = config.get<string>('webex.clientId', '') || undefined;
        this._clientSecret = config.get<string>('webex.clientSecret', '') || undefined;
        if (!this._clientId || !this._clientSecret) {
            const credentials = readWebexCredentials(this.credentialsFile);
            this._clientId ||= credentials.clientId;
            this._clientSecret ||= credentials.clientSecret;
        }
        this._refreshToken = config.get<string>('webex.refreshToken', '') || undefined;

        // Resolve token: file takes precedence over direct token
        this._accessToken = undefined;
        this._myPersonId = undefined; // clear cache on reload

        if (this.auth) {
            try {
                const tokens = await this.auth.tokens();
                this._accessToken = tokens.accessToken;
                this._refreshToken = tokens.refreshToken || this._refreshToken;
            } catch { console.warn('AskAway/Webex: Could not read stored credentials.'); }
        }
        if (!this._accessToken && this._tokenFilePath) {
            this._accessToken = this._loadTokenFromFile(this._tokenFilePath);
        }
        if (!this._accessToken && directToken) {
            this._accessToken = directToken;
        }

        // If no token but OAuth credentials exist, try to get one
        if (!this._accessToken && this._clientId && this._clientSecret && this._refreshToken) {
            await this._refreshAccessToken().then(token => {
                if (token) {
                    this._accessToken = token;
                    if (this._enabled && this._roomId && this._activeTasks.size > 0) {
                        this.startPolling();
                    }
                }
            }).catch(() => {});
        }

        // Re-evaluate polling state
        if (this._enabled && this._accessToken && this._roomId && this._activeTasks.size > 0) {
            this.startPolling();
        } else if (!this._enabled || !this._accessToken) {
            this.stopPolling();
        }
    }

    /**
     * Load access_token (and optionally refresh_token) from a JSON file on disk.
     * Supports paths with ~ (home directory).
     */
    private _loadTokenFromFile(filePath: string): string | undefined {
        try {
            const resolved = filePath.startsWith('~')
                ? path.join(os.homedir(), filePath.slice(1))
                : filePath;
            
            const content = fs.readFileSync(resolved, 'utf8');
            const json = JSON.parse(content);

            // Also load refresh_token from file if present (and not already set from settings)
            if (json.refresh_token && !this._refreshToken) {
                this._refreshToken = json.refresh_token;
            }

            return json.access_token || undefined;
        } catch (e) {
            console.warn('AskAway/Webex: Could not load token file.');
            return undefined;
        }
    }

    public isConfigured(): boolean {
        return this._enabled && (!!this._accessToken || this.hasOAuthCredentials()) && !!this._roomId;
    }

    /** Check if OAuth auto-refresh is configured */
    public hasOAuthCredentials(): boolean {
        return !!this._clientId && !!this._clientSecret && !!this._refreshToken;
    }

    public setResponseCallback(callback: (taskId: string, response: string, user: string) => void) {
        this._onResponseReceived = callback;
    }

    public resolveTask(taskId: string): void {
        this._activeTasks.delete(taskId);
        this._persistMessages();
        if (!this._activeTasks.size) { this.stopPolling(); }
    }
    public onReply(callback: RemoteReply): void { this.setResponseCallback(callback); }
    public async destination(workspace?: string, general = false): Promise<RemoteDestination | undefined> {
        await this._ready;
        if (!this._enabled || !this._accessToken) { return undefined; }
        const root = workspace ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            const facts = JSON.parse(await fs.promises.readFile(path.join(root, '.askaway/webex-spaces.json'), 'utf8'));
            const id = general ? facts.self.generalRoomId : facts.self.workspaceRoomId;
            return id ? { id, general } : undefined;
        }
        return !general && this._roomId ? { id: this._roomId, general } : undefined;
    }
    private async remoteRequest(method: string, endpoint: string, body?: Record<string, unknown> | FormData): Promise<Response> {
        const base = this.remoteOptions.baseUrl ?? WEBEX_API;
        let authRetried = false;
        for (let retry = 0; ; retry++) {
            if (!this.isConfigured()) { throw new Error('Webex not configured.'); }
            const multipart = body instanceof FormData;
            const response = await fetch(`${base.replace(/\/$/, '')}/${endpoint}`, { method, redirect: 'error',
                headers: { Authorization: `Bearer ${this._accessToken}`, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? multipart ? body : JSON.stringify(body) : undefined });
            if (response.status === 401 && !authRetried) {
                authRetried = true;
                if (await this._refreshAccessToken()) { continue; }
            }
            if (response.status !== 429 || retry >= 3) { return response; }
            const value = response.headers.get('Retry-After') ?? '1';
            const seconds = Number(value);
            const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
            await (this.remoteOptions.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(Number.isFinite(delay) ? Math.max(0, delay) : 1000);
        }
    }
    public async sendText(formatted: string, fallback: string, destination?: RemoteDestination, options?: { notify?: boolean }): Promise<RemoteMessageId | undefined> {
        await this._ready;
        if (!this.isConfigured()) { return undefined; }
        try {
            const roomId = String(destination?.id ?? this._roomId);
            // Webhook posts notify but cannot be edited, so only notifying messages use it.
            if (options?.notify && await this.incoming?.configured(roomId)) {
                const id = await this.incoming?.send(roomId, formatted);
                if (id) { this._recordPost(id); }
                return id;
            }
            let response = await this.remoteRequest('POST', 'messages', { roomId, markdown: formatted, text: fallback });
            if (response.status === 400) { response = await this.remoteRequest('POST', 'messages', { roomId, text: fallback }); }
            if (!response.ok) { return undefined; }
            const { id } = await response.json() as { id: string };
            if (id) { this._recordPost(id); }
            return id;
        } catch { return undefined; }
    }
    public async editLive(messageId: RemoteMessageId, formatted: string): Promise<boolean> {
        if (!this.isConfigured()) { return false; }
        try {
            let response = await this.remoteRequest('PUT', `messages/${encodeURIComponent(String(messageId))}`, { roomId: this._roomId, markdown: formatted, text: formatted });
            if (response.status === 400) { response = await this.remoteRequest('PUT', `messages/${encodeURIComponent(String(messageId))}`, { roomId: this._roomId, text: formatted }); }
            return response.ok;
        } catch { return false; }
    }
    public async finishLive(messageId: RemoteMessageId, head: string, markdown: string, taskId: string): Promise<boolean> {
        const id = await this.sendText(`${head}\n\n${markdown}`, `${head}\n\n${markdown}`, undefined, { notify: true });
        if (!id) { return false; }
        try { await this.remoteRequest('DELETE', `messages/${encodeURIComponent(String(messageId))}`); } catch { /* Keep the live message if deletion is unavailable. */ }
        this._activeTasks.set(taskId, { taskId, messageId: String(id), question: markdown, timestamp: Date.now(), handoff: true });
        this._persistMessages();
        this.startPolling();
        return true;
    }
    public async sendDocument(filePath: string, caption: string): Promise<boolean> {
        if (!this.isConfigured()) { return false; }
        try {
            const form = new FormData();
            form.set('roomId', this._roomId!); form.set('text', caption);
            form.set('files', new Blob([new Uint8Array(await fs.promises.readFile(filePath))], { type: filePath.endsWith('.pdf') ? 'application/pdf' : 'text/markdown' }), path.basename(filePath));
            const response = await this.remoteRequest('POST', 'messages', form);
            if (!response.ok) { return false; }
            const { id } = await response.json() as { id: string }; if (id) { this._recordPost(id); }
            return true;
        } catch { return false; }
    }
    public async postQuestion(taskId: string, question: string, choices?: string[]): Promise<void> {
        const id = await this.sendText([question, ...(choices ?? [])].join('\n'), question, undefined, { notify: true });
        if (!id) { return; }
        this._activeTasks.clear();
        this._activeTasks.set(taskId, { taskId, messageId: String(id), question, choices, timestamp: Date.now() });
        this._persistMessages();
        this._resetBackoff();
        this.startPolling();
    }

    private _persistMessages(): void {
        for (const ids of [this._postedMessageIds, this._processedMsgIds]) {
            while (ids.size > 500) { ids.delete(ids.values().next().value!); }
        }
        while (this._activeTasks.size > 500) { this._activeTasks.delete(this._activeTasks.keys().next().value!); }
        if (!this._ledgerPath) { return; }
        fs.mkdirSync(path.dirname(this._ledgerPath), { recursive: true });
        const temporary = `${this._ledgerPath}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ roomId: this._roomId, posted: [...this._postedMessageIds],
            processed: [...this._processedMsgIds], tasks: [...this._activeTasks.values()] }));
        fs.renameSync(temporary, this._ledgerPath);
    }

    private _recordPost(id: string): void {
        this._postedMessageIds.add(id);
        this._persistMessages();
        this._resetBackoff();
    }

    private _headers(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this._accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    // ── OAuth Token Refresh ────────────────────────────────────

    /**
     * Refresh the access token using OAuth refresh_token grant.
     * Persists rotated credentials through the authentication boundary.
     */
    private async _refreshAccessToken(): Promise<string | undefined> {
        if (!this._refreshing) {
            this._refreshing = this._performRefresh().finally(() => { this._refreshing = undefined; });
        }
        return this._refreshing;
    }

    private async _performRefresh(): Promise<string | undefined> {
        if (!this._clientId || !this._clientSecret || !this._refreshToken) {
            return undefined;
        }

        try {
            const clientId = this._clientId;
            const clientSecret = this._clientSecret;
            const refreshToken = this._refreshToken;
            const accessToken = this._accessToken;
            const credentialRevision = this.auth?.revision;
            console.log('AskAway/Webex: Refreshing access token via OAuth...');
            const resp = await fetch('https://webexapis.com/v1/access_token', {
                method: 'POST',
                redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: this._clientId,
                    client_secret: this._clientSecret,
                    refresh_token: this._refreshToken
                }).toString()
            });

            if (!resp.ok) {
                console.error(`AskAway/Webex: Token refresh failed: ${resp.status}`);
                return undefined;
            }

            const data = await resp.json() as {
                access_token: string;
                refresh_token: string;
                expires_in: number;
            };
            if (!isWebexToken(data.access_token) || (data.refresh_token !== undefined && !isWebexToken(data.refresh_token))) {
                throw new Error('Invalid Webex refresh response.');
            }
            if (clientId !== this._clientId || clientSecret !== this._clientSecret || refreshToken !== this._refreshToken || accessToken !== this._accessToken) {
                return this._accessToken;
            }
            if (this.auth) {
                const committed = await this.auth.storeIfCurrent(data.access_token, data.refresh_token, credentialRevision);
                if (!committed || this.auth.revision !== credentialRevision! + 1 || clientId !== this._clientId || clientSecret !== this._clientSecret ||
                    (this._refreshToken !== refreshToken && this._refreshToken !== data.refresh_token) ||
                    (this._accessToken !== accessToken && this._accessToken !== data.access_token)) {
                    return this._accessToken;
                }
            }

            // Update in-memory token
            this._accessToken = data.access_token;
            this._myPersonId = undefined; // re-cache identity

            // Webex rotates the refresh token.
            if (data.refresh_token && data.refresh_token !== this._refreshToken) {
                this._refreshToken = data.refresh_token;
            }

            // Also save to token file if configured
            if (!this.auth && this._tokenFilePath) {
                try {
                    const resolved = this._tokenFilePath.startsWith('~')
                        ? path.join(os.homedir(), this._tokenFilePath.slice(1))
                        : this._tokenFilePath;
                    const json = JSON.stringify({ access_token: data.access_token }, null, 2);
                    fs.writeFileSync(resolved, json, 'utf8');
                    console.log('AskAway/Webex: Access token saved to file');
                } catch (e) {
                    console.warn('AskAway/Webex: Could not save token to file.');
                }
            }

            this._tokenExpiredNotified = false;
            console.log('AskAway/Webex: Token refreshed successfully.');
            return data.access_token;
        } catch (e) {
            console.error('AskAway/Webex: Token refresh error.');
            return undefined;
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────

    /** Track whether we already showed a token-expired notification this session */
    private _tokenExpiredNotified: boolean = false;

    /**
     * Handle 401 Unauthorized: try OAuth refresh first, then file reload, then notify user.
     * Returns true if the token was successfully refreshed.
     */
    private async _handleTokenExpiry(): Promise<boolean> {
        // 1. Try OAuth refresh (automatic, no user action needed)
        if (this.hasOAuthCredentials()) {
            const newToken = await this._refreshAccessToken();
            if (newToken) {
                return true;
            }
        }

        // 2. Try to reload token from file (file may have been updated externally)
        if (this._tokenFilePath) {
            const newToken = this._loadTokenFromFile(this._tokenFilePath);
            if (newToken && newToken !== this._accessToken) {
                this._accessToken = newToken;
                this._myPersonId = undefined;
                this._tokenExpiredNotified = false;
                console.log('AskAway/Webex: Token refreshed from file');
                return true;
            }
        }

        // 3. Token still invalid — notify user once
        if (!this._tokenExpiredNotified) {
            this._tokenExpiredNotified = true;
            const action = await vscode.window.showWarningMessage(
                'AskAway: Webex token expired (401). Please update your token or configure OAuth credentials.',
                'Open Settings',
                'Dismiss'
            );
            if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.webex');
            }
        }
        return false;
    }

    public start() {
        void this._ready.then(() => {
            if (this.isConfigured()) { this._cacheMyId().catch(() => {}); }
        });
    }

    public stop() {
        this.stopPolling();
    }

    public dispose() {
        this.stop();
    }

    /** Cache the bot/user person ID so we don't call /people/me on every poll */
    private async _cacheMyId(): Promise<void> {
        if (this._myPersonId || !this._accessToken) { return; }
        try {
            const resp = await fetch(`${WEBEX_API}/people/me`, { headers: this._headers() });
            if (resp.ok) {
                const me = await resp.json() as any;
                this._myPersonId = me.id;
            }
        } catch { /* ignore */ }
    }

    // ── Markdown → Adaptive Card helpers ──────────────────────

    /**
     * Convert a markdown question into an array of Adaptive Card body elements.
     * Webex Adaptive Cards support a subset of markdown inside TextBlock:
     *   - **bold**, _italic_, [links](url), `code`, and line breaks via \n
     * We split multi-line content into logical blocks for better rendering.
     */
    private _markdownToCardBody(markdown: string): any[] {
        const body: any[] = [];

        // Split on double-newlines to create separate TextBlocks (paragraph-level)
        const paragraphs = markdown.split(/\n{2,}/);
        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (!trimmed) { continue; }

            // Check if this is a code block (```...```)
            if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
                const codeContent = trimmed.slice(trimmed.indexOf('\n') + 1, trimmed.lastIndexOf('```')).trim();
                body.push({
                    "type": "TextBlock",
                    "text": codeContent,
                    "wrap": true,
                    "fontType": "Monospace",
                    "size": "Small"
                });
            } else if (trimmed.startsWith('```')) {
                // Fenced code block that spans the whole remaining content
                body.push({
                    "type": "TextBlock",
                    "text": trimmed.replace(/```\w*\n?/, '').replace(/```$/, '').trim(),
                    "wrap": true,
                    "fontType": "Monospace",
                    "size": "Small"
                });
            } else {
                // Regular text — preserve single newlines within the paragraph
                body.push({
                    "type": "TextBlock",
                    "text": trimmed,
                    "wrap": true
                });
            }
        }

        return body;
    }

    // ── Post plain message ────────────────────────────────────

    /** Post a plain markdown message (no card, no reply tracking). Used for turn-end handoffs, which must notify. */
    public async postText(markdown: string, fallback: string): Promise<boolean> {
        await this._ready;
        if (!this.isConfigured() || !markdown.trim()) { return false; }
        const id = await this.sendText(markdown, fallback, undefined, { notify: true });
        if (!id) { this.logger?.appendLine('AskAway/Webex: postText failed.'); }
        return !!id;
    }

    // ── Post Adaptive Card ────────────────────────────────────

    public async postAdaptiveCard(taskId: string, question: string, choices?: string[]): Promise<void> {
        await this._ready;
        if (!this.isConfigured()) {
            return;
        }

        // Build card body
        const cardBody: any[] = [];

        // Header
        cardBody.push({
            "type": "TextBlock",
            "text": "🔔 AskAway — Input Required",
            "weight": "Bolder",
            "size": "Medium",
            "color": "Accent"
        });

        // Separator
        cardBody.push({
            "type": "ColumnSet",
            "columns": [
                { "type": "Column", "width": "stretch", "items": [{ "type": "TextBlock", "text": " ", "size": "Small" }] }
            ],
            "separator": true
        });

        // Question body — convert markdown to multiple TextBlocks
        const questionBlocks = this._markdownToCardBody(question);
        cardBody.push(...questionBlocks);

        // Choices (if any)
        if (choices && choices.length > 0) {
            cardBody.push({ "type": "TextBlock", "text": " ", "size": "Small", "spacing": "Small" }); // spacer
            const choiceList = choices.map((c, i) => `${i + 1}. ${c}`).join('  \n');
            cardBody.push({
                "type": "TextBlock",
                "text": choiceList,
                "wrap": true,
                "weight": "Bolder",
                "size": "Small"
            });
        }

        // Status row
        cardBody.push({
            "type": "ColumnSet",
            "separator": true,
            "spacing": "Medium",
            "columns": [
                {
                    "type": "Column",
                    "width": "auto",
                    "items": [{ "type": "TextBlock", "text": "Status:", "weight": "Bolder", "size": "Small" }]
                },
                {
                    "type": "Column",
                    "width": "stretch",
                    "items": [{ "type": "TextBlock", "text": "⏳ Awaiting Response", "size": "Small", "color": "Attention" }]
                }
            ]
        });

        // Files changed (collapsible via ToggleVisibility)
        const changedFiles = this._consumeFileChanges();
        if (changedFiles.length > 0) {
            const fileListText = changedFiles.slice(0, 15).map(f => `• ${f}`).join('\n');
            const extra = changedFiles.length > 15
                ? `\n... and ${changedFiles.length - 15} more`
                : '';

            // Toggle button
            cardBody.push({
                "type": "ActionSet",
                "separator": true,
                "spacing": "Small",
                "actions": [{
                    "type": "Action.ToggleVisibility",
                    "title": `📁 Files Changed (${changedFiles.length})`,
                    "targetElements": ["filesChangedContainer"]
                }]
            });

            // Hidden container (shown on toggle)
            cardBody.push({
                "type": "Container",
                "id": "filesChangedContainer",
                "isVisible": false,
                "items": [{
                    "type": "TextBlock",
                    "text": fileListText + extra,
                    "wrap": true,
                    "size": "Small",
                    "fontType": "Monospace",
                    "isSubtle": true
                }]
            });
        }

        // Thread-reply instruction
        cardBody.push({
            "type": "TextBlock",
            "text": "💬 **Reply to this thread** with your answer.",
            "wrap": true,
            "size": "Small",
            "isSubtle": true,
            "spacing": "Medium"
        });

        // Task ID footer
        cardBody.push({
            "type": "TextBlock",
            "text": `Task ID: ${taskId}`,
            "size": "Small",
            "isSubtle": true,
            "spacing": "None"
        });

        // Fallback text for clients that don't render cards
        const fallbackText = `AskAway Question [${taskId}]: ${question.substring(0, 200)}${question.length > 200 ? '...' : ''}`;

        const payload = {
            roomId: this._roomId,
            text: fallbackText,
            attachments: [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "type": "AdaptiveCard",
                    "version": CARD_VERSION,
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "body": cardBody
                }
            }]
        };

        try {
            const response = await fetch(`${WEBEX_API}/messages`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`AskAway/Webex: Failed to post card: ${response.status} ${errorText}`);
                if (response.status === 401) {
                    const refreshed = await this._handleTokenExpiry();
                    if (refreshed) {
                        // Retry once with new token
                        return this.postAdaptiveCard(taskId, question, choices);
                    }
                }
                return;
            }

            const msg = await response.json() as any;
            if (msg.id) { this._recordPost(msg.id); }
            console.log(`AskAway/Webex: Posted task ${taskId} (msgId: ${msg.id})`);

            this._activeTasks.set(taskId, {
                taskId,
                messageId: msg.id,
                question,
                choices,
                timestamp: Date.now()
            });

            // Reset backoff and ensure polling is running
            this._persistMessages();
            this._resetBackoff();
            this.startPolling();
        } catch (error) {
            console.error('AskAway/Webex: Error posting card:', error);
        }
    }

    // ── Polling for Thread Replies (with backoff) ─────────────

    private startPolling() {
        if (this._pollingTimer) { return; }
        this._pollTickIndex = 0;
        this._pollCount = 0;
        this._scheduleNextPoll();
        console.log('AskAway/Webex: Polling started (backoff schedule: ' + POLL_BACKOFF_SCHEDULE_S.join('s, ') + 's).');
    }

    /** Schedule the next poll tick according to the backoff schedule */
    private _scheduleNextPoll() {
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
        }
        const delaySec = POLL_BACKOFF_SCHEDULE_S[
            Math.min(this._pollTickIndex, POLL_BACKOFF_SCHEDULE_S.length - 1)
        ];
        this._pollingTimer = setTimeout(() => { this._pollingTimer = undefined; return this._poll(); }, delaySec * 1000);
    }

    /** Reset backoff to the beginning (e.g. after a new card is posted) */
    private _resetBackoff() {
        this._pollTickIndex = 0;
        this._pollCount = 0;
        if (this._pollingTimer) { this._scheduleNextPoll(); }
    }

    private stopPolling() {
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
            this._pollingTimer = undefined;
            console.log('AskAway/Webex: Polling stopped.');
        }
    }

    private async _poll() {
        if (this._polling) { return; }
        this._polling = true;
        try {
        if (!this.isConfigured() || this._activeTasks.size === 0) {
            this.stopPolling();
            return;
        }

        // Check if Copilot conversation appears stale (idle > threshold)
        if (this._lastCopilotActivity > 0) {
            const idleMs = Date.now() - this._lastCopilotActivity;
            if (idleMs > this._copilotIdleThresholdMs) {
                console.log(`AskAway/Webex: Copilot idle for ${Math.round(idleMs / 1000)}s — stopping poll (conversation likely ended).`);
                this.stopPolling();
                return;
            }
        }

        this._pollCount++;
        const currentDelaySec = POLL_BACKOFF_SCHEDULE_S[
            Math.min(this._pollTickIndex, POLL_BACKOFF_SCHEDULE_S.length - 1)
        ];
        console.log(`AskAway/Webex: Poll #${this._pollCount} (interval: ${currentDelaySec}s, tick: ${this._pollTickIndex})`);

        const now = Date.now();

        // Expire old tasks (36 hours)
        for (const [taskId, task] of this._activeTasks.entries()) {
            if (now - task.timestamp > EXPIRY_MS) {
                console.log(`AskAway/Webex: Task ${taskId} expired (36h).`);
                await this._updateCardStatus(task, 'expired');
                this._activeTasks.delete(taskId);
                this._persistMessages();
            }
        }

        if (this._activeTasks.size === 0) {
            this.stopPolling();
            return;
        }

        let activity = false;
        let roomReplies: any[] = [];
        try {
            const response = await this.remoteRequest('GET', `messages?roomId=${encodeURIComponent(this._roomId!)}&max=100`);
            if (response.ok) { roomReplies = (await response.json() as { items: any[] }).items || []; }
        } catch { /* Thread polling can still succeed when listing the space fails. */ }
        // Poll thread replies for each active task
        for (const [taskId, task] of this._activeTasks.entries()) {
            try {
                const url = `${WEBEX_API}/messages?roomId=${this._roomId}&parentId=${task.messageId}&max=10`;
                console.log(`AskAway/Webex: Polling URL: ${url}`);
                const resp = task.messageId.startsWith('incoming:') ? new Response(JSON.stringify({ items: [] })) :
                    await this.remoteRequest('GET', `messages?roomId=${encodeURIComponent(this._roomId!)}&parentId=${encodeURIComponent(task.messageId)}&max=10`);

                if (!resp.ok) { 
                    console.log(`AskAway/Webex: Poll failed ${resp.status} ${resp.statusText}`);
                    if (resp.status === 401) {
                        await this._handleTokenExpiry();
                        return; // skip rest of this poll cycle
                    }
                    if (resp.status === 404) {
                        // 404 = "no thread exists yet" — normal when nobody has replied in-thread.
                        // Don't remove the task; just wait. Task will expire via 36h timeout.
                        console.log(`AskAway/Webex: Task ${taskId} — no thread yet (404). Waiting for reply.`);
                    }
                    continue; 
                }

                const data = await resp.json() as { items: any[] };
                const latestHandoff = [...this._activeTasks.values()].filter(item => item.handoff).sort((a, b) => b.timestamp - a.timestamp)[0];
                const webhookParents = new Set(roomReplies.filter(isIncomingWebhookSender).map(reply => reply.id));
                const replies = [...(data.items || []), ...roomReplies.filter(reply => !reply.parentId || reply.parentId === task.messageId ||
                    (latestHandoff?.taskId === taskId && webhookParents.has(reply.parentId)))]
                    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
                console.log(`AskAway/Webex: Found ${replies.length} replies for task ${taskId}`);

                for (const reply of replies) {
                    if (isIncomingWebhookSender(reply)) { continue; }
                    if (this._processedMsgIds.has(reply.id) || this._postedMessageIds.has(reply.id)) { continue; }
                    if (!this._activeTasks.has(taskId) || !this.isConfigured()) { break; }
                    if (reply.created && Date.parse(reply.created) < task.timestamp) { continue; }

                    // Collect the full text (could be multi-line)
                    const answer = (reply.text || '').trim();
                    const userEmail = reply.personEmail || 'unknown';

                    if (!answer) { continue; }
                    this._processedMsgIds.add(reply.id);
                    this._activeTasks.delete(taskId);
                    this._persistMessages();
                    activity = true;
                    this._resetBackoff();

                    console.log(`AskAway/Webex: Reply for ${taskId} from ${userEmail}: "${answer.substring(0, 80)}..."`);

                    // Notify AskAway
                    if (this._onResponseReceived) {
                        await this._onResponseReceived(taskId, answer, userEmail);
                    }

                    // Update card to "Resolved"
                    await this._updateCardStatus(task, 'resolved', answer, `${userEmail} (via Webex)`);
                    this._activeTasks.delete(taskId);
                    break; // one reply per task
                }
            } catch (e) {
                console.error(`AskAway/Webex: Polling error for ${taskId}:`, e);
            }
        }

        if (this._activeTasks.size === 0) {
            this.stopPolling();
        } else {
            // Advance backoff and schedule next poll
            if (!activity) { this._pollTickIndex++; }
            this._scheduleNextPoll();
        }
        } finally { this._polling = false; }
    }

    // ── Update Card Status ────────────────────────────────────

    private async _updateCardStatus(task: TrackedTask, status: string, answer?: string, user?: string) {
        if (!this._accessToken || !this._roomId) { return; }

        const body: any[] = [
            { "type": "TextBlock", "text": "🔔 AskAway — Task Request", "weight": "Bolder", "size": "Medium", "color": "Accent" }
        ];

        // Re-render the original question using markdown conversion
        const questionBlocks = this._markdownToCardBody(task.question);
        body.push(...questionBlocks);

        if (status === 'resolved') {
            body.push(
                { "type": "TextBlock", "text": "Status: ✅ Answered", "color": "Good", "weight": "Bolder", "separator": true, "spacing": "Medium" }
            );
            // Render the response (could be multi-line)
            if (answer) {
                body.push({ "type": "TextBlock", "text": "**Response:**", "size": "Small", "weight": "Bolder" });
                const answerBlocks = this._markdownToCardBody(answer);
                body.push(...answerBlocks);
            }
            if (user) {
                body.push({ "type": "TextBlock", "text": `Submitted by: ${user}`, "size": "Small", "isSubtle": true });
            }
        } else if (status === 'expired') {
            body.push(
                { "type": "TextBlock", "text": "Status: ⚠️ Expired — No response within 36 hours.", "color": "Warning", "weight": "Bolder", "separator": true, "spacing": "Medium" }
            );
        } else {
            body.push(
                { "type": "TextBlock", "text": `Status: ${status}`, "size": "Small", "separator": true }
            );
        }

        body.push({ "type": "TextBlock", "text": `Task ID: ${task.taskId}`, "size": "Small", "isSubtle": true, "spacing": "None" });

        const fallbackText = status === 'resolved'
            ? `Task answered: ${(answer || '').substring(0, 100)}`
            : `Task ${status}: ${task.question.substring(0, 100)}`;

        try {
            const resp = await this.remoteRequest('PUT', `messages/${encodeURIComponent(task.messageId)}`, {
                    roomId: this._roomId,
                    text: fallbackText,
                    attachments: [{
                        "contentType": "application/vnd.microsoft.card.adaptive",
                        "content": {
                            "type": "AdaptiveCard",
                            "version": CARD_VERSION,
                            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                            "body": body
                        }
                    }]
            });
            if (resp.ok) {
                console.log(`AskAway/Webex: Card updated → "${status}" for ${task.taskId}`);
            } else {
                const errText = await resp.text();
                console.error(`AskAway/Webex: Card update failed (${resp.status}): ${errText}`);
            }
        } catch (e) {
            console.error('AskAway/Webex: Failed to update card:', e);
        }
    }

    // ── Called when user responds in VS Code ──────────────────

    public async onLocalResponse(taskId: string, answer: string, user: string) {
        const task = this._activeTasks.get(taskId);
        if (task) {
            await this._updateCardStatus(task, 'resolved', answer, `${user} (via VS Code)`);
            this._activeTasks.delete(taskId);
            this._persistMessages();
        }
    }

    // ── Public getters for UI ─────────────────────────────────

    public getActiveTaskCount(): number {
        return this._activeTasks.size;
    }

    public isEnabled(): boolean {
        return this._enabled;
    }

    /** Get detailed token/connection status for the settings UI */
    public getTokenStatus(): {
        status: 'connected' | 'token-missing' | 'token-expired' | 'incomplete' | 'disabled';
        tokenSource: 'oauth' | 'file' | 'setting' | 'none';
        hasOAuth: boolean;
        hasToken: boolean;
        hasRoomId: boolean;
        isPolling: boolean;
        activeTasks: number;
        message: string;
        hint: string;
    } {
        if (!this._enabled) {
            return {
                status: 'disabled',
                tokenSource: 'none',
                hasOAuth: this.hasOAuthCredentials(),
                hasToken: !!this._accessToken,
                hasRoomId: !!this._roomId,
                isPolling: !!this._pollingTimer,
                activeTasks: this._activeTasks.size,
                message: 'Webex integration is disabled.',
                hint: 'Enable it in Settings → askaway.webex.enabled'
            };
        }

        const hasOAuth = this.hasOAuthCredentials();
        const hasToken = !!this._accessToken;
        const hasRoomId = !!this._roomId;
        const isPolling = !!this._pollingTimer;

        if (hasToken && this.setupFailure) {
            return { status: 'incomplete', tokenSource: 'oauth', hasOAuth, hasToken, hasRoomId, isPolling,
                activeTasks: this._activeTasks.size, message: `Signed in; space creation failed: ${this.setupFailure}`,
                hint: 'Reauthorize with the registered spark:rooms_write scope.' };
        }

        let tokenSource: 'oauth' | 'file' | 'setting' | 'none' = 'none';
        if (hasToken) {
            if (this._tokenFilePath && this._loadTokenFromFile(this._tokenFilePath)) {
                tokenSource = 'file';
            } else if (hasOAuth) {
                tokenSource = 'oauth';
            } else {
                tokenSource = 'setting';
            }
        }

        if (this._tokenExpiredNotified) {
            return {
                status: 'token-expired',
                tokenSource,
                hasOAuth,
                hasToken: false,
                hasRoomId,
                isPolling,
                activeTasks: this._activeTasks.size,
                message: 'Access token has expired.',
                hint: hasOAuth
                    ? 'OAuth auto-refresh is configured — run "AskAway: Authorize Webex" to re-authorize.'
                    : 'Update your token in Settings → askaway.webex.accessToken or set up OAuth credentials.'
            };
        }

        if (!hasToken && !hasOAuth) {
            return {
                status: 'token-missing',
                tokenSource: 'none',
                hasOAuth: false,
                hasToken: false,
                hasRoomId,
                isPolling,
                activeTasks: this._activeTasks.size,
                message: 'No access token configured.',
                hint: 'Set a token in Settings → askaway.webex.accessToken, or configure OAuth (clientId + clientSecret + refreshToken).'
            };
        }

        if (!hasRoomId) {
            return {
                status: 'incomplete',
                tokenSource,
                hasOAuth,
                hasToken,
                hasRoomId: false,
                isPolling,
                activeTasks: this._activeTasks.size,
                message: 'Missing Webex Room ID.',
                hint: 'Set the room/space ID in Settings → askaway.webex.roomId'
            };
        }

        return {
            status: 'connected',
            tokenSource,
            hasOAuth,
            hasToken: true,
            hasRoomId: true,
            isPolling,
            activeTasks: this._activeTasks.size,
            message: 'Webex integration is active.',
            hint: isPolling
                ? `Polling for replies (${this._activeTasks.size} active task${this._activeTasks.size !== 1 ? 's' : ''}).`
                : 'Ready — will start polling when a question is posted.'
        };
    }

    /** Track a file change for inclusion in the next Adaptive Card */
    public trackFileChange(relativePath: string) {
        if (!this._recentFileChanges.includes(relativePath)) {
            this._recentFileChanges.push(relativePath);
        }
    }

    /** Get and clear the tracked file changes */
    private _consumeFileChanges(): string[] {
        const changes = [...this._recentFileChanges];
        this._recentFileChanges = [];
        return changes;
    }

    // ── Copilot Activity Tracking ─────────────────────────────

    /**
     * Called by the extension whenever Copilot/tool activity is detected.
     * Resets the idle timer so polling continues.
     */
    public notifyCopilotActivity() {
        this._lastCopilotActivity = Date.now();
    }

    /**
     * Called when a Copilot conversation is known to have ended (e.g. cancellation).
     * Immediately marks all remaining tasks as stale and stops polling.
     */
    public notifyCopilotStopped() {
        console.log('AskAway/Webex: Copilot stopped — expiring active Webex tasks.');
        for (const [taskId, task] of this._activeTasks.entries()) {
            this._updateCardStatus(task, 'expired').catch(() => {});
        }
        this._activeTasks.clear();
        this.stopPolling();
    }

    /**
     * Post a progress update to a Webex room as a simple text message.
     * This lets remote users see what Copilot is doing without waiting for the final result.
     */
    public async postProgressUpdate(summary: string): Promise<void> {
        if (!this.isConfigured() || this._activeTasks.size === 0) { return; }

        try {
            // Find the most recent active task to thread under
            const latestTask = Array.from(this._activeTasks.values()).sort((a, b) => b.timestamp - a.timestamp)[0];
            if (!latestTask) { return; }

            const payload = {
                roomId: this._roomId,
                parentId: latestTask.messageId,
                text: `📋 **Copilot Progress:**\n${summary}`
            };
            await fetch(`${WEBEX_API}/messages`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(payload)
            });
            console.log('AskAway/Webex: Posted progress update.');
        } catch (e) {
            console.error('AskAway/Webex: Failed to post progress update:', e);
        }
    }
}
