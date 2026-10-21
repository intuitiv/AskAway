import * as fs from 'fs';
import * as path from 'path';
import { redactRecordOrDrop } from './redact';

export interface ValidatorUsage { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number }

export interface ContextAddition { id: string; ref: string; reason: string; dismissed: boolean }

export interface ValidatorResponse {
    /** Set for the end-of-turn pass over the agent's final response; not persisted. */
    turnEnd?: boolean;
    id: string;
    observedId: string;
    /** `agent` or `worker:<workerId>`. */
    source: string;
    specSlug: string | null;
    answer: string | null;
    observations: string;
    summary: string;
    impact: string;
    sources: string[];
    contextSuggestions: ContextAddition[];
    usage: ValidatorUsage;
    skipped: boolean;
    error: string | null;
    ts: number;
    /** The validator run's own worker and OpenCode session (analyze N3), when it ran as a worker. */
    workerId?: string;
    sessionId?: string;
}

export interface Prediction { id: string; responseId: string; decision: string; ts: number; matched?: boolean | null; diff?: string }

export interface IndexEntry { memoryId: string; kind: string; specSlug: string; storyId?: string; taskId?: string; from?: string; ts: number }

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NO_SPEC = '_no-spec';

/** Append-only jsonl under `<workspace>/.askaway/specs/<slug>/validator/`; a record holding a credential is dropped whole (FR-016). */
export class ValidatorRecords {
    readonly dir: string;

    constructor(workspaceRoot: string, specSlug: string | null) {
        const slug = specSlug ?? NO_SPEC;
        if (slug !== NO_SPEC && !SLUG.test(slug)) { throw new Error(`invalid spec slug "${slug}"`); }
        this.dir = path.join(workspaceRoot, '.askaway', 'specs', slug, 'validator');
    }

    private file(name: 'responses' | 'predictions' | 'index'): string {
        return path.join(this.dir, `${name}.jsonl`);
    }

    private append(name: 'responses' | 'predictions' | 'index', record: object): boolean {
        const safe = redactRecordOrDrop(record);
        if (!safe) { return false; }
        fs.mkdirSync(this.dir, { recursive: true });
        fs.appendFileSync(this.file(name), `${JSON.stringify(safe)}\n`);
        return true;
    }

    private read<T>(name: 'responses' | 'predictions' | 'index'): T[] {
        let text = '';
        try { text = fs.readFileSync(this.file(name), 'utf8'); } catch { return []; }
        const rows: T[] = [];
        for (const line of text.split('\n')) {
            if (!line) { continue; }
            try { rows.push(JSON.parse(line)); } catch { /* skip a torn line */ }
        }
        return rows;
    }

    /** Returns false when the record was dropped because it held a credential. */
    appendResponse(response: ValidatorResponse): boolean { return this.append('responses', response); }

    /** A prediction is appended again, with `matched` and `diff`, once compared; reads fold to the newest line per id. */
    appendPrediction(prediction: Prediction): boolean { return this.append('predictions', prediction); }

    appendIndex(entry: IndexEntry): boolean { return this.append('index', entry); }

    responses(): ValidatorResponse[] { return this.read<ValidatorResponse>('responses'); }

    predictions(): Prediction[] {
        const byId = new Map<string, Prediction>();
        for (const row of this.read<Prediction>('predictions')) { byId.set(row.id, { ...byId.get(row.id), ...row }); }
        return [...byId.values()];
    }

    index(): IndexEntry[] { return this.read<IndexEntry>('index'); }
}
