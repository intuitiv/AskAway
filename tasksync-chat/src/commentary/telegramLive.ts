import * as fs from 'fs';
import type { CommentaryItem, CommentaryStore, CommentaryView } from './commentary';
import { commentaryView } from './commentary';

/**
 * One Telegram message per chat turn, driven by three events (reviewer, 2026-09-28):
 * a user message opens it, the commentary tool edits it, the final response becomes it and is polled for a reply.
 * The next user message marks it continued and stops that polling.
 */
export interface LiveMessagePoster {
    isConfigured(): boolean;
    sendLive(html: string): Promise<number | undefined>;
    editLive(messageId: number, html: string): Promise<boolean>;
    /** Turns the live message into the final response and tracks it for Telegram replies. */
    finishLive(messageId: number, headHtml: string, finalMarkdown: string, replyTaskId: string): Promise<boolean>;
}

type Phase = 'live' | 'final' | 'continued';

const HEADS_UP = new Set(['heads-up', 'question', 'blocked']);
const MAX_HTML = 3900; // Telegram rejects texts over 4096 chars

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Same light markup as the Commentary tab, in Telegram's HTML subset.
function markup(text: string): string {
    return esc(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/==([^=]+)==/g, '<b>$1</b>')
        .replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>');
}

function clock(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Lines of the current chat turn: everything posted since the latest user message (all lines when none was recorded). */
export function currentTurn(view: CommentaryView): { startedAt: number; prompt: string; items: CommentaryItem[] } {
    const startedAt = view.turnStarts.length ? Math.max(...view.turnStarts) : 0;
    return { startedAt, prompt: view.currentPrompt || '', items: view.items.filter((item) => item.ts >= startedAt) };
}

const HEADS: Record<Phase, string> = { live: '🔴 <b>Live</b>', final: '✅ <b>Turn complete</b>', continued: '⏭ <b>Continued</b>' };

export function liveCommentaryHtml(workspaceName: string, prompt: string, items: CommentaryItem[], phase: Phase, budget = MAX_HTML, footer = ''): string {
    const head = [`${HEADS[phase]} · ${esc(workspaceName)}`, prompt ? `💬 <i>${esc(prompt)}</i>` : ''].filter(Boolean);
    const lines = items.map((item) => `<code>${clock(item.ts)}</code> ${HEADS_UP.has(item.kind) ? '❓ <b>HEADS-UP</b> ' : ''}${markup(item.text)}`);
    const tail = footer ? [footer] : [];
    let body = [...head, ...lines, ...tail].join('\n');
    // Keep the newest lines when the turn outgrows one message.
    while (body.length > budget && lines.length > 1) {
        lines.shift();
        body = [...head, '…', ...lines, ...tail].join('\n');
    }
    return body;
}

/** What the extension knows about the running turn, for the periodic status line. */
export interface TurnActivity { lastActivityAt: number; requests: number }

const STUCK_MS = 5 * 60 * 1000;

function minutes(ms: number): string {
    const m = Math.floor(ms / 60_000);
    return m < 1 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${m}m`;
}

/** Every tick while a turn is live: how long it has run and when the agent last did anything; warns when it looks stuck. */
export function statusFooter(now: number, turnStartedAt: number, activity: TurnActivity): string {
    const last = Math.max(activity.lastActivityAt, turnStartedAt);
    const idle = now - last;
    const facts = `⏱ ${clock(now).slice(0, 5)} · working ${minutes(now - turnStartedAt)} · ${activity.requests} request${activity.requests === 1 ? '' : 's'} · last activity ${minutes(idle)} ago`;
    return idle >= STUCK_MS ? `${facts}\n⚠️ <b>No activity for ${minutes(idle)}</b> — the agent may be stuck or errored.` : facts;
}

export class TelegramLiveCommentary {
    private turnStartedAt = -1;
    private messageId: number | undefined;
    private finished = false;
    private turn: { prompt: string; items: CommentaryItem[] } = { prompt: '', items: [] };
    private lastHtml = '';
    private lastEditAt = 0;
    private pending: NodeJS.Timeout | undefined;
    private ticker: NodeJS.Timeout | undefined;
    private footer = '';
    private lastView: CommentaryView | undefined;
    private chain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly poster: () => LiveMessagePoster | undefined,
        private readonly workspaceName: string,
        private readonly options: { minEditMs?: number; now?: () => number; enabled?: () => boolean; activity?: () => TurnActivity; tickMs?: number } = {},
    ) { }

    /** Serialized so a burst of events never opens two messages for one turn. */
    update(view: CommentaryView): Promise<void> {
        this.lastView = view;
        return this.enqueue(() => this.apply(view));
    }

    /** Refreshes the status line of a live turn; the ticker calls this every `tickMs` (default 2 minutes). */
    tick(): Promise<void> {
        return this.enqueue(async () => {
            if (!this.options.activity || this.messageId === undefined || this.finished || !this.lastView) { return; }
            this.footer = statusFooter(this.now(), this.turnStartedAt, this.options.activity());
            this.lastEditAt = 0;
            await this.apply(this.lastView);
        });
    }

    /** The final response replaces the live status in the same message; false when there is no live message to reuse. */
    finish(finalMarkdown: string, replyTaskId: string): Promise<boolean> {
        return this.enqueue(async () => {
            const poster = this.active();
            if (!poster || this.messageId === undefined || this.finished) { return false; }
            this.cancelPending();
            this.stopTicker();
            const head = liveCommentaryHtml(this.workspaceName, this.turn.prompt, this.turn.items, 'final', 1800);
            const ok = await poster.finishLive(this.messageId, head, finalMarkdown, replyTaskId);
            if (ok) { this.finished = true; }
            return ok;
        });
    }

    dispose(): void {
        this.cancelPending();
        this.stopTicker();
    }

    private startTicker(): void {
        if (this.ticker || !this.options.activity) { return; }
        this.ticker = setInterval(() => { void this.tick(); }, this.options.tickMs ?? 120_000);
    }

    private stopTicker(): void {
        if (this.ticker) { clearInterval(this.ticker); this.ticker = undefined; }
    }

    private enqueue<T>(step: () => Promise<T>): Promise<T> {
        const next = this.chain.then(step);
        this.chain = next.catch(() => undefined);
        return next;
    }

    private active(): LiveMessagePoster | undefined {
        const poster = this.poster();
        return poster?.isConfigured() && this.options.enabled?.() !== false ? poster : undefined;
    }

    private async apply(view: CommentaryView): Promise<void> {
        const poster = this.active();
        if (!poster) { return; }
        const turn = currentTurn(view);
        if (turn.startedAt !== this.turnStartedAt) {
            // A new user message: close the previous live message if its turn never reached a final response.
            if (this.messageId !== undefined && !this.finished) {
                this.cancelPending();
                await poster.editLive(this.messageId, liveCommentaryHtml(this.workspaceName, this.turn.prompt, this.turn.items, 'continued'));
            }
            this.turnStartedAt = turn.startedAt;
            this.messageId = undefined;
            this.finished = false;
            this.lastHtml = '';
            this.footer = '';
        }
        this.turn = { prompt: turn.prompt, items: turn.items };
        if (this.finished || (!turn.items.length && !turn.prompt)) { return; }
        const html = liveCommentaryHtml(this.workspaceName, turn.prompt, turn.items, 'live', MAX_HTML, this.footer);
        if (html === this.lastHtml) { return; }
        if (this.messageId === undefined) {
            this.messageId = await poster.sendLive(html);
            if (this.messageId !== undefined) { this.lastHtml = html; this.lastEditAt = this.now(); this.startTicker(); }
            return;
        }
        const wait = (this.options.minEditMs ?? 1500) - (this.now() - this.lastEditAt);
        if (wait > 0) {
            // Telegram throttles rapid edits; keep only the newest text and send it once the window opens.
            this.cancelPending();
            this.pending = setTimeout(() => { this.pending = undefined; void this.update(view); }, wait);
            return;
        }
        if (await poster.editLive(this.messageId, html)) { this.lastHtml = html; this.lastEditAt = this.now(); }
    }

    private cancelPending(): void {
        if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }
}

/** The Telegram handoff target: the final response lands in the turn's live message, or a new message when there is none. */
export function telegramTurnTarget(relay: TelegramLiveCommentary, telegram: () => (LiveMessagePoster & { postText(markdown: string, fallback: string, replyTaskId?: string): Promise<boolean> }) | undefined) {
    return {
        isConfigured: () => telegram()?.isConfigured() ?? false,
        postText: async (markdown: string, fallback: string, replyTaskId?: string): Promise<boolean> =>
            (replyTaskId !== undefined && await relay.finish(markdown, replyTaskId)) || (await telegram()?.postText(markdown, fallback, replyTaskId) ?? false),
    };
}

/** Feeds the relay from commentary posts and from user messages (turns file); `onNewTurn` fires once per new user message. */
export function relayCommentaryToTelegram(relay: TelegramLiveCommentary, store: CommentaryStore, workspacePath: string, onNewTurn?: () => void): { dispose(): void } {
    let lastStart = Math.max(0, ...store.turnStarts(workspacePath));
    const view = () => commentaryView(store.read(workspacePath), store.turnStarts(workspacePath), store.currentPrompt(workspacePath));
    const push = () => void relay.update(view());
    const onTurns = () => {
        const latest = Math.max(0, ...store.turnStarts(workspacePath));
        if (latest > lastStart) { lastStart = latest; onNewTurn?.(); }
        push();
    };
    store.onChange(() => push());
    // Another window may post for this workspace (the shared MCP server lives in one window), so watch the feed file too.
    const feed = store.file(workspacePath);
    fs.watchFile(feed, { interval: 1000 }, push);
    const turns = store.turnsFile(workspacePath);
    fs.watchFile(turns, { interval: 500 }, onTurns);
    return { dispose: () => { fs.unwatchFile(turns, onTurns); fs.unwatchFile(feed, push); relay.dispose(); } };
}
