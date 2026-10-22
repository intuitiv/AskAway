import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { redactOrDrop } from './redact';

/** ADR 0038: one stack per conversation holding only the reviewer's messages and the main agent's final responses. */
export interface StackEntry { role: 'user' | 'agent'; text: string; turnId: string; at: number; id?: string }

const DISK_PAIRS = 200;
const MODEL_PAIRS = 50;
/** A replayed event is recognised by its stable id among the newest entries. */
const DUPLICATE_WINDOW = 50;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class ConversationStacks {
    private readonly dir: string;
    private readonly secured = new Set<string>();
    constructor(options: { dir: string }) { this.dir = options.dir; }

    private base(key: string): string { return path.join(this.dir, createHash('sha256').update(key).digest('hex')); }

    /** Creates the directory 0700 and narrows a directory or file that already existed with wider modes, once per path. */
    private secure(target: string, mode: number): void {
        if (this.secured.has(target)) { return; }
        try { fs.chmodSync(target, mode); this.secured.add(target); } catch { /* not created yet or not ours */ }
    }

    private ensureDir(): void {
        fs.mkdirSync(this.dir, { recursive: true, mode: DIR_MODE });
        this.secure(this.dir, DIR_MODE);
    }

    private write(file: string, data: string, flag: 'a' | 'w'): void {
        fs.writeFileSync(file, data, { flag, mode: FILE_MODE });
        this.secure(file, FILE_MODE);
    }

    /**
     * Records one entry; a text that holds a credential is dropped whole. Out-of-order roles are recorded as given.
     * An entry whose `id` is already among the newest entries is a replay and adds nothing. True when a line was added.
     */
    append(conversationKey: string, entry: StackEntry): boolean {
        const text = redactOrDrop(entry.text);
        if (text === null) { return false; }
        this.ensureDir();
        const file = `${this.base(conversationKey)}.jsonl`;
        if (entry.id && this.readFile(file).slice(-DUPLICATE_WINDOW).some(existing => existing.id === entry.id)) { return false; }
        const line = JSON.stringify({ role: entry.role, text, turnId: entry.turnId, at: entry.at, id: entry.id ?? randomUUID() }) + '\n';
        this.write(file, this.endsMidLine(file) ? '\n' + line : line, 'a');
        const entries = this.readFile(file);
        if (entries.length > DISK_PAIRS * 2) {
            const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
            this.write(temp, entries.slice(-DISK_PAIRS * 2).map(item => JSON.stringify(item) + '\n').join(''), 'w');
            fs.renameSync(temp, file);
        }
        return true;
    }

    /** True when the file's last byte is not a newline (a truncated write): the next line must not be glued onto it. */
    private endsMidLine(file: string): boolean {
        let fd: number | undefined;
        try {
            fd = fs.openSync(file, 'r');
            const size = fs.fstatSync(fd).size;
            if (size === 0) { return false; }
            const last = Buffer.alloc(1);
            fs.readSync(fd, last, 0, 1, size - 1);
            return last[0] !== 0x0a;
        } catch { return false; } finally { if (fd !== undefined) { fs.closeSync(fd); } }
    }

    read(conversationKey: string): StackEntry[] { return this.readFile(`${this.base(conversationKey)}.jsonl`); }

    /** The id of the newest entry, or undefined for an empty or unknown stack. */
    lastEntryId(conversationKey: string): string | undefined { return this.read(conversationKey).at(-1)?.id; }

    /**
     * The caller's acknowledgement, after the model call succeeded: everything up to `upToEntryId` is now in the Validator's session
     * (`session`, when given, is that session's id; a delta is only built for the same session).
     */
    markDelivered(conversationKey: string, upToEntryId: string, session?: string): void {
        this.ensureDir();
        this.write(`${this.base(conversationKey)}.cursor`, JSON.stringify({ id: upToEntryId, session: session ?? '' }), 'w');
    }

    private delivered(conversationKey: string): { id: string; session: string } | undefined {
        try {
            const raw = fs.readFileSync(`${this.base(conversationKey)}.cursor`, 'utf8').trim();
            const value = JSON.parse(raw);
            return value && typeof value.id === 'string' ? { id: value.id, session: String(value.session ?? '') } : undefined;
        } catch { return undefined; }
    }

    /**
     * The text the Validator receives. With `sessionContinues` only the entries after the delivered cursor (same `session`) are returned,
     * else the last `maxPairs` pairs. Building the input never moves the cursor: call `markDelivered` once the model call succeeded.
     */
    buildInput(conversationKey: string, options: { sessionContinues: boolean; maxPairs?: number; session?: string }): string {
        const entries = this.read(conversationKey);
        let chosen: StackEntry[];
        const cursor = options.sessionContinues ? this.delivered(conversationKey) : undefined;
        const at = cursor && (options.session === undefined || cursor.session === options.session)
            ? entries.findIndex(entry => entry.id === cursor.id) : -1;
        if (options.sessionContinues && at >= 0) {
            chosen = entries.slice(at + 1);
        } else if (options.sessionContinues && !cursor) {
            chosen = entries;
        } else {
            chosen = entries.slice(-Math.max(1, options.maxPairs ?? MODEL_PAIRS) * 2);
        }
        // Turn numbers count the reviewer's messages from the start of the stored stack.
        const first = entries.indexOf(chosen[0]);
        let turn = entries.slice(0, Math.max(first, 0)).filter(entry => entry.role === 'user').length;
        return chosen.map(entry => {
            if (entry.role === 'user') { turn++; }
            return `[${Math.max(turn, 1)}] ${entry.role === 'user' ? 'Reviewer' : 'Agent'}: ${entry.text}`;
        }).join('\n\n');
    }

    private readFile(file: string): StackEntry[] {
        let raw: string;
        try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
        const entries: StackEntry[] = [];
        for (const line of raw.split('\n')) {
            if (!line.trim()) { continue; }
            try {
                const value = JSON.parse(line);
                if ((value.role === 'user' || value.role === 'agent') && typeof value.text === 'string') { entries.push(value); }
            } catch { /* truncated or garbage line */ }
        }
        return entries;
    }
}
