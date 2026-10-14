import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
const CREDENTIAL = /\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|\bsqu_[A-Za-z0-9]{20,}|\d{8,}:[A-Za-z0-9_-]{30,}/;

export const COMMENTARY_KINDS = ['update', 'heads-up'] as const;
export type CommentaryKind = typeof COMMENTARY_KINDS[number];
export const MAX_COMMENTARY_WORDS = 20;
export const MIN_COMMENTARY_WORDS = 3;
const OPENER_ITEMS = 30;
type TalkPost = (workspace: string, input: { text: string; replyTo?: string; details?: string; kind?: string; authorKind?: string; detail?: Record<string, unknown> }) => unknown;
let talkPost: TalkPost | undefined;
export function setCommentaryAITalkMirror(callback: TalkPost): void { talkPost = callback; }

/** `validator` items are written only by `postValidator()`; `detail` is the validator's expandable trace rows. */
export interface CommentaryItem { id: string; ts: number; kind: CommentaryKind | 'validator'; text: string; turnId: string; detail?: Record<string, unknown> }

/** Persisted per workspace so the next conversation's hook can carry goal and feed over. */
export interface CommentaryState {
    workspacePath: string;
    clearedAt: number;
    items: CommentaryItem[];
    /**
     * Validator items live apart from `items`: the conversation hook and `buildOpener` read `items` and inject it into the
     * agent's prompt, and beta validator output must never reach the agent. Only `commentaryView` (the tab) merges them.
     */
    validatorItems?: CommentaryItem[];
}

export type PostResult = { status: 'POSTED'; id: string } | { status: 'REJECTED'; reason: string };

/** Same key the conversation hook computes from its cwd. */
export function commentaryKey(workspacePath: string): string {
    let resolved = workspacePath;
    try { resolved = fs.realpathSync(workspacePath); } catch { /* keep as given */ }
    return resolved.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** The agent-facing feed: validator items are excluded (beta isolation). */
export function uncleared(state: CommentaryState): CommentaryItem[] {
    return state.items.filter((item) => item.ts > state.clearedAt);
}

/** The block the reviewer pastes into (or the hook injects at) the next conversation's first prompt. */
export function buildOpener(state: CommentaryState): string {
    const items = uncleared(state).slice(-OPENER_ITEMS);
    const lines: string[] = [];
    if (items.length) {
        lines.push(`Commentary since last clear (${items.length}):`);
        for (const item of items) {
            const time = new Date(item.ts).toISOString().slice(11, 16);
            lines.push(`- ${time} ${item.kind === 'heads-up' ? 'HEADS-UP: ' : ''}${item.text}`);
        }
    }
    return lines.join('\n');
}

/** What the Commentary tab receives: the goal, the uncleared feed, when each chat turn started, and the ready-to-copy opener. */
export interface CommentaryView { items: CommentaryItem[]; archivedCount: number; opener: string; turnStarts: number[]; currentPrompt: string }

export function commentaryView(state: CommentaryState, turnStarts: number[] = [], currentPrompt = ''): CommentaryView {
    const agentItems = uncleared(state);
    const validator = (state.validatorItems ?? []).filter((item) => item.ts > state.clearedAt);
    const items = validator.length ? [...agentItems, ...validator].sort((a, b) => a.ts - b.ts) : agentItems;
    return { items, archivedCount: state.items.length - agentItems.length, opener: buildOpener(state), turnStarts, currentPrompt };
}

/** Same turns-file shape as hooks/spec-context-inject.cjs writes: parallel `starts` and `prompts`, newest last. */
const MAX_TURNS = 200;
const PROMPT_CHARS = 300;
export const CREDENTIAL_ANYWHERE = new RegExp(CREDENTIAL.source, 'g');
export function promptExcerpt(text: string): string {
    const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim().replace(CREDENTIAL_ANYWHERE, '[redacted]');
    return oneLine.length > PROMPT_CHARS ? `${oneLine.slice(0, PROMPT_CHARS - 1)}…` : oneLine;
}

export class CommentaryStore {
    private readonly dir: string;
    private readonly now: () => number;
    private readonly listeners: Array<(state: CommentaryState) => void> = [];
    private sequence = 0;

    constructor(options: { dir?: string; now?: () => number } = {}) {
        this.dir = options.dir ?? path.join(os.homedir(), '.askaway', 'commentary');
        this.now = options.now ?? Date.now;
    }

    file(workspacePath: string): string {
        return path.join(this.dir, `${commentaryKey(workspacePath)}.json`);
    }

    /** A user message starts a turn: a typed prompt (written by the UserPromptSubmit hook) or a queued/answered message (written here). */
    turnsFile(workspacePath: string): string {
        return path.join(this.dir, `${commentaryKey(workspacePath)}.turns.json`);
    }

    private readTurns(workspacePath: string): { starts: number[]; prompts: string[] } {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.turnsFile(workspacePath), 'utf8'));
            const starts: number[] = Array.isArray(parsed.starts) ? parsed.starts : [];
            const prompts: string[] = Array.isArray(parsed.prompts) ? parsed.prompts : [];
            // Older files have starts only; align prompts to the same length.
            return { starts, prompts: starts.map((_, i) => String(prompts[i - (starts.length - prompts.length)] ?? '')) };
        } catch {
            return { starts: [], prompts: [] };
        }
    }

    turnStarts(workspacePath: string): number[] {
        return this.readTurns(workspacePath).starts.filter((ts) => typeof ts === 'number');
    }

    currentPrompt(workspacePath: string): string {
        const { prompts } = this.readTurns(workspacePath);
        return prompts.length ? prompts[prompts.length - 1] : '';
    }

    markTurnStart(workspacePath: string, prompt: string): number {
        const turns = this.readTurns(workspacePath);
        const ts = Math.max(this.now(), (turns.starts[turns.starts.length - 1] ?? 0) + 1);
        const file = this.turnsFile(workspacePath);
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ starts: [...turns.starts, ts].slice(-MAX_TURNS), prompts: [...turns.prompts, promptExcerpt(prompt)].slice(-MAX_TURNS) }));
        fs.renameSync(`${file}.tmp`, file);
        return ts;
    }

    read(workspacePath: string): CommentaryState {
        const empty: CommentaryState = { workspacePath, clearedAt: 0, items: [] };
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file(workspacePath), 'utf8'));
            return { workspacePath, clearedAt: parsed.clearedAt ?? 0, items: Array.isArray(parsed.items) ? parsed.items : [],
                ...(Array.isArray(parsed.validatorItems) ? { validatorItems: parsed.validatorItems } : {}) };
        } catch {
            return empty;
        }
    }

    onChange(listener: (state: CommentaryState) => void): void {
        this.listeners.push(listener);
    }

    post(workspacePath: string, input: { kind: string; text: string; turnId?: string }): PostResult {
        if (!COMMENTARY_KINDS.includes(input.kind as CommentaryKind)) {
            return { status: 'REJECTED', reason: `kind must be one of ${COMMENTARY_KINDS.join(', ')}` };
        }
        const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
        const words = text ? text.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length : 0;
        if (words > MAX_COMMENTARY_WORDS) { return { status: 'REJECTED', reason: `${words} words; shorten to ${MAX_COMMENTARY_WORDS} or fewer` }; }
        if (words < MIN_COMMENTARY_WORDS) { return { status: 'REJECTED', reason: `${words} words; say what and why in 10-20 words` }; }
        if (CREDENTIAL.test(text)) { return { status: 'REJECTED', reason: 'text contains a credential' }; }
        const state = this.read(workspacePath);
        const ts = Math.max(this.now(), (state.items[state.items.length - 1]?.ts ?? 0) + 1, state.clearedAt + 1);
        const item: CommentaryItem = { id: `c-${ts.toString(36)}-${++this.sequence}`, ts, kind: input.kind as CommentaryKind, text,
            turnId: input.turnId ?? '' };
        state.items.push(item);
        this.write(state);
        talkPost?.(workspacePath, { text, kind: input.kind });
        return { status: 'POSTED', id: item.id };
    }

    /**
     * Internal only (never an MCP tool): the validator's one-line summary plus expandable `detail`. No word cap (R-3);
     * a credential anywhere in text or detail drops the whole item. Stored apart from agent-facing items.
     */
    postValidator(workspacePath: string, input: { text: string; detail?: Record<string, unknown>; turnId?: string; headsUp?: boolean }): PostResult {
        const text = String(input.text ?? '').replace(/\s+/g, ' ').trim();
        if (!text) { return { status: 'REJECTED', reason: 'empty text' }; }
        const body = `${text}\n${JSON.stringify(input.detail ?? {})}`;
        if (body.replace(CREDENTIAL_ANYWHERE, '') !== body) { return { status: 'REJECTED', reason: 'text contains a credential' }; }
        const state = this.read(workspacePath);
        const validatorItems = state.validatorItems ?? [];
        const ts = Math.max(this.now(), (validatorItems[validatorItems.length - 1]?.ts ?? 0) + 1,
            (state.items[state.items.length - 1]?.ts ?? 0) + 1, state.clearedAt + 1);
        const item: CommentaryItem = { id: `v-${ts.toString(36)}-${++this.sequence}`, ts, kind: input.headsUp ? 'heads-up' : 'validator', text, turnId: input.turnId ?? '',
            ...(input.detail ? { detail: input.detail } : {}) };
        state.validatorItems = [...validatorItems, item];
        this.write(state);
        talkPost?.(workspacePath, { text, kind: input.headsUp ? 'heads-up' : 'validator', authorKind: 'validator', detail: input.detail });
        return { status: 'POSTED', id: item.id };
    }

    /** Clearing the feed keeps the items as audit history; only the carry-over boundary moves. */
    clear(workspacePath: string, what: 'feed' | 'all'): CommentaryState {
        const state = this.read(workspacePath);
        state.clearedAt = Math.max(this.now(), state.items[state.items.length - 1]?.ts ?? 0);
        this.write(state);
        return state;
    }

    private write(state: CommentaryState): void {
        fs.mkdirSync(this.dir, { recursive: true });
        const file = this.file(state.workspacePath);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
        fs.renameSync(`${file}.tmp`, file);
        for (const listener of this.listeners) { listener(state); }
    }
}

export function commentaryToolDefinitions(store: () => CommentaryStore, defaultWorkspace: string): Array<{
    name: string; description: string; inputSchema: z.ZodObject<any>; run: (args: any) => any;
}> {
    return [{
        name: 'commentary',
        description: 'Live commentary: the trace of your execution for the reviewer, so they know what is happening, can guide you in time, and are prepared for questions coming their way. '
            + 'One line per significant stage (not per tool), in plain words a non-engineer follows; no run IDs, worker IDs, model names, or file paths unless the reviewer must act on them. '
            + 'Speak to the reviewer in plain first-person sentences, like updating a colleague. Use one or two short sentences, not emoji-led bold banners or headlines. '
            + 'kind `update` for everything that is just happening. kind `heads-up` when you will need something from the reviewer soon, or something is unclear to you, so they can prepare. '
            + 'You hold the context the reviewer lacks, so a heads-up asks the exact question with options, or asks for the input you need. Never just "something is unclear". '
             + '10-20 words. Batch it with the step\'s real tool call; do not repeat it in chat. action aitalk posts a crisp question or reply; optional details appear under Read more.',
        inputSchema: z.object({
            action: z.enum(['post', 'aitalk']).optional(),
            details: z.string().max(8000).optional(),
            replyTo: z.string().optional(),
            kind: z.enum(COMMENTARY_KINDS).optional(),
            text: z.string().min(1).describe('10-20 plain words: what is happening and why.'),
            turnId: z.string().optional(),
            workspacePath: z.string().optional().describe('The workspace this line belongs to. Required over MCP; the VS Code tool defaults to its own window.'),
        }),
        // One MCP server serves every window, so a missing workspace must never fall back to the server owner's feed.
        run: (args) => {
            const workspace = args.workspacePath || defaultWorkspace;
            if (!workspace) return { status: 'REJECTED', reason: 'workspacePath is required: say which workspace this line belongs to' };
            if (args.action === 'aitalk') {
                return talkPost ? talkPost(workspace, args) : { status: 'REJECTED', reason: 'AITalk is not configured' };
            }
            if (!args.kind) return { status: 'INVALID_INPUT', reason: 'kind is required for commentary' };
            return store().post(workspace, args);
        },
    }];
}
