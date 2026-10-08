import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { CONFIG_NAMESPACE } from '../constants/branding';
import { createTelegramHandoffTaskId } from './telegramConversationReply';
import { renderResponseFile, type ResponseFile } from './responsePdf';
import type { RemoteChannel } from './remoteChannel';

/**
 * Posts the agent's `Response Handoff` section to Webex and/or Telegram when a turn ends.
 *
 * No new hook is needed: the existing cache-timer hook already stamps
 * `~/.askaway/turn-complete-ts` on the Stop event, and Copilot's own debug log records the
 * final assistant text as an `agent_response` line. Watching the stamp and tailing the log
 * keeps the whole feature inside the extension, where the Webex token already lives.
 */

const STAMP = path.join(os.homedir(), '.askaway', 'turn-complete-ts');
const TRANSCRIPT = path.join(os.homedir(), '.askaway', 'turn-complete-transcript');
const TAIL_BYTES = 4 * 1024 * 1024; // agent_response lines are large; the last one is at the end
const TURN_LOOKBACK_MS = 10 * 60 * 1000;
const WATCH_INTERVAL_MS = 2000;

/** The mandatory handoff, plus everything that came before it in the same message. */
export interface HandoffParts { handoff: string; details: string; }

export interface TurnMetricsSnapshot {
    latestInputTokens: number;
    turnOutputTokens: number;
    turnNanoAiu: number;
}

export type HandoffPoster = Pick<RemoteChannel, 'isConfigured' | 'postText'> & Partial<Pick<RemoteChannel, 'sendDocument'>>;

export interface HandoffTarget {
    name: string;
    /** Settings key under the AskAway namespace that gates this target. */
    setting: string;
    /** Resolved at turn-end, not at construction: the services activate asynchronously. */
    get(): HandoffPoster | undefined;
}

export function createHandoffTargets(
    getWebex: () => HandoffPoster | undefined,
    getTelegram: () => HandoffPoster | undefined
): HandoffTarget[] {
    return [
        { name: 'Webex', setting: 'webex.notifyOnTurnEnd', get: getWebex },
        { name: 'Telegram', setting: 'telegram.notifyOnTurnEnd', get: getTelegram }
    ];
}

export class HandoffNotifier implements vscode.Disposable {
    /** The running notifier, so the provider can send the long-run notice without extension wiring. */
    public static current: HandoffNotifier | undefined;
    private _lastPostedTs = 0;
    private _lastPostedHandoff = '';
    private _watchTimer: NodeJS.Timeout | undefined;
    private _processing = false;

    constructor(
        private readonly _targets: HandoffTarget[],
        private readonly _debugLogsDir: string | undefined,
        private readonly _log: (msg: string, data?: unknown) => void,
        private readonly _getTurnMetrics?: () => TurnMetricsSnapshot | Promise<TurnMetricsSnapshot>,
        private readonly _validateFinal?: (text: string, id: string) => Promise<void>
    ) { }

    public start(): void {
        if (this._watchTimer) { return; }
        HandoffNotifier.current = this;
        // Seed with the current stamp so activation never replays the previous turn.
        this._lastPostedTs = this._readStamp();
        this._watchTimer = setInterval(() => { void this._onTurnEnd(); }, WATCH_INTERVAL_MS);
    }

    /** Telegram-only notice that a long Away run crossed 300K (decision lives in specs/handoffThreshold.ts). */
    public async postLongRunNotice(text: string): Promise<boolean> {
        const poster = this._targets.find(t => t.name === 'Telegram')?.get();
        if (!poster?.isConfigured()) { return false; }
        return poster.postText(`**AskAway**

${text}`, `AskAway: ${text}`);
    }

    public dispose(): void {
        if (HandoffNotifier.current === this) { HandoffNotifier.current = undefined; }
        if (this._watchTimer) {
            clearInterval(this._watchTimer);
            this._watchTimer = undefined;
        }
    }

    private _readStamp(): number {
        try { return parseInt(fs.readFileSync(STAMP, 'utf8').trim(), 10) || 0; } catch { return 0; }
    }

    private async _onTurnEnd(): Promise<void> {
        if (this._processing) { return; }
        const ts = this._readStamp();
        if (!ts || ts <= this._lastPostedTs) { return; }

        const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const enabled = this._targets.filter(t => cfg.get<boolean>(t.setting, false));
        if (!enabled.length && !this._validateFinal) { this._lastPostedTs = ts; return; }

        this._processing = true;
        try {
            // Only accept a handoff produced by the turn that just ended.
            const parts = this._findHandoff(ts - TURN_LOOKBACK_MS);
            if (!parts) { this._log('Handoff notifier: no Response Handoff section in the final response'); return; }
            const finalText = fullResponseMarkdown(parts);
            void this._validateFinal?.(finalText, createHash('sha256').update(finalText).digest('hex'));
            // The turn-end stamp can be written more than once per turn; the message itself is the
            // real identity, so posting the same text twice is always a duplicate.
            if (parts.handoff === this._lastPostedHandoff) {
                this._log('Handoff notifier: same handoff already posted, skipping duplicate');
                this._lastPostedTs = ts;
                return;
            }
            let configuredTargets = 0;
            let postedTargets = 0;
            const turnMetrics = await this._getTurnMetrics?.();
            for (const target of enabled) {
                const poster = target.get();
                if (!poster?.isConfigured()) {
                    this._log(`Handoff notifier: ${target.name} is enabled but not configured`);
                    continue;
                }
                configuredTargets++;
                const markdown = telegramHandoffUpdate(parts, turnMetrics);
                const ok = await poster.postText(
                    markdown,
                    `AskAway — turn complete: ${parts.handoff.slice(0, 200)}`,
                    createTelegramHandoffTaskId(ts)
                );
                if (ok) { postedTargets++; }
                if (ok && poster.sendDocument && parts.details) {
                    await this._sendResponseDocument(poster.sendDocument.bind(poster), parts);
                }
                this._log(`Handoff notifier: posted to ${target.name} = ${ok}`, { chars: markdown.length });
            }
            if (configuredTargets === 0 || postedTargets > 0) {
                this._lastPostedTs = ts;
                this._lastPostedHandoff = parts.handoff;
            } else {
                this._log('Handoff notifier: all configured targets failed; retrying current turn');
            }
        } catch (err) {
            this._log('Handoff notifier failed', err instanceof Error ? err.message : String(err));
        } finally {
            this._processing = false;
        }
    }

    private async _sendResponseDocument(send: (file: string, caption: string) => Promise<boolean>, parts: HandoffParts): Promise<void> {
        let rendered: ResponseFile | undefined;
        try {
            rendered = await renderResponseFile(fullResponseMarkdown(parts));
            const ok = await send(rendered.file, rendered.kind === 'pdf' ? '📄 Full response' : '📄 Full response (markdown; PDF conversion unavailable)');
            this._log(`Handoff notifier: sent full response ${rendered.kind} = ${ok}`);
        } catch (err) {
            this._log('Handoff notifier: full response document failed', err instanceof Error ? err.message : String(err));
        } finally {
            rendered?.cleanup();
        }
    }

    /** Handoff from the newest session in this workspace's Copilot debug logs. */
    private _findHandoff(minTs: number): HandoffParts | undefined {
        try {
            const transcript = fs.readFileSync(TRANSCRIPT, 'utf8').trim();
            if (transcript && fs.statSync(transcript).mtimeMs >= minTs) {
                const parts = findClaudeHandoff(readTail(transcript, TAIL_BYTES), minTs);
                if (parts) { return parts; }
            }
        } catch { /* no Claude Stop transcript available */ }
        if (!this._debugLogsDir) { return undefined; }
        let newest: { file: string; mtime: number } | undefined;
        let sessions: string[] = [];
        try { sessions = fs.readdirSync(this._debugLogsDir); } catch { return undefined; }
        for (const s of sessions) {
            const f = path.join(this._debugLogsDir, s, 'main.jsonl');
            try {
                const st = fs.statSync(f);
                if (!newest || st.mtimeMs > newest.mtime) { newest = { file: f, mtime: st.mtimeMs }; }
            } catch { /* not a session dir */ }
        }
        if (!newest) { return undefined; }
        return findHandoff(readTail(newest.file, TAIL_BYTES), minTs);
    }
}

export function findClaudeHandoff(jsonl: string, minTs: number): HandoffParts | undefined {
    const lines = jsonl.split('\n');
    for (let i = lines.length - 1, scanned = 0; i >= 0 && scanned < 200; i--) {
        let parsed: any;
        try { parsed = JSON.parse(lines[i]); } catch { continue; }
        const message = parsed?.message;
        if (parsed?.type !== 'assistant' && parsed?.role !== 'assistant' && message?.role !== 'assistant') { continue; }
        scanned++;
        const timestamp = typeof parsed?.timestamp === 'string' ? Date.parse(parsed.timestamp) : parsed?.ts;
        if (typeof timestamp === 'number' && timestamp < minTs) { return undefined; }
        const content = message?.content ?? parsed?.content ?? parsed?.text;
        const text = typeof content === 'string' ? content : Array.isArray(content)
            ? content.map((part: any) => typeof part === 'string' ? part : part?.text || '').join('\n')
            : '';
        const handoff = extractHandoff(text);
        if (handoff) { return handoff; }
    }
    return undefined;
}

export function telegramHandoffUpdate(parts: HandoffParts, metrics?: TurnMetricsSnapshot): string {
    const compactTokens = (value: number): string => {
        const n = Math.max(0, Number(value) || 0);
        if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`; }
        if (n >= 1_000) { return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`; }
        return String(Math.round(n));
    };
    const banner = metrics
        ? `**${compactTokens(metrics.latestInputTokens)} last in · ${compactTokens(metrics.turnOutputTokens)} turn out · $${(metrics.turnNanoAiu / 1_000_000_000 / 100).toFixed(2)} turn**`
        : '**Turn metrics unavailable**';
    const handoff = parts.handoff.trim() || 'No Response Handoff provided.';
    // Only the handoff travels as text; the full response goes along as a PDF document (see responsePdf.ts).
    // Telegram HTML can outgrow raw markdown, and TelegramService bounds it before converting, so no details here.
    return `**AskAway**\n\n${banner}\n\n**Handoff**\n${handoff}`;
}

/** The whole response, as the markdown that becomes the PDF. */
export function fullResponseMarkdown(parts: HandoffParts): string {
    return `${parts.details ? `${parts.details}\n\n` : ''}## Response Handoff\n\n${parts.handoff}\n`;
}

export function compactHandoffUpdate(handoff: string): string {
    return telegramHandoffUpdate({ handoff, details: '' });
}

/** Read the trailing `bytes` of a file (the first line is likely partial and gets dropped). */
function readTail(file: string, bytes: number): string {
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - bytes);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        const text = buf.toString('utf8');
        return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    } finally {
        fs.closeSync(fd);
    }
}

/** Newest `agent_response` at/after `minTs` whose text carries a Response Handoff section.
 *  Copilot writes one `agent_response` per LLM round, so the turn's final message sits among
 *  several rounds of mid-turn narration and tool-call-only rounds; requiring the heading picks
 *  the final message out of them, and `minTs` keeps a previous turn's handoff from being reposted.
 *  Text is carried as `content` on the part, inside the JSON-encoded `attrs.response`. */
export function findHandoff(jsonl: string, minTs: number): HandoffParts | undefined {
    const lines = jsonl.split('\n');
    let scanned = 0;
    for (let i = lines.length - 1; i >= 0 && scanned < 200; i--) {
        if (!lines[i] || lines[i].indexOf('"agent_response"') === -1) { continue; }
        let parsed: any;
        try { parsed = JSON.parse(lines[i]); } catch { continue; }
        if (parsed?.type !== 'agent_response') { continue; }
        scanned++;
        if (typeof parsed.ts === 'number' && parsed.ts < minTs) { return undefined; }
        const raw = parsed?.attrs?.response;
        if (typeof raw !== 'string') { continue; }
        let msgs: any;
        try { msgs = JSON.parse(raw); } catch { continue; }
        if (!Array.isArray(msgs)) { continue; }
        const text = msgs
            .flatMap((m: any) => Array.isArray(m?.parts) ? m.parts : [])
            .filter((p: any) => p?.type === 'text')
            .map((p: any) => (typeof p.content === 'string' ? p.content : typeof p.text === 'string' ? p.text : ''))
            .join('\n');
        const handoff = extractHandoff(text);
        if (handoff) { return handoff; }
    }
    return undefined;
}

/** Split a response into the `Response Handoff` section and everything preceding it. */
export function extractHandoff(response: string): HandoffParts | undefined {
    const m = /^#{1,6}\s*Response\s+Handoff\s*$/im.exec(response);
    if (!m) { return undefined; }
    const handoff = response.slice(m.index + m[0].length).trim();
    if (!handoff) { return undefined; }
    return { handoff, details: response.slice(0, m.index).trim() };
}
