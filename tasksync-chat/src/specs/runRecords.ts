import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isSpecKitStage, SpecKitStage } from './stages';

export type RunKind = 'chat' | 'worker' | 'checkpoint' | 'converge' | 'import';
export type CheckStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'N/A';

export interface ReadinessResult {
    checks: Array<{ name: string; status: CheckStatus; reason?: string; evidence?: string }>;
    openFindings: string[];
    residualRisk: string[];
}

export interface RunRecord {
    v: 1;
    slug: string;
    kind: RunKind;
    command: string;
    stageBefore: SpecKitStage | null;
    stageAfter: SpecKitStage | null;
    branch: string;
    pr: string;
    startedAt: string;
    endedAt: string;
    agentMs: number;
    cost: { nanoAiu: number; requests: number };
    tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
    story?: string;
    checkpoint?: { result: 'PASS' | 'FAIL' | 'BLOCKED'; independentTest: string; scs: Array<{ id: string; result: CheckStatus; evidence?: string }> };
    readiness?: ReadinessResult;
    workerId?: string;
    runId?: string;
}

export interface SpecFacts {
    storedStage: SpecKitStage | null;
    branch: string;
    pr: string;
    costNanoAiu: number;
    requests: number;
    agentMs: number;
    runs: number;
    skippedRecords: number;
    lastReadiness: ReadinessResult | null;
}

const SLUG = /^\d{3}-[a-z0-9][a-z0-9-]*$/;
// Allow-list: anything else a caller passes (prompt text, env values) is never persisted.
const FIELDS: Array<keyof RunRecord> = ['v', 'slug', 'kind', 'command', 'stageBefore', 'stageAfter', 'branch', 'pr', 'startedAt', 'endedAt',
    'agentMs', 'cost', 'tokens', 'story', 'checkpoint', 'readiness', 'workerId', 'runId'];
const KINDS: RunKind[] = ['chat', 'worker', 'checkpoint', 'converge', 'import'];

export function runRecordsDir(workspaceRoot: string, slug: string): string {
    if (!SLUG.test(slug)) { throw new Error(`invalid spec slug: ${slug}`); }
    return path.join(workspaceRoot, '.askaway', 'specs', slug, 'runs');
}

function stageOrNull(value: unknown): SpecKitStage | null {
    return isSpecKitStage(value) ? value : null;
}

function normalize(slug: string, input: Partial<RunRecord>): RunRecord {
    const endedAt = input.endedAt || new Date().toISOString();
    const rec: Record<string, unknown> = {};
    for (const key of FIELDS) {
        if (input[key] !== undefined) { rec[key] = input[key]; }
    }
    return {
        ...(rec as Partial<RunRecord>),
        v: 1,
        slug,
        kind: KINDS.includes(input.kind as RunKind) ? input.kind as RunKind : 'chat',
        command: String(input.command || '').slice(0, 80),
        stageBefore: stageOrNull(input.stageBefore),
        stageAfter: stageOrNull(input.stageAfter),
        branch: String(input.branch || ''),
        pr: String(input.pr || ''),
        startedAt: input.startedAt || endedAt,
        endedAt,
        agentMs: Math.max(0, Number(input.agentMs) || 0),
        cost: { nanoAiu: Math.max(0, Number(input.cost?.nanoAiu) || 0), requests: Math.max(0, Math.trunc(Number(input.cost?.requests) || 0)) }
    };
}

/** Write one new record file; never touches an existing file, so concurrent runs cannot overwrite each other. */
export function appendRunRecord(workspaceRoot: string, slug: string, input: Partial<RunRecord>): string {
    const dir = runRecordsDir(workspaceRoot, slug);
    fs.mkdirSync(dir, { recursive: true });
    const rec = normalize(slug, input);
    const stamp = rec.endedAt.replace(/[:.]/g, '-');
    for (let attempt = 0; attempt < 5; attempt++) {
        const file = path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}.json`);
        try {
            fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' });
            return file;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') { throw err; }
        }
    }
    throw new Error(`could not allocate a run record file in ${dir}`);
}

/** Records ordered by `endedAt`, then file name; malformed files are skipped and counted. */
export function readRunRecords(workspaceRoot: string, slug: string): { records: RunRecord[]; skipped: number } {
    let dir: string;
    let names: string[];
    try {
        dir = runRecordsDir(workspaceRoot, slug);
        names = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
    } catch {
        return { records: [], skipped: 0 };
    }
    const rows: Array<{ name: string; rec: RunRecord }> = [];
    let skipped = 0;
    for (const name of names) {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            if (!parsed || parsed.v !== 1 || typeof parsed.endedAt !== 'string') { skipped++; continue; }
            rows.push({ name, rec: normalize(slug, parsed) });
        } catch {
            skipped++;
        }
    }
    rows.sort((a, b) => a.rec.endedAt.localeCompare(b.rec.endedAt) || a.name.localeCompare(b.name));
    return { records: rows.map(row => row.rec), skipped };
}

export function specFacts(records: RunRecord[], skipped = 0): SpecFacts {
    const facts: SpecFacts = {
        storedStage: null, branch: '', pr: '', costNanoAiu: 0, requests: 0, agentMs: 0,
        runs: records.length, skippedRecords: skipped, lastReadiness: null
    };
    for (const rec of records) {
        facts.costNanoAiu += rec.cost.nanoAiu;
        facts.requests += rec.cost.requests;
        facts.agentMs += rec.agentMs;
        if (rec.stageAfter) { facts.storedStage = rec.stageAfter; }
        if (rec.branch) { facts.branch = rec.branch; }
        if (rec.pr) { facts.pr = rec.pr; }
        if (rec.readiness) { facts.lastReadiness = rec.readiness; }
    }
    return facts;
}
