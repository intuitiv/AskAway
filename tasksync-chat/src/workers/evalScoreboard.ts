import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** One mode × model × thinking line of the eval scoreboard: the evidence for picking a worker tier. */
export interface ScoreRow { mode: string; model: string; variant: string; runs: number; passed: number; avgCost: number; avgMs: number; lastAt: string }

export const EVAL_RESULTS_FILE = path.join(os.homedir(), '.askaway', 'evals', 'results.jsonl');

export function evalScoreboard(records: Array<{ ts?: string; suite?: string; mode?: string; model?: string; variant?: string; verdict?: string; usage?: { cost?: number }; durationMs?: number }>): ScoreRow[] {
    const rows = new Map<string, ScoreRow & { cost: number; ms: number }>();
    for (const r of records) {
        const model = String(r.model ?? 'unknown').split('/').pop() || 'unknown';
        // Orchestrator evals grade a plan, not a worker mode.
        const mode = String(r.mode ?? r.suite ?? 'unknown');
        const key = `${mode}\u0000${model}\u0000${r.variant}`;
        const row = rows.get(key) ?? { mode, model, variant: String(r.variant ?? ''), runs: 0, passed: 0, avgCost: 0, avgMs: 0, lastAt: '', cost: 0, ms: 0 };
        row.runs++;
        if (r.verdict === 'PASS') { row.passed++; }
        row.cost += Number(r.usage?.cost) || 0;
        row.ms += Number(r.durationMs) || 0;
        if (String(r.ts ?? '') > row.lastAt) { row.lastAt = String(r.ts); }
        rows.set(key, row);
    }
    return [...rows.values()]
        .map(({ cost, ms, ...row }) => ({ ...row, avgCost: cost / row.runs, avgMs: ms / row.runs }))
        .sort((a, b) => a.mode.localeCompare(b.mode) || b.passed / b.runs - a.passed / a.runs || a.avgCost - b.avgCost);
}

/** Reads the eval results ledger; malformed lines are skipped. */
export function loadEvalScoreboard(file: string = EVAL_RESULTS_FILE): ScoreRow[] {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
    const records = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) { continue; }
        try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
    return evalScoreboard(records);
}
