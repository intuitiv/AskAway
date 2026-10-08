import * as fs from 'fs/promises';
import * as path from 'path';
import { CloudRun, QueueIO, defaultIO } from './cloudQueue';

export interface LocalCommandEvidence { command: string; exitCode: number; output: string }
export type VerifyRunner = (packet: { root: string; cwd: string; head: string; commands: string[]; run: CloudRun }) => Promise<LocalCommandEvidence[]>;

export function outOfScope(paths: string[], allowed: string[]): string[] {
    return paths.filter(file => !allowed.some(pattern => {
        const expression = pattern.split('/').map(part => part === '**' ? '.*' : part.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('/');
        return new RegExp(`^${expression}$`).test(file);
    }));
}

async function scopeViolations(run: CloudRun, head: string, io: QueueIO): Promise<string[]> {
    const root = run.request.root;
    const packet = await io.git(['show', `${run.packetSha}:${run.packetPath}`], root);
    const base = /^base:\s*"?([a-f0-9]{7,40})"?\s*$/m.exec(packet)?.[1];
    const section = /^allowedPaths:\s*\r?\n((?:[ \t]+- .*(?:\r?\n|$))*)/m.exec(packet)?.[1];
    if (!base || !section) { throw new Error('Packet base or allowedPaths unavailable'); }
    const allowed = section.trim().split(/\r?\n/).map(line => {
        const value = line.trim().slice(2);
        return value.startsWith('"') ? JSON.parse(value) as string : value;
    });
    await io.git(['merge-base', '--is-ancestor', base, head], root);
    const commits = (await io.git(['rev-list', `${base}..${head}`], root)).split(/\s+/).filter(Boolean);
    const violations = new Set<string>();
    for (const commit of commits) {
        const metadata = await io.git(['show', '-s', '--format=%an%n%B', commit], root);
        if (metadata.split('\n')[0] !== 'copilot-swe-agent[bot]' || /^AskAway-Commit:/m.test(metadata)) { continue; }
        const files = (await io.git(['diff-tree', '--root', '--no-commit-id', '-r', '--no-renames', '--name-only', '-z', commit], root)).split('\0').filter(Boolean);
        outOfScope(files, allowed).forEach(file => violations.add(file));
        for (const file of files.filter(file => /(^|\/)(spec|plan)\.md$/.test(file))) {
            const diff = await io.git(['show', '--format=', '--no-renames', '--unified=0', commit, '--', file], root);
            if (/^[+-]\s*\*\*Status\*\*\s*:/m.test(diff)) { violations.add(file); }
        }
    }
    return [...violations].sort();
}

export const verifyWorkerRunner: VerifyRunner = async ({ root, cwd, head, commands, run }) => {
    const { sharedWorkerRuntimeReady } = await import('../workers/workerHost');
    const runtime = await sharedWorkerRuntimeReady(root);
    const handle = runtime.start({ workspacePath: root, cwd, profile: 'verify', dispatchTurnId: `cloud:${run.taskId}:${run.attempt}`,
        baseRevision: head, allowedFiles: [], command: commands.join('\n'),
        objective: `Read-only local verification. Run each exact command in order in ${cwd}:\n${commands.join('\n')}\nDo not edit, commit or push. Return one line LOCAL-EVIDENCE: followed by a JSON array of {command, exitCode, output}; include actual command output.`,
        acceptance: 'Every named command exits 0 with nonempty local evidence', expected: 'LOCAL-EVIDENCE: JSON array, then Result: PASS or FAIL' });
    if (!('runId' in handle)) { throw new Error(handle.reason); }
    const result = await runtime.wait(handle.runId, 60);
    if (result.status !== 'COMPLETED') { runtime.cancel(handle.runId); throw new Error(`Local verify worker ${result.status}`); }
    const line = result.evidence.find(line => line.startsWith('LOCAL-EVIDENCE:'));
    return line ? JSON.parse(line.slice('LOCAL-EVIDENCE:'.length)) : [];
};

export async function acceptCloudTask(run: CloudRun, runner: VerifyRunner = verifyWorkerRunner, io: QueueIO = defaultIO): Promise<CloudRun> {
    const next = structuredClone(run);
    if (run.state !== 'Needs review') { return next; }
    let directory: string | undefined;
    let checkout: string | undefined;
    let added = false;
    let head = '';
    let evidence: LocalCommandEvidence[] = [];
    let reason = '';
    let offendingPaths: string[] = [];
    try {
        const [, , , owner, repo, , number] = run.pr.split('/');
        const pr = await io.gh.json<{ state: string; head: { ref: string; sha: string; repo: { clone_url: string } } }>(['api', `repos/${owner}/${repo}/pulls/${number}`]);
        if (pr.state !== 'open' || pr.head.ref !== run.branch) { throw new Error('Active PR closed or branch changed'); }
        const build = path.join(run.request.root, 'build');
        await fs.mkdir(build, { recursive: true });
        directory = await fs.mkdtemp(path.join(build, 'cloud-accept-'));
        checkout = path.join(directory, 'checkout');
        await io.git(['fetch', pr.head.repo.clone_url, pr.head.ref], run.request.root);
        head = await io.git(['rev-parse', 'FETCH_HEAD'], run.request.root);
        await io.git(['worktree', 'add', '--detach', checkout, head], run.request.root);
        added = true;
        const commands = run.request.task.verify;
        evidence = await runner({ root: run.request.root, cwd: checkout, head, commands: [...commands], run: structuredClone(run) });
        offendingPaths = await scopeViolations(run, head, io);
        if (!commands.length || evidence.length !== commands.length || commands.some((command, index) =>
            evidence[index]?.command !== command || evidence[index]?.exitCode !== 0 || !evidence[index]?.output?.trim())) {
            reason = 'Local verification failed or missing exact command evidence';
        }
        if (offendingPaths.length) { reason = `Scope or human-gate violation: ${offendingPaths.join(', ')}`; }
    } catch (error) { reason = (error as Error).message; }
    finally {
        if (added && checkout) { await io.git(['worktree', 'remove', '--force', checkout], run.request.root); }
        if (directory) { await io.cleanup(directory); }
    }
    next.state = reason ? 'Returned' : 'Accepted';
    next.acceptance = { result: next.state as 'Accepted' | 'Returned', head, outOfScope: offendingPaths,
        evidence: [evidence.map(item => `${item.command} → exit ${item.exitCode}: ${item.output}`).join('\n'), reason].filter(Boolean).join('\n') };
    next.decisionNeeded = reason || undefined;
    next.history.push({ state: next.state, at: new Date().toISOString(), signal: `local verification: ${next.acceptance.evidence}` });
    return next;
}
