import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CREDENTIAL } from '../workers/openCodeRuntime';
import type { ToolDefinition } from '../workers/workerTools';

export const COMMENTARY_KINDS = ['update', 'heads-up'] as const;
export type CommentaryKind = typeof COMMENTARY_KINDS[number];
export const MAX_COMMENTARY_WORDS = 20;
export const MIN_COMMENTARY_WORDS = 3;
const MAX_GOAL_CHARS = 2000;
const OPENER_ITEMS = 30;

export interface CommentaryItem { id: string; ts: number; kind: CommentaryKind; text: string; turnId: string }

/** Persisted per workspace so the next conversation's hook can carry goal and feed over. */
export interface CommentaryState {
    workspacePath: string;
    goal: string;
    goalUpdatedAt: number;
    clearedAt: number;
    items: CommentaryItem[];
}

export type PostResult = { status: 'POSTED'; id: string } | { status: 'REJECTED'; reason: string };

/** Same key the conversation hook computes from its cwd. */
export function commentaryKey(workspacePath: string): string {
    let resolved = workspacePath;
    try { resolved = fs.realpathSync(workspacePath); } catch { /* keep as given */ }
    return resolved.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export function uncleared(state: CommentaryState): CommentaryItem[] {
    return state.items.filter((item) => item.ts > state.clearedAt);
}

/** The block the reviewer pastes into (or the hook injects at) the next conversation's first prompt. */
export function buildOpener(state: CommentaryState): string {
    const items = uncleared(state).slice(-OPENER_ITEMS);
    const lines = [`Main goal: ${state.goal || '(none set; use the active spec cycle)'}`];
    if (items.length) {
        lines.push(`Commentary since last clear (${items.length}):`);
        for (const item of items) {
            const time = new Date(item.ts).toISOString().slice(11, 16);
            lines.push(`- ${time} ${item.kind === 'heads-up' ? 'HEADS-UP: ' : ''}${item.text}`);
        }
    }
    lines.push('Continue toward the main goal.');
    return lines.join('\n');
}

/** What the Commentary tab receives: the goal, the uncleared feed, when each chat turn started, and the ready-to-copy opener. */
export interface CommentaryView { goal: string; goalUpdatedAt: number; items: CommentaryItem[]; archivedCount: number; opener: string; turnStarts: number[]; currentPrompt: string }

export function commentaryView(state: CommentaryState, turnStarts: number[] = [], currentPrompt = ''): CommentaryView {
    const items = uncleared(state);
    return { goal: state.goal, goalUpdatedAt: state.goalUpdatedAt, items, archivedCount: state.items.length - items.length, opener: buildOpener(state), turnStarts, currentPrompt };
}

/** Same turns-file shape as hooks/spec-context-inject.cjs writes: parallel `starts` and `prompts`, newest last. */
const MAX_TURNS = 200;
const PROMPT_CHARS = 300;
const CREDENTIAL_ANYWHERE = new RegExp(CREDENTIAL.source, 'g');
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
        const empty: CommentaryState = { workspacePath, goal: '', goalUpdatedAt: 0, clearedAt: 0, items: [] };
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file(workspacePath), 'utf8'));
            return { ...empty, ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
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
        return { status: 'POSTED', id: item.id };
    }

    setGoal(workspacePath: string, goal: string): CommentaryState {
        const state = this.read(workspacePath);
        state.goal = String(goal ?? '').trim().slice(0, MAX_GOAL_CHARS);
        state.goalUpdatedAt = this.now();
        this.write(state);
        return state;
    }

    /** Clearing the feed keeps the items as audit history; only the carry-over boundary moves. */
    clear(workspacePath: string, what: 'feed' | 'goal' | 'all'): CommentaryState {
        const state = this.read(workspacePath);
        if (what !== 'goal') { state.clearedAt = Math.max(this.now(), state.items[state.items.length - 1]?.ts ?? 0); }
        if (what !== 'feed') { state.goal = ''; state.goalUpdatedAt = this.now(); }
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

export function commentaryToolDefinitions(store: () => CommentaryStore, defaultWorkspace: string): ToolDefinition[] {
    return [{
        name: 'commentary',
        description: 'Live commentary: the trace of your execution for the reviewer, so they know what is happening, can guide you in time, and are prepared for questions coming their way. '
            + 'One line per significant stage (not per tool), in plain words a non-engineer follows; no run IDs, worker IDs, model names, or file paths unless the reviewer must act on them. '
            + 'Lead with one emoji; **bold** the outcome, ==highlight== the one number that matters. '
            + 'kind `update` for everything that is just happening. kind `heads-up` when you will need something from the reviewer soon, or something is unclear to you, so they can prepare. '
            + 'You hold the context the reviewer lacks, so a heads-up names exactly what you need: the decision and its options, or the input. Never just "something is unclear". '
            + '10-20 words. Batch it with the step\'s real tool call; do not repeat it in chat.',
        inputSchema: z.object({
            kind: z.enum(COMMENTARY_KINDS),
            text: z.string().min(1).describe('10-20 plain words: what is happening and why.'),
            turnId: z.string().optional(),
        }),
        run: (args) => store().post(defaultWorkspace, args),
    }];
}
