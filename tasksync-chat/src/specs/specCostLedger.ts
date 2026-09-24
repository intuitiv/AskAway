import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SpecCostTurn {
    specSlug: string;
    turnKey: string;
    day: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    nanoAiu: number;
}

export interface SpecCostTotals {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    nanoAiu: number;
    turns: number;
    days: number;
}

function workspaceKey(workspaceRoot: string): string {
    let canonical = workspaceRoot;
    try {
        canonical = fs.realpathSync(workspaceRoot);
    } catch {
        // Unreadable path still gets a stable key from the literal value.
    }
    return canonical.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export function specCostLedgerFile(workspaceRoot: string): string {
    return path.join(os.homedir(), '.askaway', 'spec-cost', `${workspaceKey(workspaceRoot)}.json`);
}

export function readActiveSpecSlug(workspaceRoot: string): string {
    try {
        const raw = fs.readFileSync(path.join(workspaceRoot, '.specify', 'feature.json'), 'utf8');
        const dir = JSON.parse(raw).feature_directory;
        return typeof dir === 'string' && dir ? path.basename(dir) : '';
    } catch {
        return '';
    }
}

function readRows(file: string): SpecCostTurn[] {
    try {
        const rows = JSON.parse(fs.readFileSync(file, 'utf8')).rows;
        return Array.isArray(rows) ? rows.filter((row) => row && typeof row.turnKey === 'string') : [];
    } catch {
        return [];
    }
}

/** Upserts one aggregate row per user turn. Rows are never removed: they are the measured record. */
export function recordSpecTurn(file: string, turn: SpecCostTurn): void {
    if (!turn.specSlug || !turn.turnKey) {
        return;
    }
    if (turn.requests <= 0 && turn.nanoAiu <= 0) {
        return;
    }
    const rows = readRows(file);
    const index = rows.findIndex((row) => row.turnKey === turn.turnKey && row.specSlug === turn.specSlug);
    if (index >= 0) {
        rows[index] = turn;
    } else {
        rows.push(turn);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rows }, null, 2));
}

export function readSpecCostTotals(file: string): Record<string, SpecCostTotals> {
    const totals: Record<string, SpecCostTotals> = {};
    const days: Record<string, Set<string>> = {};
    for (const row of readRows(file)) {
        const slug = row.specSlug;
        if (!slug) {
            continue;
        }
        if (!totals[slug]) {
            totals[slug] = { requests: 0, inputTokens: 0, outputTokens: 0, nanoAiu: 0, turns: 0, days: 0 };
            days[slug] = new Set();
        }
        totals[slug].requests += Number(row.requests) || 0;
        totals[slug].inputTokens += Number(row.inputTokens) || 0;
        totals[slug].outputTokens += Number(row.outputTokens) || 0;
        totals[slug].nanoAiu += Number(row.nanoAiu) || 0;
        totals[slug].turns += 1;
        if (row.day) {
            days[slug].add(row.day);
        }
    }
    for (const slug of Object.keys(totals)) {
        totals[slug].days = days[slug].size;
    }
    return totals;
}
