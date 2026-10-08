import * as fs from 'fs';
import * as path from 'path';
import { redactRecordOrDrop } from './redact';

export interface LiveReply {
    answer?: string | null; sources?: string[]; risk?: 'low' | 'high';
    reversible?: boolean; confidence?: number; error?: string | null;
}
export interface LiveDecision {
    question: string; answer: string | null; held: boolean; sources: string[];
    risk: 'low' | 'high' | null; reversible: boolean | null; confidence: number | null; ts: number;
}
export function readLiveDecisions(workspace: string, since: number, until = Infinity): LiveDecision[] {
    let text: string;
    try { text = fs.readFileSync(path.join(workspace, '.askaway', 'validator', 'live-decisions.jsonl'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    return text.split('\n').filter(Boolean).flatMap(line => {
        try {
            const row = JSON.parse(line) as LiveDecision;
            return row.ts >= since && row.ts <= until && typeof row.question === 'string' &&
                Array.isArray(row.sources) && typeof row.held === 'boolean' && redactRecordOrDrop(row) ? [row] : [];
        } catch { return []; }
    });
}
export function recordLiveDecision(workspace: string, decision: LiveDecision): void {
    if (!redactRecordOrDrop(decision)) throw new Error('Live decision rejected by secret gate');
    const file = path.join(workspace, '.askaway', 'validator', 'live-decisions.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(decision) + '\n', 'utf8');
}
