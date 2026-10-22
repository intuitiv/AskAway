import * as fs from 'fs';
import * as path from 'path';
import { ConversationStacks } from './conversationStack';
import { redactOrDrop } from './redact';

const MAX_AGE_MS = 10 * 60 * 1000;
const CLAIMED = /^(.+\.json)\.claimed-(\d+)$/;

/** One stack per workspace and session. */
export function stackKey(workspaceRoot: string, sessionId: string): string { return `${workspaceRoot}::${sessionId}`; }

const inside = (root: string, cwd: string): boolean => {
    const relative = path.relative(root, cwd);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const alive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** Moves reviewer prompts from the hook spool into the conversation stacks (ADR 0038). */
export class StackCapture {
    private timer: NodeJS.Timeout | undefined;
    private readonly now: () => number;
    constructor(private readonly options: { spoolDir: string; stacks: Pick<ConversationStacks, 'append' | 'read'>; workspaceRoot: string; now?: () => number;
        onUser?: (input: { conversationKey: string; text: string; turnId: string; sessionId: string }) => void | Promise<void> }) {
        this.now = options.now ?? Date.now;
    }

    private remove(file: string): void { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }

    /** Stale temp files go; a claim whose owner is gone returns to the spool for a retry (the stable entry id makes a replay harmless), or goes when old. */
    private sweep(names: string[]): void {
        const { spoolDir } = this.options;
        for (const name of names) {
            const file = path.join(spoolDir, name);
            try {
                const old = this.now() - fs.statSync(file).mtimeMs > MAX_AGE_MS;
                if (name.startsWith('.') && name.endsWith('.tmp')) { if (old) { this.remove(file); } continue; }
                const claimed = CLAIMED.exec(name);
                if (!claimed || alive(Number(claimed[2]))) { continue; }
                if (old) { this.remove(file); } else { fs.renameSync(file, path.join(spoolDir, claimed[1])); }
            } catch { /* another window got there first */ }
        }
    }

    drain(): void {
        try {
            const { spoolDir, stacks, workspaceRoot } = this.options;
            this.sweep(fs.readdirSync(spoolDir).filter(name => !name.endsWith('.json') || name.startsWith('.')));
            for (const name of fs.readdirSync(spoolDir).filter(entry => entry.endsWith('.json') && !entry.startsWith('.')).sort()) {
                const file = path.join(spoolDir, name);
                try {
                    let event: { kind?: unknown; sessionId?: unknown; cwd?: unknown; text?: unknown; at?: unknown } | undefined;
                    try { event = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { event = undefined; }
                    if (!event) { if (fs.existsSync(file)) { this.remove(file); } continue; }
                    const at = typeof event.at === 'number' ? event.at : this.now();
                    const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
                    // An event that names no session cannot be told apart from another one: it would merge unrelated conversations.
                    if (event.kind !== 'user' || typeof event.text !== 'string' || typeof event.cwd !== 'string' || !sessionId) { this.remove(file); continue; }
                    if (!inside(workspaceRoot, event.cwd)) {
                        if (this.now() - at > MAX_AGE_MS) { this.remove(file); }
                        continue;
                    }
                    // One window owns the event: the rename succeeds for exactly one process.
                    const claimed = `${file}.claimed-${process.pid}`;
                    try { fs.renameSync(file, claimed); } catch { continue; }
                    const conversationKey = stackKey(workspaceRoot, sessionId);
                    const turnId = name.replace(/\.json$/, '');
                    try {
                        stacks.append(conversationKey, { role: 'user', text: event.text, turnId, at, id: turnId });
                    } catch {
                        if (this.now() - at > MAX_AGE_MS) { this.remove(claimed); } else { try { fs.renameSync(claimed, file); } catch { /* retried when its owner is gone */ } }
                        continue;
                    }
                    const safe = redactOrDrop(event.text);
                    if (safe !== null) { try { void Promise.resolve(this.options.onUser?.({ conversationKey, text: safe, turnId, sessionId })).catch(() => undefined); } catch { /* a callback never stops the drain */ } }
                    this.remove(claimed);
                } catch { /* one bad file never stops the drain */ }
            }
        } catch { /* no spool yet */ }
    }

    /** The agent's final response for a turn, appended to the same stack as the reviewer's prompts. */
    appendAgent(input: { sessionId: string; text: string; turnId: string; at: number }): void {
        if (!input.sessionId) { return; }
        try { this.options.stacks.append(stackKey(this.options.workspaceRoot, input.sessionId), { role: 'agent', text: input.text, turnId: input.turnId, at: input.at }); } catch { /* never throw */ }
    }

    start(intervalMs = 2000): void {
        if (this.timer) { return; }
        this.timer = setInterval(() => this.drain(), intervalMs);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    }
}
