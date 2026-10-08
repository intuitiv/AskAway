import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGh, GhError } from './gh';
import { buildPacket, buildComment, PacketTask, PacketStory, knownSecretValues } from './packet';

export interface QueueRequest {
    root: string;
    slug: string;
    pr: string;
    explicitRequest: boolean;
    enabled: boolean;
    task: PacketTask & { tags: string[] };
    story: PacketStory;
}
export interface CloudRun {
    v: 1;
    slug: string;
    taskId: string;
    attempt: number;
    packetPath: string;
    packetSha: string;
    pr: string;
    branch: string;
    commentId: string;
    commentUrl: string;
    model: string;
    state: string;
    queuedAt: string;
    history: Array<{ at: string; state: string; signal: string }>;
    startedAt?: string;
    endedAt?: string;
    commits?: Array<{ sha: string; author: string; at: string; url: string }>;
    checkRuns?: Array<{ name: string; status: string; conclusion: string | null; url: string }>;
    report?: { url: string; result: string; verifyOutput: string; commands: string[]; question: string; model: string };
    decisionNeeded?: string;
    staleSince?: string;
    pollFailures?: number;
    nextPollAt?: string;
    acceptance?: { result: 'Accepted' | 'Returned'; head: string; evidence: string; outOfScope?: string[] };
    request: QueueRequest;
}
export interface QueueIO {
    gh: ReturnType<typeof createGh>;
    git(args: string[], cwd: string): Promise<string>;
    load(root: string): Promise<CloudRun[]>;
    save(root: string, runs: CloudRun[]): Promise<void>;
    write(file: string, text: string): Promise<void>;
    temporary(): Promise<string>;
    cleanup(dir: string): Promise<void>;
    knownValues(): string[];
}

export const defaultIO: QueueIO = {
    gh: createGh(),
    git: (args, cwd) => new Promise((resolve, reject) => {
        execFile('git', args, { cwd }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
    }),
    async load(root) {
        const dir = path.join(root, '.askaway/specs');
        let slugs: string[];
        try { slugs = await fs.readdir(dir); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error;
        }
        const runs: CloudRun[] = [];
        for (const slug of slugs) {
            try { runs.push(...JSON.parse(await fs.readFile(path.join(dir, slug, 'cloud/runs.json'), 'utf8'))); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
        }
        return runs;
    },
    async save(root, runs) {
        for (const slug of new Set(runs.map(run => run.slug))) {
            const file = path.join(root, '.askaway/specs', slug, 'cloud/runs.json');
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, JSON.stringify(runs.filter(run => run.slug === slug), null, 2));
        }
    },
    async write(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); },
    temporary: () => fs.mkdtemp(path.join(os.tmpdir(), 'askaway-cloud-queue-')),
    cleanup: dir => fs.rm(dir, { recursive: true, force: true }),
    knownValues: () => knownSecretValues(),
};
const locks = new Map<string, Promise<unknown>>();
export async function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) { locks.delete(key); } }
}
const active = new Set(['Queued', 'Working', 'Pushed', 'Checks passed', 'Checks failed', 'Checks waiting for approval']);
const finished = new Set(['Needs review', 'Accepted', 'Returned', 'Timed out', 'No response']);
export function refusalFor(request: QueueRequest, runs: CloudRun[] = []): string | undefined {
    if (!request.explicitRequest) { return 'explicit reviewer request required'; }
    if (!request.enabled) { return 'cloud tasks disabled'; }
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(request.pr)) { return `no active PR for ${request.slug}`; }
    if (!/^[\w-]+$/.test(request.slug) || !/^[\w-]+$/.test(request.task.taskId)) { return 'invalid packet identity'; }
    const local = request.task.tags.find(tag => tag.startsWith('local:'));
    if (local || !request.task.tags.includes('cloud')) {
        return `${request.task.taskId} is not cloud-eligible: ${local?.slice(6).trim() || 'not tagged cloud'}`;
    }
    const duplicate = runs.find(run => run.pr === request.pr && run.slug === request.slug && run.taskId === request.task.taskId && !['Timed out', 'No response'].includes(run.state));
    if (duplicate) { return `${request.task.taskId} already queued (${duplicate.state})`; }
    return undefined;
}

async function prepare(request: QueueRequest, io: QueueIO, runs: CloudRun[]) {
    // The active PR URL, not the checkout remote, is the repository authority.
    const [, , , owner, repo, , number] = request.pr.split('/');
    await io.gh.text(['auth', 'status']);
    const pr = await io.gh.json<{ state: string; head: { ref: string; sha: string; repo: { full_name: string; clone_url: string } } }>(['api', `repos/${owner}/${repo}/pulls/${number}`]);
    if (pr.state !== 'open') { throw new Error(`no active PR for ${request.slug}`); }
    const permission = await io.gh.json<{ permissions: { push: boolean } }>(['api', `repos/${pr.head.repo.full_name}`]);
    if (!permission.permissions?.push) { throw new Error(`no push permission on ${pr.head.repo.full_name}`); }
    const refusal = refusalFor(request, runs);
    if (refusal) { throw new Error(refusal); }
    const attempt = 1 + Math.max(0, ...runs.filter(run => run.slug === request.slug && run.taskId === request.task.taskId).map(run => run.attempt));
    const packet = buildPacket(request.task, request.story, { slug: request.slug, attempt, base: pr.head.sha, knownValues: io.knownValues() });
    buildComment({ slug: request.slug, taskId: request.task.taskId, story: request.story.story, stage: request.task.stage, packetPath: packet.path, packetSha: pr.head.sha, knownValues: io.knownValues() });
    return { pr, packet, attempt };
}

async function post(request: QueueRequest, io: QueueIO, runs: CloudRun[], held?: CloudRun): Promise<CloudRun> {
    const prepared = await prepare(request, io, held ? runs.filter(run => run !== held) : runs);
    const { pr, packet, attempt } = prepared;
    const at = new Date().toISOString();
    const run: CloudRun = held ?? { v: 1, slug: request.slug, taskId: request.task.taskId, attempt, packetPath: packet.path,
        packetSha: '', pr: request.pr, branch: pr.head.ref, commentId: '', commentUrl: '', model: 'PR default (not independently observed)',
        state: 'Held', queuedAt: at, history: [], request };
    if (!held) { runs.push(run); }
    if (runs.some(other => other !== run && other.pr === request.pr && active.has(other.state))) {
        run.history.push({ at, state: 'Held', signal: 'held: one cloud task at a time on this PR' });
        await io.save(request.root, runs);
        return run;
    }
    run.state = 'Queued';
    run.branch = pr.head.ref;
    run.history.push({ at, state: 'Queued', signal: 'explicit reviewer request' });
    // Reserve before any external write: even an uncertain push/comment failure cannot cause a duplicate retry.
    await io.save(request.root, runs);
    const temp = await io.temporary();
    const checkout = path.join(temp, 'checkout');
    let added = false;
    try {
        await io.git(['fetch', pr.head.repo.clone_url, pr.head.ref], request.root);
        await io.git(['worktree', 'add', '--detach', checkout, pr.head.sha], request.root);
        added = true;
        await io.write(path.join(checkout, packet.path), packet.text);
        await io.git(['add', '-f', '--', packet.path], checkout);
        await io.git(['commit', '-m', `[${request.task.taskId}] cloud packet\n\nAskAway-Commit: packet`], checkout);
        run.packetSha = await io.git(['rev-parse', 'HEAD'], checkout);
        await io.git(['push', pr.head.repo.clone_url, `HEAD:refs/heads/${pr.head.ref}`], checkout);
        const comment = buildComment({ slug: request.slug, taskId: request.task.taskId, story: request.story.story,
            stage: request.task.stage, packetPath: packet.path, packetSha: run.packetSha, knownValues: io.knownValues() });
        const bodyFile = path.join(temp, 'comment.md');
        await io.write(bodyFile, comment);
        run.commentUrl = (await io.gh.text(['pr', 'comment', request.pr, '--repo', `${ownerRepo(request.pr)}`, '--body-file', bodyFile])).trim();
        run.commentId = /issuecomment-(\d+)/.exec(run.commentUrl)?.[1] ?? '';
        await io.save(request.root, runs);
        return run;
    } finally {
        if (added) { await io.git(['worktree', 'remove', '--force', checkout], request.root); }
        await io.cleanup(temp);
    }
}
function ownerRepo(pr: string): string { return pr.split('/').slice(3, 5).join('/'); }

export async function queueTask(request: QueueRequest, io: QueueIO = defaultIO): Promise<{ run?: CloudRun; refusal?: string }> {
    const initial = refusalFor({ ...request, task: { ...request.task, tags: ['cloud'] } });
    if (initial) { return { refusal: initial }; }
    return serial(request.root, async () => {
        try { return { run: await post(request, io, await io.load(request.root)) }; }
        catch (error) { return { refusal: error instanceof GhError && error.kind === 'unauthenticated' ? 'gh not authenticated' : (error as Error).message }; }
    });
}

export async function releaseHeld(root: string, pr: string, io: QueueIO = defaultIO): Promise<CloudRun | undefined> {
    return serial(root, async () => {
        const runs = await io.load(root);
        if (runs.some(run => run.pr === pr && active.has(run.state))) { return undefined; }
        if (!runs.some(run => run.pr === pr && finished.has(run.state))) { return undefined; }
        const held = runs.find(run => run.pr === pr && run.state === 'Held' && run.request.explicitRequest);
        return held ? post(held.request, io, runs, held) : undefined;
    });
}
