import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { CREDENTIAL } from '../workers/openCodeRuntime';
import type { ToolDefinition } from '../workers/workerTools';

export const COMMENTARY_KINDS = ['decision', 'question', 'progress', 'blocked'] as const;
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
            lines.push(`- ${time} ${item.kind}: ${item.text}`);
        }
    }
    lines.push('Continue toward the main goal.');
    return lines.join('\n');
}

/** What the Commentary tab receives: the goal, the uncleared feed, and the ready-to-copy opener. */
export interface CommentaryView { goal: string; goalUpdatedAt: number; items: CommentaryItem[]; archivedCount: number; opener: string }

export function commentaryView(state: CommentaryState): CommentaryView {
    const items = uncleared(state);
    return { goal: state.goal, goalUpdatedAt: state.goalUpdatedAt, items, archivedCount: state.items.length - items.length, opener: buildOpener(state) };
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
        const words = text ? text.split(' ').length : 0;
        if (words > MAX_COMMENTARY_WORDS) { return { status: 'REJECTED', reason: `${words} words; shorten to ${MAX_COMMENTARY_WORDS} or fewer` }; }
        if (words < MIN_COMMENTARY_WORDS) { return { status: 'REJECTED', reason: `${words} words; say what and why in 10-20 words` }; }
        if (CREDENTIAL.test(text)) { return { status: 'REJECTED', reason: 'text contains a credential' }; }
        const state = this.read(workspacePath);
        const ts = Math.max(this.now(), (state.items[state.items.length - 1]?.ts ?? 0) + 1, state.clearedAt + 1);
        const item: CommentaryItem = { id: `c-${ts.toString(36)}-${++this.sequence}`, ts, kind: input.kind as CommentaryKind, text, turnId: input.turnId ?? '' };
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
        description: 'Post one live-commentary line to the reviewer\'s Commentary tab: a decision, question, progress, or blocker in 10-20 plain words. '
            + 'Call it in the same parallel batch as the step\'s real tool call so it never costs an extra request. Do not repeat the text in chat.',
        inputSchema: z.object({
            kind: z.enum(COMMENTARY_KINDS),
            text: z.string().min(1).describe('10-20 plain words: what and why.'),
            turnId: z.string().optional(),
        }),
        run: (args) => store().post(defaultWorkspace, args),
    }];
}
