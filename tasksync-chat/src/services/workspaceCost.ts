import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LogCursor, readLogIncrement } from '../observability/logCursor';

function canonical(root: string): string {
    try { return fs.realpathSync(root); } catch { return path.resolve(root); }
}

const files = new Map<string, { cursor: LogCursor; rows: any[] }>();
async function rows(file: string): Promise<any[]> {
    const previous = files.get(file);
    try {
        const increment = await readLogIncrement(file, previous?.cursor);
        const added = increment.raw.split('\n').flatMap(line => {
            try { const row = JSON.parse(line); return row && typeof row === 'object' && !Array.isArray(row) ? [row] : []; } catch { return []; }
        });
        const reset = previous && increment.lineIndexBase < previous.cursor.lineCount;
        const all = [...(reset ? [] : previous?.rows ?? []), ...added];
        files.set(file, { cursor: increment.cursor, rows: all });
        return all;
    } catch { return previous?.rows ?? []; }
}
const worktrees = new Map<string, { at: number; pending: Promise<Set<string>> }>();
async function ownersOf(workspace: string): Promise<Set<string>> {
    const cached = worktrees.get(workspace);
    if (cached && Date.now() - cached.at < 30000) return cached.pending;
    const pending = (async () => {
        const owners = new Set([workspace]);
        try {
            const { stdout } = await promisify(execFile)('git', ['-C', workspace, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 3000 });
            for (const line of stdout.split('\n')) if (line.startsWith('worktree ')) owners.add(canonical(line.slice(9).trim()));
        } catch { /* Not a git workspace. */ }
        return owners;
    })();
    worktrees.set(workspace, { at: Date.now(), pending });
    return pending;
}

/** Request identities, not session identities: one session can contain many billed requests. */
export async function workspaceCostRequests(root: string): Promise<Array<{ id: string; ts: number; dollars: number; source: 'worker' | 'validator' | 'eval' }>> {
    const workspace = canonical(root);
    const owners = await ownersOf(workspace);
    const home = path.join(os.homedir(), '.askaway');
    const cost = (row: any) => typeof row.usage?.cost === 'number' && Number.isFinite(row.usage.cost) ? row.usage.cost : 0;
    const requests = new Set<string>();
    const result: Awaited<ReturnType<typeof workspaceCostRequests>> = [];
    const workerRows: any[] = [];
    const billedRuns = new Set<string>();
    const add = (row: any, source: 'worker' | 'validator' | 'eval') => {
        const ts = typeof row.ts === 'number' ? row.ts : Date.parse(row.ts);
        const call = row.callId ?? row.requestId ?? row.stepId ?? row.messageId;
        const id = call ? `request:${row.sessionId ?? ''}:${call}` : row.runId && source !== 'worker' ? `run:${row.runId}`
            : row.id ? `request:${row.sessionId ?? ''}:${row.id}` : `row:${row.runId ?? ''}:${ts}:${JSON.stringify(row.usage)}`;
        if (!Number.isFinite(ts) || requests.has(id) || (source !== 'worker' && row.runId && billedRuns.has(row.runId))) return;
        requests.add(id);
        result.push({ id, ts, dollars: cost(row), source });
    };
    for (const owner of owners) {
        const key = owner.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
        for (const row of await rows(path.join(home, 'worker-ledger', key + '.jsonl'))) {
            if (typeof row.workspace !== 'string' || !owners.has(canonical(row.workspace))) continue;
            workerRows.push(row);
            if (row.type === 'checkpoint') {
                add(row, 'worker');
                if (row.runId) billedRuns.add(row.runId);
            }
        }
    }
    const specs = path.join(workspace, '.askaway', 'specs');
    let slugs: string[] = [];
    try { slugs = fs.readdirSync(specs); } catch { /* No validator records yet. */ }
    for (const slug of slugs) {
        for (const row of await rows(path.join(specs, slug, 'validator', 'responses.jsonl'))) {
            // The real validator producer stores the response timestamp before dispatch and returns worker/session IDs.
            const run = !row.runId && row.workerId && workerRows.filter(fact => fact.type === 'start' && fact.track === 'validator'
                && fact.workerId === row.workerId && (!fact.sessionId || fact.sessionId === row.sessionId) && fact.ts >= row.ts)
                .sort((a, b) => a.ts - b.ts)[0];
            if (run && billedRuns.has(run.runId)) continue;
            add(row, 'validator');
        }
    }
    for (const row of await rows(path.join(home, 'evals', 'results.jsonl'))) {
        const owned = typeof row.workspacePath === 'string' && owners.has(canonical(row.workspacePath));
        if (owned) add(row, 'eval');
    }
    return result;
}
