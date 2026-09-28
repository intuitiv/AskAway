import * as fs from 'fs';
import type { CommentaryItem, CommentaryStore, CommentaryView } from './commentary';
import { commentaryView } from './commentary';

/** The two Telegram calls the relay needs; TelegramService implements them with its topic routing. */
export interface LiveMessagePoster {
    isConfigured(): boolean;
    sendLive(html: string): Promise<number | undefined>;
    editLive(messageId: number, html: string): Promise<boolean>;
}

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

/** Lines of the current chat turn: everything posted since the latest prompt (all lines when no prompt was recorded). */
export function currentTurn(view: CommentaryView): { startedAt: number; items: CommentaryItem[] } {
    const startedAt = view.turnStarts.length ? Math.max(...view.turnStarts) : 0;
    return { startedAt, items: view.items.filter((item) => item.ts >= startedAt) };
}

export function liveCommentaryHtml(workspaceName: string, items: CommentaryItem[], done: boolean): string {
    const head = `${done ? '✅' : '🔴'} <b>${done ? 'Turn complete' : 'Live'}</b> · ${esc(workspaceName)}`;
    const lines = items.map((item) => `<code>${clock(item.ts)}</code> ${HEADS_UP.has(item.kind) ? '❓ <b>HEADS-UP</b> ' : ''}${markup(item.text)}`);
    const tail = done ? '\n<i>Final response follows.</i>' : '';
    let body = [head, ...lines].join('\n') + tail;
    // Keep the newest lines when the turn outgrows one message.
    while (body.length > MAX_HTML && lines.length > 1) {
        lines.shift();
        body = [head, '…', ...lines].join('\n') + tail;
    }
    return body;
}

/** Mirrors the current turn's commentary into ONE Telegram message: sent on the turn's first line, then edited in place. */
export class TelegramLiveCommentary {
    private turnStartedAt = -1;
    private messageId: number | undefined;
    private lastHtml = '';
    private lastEditAt = 0;
    private pending: NodeJS.Timeout | undefined;
    private chain: Promise<void> = Promise.resolve();

    constructor(
        private readonly poster: () => LiveMessagePoster | undefined,
        private readonly workspaceName: string,
        private readonly options: { minEditMs?: number; now?: () => number; enabled?: () => boolean } = {},
    ) { }

    /** Serialized so a burst of lines never sends two messages for one turn. */
    update(view: CommentaryView, done = false): Promise<void> {
        this.chain = this.chain.then(() => this.apply(view, done)).catch(() => undefined);
        return this.chain;
    }

    finish(view: CommentaryView): Promise<void> {
        return this.update(view, true);
    }

    dispose(): void {
        if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    }

    private async apply(view: CommentaryView, done: boolean): Promise<void> {
        const poster = this.poster();
        if (!poster?.isConfigured() || this.options.enabled?.() === false) { return; }
        const turn = currentTurn(view);
        if (turn.startedAt !== this.turnStartedAt) {
            this.turnStartedAt = turn.startedAt;
            this.messageId = undefined;
            this.lastHtml = '';
        }
        if (!turn.items.length) { return; }
        const html = liveCommentaryHtml(this.workspaceName, turn.items, done);
        if (html === this.lastHtml) { return; }
        if (this.messageId === undefined) {
            this.messageId = await poster.sendLive(html);
            if (this.messageId !== undefined) { this.lastHtml = html; this.lastEditAt = this.now(); }
            return;
        }
        const wait = (this.options.minEditMs ?? 1500) - (this.now() - this.lastEditAt);
        if (wait > 0 && !done) {
            // Telegram throttles rapid edits; keep only the newest text and send it once the window opens.
            if (this.pending) { clearTimeout(this.pending); }
            this.pending = setTimeout(() => { this.pending = undefined; void this.update(view); }, wait);
            return;
        }
        if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
        if (await poster.editLive(this.messageId, html)) { this.lastHtml = html; this.lastEditAt = this.now(); }
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }
}

/** Feeds the relay from the store's own writes and from the prompt hook's turn-start file; `onNewTurn` fires once per new prompt. */
export function relayCommentaryToTelegram(relay: TelegramLiveCommentary, store: CommentaryStore, workspacePath: string, onNewTurn?: () => void): { dispose(): void } {
    let lastStart = Math.max(0, ...store.turnStarts(workspacePath));
    const push = () => void relay.update(commentaryView(store.read(workspacePath), store.turnStarts(workspacePath)));
    const onTurns = () => {
        const latest = Math.max(0, ...store.turnStarts(workspacePath));
        if (latest > lastStart) { lastStart = latest; onNewTurn?.(); }
        push();
    };
    store.onChange(() => push());
    const turns = store.turnsFile(workspacePath);
    fs.watchFile(turns, { interval: 1000 }, onTurns);
    return { dispose: () => { fs.unwatchFile(turns, onTurns); relay.dispose(); } };
}
