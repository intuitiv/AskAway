import * as vscode from 'vscode';
import { CONFIG_NAMESPACE } from '../constants/branding';

// ── Interfaces ─────────────────────────────────────────────────

interface TrackedTask {
    taskId: string;
    messageId: number;   // Telegram message_id of the posted question
    question: string;
    choices?: string[];
    timestamp: number;
    /** Rendered HTML body (without footer) — used when editing for sync-time updates */
    formattedText: string;
}

// ── Constants ──────────────────────────────────────────────────

// Quick ramp-up schedule before switching to configurable steady interval.
const INITIAL_POLL_BACKOFF_SCHEDULE_S = [2, 2, 5, 10, 30];
const LONG_WAIT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const LONG_WAIT_INTERVAL_SECONDS = 4 * 60; // 4 minutes
const EXPIRY_MS = 36 * 60 * 60 * 1000;  // 36 hours
const TELEGRAM_API = 'https://api.telegram.org/bot';

// ── Service ────────────────────────────────────────────────────

export class TelegramService {
    private _out: vscode.OutputChannel | undefined;
    private _enabled: boolean = false;
    private _botToken: string | undefined;
    private _chatId: string | undefined;
    private _pollingTimer: NodeJS.Timeout | undefined;
    private _activeTasks: Map<string, TrackedTask> = new Map();
    private _lastUpdateId: number = 0;  // Telegram getUpdates offset
    private _onResponseReceived: ((taskId: string, response: string, user: string) => void) | undefined;

    // ── Backoff polling state ──
    private _pollTickIndex: number = 0;
    private _pollCount: number = 0;
    private _pollingStartedAtMs: number = 0;

    // ── Copilot activity tracking ──
    private _lastCopilotActivity: number = 0;
    private _copilotIdleThresholdMs: number = 0;

    // ── Polling configuration ──
    private _steadyPollIntervalSeconds: number = 60;

    // ── File change tracking ──
    private _recentFileChanges: string[] = [];

    // ── Bot info ──
    private _botId: number | undefined;

    // ── Heartbeat ──
    private _heartbeatTimer: NodeJS.Timeout | undefined;
    private _heartbeatIntervalMs: number = 10 * 60 * 1000;  // 10 min default
    private _lastHeartbeatMsgId: number | undefined;
    private _lastStatusSentAt: number = 0;

    constructor(outputChannel?: vscode.OutputChannel) {
        this._out = outputChannel;
        this.reloadConfig();
    }

    private _log(msg: string): void {
        const line = `[${new Date().toISOString()}] ${msg}`;
        this._out?.appendLine(line);
        console.log(msg);
    }

    private _warn(msg: string): void {
        const line = `[${new Date().toISOString()}] WARN: ${msg}`;
        this._out?.appendLine(line);
        console.warn(msg);
    }

    private _err(msg: string, error?: unknown): void {
        const detail = error instanceof Error ? ` — ${error.message}` : (error ? ` — ${error}` : '');
        const line = `[${new Date().toISOString()}] ERROR: ${msg}${detail}`;
        this._out?.appendLine(line);
        console.error(msg, error ?? '');
    }

    // ── Configuration ──────────────────────────────────────────

    public reloadConfig() {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        this._enabled = config.get<boolean>('telegram.enabled', false);
        this._botToken = config.get<string>('telegram.botToken', '') || undefined;
        this._chatId = config.get<string>('telegram.chatId', '') || undefined;

        const configuredRetrySec = config.get<number>('telegram.retryIntervalSeconds', 60);
        // Allowed bounds: 10s to 15min for steady polling interval.
        this._steadyPollIntervalSeconds = Math.min(900, Math.max(10, Math.floor(configuredRetrySec || 60)));

        const configuredIdleMinutes = config.get<number>('telegram.idlePauseMinutes', 0);
        // 0 disables idle-pause, otherwise clamp to 1 minute..12 hours.
        const idleMinutes = Math.min(720, Math.max(0, Math.floor(configuredIdleMinutes || 0)));
        this._copilotIdleThresholdMs = idleMinutes > 0 ? idleMinutes * 60 * 1000 : 0;

        this._log(
            `AskAway/Telegram: Config reloaded — enabled=${this._enabled}, hasToken=${!!this._botToken}, hasChatId=${!!this._chatId}, retry=${this._steadyPollIntervalSeconds}s, idlePause=${idleMinutes}m`
        );

        // Re-evaluate polling state
        if (this._enabled && this._botToken && this._chatId && this._activeTasks.size > 0) {
            this.startPolling();
        } else if (!this._enabled || !this._botToken) {
            this.stopPolling();
        }
    }

    public isConfigured(): boolean {
        return this._enabled && !!this._botToken && !!this._chatId;
    }

    public isEnabled(): boolean {
        return this._enabled;
    }

    public setResponseCallback(callback: (taskId: string, response: string, user: string) => void) {
        this._onResponseReceived = callback;
    }

    /** Get detailed status for settings UI */
    public getTokenStatus(): {
        status: 'connected' | 'token-missing' | 'incomplete' | 'disabled';
        hasToken: boolean;
        hasChatId: boolean;
        isPolling: boolean;
        activeTasks: number;
        message: string;
        hint: string;
    } {
        if (!this._enabled) {
            return {
                status: 'disabled',
                hasToken: !!this._botToken,
                hasChatId: !!this._chatId,
                isPolling: !!this._pollingTimer,
                activeTasks: this._activeTasks.size,
                message: 'Telegram integration is disabled.',
                hint: 'Enable it in Settings → askaway.telegram.enabled'
            };
        }

        if (!this._botToken) {
            return {
                status: 'token-missing',
                hasToken: false,
                hasChatId: !!this._chatId,
                isPolling: !!this._pollingTimer,
                activeTasks: this._activeTasks.size,
                message: 'No bot token configured.',
                hint: 'Create a bot via @BotFather on Telegram, then set the token in Settings → askaway.telegram.botToken'
            };
        }

        if (!this._chatId) {
            return {
                status: 'incomplete',
                hasToken: true,
                hasChatId: false,
                isPolling: !!this._pollingTimer,
                activeTasks: this._activeTasks.size,
                message: 'Missing Chat ID.',
                hint: 'Send a message to your bot, then use "AskAway: Get Telegram Chat ID" command, or set it in Settings → askaway.telegram.chatId'
            };
        }

        return {
            status: 'connected',
            hasToken: true,
            hasChatId: true,
            isPolling: !!this._pollingTimer,
            activeTasks: this._activeTasks.size,
            message: 'Telegram integration is active.',
            hint: this._pollingTimer
                ? `Polling for replies (${this._activeTasks.size} active task${this._activeTasks.size !== 1 ? 's' : ''}).`
                : 'Ready — will start polling when a question is posted.'
        };
    }

    // ── Telegram API helpers ───────────────────────────────────

    private _apiUrl(method: string): string {
        return `${TELEGRAM_API}${this._botToken}/${method}`;
    }

    /** Cache the bot's own user ID to ignore its own messages */
    private async _cacheBotId(): Promise<void> {
        if (this._botId) { return; }
        try {
            const resp = await fetch(this._apiUrl('getMe'));
            if (resp.ok) {
                const data = await resp.json() as any;
                this._botId = data.result?.id;
                this._log(`AskAway/Telegram: Bot ID cached: ${this._botId}`);
            } else {
                this._warn(`AskAway/Telegram: getMe failed ${resp.status}`);
            }
        } catch (e) {
            this._warn(`AskAway/Telegram: Failed to get bot info: ${e}`);
        }
    }

    // ── Post Question ──────────────────────────────────────────

    /**
     * Post a question to Telegram as a formatted message.
     * If choices are provided, includes inline keyboard buttons.
     */
    public async postQuestion(taskId: string, question: string, choices?: string[]): Promise<void> {
        this._log(`AskAway/Telegram: postQuestion called — taskId=${taskId}, enabled=${this._enabled}, hasToken=${!!this._botToken}, hasChatId=${!!this._chatId}`);
        if (!this.isConfigured()) {
            this._log(`AskAway/Telegram: SKIPPED — not configured (enabled=${this._enabled}, token=${!!this._botToken}, chatId=${!!this._chatId})`);
            return;
        }

        // Stop heartbeat — we have a new pending question now
        this._stopHeartbeat();
        this.resetHeartbeatMessage();

        try {
            // Format the message with HTML (more reliable than MarkdownV2)
            const fileChanges = this._consumeFileChanges();
            let text = `🔔 <b>AskAway — Question</b>\n\n${this._markdownToHtml(question)}`;

            if (choices && choices.length > 0) {
                text += '\n\n<b>Options:</b>\n';
                choices.forEach((c, i) => {
                    text += `${i + 1}. ${this._escapeHtml(c)}\n`;
                });
                text += '\n<i>Reply with the option number or your answer.</i>';
            } else {
                text += '\n\n<i>Reply to this message with your answer.</i>';
            }

            if (fileChanges.length > 0) {
                text += '\n\n📁 <b>Recent Changes:</b>\n';
                const displayFiles = fileChanges.slice(0, 10);
                displayFiles.forEach(f => {
                    text += `• <code>${this._escapeHtml(f)}</code>\n`;
                });
                if (fileChanges.length > 10) {
                    text += `<i>... and ${fileChanges.length - 10} more</i>\n`;
                }
            }

            // Build request body
            const body: any = {
                chat_id: this._chatId,
                text: text,
                parse_mode: 'HTML'
            };

            // Add inline keyboard for choices
            if (choices && choices.length > 0) {
                body.reply_markup = {
                    inline_keyboard: choices.map(c => ([{
                        text: c,
                        callback_data: `askaway:${taskId}:${c.substring(0, 60)}`
                    }]))
                };
            }

            const response = await fetch(this._apiUrl('sendMessage'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                this._err(`AskAway/Telegram: SEND FAILED ${response.status}: ${errorText}`);
                return;
            }

            const result = await response.json() as any;
            const messageId = result.result?.message_id;
            this._log(`AskAway/Telegram: ✅ Message sent — taskId=${taskId}, msgId=${messageId}`);

            this._activeTasks.set(taskId, {
                taskId,
                messageId,
                question,
                choices,
                timestamp: Date.now(),
                formattedText: text   // store rendered HTML body for footer edits
            });

            // Always restart polling from scratch so new questions get fast retries
            // even if a previous polling cycle was still running.
            this.stopPolling();
            this._resetBackoff();
            this.startPolling();
        } catch (error) {
            this._err('AskAway/Telegram: Error posting message', error);
        }
    }

    /** Escape special characters for Telegram HTML */
    private _escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Convert Markdown to Telegram-compatible HTML.
     * Protects code blocks and tables from inline-formatting regexes by
     * extracting them first, processing the remaining text, then restoring.
     *
     * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>,
     * <a href>, <blockquote>.  No <table>/<h1> etc.
     */
    private _markdownToHtml(text: string): string {
        const preserved: string[] = [];
        const hold = (html: string): string => {
            const i = preserved.length;
            preserved.push(html);
            return `\x00P${i}\x00`;
        };

        let r = text;

        // ── 1. Fenced code blocks ```lang\n…\n``` ──
        r = r.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
            const esc = this._escapeHtml(code.replace(/\n$/, ''));
            const attr = lang ? ` class="language-${lang}"` : '';
            return hold(`<pre><code${attr}>${esc}</code></pre>`);
        });

        // ── 2. Inline code `…` ──
        r = r.replace(/`([^`\n]+?)`/g, (_m, code: string) =>
            hold(`<code>${this._escapeHtml(code)}</code>`)
        );

        // ── 3. Markdown tables → box-drawing <pre> ──
        r = r.replace(/(?:^\|.+\|[ \t]*$\n?)+/gm, (block) =>
            hold(this._formatTable(block))
        );

        // ── 4. Escape remaining HTML chars ──
        r = r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // ── 5. Headings (#…######) → bold ──
        r = r.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

        // ── 6. Bold **…** / __…__ ──
        r = r.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
        r = r.replace(/__([\s\S]+?)__/g, '<b>$1</b>');

        // ── 7. Italic *…* / _…_ (single markers) ──
        r = r.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>');
        r = r.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>');

        // ── 8. Strikethrough ~~…~~ ──
        r = r.replace(/~~(.+?)~~/g, '<s>$1</s>');

        // ── 9. Links [text](url) — must run before image strip ──
        r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">🖼 $1</a>');
        r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

        // ── 10. Blockquotes (&gt; lines) ──
        r = r.replace(/(?:^&gt;\s?(.*)$\n?)+/gm, (match) => {
            const lines = match.split('\n')
                .filter(l => l.startsWith('&gt;'))
                .map(l => l.replace(/^&gt;\s?/, ''));
            return `<blockquote>${lines.join('\n')}</blockquote>\n`;
        });

        // ── 11. Horizontal rules ──
        r = r.replace(/^[-*_]{3,}\s*$/gm, '─────────────────────');

        // ── 12. Bullet lists (- item, * item, + item) → • item ──
        r = r.replace(/^[ \t]*[-*+]\s+(.+)$/gm, '  • $1');

        // ── 13. Numbered lists (1. item) — keep as-is but ensure consistent indent ──
        r = r.replace(/^[ \t]*(\d+)\.\s+(.+)$/gm, '  $1. $2');

        // ── 14. Task lists ──
        r = r.replace(/• \[ \]\s*/g, '☐ ');
        r = r.replace(/• \[x\]\s*/gi, '☑ ');

        // ── 15. Restore protected blocks ──
        r = r.replace(/\x00P(\d+)\x00/g, (_, idx) => preserved[parseInt(idx)]);

        return r;
    }

    /**
     * Convert a markdown table block into a Unicode box-drawing table
     * wrapped in <pre> for Telegram (which has no native HTML table support).
     */
    private _formatTable(block: string): string {
        const rows = block.trim().split('\n').filter(r => r.trim());
        if (rows.length < 2) { return `<pre>${this._escapeHtml(block)}</pre>`; }

        const parsed: string[][] = [];
        let hasSep = false;
        for (const row of rows) {
            // Split on | and drop the leading/trailing empty segments
            const cells = row.split('|').map(c => c.trim());
            // If starts/ends with |, first & last elements are empty strings
            const trimmed = cells.length > 2 && cells[0] === '' && cells[cells.length - 1] === ''
                ? cells.slice(1, -1)
                : cells.filter(c => c !== '');
            // Detect separator row (e.g. | --- | :---: |)
            if (trimmed.every(c => /^[-:]+$/.test(c))) { hasSep = true; continue; }
            parsed.push(trimmed);
        }

        if (!hasSep || parsed.length === 0) { return `<pre>${this._escapeHtml(block)}</pre>`; }

        const numCols = Math.max(...parsed.map(r => r.length));
        const widths: number[] = Array(numCols).fill(3);
        for (let c = 0; c < numCols; c++) {
            for (const row of parsed) {
                if (row[c]) { widths[c] = Math.max(widths[c], row[c].length); }
            }
        }

        const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
        const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
        const mid = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
        const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

        const lines: string[] = [top];
        parsed.forEach((row, i) => {
            const cells = widths.map((w, c) => ` ${pad(row[c] || '', w)} `);
            lines.push('│' + cells.join('│') + '│');
            if (i === 0 && parsed.length > 1) { lines.push(mid); }
        });
        lines.push(bot);

        return `<pre>${this._escapeHtml(lines.join('\n'))}</pre>`;
    }

    /** Format a timestamp as 12-hour clock string, e.g. "3:34 PM" */
    private _formatTime(ts: number): string {
        return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    /**
     * Edit the most-recently-posted task's Telegram message to update the
     * sync-time footer.  Only the task with the highest timestamp is updated
     * so old resolved-but-stale tasks are not touched.
     */
    private async _updateMessageFooters(): Promise<void> {
        if (this._activeTasks.size === 0) { return; }

        // Pick only the newest task to update (avoids spamming old messages)
        let newestTask: TrackedTask | undefined;
        for (const task of this._activeTasks.values()) {
            if (!newestTask || task.timestamp > newestTask.timestamp) {
                newestTask = task;
            }
        }
        if (!newestTask) { return; }

        const nextDelaySec = this._getPollDelaySeconds();
        const lastSyncTime = this._formatTime(Date.now());
        const nextSyncTime = this._formatTime(Date.now() + nextDelaySec * 1000);
        const footer = `\n\n<i>🔄 Last sync: ${lastSyncTime} · Next sync: ${nextSyncTime}</i>`;

        try {
            const body: any = {
                chat_id: this._chatId,
                message_id: newestTask.messageId,
                text: newestTask.formattedText + footer,
                parse_mode: 'HTML'
            };
            if (newestTask.choices && newestTask.choices.length > 0) {
                body.reply_markup = {
                    inline_keyboard: newestTask.choices.map(c => ([{
                        text: c,
                        callback_data: `askaway:${newestTask!.taskId}:${c.substring(0, 60)}`
                    }]))
                };
            }
            await fetch(this._apiUrl('editMessageText'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) {
            // Non-critical — footer update failure should not break polling
        }
    }

    // ── Polling for Replies (with backoff) ─────────────────────

    /**
     * Called by the webview provider whenever a task is resolved through any
     * channel (VS Code UI, remote web UI, autopilot, timeout).
     * Removes the task so polling stops for it and the footer stops updating.
     */
    public resolveTask(taskId: string): void {
        if (this._activeTasks.has(taskId)) {
            this._activeTasks.delete(taskId);
            this._log(`AskAway/Telegram: Task ${taskId} resolved externally — removed from active set (${this._activeTasks.size} remaining)`);
            if (this._activeTasks.size === 0) {
                this.stopPolling();
            }
            // Send "processing" confirmation and start heartbeat
            this.resetHeartbeatMessage();
            this.sendStatusUpdate('🟢 Processing your response...');
            this._ensureHeartbeat();
        }
    }

    public startPolling() {
        if (this._pollingTimer) { return; }
        this._pollTickIndex = 0;
        this._pollCount = 0;
        this._pollingStartedAtMs = Date.now();
        this._scheduleNextPoll();
        this._log('AskAway/Telegram: Polling started.');
    }

    private _scheduleNextPoll() {
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
        }
        const delaySec = this._getPollDelaySeconds();
        this._pollingTimer = setTimeout(() => this._poll(), delaySec * 1000);
    }

    private _getPollDelaySeconds(): number {
        const elapsedMs = this._pollingStartedAtMs > 0 ? (Date.now() - this._pollingStartedAtMs) : 0;
        if (elapsedMs >= LONG_WAIT_THRESHOLD_MS) {
            return LONG_WAIT_INTERVAL_SECONDS;
        }

        if (this._pollTickIndex < INITIAL_POLL_BACKOFF_SCHEDULE_S.length) {
            return INITIAL_POLL_BACKOFF_SCHEDULE_S[this._pollTickIndex];
        }
        return this._steadyPollIntervalSeconds;
    }

    private _resetBackoff() {
        this._pollTickIndex = 0;
        this._pollCount = 0;
        this._pollingStartedAtMs = Date.now();
    }

    public stopPolling() {
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
            this._pollingTimer = undefined;
            this._pollingStartedAtMs = 0;
            this._log('AskAway/Telegram: Polling stopped.');
        }
    }

    private async _poll(): Promise<void> {
        this._pollingTimer = undefined;

        if (!this.isConfigured() || this._activeTasks.size === 0) {
            this._log(`AskAway/Telegram: Poll skipped — configured=${this.isConfigured()}, activeTasks=${this._activeTasks.size}`);
            this.stopPolling();
            return;
        }

        // Keep polling while tasks are active, even if Copilot is idle.
        // Stopping here causes delayed user replies to be missed.
        if (this._copilotIdleThresholdMs > 0 && this._lastCopilotActivity > 0) {
            if (Date.now() - this._lastCopilotActivity > this._copilotIdleThresholdMs) {
                console.log(`AskAway/Telegram: Copilot idle exceeded ${Math.floor(this._copilotIdleThresholdMs / 60000)}min, continuing polling to catch delayed replies.`);
            }
        }

        this._pollCount++;
        const currentDelaySec = this._getPollDelaySeconds();
        this._log(`AskAway/Telegram: Poll #${this._pollCount} — interval=${currentDelaySec}s, tick=${this._pollTickIndex}, activeTasks=${this._activeTasks.size}`);

        // Cache bot ID
        if (!this._botId) {
            await this._cacheBotId();
        }

        const now = Date.now();

        // Expire old tasks (36 hours)
        for (const [taskId, task] of this._activeTasks.entries()) {
            if (now - task.timestamp > EXPIRY_MS) {
                this._log(`AskAway/Telegram: Task ${taskId} expired (36h), removing.`);
                this._activeTasks.delete(taskId);
            }
        }

        if (this._activeTasks.size === 0) {
            this.stopPolling();
            return;
        }

        try {
            // Get updates (messages + callback queries)
            const url = this._apiUrl('getUpdates') + `?offset=${this._lastUpdateId + 1}&timeout=0&allowed_updates=["message","callback_query"]`;
            const resp = await fetch(url);

            if (!resp.ok) {
                this._err(`AskAway/Telegram: Poll HTTP error ${resp.status} ${resp.statusText}`);
                if (resp.status === 401) {
                    this._err('AskAway/Telegram: Bot token is invalid or expired.');
                    vscode.window.showErrorMessage(
                        'AskAway: Telegram bot token is invalid. Please update it in settings.',
                        'Open Settings'
                    ).then(action => {
                        if (action === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'askaway.telegram.botToken');
                        }
                    });
                    this.stopPolling();
                    return;
                }
            } else {
                const data = await resp.json() as any;
                const updates = data.result || [];

                for (const update of updates) {
                    this._lastUpdateId = Math.max(this._lastUpdateId, update.update_id);

                    // Handle callback query (inline button click)
                    if (update.callback_query) {
                        const cbData = update.callback_query.data || '';
                        const parts = cbData.split(':');
                        if (parts[0] === 'askaway' && parts.length >= 3) {
                            const cbTaskId = parts[1];
                            const answer = parts.slice(2).join(':');
                            const user = update.callback_query.from?.username
                                || update.callback_query.from?.first_name
                                || 'unknown';

                            if (this._activeTasks.has(cbTaskId)) {
                                this._log(`AskAway/Telegram: Button reply for ${cbTaskId} from ${user}: "${answer.substring(0, 80)}"`); 

                                // Answer the callback to remove the loading indicator
                                await fetch(this._apiUrl('answerCallbackQuery'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        callback_query_id: update.callback_query.id,
                                        text: 'Answer received!'
                                    })
                                });

                                if (this._onResponseReceived) {
                                    this._onResponseReceived(cbTaskId, answer, `${user} (via Telegram)`);
                                }

                                // Update message to show resolved
                                await this._markResolved(this._activeTasks.get(cbTaskId)!, answer, user);
                                this._activeTasks.delete(cbTaskId);
                            }
                        }
                        continue;
                    }

                    // Handle text message reply
                    const msg = update.message;
                    if (!msg || !msg.text) { continue; }

                    // Skip messages from the bot itself
                    if (this._botId && msg.from?.id === this._botId) { continue; }

                    // Check if this is a reply to one of our messages
                    const replyToMsgId = msg.reply_to_message?.message_id;

                    // Fallback: if there is exactly one active task, accept plain chat
                    // messages even when Telegram doesn't include reply_to_message.
                    if (!replyToMsgId && this._activeTasks.size === 1) {
                        const onlyTask = this._activeTasks.values().next().value as TrackedTask | undefined;
                        if (onlyTask) {
                            const answer = msg.text.trim();
                            const user = msg.from?.username || msg.from?.first_name || 'unknown';

                            if (!answer) { continue; }

                            this._log(`AskAway/Telegram: Plain-message fallback matched task ${onlyTask.taskId} from ${user}: "${answer.substring(0, 80)}"`);

                            let resolvedAnswer = answer;
                            if (onlyTask.choices && onlyTask.choices.length > 0) {
                                const num = parseInt(answer, 10);
                                if (num >= 1 && num <= onlyTask.choices.length) {
                                    resolvedAnswer = onlyTask.choices[num - 1];
                                }
                            }

                            if (this._onResponseReceived) {
                                this._onResponseReceived(onlyTask.taskId, resolvedAnswer, `${user} (via Telegram)`);
                            }

                            await this._markResolved(onlyTask, resolvedAnswer, user);
                            this._activeTasks.delete(onlyTask.taskId);
                            continue;
                        }
                    }

                    if (!replyToMsgId) { continue; }

                    // Find the task this reply belongs to
                    for (const [taskId, task] of this._activeTasks.entries()) {
                        if (task.messageId === replyToMsgId) {
                            const answer = msg.text.trim();
                            const user = msg.from?.username || msg.from?.first_name || 'unknown';

                            if (!answer) { continue; }

                            this._log(`AskAway/Telegram: Thread reply for ${taskId} from ${user}: "${answer.substring(0, 80)}"`);

                            // Resolve choice by number if applicable
                            let resolvedAnswer = answer;
                            if (task.choices && task.choices.length > 0) {
                                const num = parseInt(answer, 10);
                                if (num >= 1 && num <= task.choices.length) {
                                    resolvedAnswer = task.choices[num - 1];
                                }
                            }

                            if (this._onResponseReceived) {
                                this._onResponseReceived(taskId, resolvedAnswer, `${user} (via Telegram)`);
                            }

                            await this._markResolved(task, resolvedAnswer, user);
                            this._activeTasks.delete(taskId);
                            break;
                        }
                    }
                }
            }
        } catch (error) {
            this._err('AskAway/Telegram: Poll error', error);
        }

        // Advance backoff tick
        this._pollTickIndex++;

        // Update footer on all live messages so user sees sync timestamps
        if (this._activeTasks.size > 0) {
            await this._updateMessageFooters();
        }

        // Schedule next poll if still have tasks
        if (this._activeTasks.size > 0) {
            this._scheduleNextPoll();
        } else {
            this.stopPolling();
        }
    }

    /** Edit the original message to show it's been resolved */
    private async _markResolved(task: TrackedTask, answer: string, user: string): Promise<void> {
        try {
            // Use _markdownToHtml for the question (may contain markdown from Copilot)
            // Answer and user are plain text, so just escape HTML.
            const text = `✅ <b>Resolved</b>\n\n` +
                `<b>Q:</b> ${this._markdownToHtml(task.question)}\n` +
                `<b>A:</b> ${this._escapeHtml(answer)}\n` +
                `<b>By:</b> ${this._escapeHtml(user)}`;

            await fetch(this._apiUrl('editMessageText'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this._chatId,
                    message_id: task.messageId,
                    text: text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [] }  // remove buttons
                })
            });
        } catch (e) {
            this._warn(`AskAway/Telegram: Failed to update resolved message: ${e}`);
        }
    }

    // ── Public API ─────────────────────────────────────────────

    public getActiveTaskCount(): number {
        return this._activeTasks.size;
    }

    /** Track a file change for inclusion in the next message */
    public trackFileChange(relativePath: string) {
        if (!this._recentFileChanges.includes(relativePath)) {
            this._recentFileChanges.push(relativePath);
        }
    }

    private _consumeFileChanges(): string[] {
        const changes = [...this._recentFileChanges];
        this._recentFileChanges = [];
        return changes;
    }

    // ── Copilot Activity Tracking ─────────────────────────────

    public notifyCopilotActivity() {
        this._lastCopilotActivity = Date.now();
        this._ensureHeartbeat();
    }

    public notifyCopilotStopped() {
        this._lastCopilotActivity = 0;
        this._stopHeartbeat();
    }

    // ── Heartbeat: periodic "still working" notifications ─────

    /**
     * Send a lightweight status message to Telegram.
     * Reuses (edits) the same message to avoid spamming the chat.
     */
    public async sendStatusUpdate(status: string): Promise<void> {
        if (!this.isConfigured()) { return; }
        // Throttle: don't send more than once per 30 seconds
        if (Date.now() - this._lastStatusSentAt < 30_000) { return; }
        this._lastStatusSentAt = Date.now();

        const text = `<i>${this._escapeHtml(status)}</i>`;
        try {
            if (this._lastHeartbeatMsgId) {
                // Edit existing status message
                await fetch(this._apiUrl('editMessageText'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: this._chatId,
                        message_id: this._lastHeartbeatMsgId,
                        text,
                        parse_mode: 'HTML'
                    })
                });
            } else {
                // Send new status message
                const resp = await fetch(this._apiUrl('sendMessage'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: this._chatId,
                        text,
                        parse_mode: 'HTML',
                        disable_notification: true
                    })
                });
                if (resp.ok) {
                    const data = await resp.json() as any;
                    this._lastHeartbeatMsgId = data.result?.message_id;
                }
            }
        } catch {
            // Non-critical
        }
    }

    /** Start the heartbeat timer if not already running and no active ask_user */
    private _ensureHeartbeat(): void {
        if (this._heartbeatTimer) { return; }
        if (this._activeTasks.size > 0) { return; }   // ask_user is pending, no heartbeat needed
        if (!this.isConfigured()) { return; }

        this._heartbeatTimer = setInterval(async () => {
            // Only send heartbeat when Copilot is active AND no ask_user is pending
            if (this._activeTasks.size > 0) {
                this._stopHeartbeat();
                return;
            }
            if (this._lastCopilotActivity === 0) {
                this._stopHeartbeat();
                return;
            }
            const elapsed = Date.now() - this._lastCopilotActivity;
            if (elapsed > this._heartbeatIntervalMs * 3) {
                // Copilot hasn't done anything in 3x the interval — likely idle
                this._stopHeartbeat();
                return;
            }

            const elapsedMin = Math.round(elapsed / 60_000);
            const now = this._formatTime(Date.now());
            await this.sendStatusUpdate(`🟢 Copilot is working... (${elapsedMin}m active, updated ${now})`);
        }, this._heartbeatIntervalMs);
    }

    private _stopHeartbeat(): void {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = undefined;
        }
    }

    /** Reset the heartbeat message so the next status sends a new message */
    public resetHeartbeatMessage(): void {
        this._lastHeartbeatMsgId = undefined;
    }

    // ── Get Chat ID helper ─────────────────────────────────────

    /**
     * Fetch recent updates to find the chat ID.
     * User should send a message to the bot first.
     */
    public async getChatId(): Promise<string | undefined> {
        if (!this._botToken) {
            vscode.window.showErrorMessage('AskAway: Set your Telegram Bot Token first.');
            return undefined;
        }

        try {
            const resp = await fetch(this._apiUrl('getUpdates') + '?limit=5');
            if (!resp.ok) {
                vscode.window.showErrorMessage(`AskAway: Failed to get updates: ${resp.status}`);
                return undefined;
            }

            const data = await resp.json() as any;
            const updates = data.result || [];

            if (updates.length === 0) {
                vscode.window.showInformationMessage(
                    'AskAway: No messages found. Send any message to your bot on Telegram first, then try again.'
                );
                return undefined;
            }

            // Get the most recent chat ID
            const chatId = updates[updates.length - 1].message?.chat?.id?.toString();
            if (chatId) {
                // Save to settings
                const config = vscode.workspace.getConfiguration('askaway');
                await config.update('telegram.chatId', chatId, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`AskAway: Telegram Chat ID set to ${chatId}`);
                this.reloadConfig();
                return chatId;
            }

            vscode.window.showWarningMessage('AskAway: Could not determine chat ID from recent messages.');
            return undefined;
        } catch (e) {
            console.error('AskAway/Telegram: getChatId error:', e);
            vscode.window.showErrorMessage('AskAway: Failed to fetch Telegram updates.');
            return undefined;
        }
    }

    public dispose() {
        this.stopPolling();
        this._stopHeartbeat();
        this._activeTasks.clear();
    }
}
