import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkerProfile, workerInstructions } from './workerProfiles';
import type { KeepWarmWorker } from './keepWarm';
import { KEEP_WARM_PROMPT, MAX_PARALLEL_WORKERS, RouteResult, WorkerRouter } from './workerRouter';

/** agy is an alternate runtime (see agyRuntime.ts); its models are namespaced `agy/` so it never shares a worker with OpenCode. */
export const AGY_PREFIX = 'agy/';
export function isAgyModel(model: string): boolean {
    return model.startsWith(AGY_PREFIX);
}
/** Claude Code is an alternate runtime (see claudeRuntime.ts) namespaced `claude/` like agy; unlike agy it reports cost and has a prompt cache. */
export const CLAUDE_PREFIX = 'claude/';
export function isClaudeModel(model: string): boolean {
    return model.startsWith(CLAUDE_PREFIX);
}

export const MAX_WAIT_SECONDS = 240;
/** A run whose process emitted no event this long after spawn is STALLED (OpenCode is silent on a session/directory mismatch). */
export const STALL_AFTER_SECONDS = 60;
const MAX_EVIDENCE_LINES = 25;

export type RunState = 'STARTING' | 'RUNNING' | 'STALLED' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type LifecycleType = 'start' | 'message_update' | 'before_tool' | 'after_tool' | 'checkpoint' | 'approval' | 'stop' | 'error' | 'archive' | 'fork' | 'denied_continue' | 'verify_round' | 'remove';

export interface RunUsage { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; cost: number; steps: number }

/** A lifecycle fact. It carries identities, tool names, and usage numbers, never message or transcript text. */
export interface LifecycleRecord {
    lastUsedAt?: number;
    inputTokens?: number;
    ts: number;
    type: LifecycleType;
    /** The owner workspace (dispatching window). */
    workspace: string;
    /** Directory OpenCode ran in, recorded only when it differs from the owner. */
    cwd?: string;
    workerId: string;
    runId: string;
    sessionId: string;
    dispatchTurnId: string;
    source: string;
    track?: string;
    /** Set on every fact of a worker that was forked from a busy one: the parent's worker id. */
    forkedFrom?: string;
    profile: string;
    model: string;
    thinking: string;
    tool?: string;
    /** OpenCode part id of a step, or call id of a tool. */
    callId?: string;
    durMs?: number;
    status?: string;
    /** Estimated tokens (chars / 4) of a tool's input and output. */
    toolTokens?: { input: number; output: number };
    usage?: RunUsage;
    exitCode?: number;
    round?: number;
    tail?: string;
    state?: RunState;
    reason?: string;
    /** The spawned OpenCode process and its run directory, on the start fact written at spawn. */
    pid?: number;
    dir?: string;
    /** A keep-warm ping's checkpoint: a real request that only refreshed the prompt cache. */
    ping?: boolean;
    /** A checkpoint of a runtime that reports no dollar cost (agy): usage.cost is unknown, not 0. */
    costStatus?: 'unreported';
    /** On an agy start fact: the conversation was given the run directory with --add-dir (older rows lack it). */
    addDir?: boolean;
}

export interface WorkerPacket {
    /** The OWNER: the dispatching window's workspace. Keys the ledger, Workers tab, banner and spend. */
    workspacePath: string;
    /** Where OpenCode runs (e.g. a git worktree of the owner); defaults to the owner. */
    cwd?: string;
    profile: string;
    /** Worker runtime: OpenCode (default), agy or claude. `agy`/`claude` run `model` (e.g. gemini-4-argon-medium, sonnet) through that CLI. */
    runtime?: 'opencode' | 'agy' | 'claude';
    /** agy only, explicit per run: `skip` passes --dangerously-skip-permissions. Refused for a profile that denies edits or shell. */
    agyPermissions?: 'review' | 'skip';
    model?: string;
    thinking?: string;
    dispatchTurnId: string;
    baseRevision: string;
    objective: string;
    allowedFiles: string[];
    acceptance: string;
    expected: string;
    command: string;
    estimatedSeconds?: number;
    /** The orchestrator's track this packet belongs to (e.g. "A"); the Workers tab groups by it. */
    track?: string;
}

export interface RunView {
    runId: string;
    workerId: string;
    sessionId: string;
    state: RunState;
    profile: string;
    model: string;
    thinking: string;
    dispatchTurnId: string;
    track: string;
    startedAt: number;
    endedAt?: number;
    updatedAt: number;
    elapsedMs: number;
    usage: RunUsage;
    queuePosition: number;
    reason?: string;
    /** What the worker's next model request will send: last prompt (input + cache) plus last output. */
    nextInputTokens: number;
    /** Full prompt of the last model request (input + cache) and how much of it was a cache hit. */
    lastPromptTokens: number;
    lastCachedTokens: number;
    /** The worker's own one-line summary of the context it holds, for reuse decisions. */
    knowledge: string;
    /** Set when the packet asked for a thinking the reused worker does not have: it keeps its own (e.g. "thinking: medium (worker's)"). */
    thinkingNote?: string;
    /** Parent worker id when this run's worker was forked from a busy one. */
    forkedFrom?: string;
    /** Set for a runtime that reports no dollar cost (agy): usage.cost is not an actual 0. */
    costStatus?: 'unreported';
    /** Set when the packet explicitly opted this agy run out of agy's permission review. */
    agyPermissions?: 'skip';
}

export interface ChildLike {
    pid?: number;
    stdout: NodeJS.ReadableStream | null;
    stderr?: NodeJS.ReadableStream | null;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    kill(signal?: NodeJS.Signals): boolean;
}

/** `options` is given for a non-OpenCode runtime (agy): its binary, the run directory it starts in, and the run title. */
export type Spawner = (args: string[], options?: { command: string; cwd: string; title: string }) => ChildLike;

/** Forks an OpenCode session at its last completed message and returns the new session's id. */
export type ForkSession = (sessionId: string) => Promise<{ sessionId: string }>;

export interface RuntimeOptions {
    onPresence?: (workspace: string, worker: { id: string; displayName: string }, present: boolean) => void;
    ledgerDir?: string;
    now?: () => number;
    spawner?: Spawner;
    attachUrl?: string;
    /** Defaults to the shared server's HTTP API at the attach URL; tests inject a fake. */
    forkSession?: ForkSession;
    /** One-shot timer for the stall detector; tests inject a manual one. Returns its canceller. */
    setTimer?: (fire: () => void, ms: number) => () => void;
    /** The agy binary for `runtime: 'agy'` workers; defaults to `agy` on PATH. */
    agyCommand?: string;
    /** Temporary agy verify-loop + continue-on-denial toggle (`askaway.workers.agyVerifyLoop`, default true). */
    agyVerifyLoop?: boolean | (() => boolean);
    /** The claude binary for `runtime: 'claude'` workers; defaults to `claude` on PATH. */
    claudeCommand?: string;
    /** The AskAway MCP URL handed to Claude with --mcp-config; defaults to the URL the extension registers for MCP clients. */
    claudeMcpUrl?: () => string;
}

interface RunRecord extends RunView {
    workspace: string;
    cwd: string;
    packet: string;
    command: string;
    evidence: string[];
    child?: ChildLike;
    /** The process of the run's latest launch, restored from its start fact after a reload. */
    pid?: number;
    waiters: Array<() => void>;
    autoResumes?: number;
    deniedContinued?: boolean;
    verifyRounds?: number;
    /** Failing lines the packet verify command already printed before the agy worker started; undefined until measured. */
    baseline?: string[];
    /** agy capacity (429) retries used by this run. */
    capacityRetries?: number;
    /** Clears the pending capacity-retry backoff timer; set only while a retry waits. */
    cancelCapacityRetry?: () => void;
    /** agy: each allowed file's `mtime:size` (or `missing`) before the run's first launch, for the no-edits check. */
    filesAtStart?: Record<string, string>;
    /** agy: newest allowed-file mtime seen, and when the stall detector last looked. */
    lastEditMs?: number;
    stallCheckAt?: number;
}

interface ServerMessage { info: { id: string; role: string; parentID?: string; time?: { completed?: number } } }

/**
 * Forks a session through the shared OpenCode server (`POST /session/:id/fork`). The body's `messageID` is exclusive, so a
 * session that is mid-answer is cut at the user message of its unfinished reply: the fork keeps every completed message
 * and never copies the partial one. Errors carry the HTTP status only, never a response body.
 */
export async function forkSessionViaServer(baseUrl: string, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<{ sessionId: string }> {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) { throw new Error('invalid session id'); }
    const call = async (method: string, route: string, body?: unknown): Promise<any> => {
        const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${route}`, {
            method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(FORK_HTTP_TIMEOUT_MS),
        });
        if (!res.ok) { throw new Error(`${method} ${route.replace(sessionId, ':id')} -> HTTP ${res.status}`); }
        const text = await res.text();
        return text ? JSON.parse(text) : undefined;
    };
    const messages: ServerMessage[] = await call('GET', `/session/${sessionId}/message`);
    const unfinished = messages.find((m) => m.info.role === 'assistant' && !m.info.time?.completed);
    const last = messages[messages.length - 1];
    const cut = unfinished ? (messages.some((m) => m.info.id === unfinished.info.parentID) ? unfinished.info.parentID : unfinished.info.id)
        : last?.info.role === 'user' ? last.info.id : undefined;
    if ((cut ? messages.findIndex((m) => m.info.id === cut) : messages.length) <= 0) { throw new Error('no completed message to fork from yet'); }
    const fork = await call('POST', `/session/${sessionId}/fork`, cut ? { messageID: cut } : {});
    if (!fork?.id) { throw new Error('fork returned no session id'); }
    return { sessionId: String(fork.id) };
}


const MAX_AUTO_RESUMES = 2;
const FORK_HTTP_TIMEOUT_MS = 15000;
const PING_HTTP_TIMEOUT_MS = 60000;
const UNFINISHED_FEEDBACK = 'You stopped before finishing the packet. Continue from where you stopped, run the verification command, '
    + 'and end with the required report including a `Result: PASS | FAIL | BLOCKED` line.';

/** Feedback for a worker whose command was auto-rejected, so it adapts instead of the run dying. */
export function rejectionFeedback(rejected: string[]): string {
    return `These commands were auto-rejected (headless run, not in the allowlist): ${rejected.join('; ')}. Do not retry them. `
        + 'Read files with your read/grep/glob tools. Run shell commands only as ONE simple command prefixed with `rtk ` '
        + '(no cd, &&, |, ; or redirects). Continue the packet from where you stopped and finish it with the required report.';
}

const REQUIRED: Array<keyof WorkerPacket> = ['workspacePath', 'profile', 'dispatchTurnId', 'baseRevision', 'objective', 'acceptance', 'expected', 'command'];
const PLACEHOLDER = /\bTBD\b|\bTODO\b|<required[^>]*>|\?\?\?/i;
export const CREDENTIAL = /\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|\bsqu_[A-Za-z0-9]{20,}|\d{8,}:[A-Za-z0-9_-]{30,}/;

/** Rejects packets that a worker could not execute from the packet alone, or that would leak a credential. */
export function validatePacket(packet: WorkerPacket): string {
    for (const field of REQUIRED) {
        const value = packet[field];
        if (value === undefined || String(value).trim() === '') { return `missing ${field}`; }
    }
    const text = JSON.stringify(packet);
    if (PLACEHOLDER.test(text)) { return 'packet contains an unresolved placeholder'; }
    if (CREDENTIAL.test(text)) { return 'packet contains a credential'; }
    return '';
}

export function renderPacket(packet: WorkerPacket): string {
    return [
        `Objective: ${packet.objective}`,
        `Base revision: ${packet.baseRevision}`,
        `Allowed files: ${packet.allowedFiles.length ? packet.allowedFiles.join(', ') : 'none (read-only)'}`,
        `Acceptance: ${packet.acceptance}`,
        `Expected result: ${packet.expected}`,
        `Verification command: ${packet.command}`,
        'Finish with: Result: PASS|FAIL|BLOCKED, Evidence: <exact line>, Not done: <list or none>, Knowledge: <up to 25 words on the code and context you now hold, so later packets can reuse you>.',
    ].join('\n');
}

/** The directory OpenCode runs a packet in: its cwd, else the owner workspace. Session reuse is keyed by it. */
function runDir(packet: WorkerPacket): string {
    return canonical(packet.cwd || packet.workspacePath);
}

function workspaceKey(workspace: string): string {
    return workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function canonical(workspace: string): string {
    try { return fs.realpathSync(workspace); } catch { return workspace; }
}

const worktreeCache = new Map<string, { at: number; paths: string[] }>();

/** Other git worktrees of `workspace` (`git worktree list --porcelain`), cached 30s; empty when not a git repo. */
function worktreesOf(workspace: string): string[] {
    const cached = worktreeCache.get(workspace);
    if (cached && Date.now() - cached.at < 30_000) { return cached.paths; }
    let paths: string[] = [];
    try {
        const out = childProcess.execFileSync('git', ['-C', workspace, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
        paths = out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => canonical(line.slice('worktree '.length).trim()))
            .filter((dir) => dir !== workspace);
    } catch { /* not a git repo or git missing */ }
    worktreeCache.set(workspace, { at: Date.now(), paths });
    return paths;
}

function emptyUsage(): RunUsage {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 };
}

function processAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** The lines of a verify output that name a failure (`FAIL …`) or its location (`at …:line`), compared before and after a worker. */
export function failingLines(output: string): string[] {
    return [...new Set(output.split('\n').map((line) => line.trim())
        .filter((line) => (/^FAIL\b/.test(line) || /^at\s.+:\d+/.test(line)) && !line.includes('node:internal')))];
}

/** The packet's allowed files, read from its rendered `Allowed files:` line. */
function packetAllowedFiles(packet: string): string[] {
    return (/^Allowed files: (.*)$/m.exec(packet)?.[1] ?? '').split(',').map((f) => f.trim()).filter((f) => f && !f.startsWith('none'));
}

/** Each allowed file of a run as `mtime:size`, or `missing`. */
function fileStates(run: { packet: string; cwd: string }): Record<string, string> {
    const states: Record<string, string> = {};
    for (const file of packetAllowedFiles(run.packet)) {
        try { const stat = fs.statSync(path.resolve(run.cwd, file)); states[file] = `${stat.mtimeMs}:${stat.size}`; } catch { states[file] = 'missing'; }
    }
    return states;
}

/** A failure inside a file the packet may edit (or a missing check file) is the packet's job, never "pre-existing". */
export function failureOwnedByPacket(failing: string[], packet: string, output: string): boolean {
    if (/Cannot find module|MODULE_NOT_FOUND/.test(output)) { return true; }
    const allowed = packetAllowedFiles(packet);
    return failing.some((line) => allowed.some((file) => line.includes(file)));
}

function defaultAgyVerifyLoop(): boolean {
    try {
        const vscode = require('vscode') as typeof import('vscode');
        return vscode.workspace.getConfiguration('askaway.workers').get<boolean>('agyVerifyLoop', true);
    } catch {
        return true;
    }
}

// Worker stderr is also kept in a per-run file: it never enters the caller's context, but remains for diagnosis.
const defaultSpawner: Spawner = (args, options) => {
    fs.mkdirSync('/tmp/aa', { recursive: true });
    const title = options?.title || args[args.indexOf('--title') + 1] || 'run';
    const child = childProcess.spawn(options?.command ?? 'opencode', args, { stdio: ['ignore', 'pipe', 'pipe'], ...(options ? { cwd: options.cwd } : {}) });
    const errFile = path.join('/tmp/aa', `${title.replace(/[^a-zA-Z0-9-]+/g, '_')}.err`);
    child.stderr.pipe(fs.createWriteStream(errFile, { flags: 'a' }));
    // A missing binary emits `error` (no `exit`): left unhandled it would crash the extension host, so it ends the run as a failed exit.
    child.on('error', (error) => { try { fs.appendFileSync(errFile, `${error.message}\n`); } catch { /* diagnosis only */ } child.emit('exit', 127, null); });
    return child;
};

/** Runs AskAway worker packets as OpenCode sessions and records their lifecycle and real provider usage. */
export class OpenCodeWorkerRuntime {
    readonly router: WorkerRouter;
    private readonly runs = new Map<string, RunRecord>();
    private readonly sessionsByWorker = new Map<string, string>();
    /** Keep-warm pings sent since each worker's last real run, and the pings in flight. */
    private readonly unusedPings = new Map<string, number>();
    private readonly pinging = new Set<string>();
    private readonly rehydrated = new Set<string>();
    /** Per agy worker: whether its current conversation was created with --add-dir. False only for conversations from older ledger rows. */
    private readonly agyAddDir = new Map<string, boolean>();
    private readonly adopted = new Map<string, { workspace: string; profile: string; model: string; thinking: string; sessionId: string; contextTokens: number; lastTs: number; forkedFrom?: string; cwd: string }>();
    private readonly ledgerDir: string;
    readonly now: () => number;
    private readonly spawner: Spawner;
    private readonly onPresence?: RuntimeOptions['onPresence'];
    private attachUrl?: string;
    private readonly forkSession?: ForkSession;
    private readonly setTimer: (fire: () => void, ms: number) => () => void;
    private readonly agyCommand: string;
    private readonly agyVerifyLoop: () => boolean;
    private readonly claudeCommand: string;
    private readonly claudeMcpUrl: () => string;

    constructor(profiles: WorkerProfile[], options: RuntimeOptions = {}) {
        this.agyCommand = options.agyCommand ?? 'agy';
        this.claudeCommand = options.claudeCommand ?? 'claude';
        this.claudeMcpUrl = options.claudeMcpUrl ?? (() => (require('./claudeRuntime') as typeof import('./claudeRuntime')).askawayMcpUrl());
        const verifyLoop = options.agyVerifyLoop;
        this.agyVerifyLoop = typeof verifyLoop === 'function' ? verifyLoop : () => verifyLoop ?? defaultAgyVerifyLoop();
        this.now = options.now ?? Date.now;
        this.onPresence = options.onPresence;
        this.router = new WorkerRouter(profiles, { now: this.now });
        this.ledgerDir = options.ledgerDir ?? path.join(os.homedir(), '.askaway', 'worker-ledger');
        this.spawner = options.spawner ?? defaultSpawner;
        this.attachUrl = options.attachUrl;
        this.forkSession = options.forkSession;
        this.setTimer = options.setTimer ?? ((fire, ms) => { const timer = setTimeout(fire, ms); timer.unref?.(); return () => clearTimeout(timer); });
    }

    /** The shared OpenCode server workers attach to; empty when each run hosts its own. */
    get serverEndpoint(): string {
        return this.attachUrl ?? '';
    }

    /** Later launches attach to this server instead of hosting their own. */
    setServerEndpoint(url: string): void {
        this.attachUrl = url || undefined;
    }

    private capRefusal(adding: number): { status: 'PARALLEL_CAP'; running: number; max: number; reason: string } | undefined {
        const running = this.router.runningCount();
        if (running + adding <= MAX_PARALLEL_WORKERS) { return undefined; }
        return { status: 'PARALLEL_CAP', running, max: MAX_PARALLEL_WORKERS,
            reason: `${running} workers running; ${adding} more would exceed the cap of ${MAX_PARALLEL_WORKERS}. Wait for a worker to finish.` };
    }

    /** The explicit agy permission opt-out is valid only on an agy model and a profile that allows both edits and shell. */
    private permissionRefusal(packet: WorkerPacket, model: string): string {
        if (packet.agyPermissions !== 'skip') { return ''; }
        if (!isAgyModel(model)) { return 'agyPermissions applies only to runtime agy'; }
        const profile = this.router.profile(packet.profile);
        if (!profile || profile.edit === 'deny' || profile.bash === 'deny') { return `profile ${packet.profile} denies edits or shell, so agy permissions cannot be skipped`; }
        return '';
    }

    start(packet: WorkerPacket): RunView | { status: 'SELECTION_UNAVAILABLE' | 'INELIGIBLE'; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>> {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', reason: invalid }; }
        // The runtime is chosen explicitly; its models are namespaced `agy/` so agy and OpenCode workers never share a session.
        if (packet.runtime === 'agy') {
            if (!packet.model) { return { status: 'INELIGIBLE', reason: 'runtime agy needs a model, e.g. gemini-4-argon-medium' }; }
            packet = { ...packet, model: isAgyModel(packet.model) ? packet.model : AGY_PREFIX + packet.model };
        } else if (packet.runtime === 'claude') {
            if (!packet.model) { return { status: 'INELIGIBLE', reason: 'runtime claude needs a model, e.g. sonnet' }; }
            packet = { ...packet, model: isClaudeModel(packet.model) ? packet.model : CLAUDE_PREFIX + packet.model };
        } else if (packet.runtime === 'opencode' && packet.model && (isAgyModel(packet.model) || isClaudeModel(packet.model))) {
            return { status: 'INELIGIBLE', reason: `model ${packet.model} belongs to runtime ${isAgyModel(packet.model) ? 'agy' : 'claude'}, not opencode` };
        }
        const permission = this.permissionRefusal(packet, packet.model ?? '');
        if (permission) { return { status: 'INELIGIBLE', reason: permission }; }
        const workspace = canonical(packet.workspacePath);
        this.refreshFromLedger(workspace);
        const capped = this.capRefusal(1);
        if (capped) { return capped; }
        const routed = this.router.route({ workspacePath: workspace, cwd: runDir(packet), profile: packet.profile, model: packet.model, thinking: packet.thinking,
            sessionKey: packet.track === 'validator' ? 'validator' : undefined,
            packetId: packet.objective.slice(0, 40), estimatedSeconds: packet.estimatedSeconds ?? 60 });
        if (routed.status === 'SELECTION_UNAVAILABLE') { return routed; }
        return this.admit(routed, workspace, packet);
    }

    submit(workerId: string, packet: WorkerPacket): RunView | { status: 'RETIRED' | 'INELIGIBLE' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD' | 'REMOVED'; workerId?: string; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>> {
        const invalid = validatePacket(packet);
        if (invalid) { return { status: 'INELIGIBLE', workerId, reason: invalid }; }
        const permission = this.permissionRefusal(packet, this.router.worker(workerId)?.model ?? '');
        if (permission) { return { status: 'INELIGIBLE', workerId, reason: permission }; }
        this.refreshFromLedger(canonical(packet.workspacePath));
        // Queuing behind a running worker adds no parallelism; starting on an idle one does.
        const capped = this.router.worker(workerId)?.active ? undefined : this.capRefusal(1);
        if (capped) { return capped; }
        const routed = this.router.submitTo(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60, runDir(packet));
        if (!('runId' in routed)) {
            return { status: routed.status === 'RETIRED' || routed.status === 'CWD_MISMATCH' || routed.status === 'WORKER_TOO_OLD' || routed.status === 'REMOVED' ? routed.status : 'INELIGIBLE', workerId, reason: routed.reason };
        }
        return this.admit(routed, canonical(packet.workspacePath), packet);
    }

    /**
     * submit, except that a busy worker whose expected wait is past FORK_AFTER_SECONDS is forked at its last completed
     * message and the packet runs on the fork in parallel (status FORKED). When the fork is impossible the packet queues
     * as submit does, with the reason in `forkSkipped`.
     */
    async submitForking(workerId: string, packet: WorkerPacket): Promise<ReturnType<OpenCodeWorkerRuntime['submit']> | (RunView & { status: 'FORKED'; forkedFrom: string })
        | (RunView & { forkSkipped: string })> {
        const mismatch = validatePacket(packet) ? '' : this.router.cwdMismatch(workerId, runDir(packet));
        if (mismatch) { return { status: 'CWD_MISMATCH', workerId, reason: mismatch }; }
        const candidate = validatePacket(packet) ? undefined : this.router.forkCandidate(workerId);
        if (!candidate) { return this.submit(workerId, packet); }
        const forkCapped = this.capRefusal(1);
        if (forkCapped) { return forkCapped; }
        const parentSession = this.sessionsByWorker.get(workerId);
        const fork = this.forkSession ?? (this.attachUrl ? ((id: string) => forkSessionViaServer(this.attachUrl as string, id)) : undefined);
        let forkedSession = '';
        let skipped = '';
        if (!parentSession) { skipped = 'the busy worker has no OpenCode session yet'; }
        else if (isAgyModel(this.router.worker(workerId)?.model ?? '')) { skipped = 'agy conversations cannot be forked'; }
        else if (isClaudeModel(this.router.worker(workerId)?.model ?? '')) { skipped = 'claude conversations cannot be forked'; }
        else if (!fork) { skipped = 'no shared OpenCode server attached'; }
        else {
            try { forkedSession = (await fork(parentSession)).sessionId; } catch (error) { skipped = `fork failed: ${(error as Error).message}`; }
        }
        if (!forkedSession) {
            const queued = this.submit(workerId, packet);
            return 'runId' in queued ? { ...queued, forkSkipped: skipped } : { ...queued, reason: `${queued.reason}; fork skipped: ${skipped}` };
        }
        const workspace = canonical(packet.workspacePath);
        const routed = this.router.startFork(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60);
        if (!routed || !('runId' in routed)) { return this.submit(workerId, packet); }
        this.sessionsByWorker.set(routed.workerId, forkedSession);
        const parentKnowledge = [...this.runs.values()].filter((run) => run.workerId === workerId && run.knowledge).pop()?.knowledge ?? '';
        const view = this.admit(routed, workspace, packet, parentKnowledge);
        this.record(this.runs.get(view.runId) as RunRecord, { type: 'fork', reason: `forked from ${workerId} (session ${parentSession})` });
        return { ...this.view(this.runs.get(view.runId) as RunRecord), status: 'FORKED', forkedFrom: workerId };
    }

    /**
     * Warm-then-fan-out: forks an IDLE warm worker's session once per packet. Every fork is a new worker with the warm
     * worker's profile, model and thinking (the point is to reuse its prompt cache), runs in parallel, and stays reusable.
     * Refused whole (nothing forked or started) on any mismatch, on the parallel cap, or when a fork fails.
     */
    async fanout(workerId: string, packets: WorkerPacket[]): Promise<{ status: 'FANNED_OUT'; workerId: string; runs: Array<RunView & { forkedFrom: string }> }
        | { status: 'INELIGIBLE' | 'MODEL_MISMATCH' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD'; workerId: string; reason: string } | NonNullable<ReturnType<OpenCodeWorkerRuntime['capRefusal']>>> {
        const refuse = (status: 'INELIGIBLE' | 'MODEL_MISMATCH' | 'CWD_MISMATCH' | 'WORKER_TOO_OLD', reason: string) => ({ status, workerId, reason });
        if (packets.length < 2 || packets.length > MAX_PARALLEL_WORKERS) { return refuse('INELIGIBLE', `fanout needs 2..${MAX_PARALLEL_WORKERS} packets, got ${packets.length}`); }
        const parentReason = this.router.fanoutRefusal(workerId);
        if (parentReason) { return refuse(/^idle more than/.test(parentReason) ? 'WORKER_TOO_OLD' : 'INELIGIBLE', parentReason); }
        const parent = this.router.worker(workerId) as NonNullable<ReturnType<WorkerRouter['worker']>>;
        for (const [index, packet] of packets.entries()) {
            const invalid = validatePacket(packet);
            if (invalid) { return refuse('INELIGIBLE', `packet ${index + 1}: ${invalid}`); }
            const wrongDir = this.router.cwdMismatch(workerId, runDir(packet));
            if (wrongDir) { return refuse('CWD_MISMATCH', `packet ${index + 1}: ${wrongDir}`); }
            const mismatch = packet.profile !== parent.profile ? `profile ${packet.profile} != ${parent.profile}`
                : packet.model && packet.model !== parent.model ? `model ${packet.model} != ${parent.model}`
                : packet.thinking && packet.thinking !== parent.thinking ? `thinking ${packet.thinking} != ${parent.thinking}` : '';
            if (mismatch) { return refuse('MODEL_MISMATCH', `packet ${index + 1}: ${mismatch}; forks reuse the warm worker's cache, so they keep its profile, model and thinking`); }
        }
        const capped = this.capRefusal(packets.length);
        if (capped) { return capped; }
        const parentSession = this.sessionsByWorker.get(workerId);
        const fork = this.forkSession ?? (this.attachUrl ? ((id: string) => forkSessionViaServer(this.attachUrl as string, id)) : undefined);
        if (!parentSession) { return refuse('INELIGIBLE', 'the warm worker has no OpenCode session yet'); }
        if (isAgyModel(parent.model)) { return refuse('INELIGIBLE', 'agy conversations cannot be forked'); }
        if (isClaudeModel(parent.model)) { return refuse('INELIGIBLE', 'claude conversations cannot be forked'); }
        if (!fork) { return refuse('INELIGIBLE', 'no shared OpenCode server attached'); }
        let sessions: string[];
        try { sessions = (await Promise.all(packets.map(() => fork(parentSession)))).map((forked) => forked.sessionId); }
        catch (error) { return refuse('INELIGIBLE', `fork failed: ${(error as Error).message}`); }
        // The forks awaited above may have let other dispatches in: re-check so the cap holds.
        const recapped = this.capRefusal(packets.length);
        if (recapped) { return recapped; }
        const parentKnowledge = [...this.runs.values()].filter((run) => run.workerId === workerId && run.knowledge).pop()?.knowledge ?? '';
        const runs: Array<RunView & { forkedFrom: string }> = [];
        for (const [index, packet] of packets.entries()) {
            const routed = this.router.startFork(workerId, packet.objective.slice(0, 40), packet.estimatedSeconds ?? 60);
            if (!routed || !('runId' in routed)) { continue; }
            this.sessionsByWorker.set(routed.workerId, sessions[index]);
            const view = this.admit(routed, canonical(packet.workspacePath), packet, parentKnowledge);
            this.record(this.runs.get(view.runId) as RunRecord, { type: 'fork', reason: `fanned out from ${workerId} (session ${parentSession})` });
            runs.push({ ...this.view(this.runs.get(view.runId) as RunRecord), forkedFrom: workerId });
        }
        return { status: 'FANNED_OUT', workerId, runs };
    }

    status(runId: string): (RunView & { evidence?: string[] }) | undefined {
        const run = this.runs.get(runId);
        if (!run) { return undefined; }
        return this.terminal(run.state) ? { ...this.view(run), evidence: run.evidence } : this.view(run);
    }

    list(workspacePath: string): Array<RunView & { sessionOpenAction: string; contextTokens: number; workerState: string }> {
        const workspace = canonical(workspacePath);
        return [...this.runs.values()]
            .filter((run) => run.workspace === workspace)
            .map((run) => {
                const worker = this.router.worker(run.workerId);
                return { ...this.view(run), contextTokens: worker?.contextTokens ?? 0, workerState: worker?.state ?? 'UNKNOWN',
                    // agy and claude have no OpenCode viewer: their runs show only through logs and the trace.
                    sessionOpenAction: !run.sessionId || isAgyModel(run.model) || isClaudeModel(run.model) ? '' : this.attachUrl
                        ? `opencode attach ${this.attachUrl} --session ${run.sessionId}` : `opencode --session ${run.sessionId}` };
            });
    }

    /** Waits at most 240 seconds; reaching the ceiling is a normal STILL_RUNNING result, not a failure. */
    async wait(runId: string, timeoutSeconds = MAX_WAIT_SECONDS): Promise<
        | { status: 'COMPLETED'; runId: string; evidence: string[] }
        | { status: 'FAILED' | 'CANCELLED'; runId: string; reason: string }
        | { status: 'STALLED'; runId: string; workerId: string; sessionId: string; reason: string }
        | { status: 'STILL_RUNNING'; runId: string; workerId: string; state: RunState; waitedSeconds: number }
        | { status: 'UNKNOWN_RUN'; runId: string }> {
        const run = this.runs.get(runId);
        if (!run) { return { status: 'UNKNOWN_RUN', runId }; }
        const bound = Math.min(Math.max(0, timeoutSeconds), MAX_WAIT_SECONDS);
        const started = this.now();
        if (!this.terminal(run.state) && run.state !== 'STALLED') {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, bound * 1000);
                run.waiters.push(() => { clearTimeout(timer); resolve(); });
            });
        }
        if (run.state === 'COMPLETED') { return { status: 'COMPLETED', runId, evidence: run.evidence }; }
        if (run.state === 'FAILED' || run.state === 'CANCELLED') { return { status: run.state, runId, reason: run.reason ?? run.state.toLowerCase() }; }
        if (run.state === 'STALLED') { return { status: 'STALLED', runId, workerId: run.workerId, sessionId: run.sessionId, reason: run.reason ?? 'stalled' }; }
        return { status: 'STILL_RUNNING', runId, workerId: run.workerId, state: run.state, waitedSeconds: Math.round((this.now() - started) / 1000) };
    }

    cancel(runId: string): { status: 'CANCELLATION_REQUESTED' | 'NOT_CANCELLABLE'; runId: string; reason?: string } {
        const run = this.runs.get(runId);
        if (!run || this.terminal(run.state)) { return { status: 'NOT_CANCELLABLE', runId, reason: run ? `already ${run.state}` : 'unknown run' }; }
        if (run.queuePosition > 0) {
            this.router.cancelQueued(run.workerId, runId);
            this.finish(run, 'CANCELLED', 'cancelled before start');
        } else if (run.cancelCapacityRetry) {
            // A run waiting out a capacity backoff has no process: stop the timer and end it now.
            run.cancelCapacityRetry();
            run.cancelCapacityRetry = undefined;
            run.reason = 'cancelled by caller';
            this.finalizeRun(run, 'CANCELLED', -1);
        } else {
            run.reason = 'cancelled by caller';
            run.child?.kill('SIGTERM');
        }
        return { status: 'CANCELLATION_REQUESTED', runId };
    }

    /** Resume continues a run's OpenCode session; without a session or on a retired worker a fresh submission is required. */
    resume(runId: string): RunView | { status: 'FRESH_SUBMISSION_REQUIRED'; runId: string; reason: string } {
        const run = this.runs.get(runId);
        const worker = run ? this.router.worker(run.workerId) : undefined;
        if (!run || !worker) { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'unknown run' }; }
        if (worker.state === 'RETIRED' || worker.state === 'ORPHANED') {
            return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: worker.retiredReason ?? `worker ${worker.state.toLowerCase()}` };
        }
        if (!run.sessionId) { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'no OpenCode session to resume' }; }
        if (!this.terminal(run.state)) { return this.view(run); }
        if (run.state === 'COMPLETED') { return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'run already completed' }; }
        // A run restored after a reload has no child here; its agy process may still be running the same conversation.
        if (!run.child && run.pid && (isAgyModel(run.model) || isClaudeModel(run.model)) && processAlive(run.pid)) {
            return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: `${isAgyModel(run.model) ? 'agy' : 'claude'} process ${run.pid} from before the reload is still running this conversation; wait for it to exit, then resume` };
        }
        this.refreshFromLedger(run.workspace);
        if (!this.router.resumeRun(run.workerId, run.runId, run.packet.slice(0, 40), 60)) {
            return { status: 'FRESH_SUBMISSION_REQUIRED', runId, reason: 'worker is no longer idle; submit fresh work' };
        }
        run.state = 'STARTING';
        run.endedAt = undefined;
        run.reason = undefined;
        run.deniedContinued = undefined;
        run.verifyRounds = undefined;
        run.capacityRetries = undefined;
        this.launch(run, 'Continue the previous packet from where it stopped and finish it.');
        return this.view(run);
    }

    /** Lifecycle facts for a run. Text is never included. */
    logs(runId: string): LifecycleRecord[] {
        const run = this.runs.get(runId);
        if (!run) { return []; }
        // The spawn-time start fact of a fresh session is written before OpenCode names it: readers see the run's session on it.
        return this.readLedger(run.workspace).filter((record) => record.runId === runId)
            .map((record) => (record.sessionId || !run.sessionId ? record : { ...record, sessionId: run.sessionId }));
    }

    /** Every lifecycle fact of a workspace, in the order they happened. */
    facts(workspacePath: string): LifecycleRecord[] {
        return this.readLedger(canonical(workspacePath));
    }

    /**
     * Restores this workspace's workers and runs from the ledger after a reload. A worker reconnects only when the
     * shared server is live and it has a recorded session; otherwise it is ORPHANED with the reason. Safe to call again:
     * once the server is up, server-orphaned workers reconnect.
     */
    rehydrate(workspacePath: string, serverLive: boolean): { reconnected: string[]; orphaned: Array<{ workerId: string; reason: string }> } {
        const workspace = canonical(workspacePath);
        if (!this.rehydrated.has(workspace)) {
            this.rehydrated.add(workspace);
            this.restoreRuns(workspace);
        }
        const result = { reconnected: [] as string[], orphaned: [] as Array<{ workerId: string; reason: string }> };
        for (const [workerId, adopted] of this.adopted) {
            if (adopted.workspace !== workspace) { continue; }
            // An agy or claude conversation is resumed by its CLI itself, never through the OpenCode server.
            const cli = isAgyModel(adopted.model) ? 'agy' : isClaudeModel(adopted.model) ? 'claude' : '';
            const reason = cli ? (!adopted.sessionId ? `no ${cli} conversation was recorded before reload` : '')
                : !serverLive ? 'shared OpenCode server not reachable after reload'
                : !adopted.sessionId ? 'no OpenCode session was recorded before reload' : '';
            this.router.adopt({ workerId, workspacePath: workspace, profile: adopted.profile, model: adopted.model, thinking: adopted.thinking,
                contextTokens: adopted.contextTokens, lastActivityAt: adopted.lastTs, forkedFrom: adopted.forkedFrom, cwd: adopted.cwd }, reason ? 'ORPHANED' : 'IDLE', reason || undefined);
            if (reason) { result.orphaned.push({ workerId, reason }); } else {
                this.sessionsByWorker.set(workerId, adopted.sessionId);
                result.reconnected.push(workerId);
            }
        }
        return result;
    }

    /**
     * Archive-only prune. Takes only workers that are not running, have an empty queue, and can no longer be reused
     * (retired, orphaned, or cache cold). Their ledger facts stay (cost history is never deleted); live views drop them.
     */
    archive(workspacePath: string): { archived: string[]; kept: Array<{ workerId: string; reason: string }> } {
        const workspace = canonical(workspacePath);
        const byWorker = new Map<string, RunRecord[]>();
        for (const run of this.runs.values()) {
            if (run.workspace !== workspace) { continue; }
            byWorker.set(run.workerId, [...(byWorker.get(run.workerId) ?? []), run]);
        }
        const result = { archived: [] as string[], kept: [] as Array<{ workerId: string; reason: string }> };
        for (const [workerId, runs] of byWorker) {
            const routed = this.router.worker(workerId);
            const busy = runs.some((run) => !this.terminal(run.state)) || !!routed?.active || (routed?.queue.length ?? 0) > 0;
            const expires = routed ? this.router.cacheExpiresAt(routed) : 0;
            const reusable = !!routed && routed.state !== 'RETIRED' && routed.state !== 'ORPHANED'
                && (isAgyModel(routed.model) || (expires > 0 && this.now() < expires));
            if (busy || reusable) { result.kept.push({ workerId, reason: busy ? 'running or queued work' : 'still reusable (cache warm)' }); continue; }
            const latest = runs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
            this.record(latest, { type: 'archive' });
            for (const run of runs) { this.runs.delete(run.runId); }
            this.router.forget(workerId);
            this.sessionsByWorker.delete(workerId);
            this.adopted.delete(workerId);
            result.archived.push(workerId);
        }
        return result;
    }

    /**
     * Takes one worker out of rotation (the Remove button): live runs are cancelled, a `remove` fact is recorded, and
     * restoreRuns skips it from then on. Its earlier facts stay in the ledger, so turn and month spend never shrinks.
     */
    remove(workspacePath: string, workerId: string): { status: 'REMOVED'; workerId: string; cancelled: string[] } | { status: 'UNKNOWN_WORKER'; workerId: string } {
        const workspace = canonical(workspacePath);
        this.refreshFromLedger(workspace);
        const runs = [...this.runs.values()].filter((run) => run.workerId === workerId && run.workspace === workspace);
        if (!runs.length) { return { status: 'UNKNOWN_WORKER', workerId }; }
        const cancelled: string[] = [];
        for (const run of runs) {
            if (!this.terminal(run.state) && this.cancel(run.runId).status === 'CANCELLATION_REQUESTED') { cancelled.push(run.runId); }
        }
        this.record(runs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)), { type: 'remove', reason: 'removed by reviewer' });
        for (const run of runs) { this.runs.delete(run.runId); }
        this.router.markRemoved(workerId);
        this.sessionsByWorker.delete(workerId);
        this.adopted.delete(workerId);
        return { status: 'REMOVED', workerId, cancelled };
    }

    /**
     * Another extension host (window) shares this ledger: before routing, adopt the idle workers it wrote since this host
     * last looked, and refresh the activity time of idle workers it reused. Runs of workers that are still executing
     * elsewhere are skipped, so a busy sibling is never taken. Reuses restoreRuns; never changes a known worker's state.
     */
    private refreshFromLedger(workspace: string): void {
        const unfinishedWorkers = this.restoreRuns(workspace, true);
        this.router.markBusyElsewhere(workspace, unfinishedWorkers);
        for (const [workerId, adopted] of this.adopted) {
            if (adopted.workspace !== workspace) { continue; }
            const known = this.router.worker(workerId);
            if (unfinishedWorkers.has(workerId)) { continue; }
            if (!known) {
                this.router.adopt({ workerId, workspacePath: workspace, profile: adopted.profile, model: adopted.model, thinking: adopted.thinking,
                    contextTokens: adopted.contextTokens, lastActivityAt: adopted.lastTs, forkedFrom: adopted.forkedFrom, cwd: adopted.cwd,
                    sessionKey: [...this.runs.values()].some(run => run.workerId === workerId && run.track === 'validator') ? 'validator' : undefined }, adopted.sessionId ? 'IDLE' : 'ORPHANED',
                    adopted.sessionId ? undefined : 'no OpenCode session was recorded');
                if (adopted.sessionId) { this.sessionsByWorker.set(workerId, adopted.sessionId); }
            } else {
                this.router.refreshIdle(workerId, adopted.lastTs, adopted.contextTokens);
                if (adopted.sessionId && known.state === 'IDLE') { this.sessionsByWorker.set(workerId, adopted.sessionId); }
            }
        }
    }

    private restoreRuns(workspace: string, skipUnfinished = false): Set<string> {
        const byRun = new Map<string, LifecycleRecord[]>();
        const ledger = this.readLedger(workspace);
        const removed = new Set(ledger.filter((record) => record.type === 'remove').map((record) => record.workerId));
        for (const workerId of removed) { this.router.markRemoved(workerId); }
        const archived = new Set(ledger.filter((record) => record.type === 'archive' || record.type === 'remove').map((record) => record.workerId));
        for (const record of ledger) {
            // IDs without a host segment predate host-unique IDs and are ambiguous across reloads.
            if (/^run-\d+$/.test(record.runId) || this.runs.has(record.runId) || archived.has(record.workerId)) { continue; }
            const records = byRun.get(record.runId) ?? [];
            records.push(record);
            byRun.set(record.runId, records);
        }
        // A run with no exit fact may be executing in another host: when refreshing, leave it and its worker alone.
        // A run stamped later than this host's clock comes from a skewed clock and is ignored.
        const unfinishedWorkers = new Set<string>();
        if (skipUnfinished) {
            for (const [runId, records] of byRun) {
                const last = records.filter((record) => !record.ping).pop() ?? records[records.length - 1];
                if (records[records.length - 1].ts > this.now()) { byRun.delete(runId); }
                else if (last.exitCode === undefined || last.type === 'verify_round') { unfinishedWorkers.add(records[0].workerId); byRun.delete(runId); }
            }
        }
        for (const [runId, records] of byRun) {
            if (unfinishedWorkers.has(records[0].workerId)) { continue; }
            const first = records[0];
            const last = records.filter((record) => !record.ping).pop() ?? records[records.length - 1];
            const usage = emptyUsage();
            let contextTokens = 0;
            let lastPromptTokens = 0;
            let lastCachedTokens = 0;
            for (const record of records) {
                if (record.type !== 'checkpoint' || !record.usage) { continue; }
                for (const key of Object.keys(usage) as Array<keyof RunUsage>) { usage[key] += record.usage[key]; }
                lastPromptTokens = record.usage.input + record.usage.cacheRead + record.usage.cacheWrite;
                lastCachedTokens = record.usage.cacheRead;
                contextTokens = lastPromptTokens + record.usage.output;
            }
            const sessionId = [...records].reverse().find((record) => record.sessionId)?.sessionId ?? '';
            for (const record of records) {
                if (record.type === 'start' && !record.sessionId && isAgyModel(record.model)) { this.agyAddDir.set(record.workerId, record.addDir === true); }
            }
            if (first.track === 'validator') contextTokens = last.inputTokens ?? contextTokens;
            const ended = last.exitCode !== undefined && last.type !== 'verify_round';
            const state: RunState = ended ? last.state ?? (last.type === 'stop' ? 'COMPLETED' : 'FAILED') : 'FAILED';
            const reason = ended ? last.reason ?? (state === 'COMPLETED' ? undefined : `exit code ${last.exitCode}`)
                : 'interrupted by reload; action resume continues its session';
            this.runs.set(runId, {
                runId, workerId: first.workerId, sessionId, state, profile: first.profile, model: first.model, thinking: first.thinking,
                dispatchTurnId: first.dispatchTurnId, track: first.track ?? '', startedAt: first.ts, endedAt: last.ts, updatedAt: last.ts, elapsedMs: last.ts - first.ts,
                usage, queuePosition: 0, reason, workspace, cwd: canonical(first.cwd ?? first.workspace), packet: '', command: '', evidence: [], waiters: [], nextInputTokens: contextTokens, knowledge: '',
                lastPromptTokens, lastCachedTokens, ...(first.forkedFrom ? { forkedFrom: first.forkedFrom } : {}),
                pid: [...records].reverse().find((record) => record.type === 'start')?.pid,
            });
            const lastTs = last.lastUsedAt ?? records[records.length - 1].ts;
            const adopted = this.adopted.get(first.workerId);
            if (!adopted || lastTs >= adopted.lastTs) {
                this.adopted.set(first.workerId, { workspace, cwd: canonical(first.cwd ?? first.workspace), profile: first.profile, model: first.model, thinking: first.thinking,
                    sessionId: sessionId || adopted?.sessionId || '', contextTokens: contextTokens || adopted?.contextTokens || 0, lastTs,
                    forkedFrom: first.forkedFrom ?? adopted?.forkedFrom });
            }
        }
        return unfinishedWorkers;
    }

    /** The workspace's workers as keep-warm inputs (see keepWarm.ts); a worker with no recorded session cannot be pinged. */
    keepWarmWorkers(workspacePath: string): KeepWarmWorker[] {
        return this.router.workers(canonical(workspacePath)).filter((worker) => !worker.sessionKey && !isAgyModel(worker.model) && this.sessionsByWorker.has(worker.workerId)).map((worker) => ({
            workerId: worker.workerId, state: worker.state, active: !!worker.active, queued: worker.queue.length,
            cacheExpiresAt: this.router.cacheExpiresAt(worker), nextInputTokens: worker.contextTokens,
            unusedPings: this.unusedPings.get(worker.workerId) ?? 0, pinging: this.pinging.has(worker.workerId),
        }));
    }

    /**
     * One minimal message to the worker's OpenCode session (`POST /session/:id/message`, same agent and model) so the
     * provider's prompt cache refreshes. Its step_finish usage goes to the ledger as a checkpoint tagged `ping`.
     * Never pings a busy, queued, retired, orphaned or expired worker.
     */
    async ping(workerId: string, fetchImpl: typeof fetch = fetch): Promise<{ status: 'PINGED' | 'SKIPPED' | 'FAILED'; reason?: string }> {
        const worker = this.router.worker(workerId);
        const sessionId = this.sessionsByWorker.get(workerId) ?? '';
        const run = [...this.runs.values()].filter((candidate) => candidate.workerId === workerId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (run?.track === 'validator') return { status: 'SKIPPED', reason: 'validator sessions have no keep-alive pings' };
        if (worker && run && isClaudeModel(run.model) && sessionId) { return this.pingClaude(workerId, run, sessionId); }
        if (!worker || !run || !this.attachUrl || !/^[A-Za-z0-9_-]+$/.test(sessionId)) { return { status: 'SKIPPED', reason: 'no attached session' }; }
        const expires = this.router.cacheExpiresAt(worker);
        if (worker.state !== 'IDLE' || worker.active || worker.queue.length > 0 || expires <= this.now() || this.pinging.has(workerId)) {
            return { status: 'SKIPPED', reason: 'not an idle warm worker' };
        }
        const slash = run.model.indexOf('/');
        this.pinging.add(workerId);
        try {
            const res = await fetchImpl(`${this.attachUrl.replace(/\/$/, '')}/session/${sessionId}/message`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(PING_HTTP_TIMEOUT_MS),
                body: JSON.stringify({ agent: `aa-${run.profile}`, model: { providerID: run.model.slice(0, slash), modelID: run.model.slice(slash + 1) },
                    variant: run.thinking, parts: [{ type: 'text', text: KEEP_WARM_PROMPT }] }),
            });
            if (!res.ok) { return { status: 'FAILED', reason: `HTTP ${res.status}` }; }
            const text = await res.text();
            let body: any = {};
            try { body = text ? JSON.parse(text) : {}; } catch { /* the cache is refreshed even when the reply is unreadable */ }
            const finish = (Array.isArray(body.parts) ? body.parts : []).find((part: any) => part?.type === 'step-finish') ?? {};
            const tokens = finish.tokens ?? body.info?.tokens ?? {};
            const usage: RunUsage = { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0,
                cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0, cost: finish.cost ?? body.info?.cost ?? 0, steps: 1 };
            for (const key of Object.keys(usage) as Array<keyof RunUsage>) { run.usage[key] += usage[key]; }
            const context = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
            if (context > 0) { run.nextInputTokens = context; run.lastPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite; run.lastCachedTokens = usage.cacheRead; }
            this.record(run, { type: 'checkpoint', usage, ping: true, callId: finish.id ? String(finish.id) : undefined });
            this.router.touch(workerId, context);
            this.unusedPings.set(workerId, (this.unusedPings.get(workerId) ?? 0) + 1);
            return { status: 'PINGED' };
        } catch (error) {
            return { status: 'FAILED', reason: (error as Error).message };
        } finally {
            this.pinging.delete(workerId);
        }
    }

    /** The keep-warm ping of a Claude worker: one `--resume` print call; its reported usage and cost go to the ledger tagged `ping`. */
    private async pingClaude(workerId: string, run: RunRecord, sessionId: string): Promise<{ status: 'PINGED' | 'SKIPPED' | 'FAILED'; reason?: string }> {
        const worker = this.router.worker(workerId);
        if (!worker || worker.state !== 'IDLE' || worker.active || worker.queue.length > 0 || this.router.cacheExpiresAt(worker) <= this.now() || this.pinging.has(workerId)) {
            return { status: 'SKIPPED', reason: 'not an idle warm worker' };
        }
        const { claudeArgs, claudeEventNormalizer } = require('./claudeRuntime') as typeof import('./claudeRuntime');
        const profile = this.router.profile(run.profile);
        this.pinging.add(workerId);
        try {
            const child = this.spawner(claudeArgs({ model: run.model, thinking: run.thinking, sessionId, addDir: run.cwd, message: KEEP_WARM_PROMPT, profile,
                instructions: profile ? workerInstructions(profile) : undefined }), { command: this.claudeCommand, cwd: run.cwd, title: `${workerId}/ping` });
            const normalize = claudeEventNormalizer();
            const usage: RunUsage = { ...emptyUsage(), steps: 1 };
            let last: RunUsage | undefined;
            let failed = '';
            let buffer = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const event of lines.flatMap((line) => { try { return normalize(JSON.parse(line)); } catch { return []; } })) {
                    if (event?.type === 'error') { failed = String(event.error?.message ?? 'claude error'); }
                    if (event?.type !== 'step_finish') { continue; }
                    const tokens = event.part.tokens;
                    last = { input: tokens.input, output: tokens.output, reasoning: 0, cacheRead: tokens.cache.read, cacheWrite: tokens.cache.write, cost: event.part.cost, steps: 1 };
                    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost'] as const) { usage[key] += last[key]; }
                }
            });
            // A missing binary or a hung process must never leave the worker pinging forever (it would stall keep-warm for every worker).
            let timer: NodeJS.Timeout | undefined;
            const code = await new Promise<number | null>((resolve) => {
                timer = setTimeout(() => { failed ||= `claude ping timed out after ${PING_HTTP_TIMEOUT_MS / 1000}s`; try { child.kill?.('SIGTERM'); } catch { /* already gone */ } resolve(null); }, PING_HTTP_TIMEOUT_MS);
                child.on('exit', (exitCode: number | null) => resolve(exitCode));
            }).finally(() => clearTimeout(timer));
            if (failed || code !== 0) { return { status: 'FAILED', reason: failed || `exit code ${code}` }; }
            for (const key of Object.keys(usage) as Array<keyof RunUsage>) { run.usage[key] += usage[key]; }
            const context = last ? last.input + last.cacheRead + last.cacheWrite + last.output : 0;
            if (last && context > 0) { run.nextInputTokens = context; run.lastPromptTokens = context - last.output; run.lastCachedTokens = last.cacheRead; }
            this.record(run, { type: 'checkpoint', usage, ping: true });
            this.router.touch(workerId, context);
            this.unusedPings.set(workerId, (this.unusedPings.get(workerId) ?? 0) + 1);
            return { status: 'PINGED' };
        } catch (error) {
            return { status: 'FAILED', reason: (error as Error).message };
        } finally {
            this.pinging.delete(workerId);
        }
    }

    /** Worker usage grouped by the main-agent turn that dispatched it. */
    usageByTurn(workspacePath: string): Record<string, RunUsage & { runs: number; source: string }> {
        const totals: Record<string, RunUsage & { runs: number; source: string }> = {};
        const counted = new Set<string>();
        for (const record of this.readLedger(canonical(workspacePath))) {
            if (record.type !== 'checkpoint' || !record.usage) { continue; }
            const bucket = totals[record.dispatchTurnId] ??= { ...emptyUsage(), runs: 0, source: record.source };
            for (const key of Object.keys(record.usage) as Array<keyof RunUsage>) { bucket[key] += record.usage[key]; }
            if (!counted.has(record.runId)) { counted.add(record.runId); bucket.runs++; }
        }
        return totals;
    }

    /** Worker spend since a moment (the turn start): one checkpoint is one model request; session totals are never used. */
    usageSince(workspacePath: string, sinceMs: number): { requests: number; dollars: number; runs: number; workers: number; workerIds: string[]; inputTokens: number; outputTokens: number; cachedTokens?: number; cacheMisses?: number; unreportedCostRequests?: number; perModel?: Record<string, { requests: number; dollars: number; runs: number; inputTokens: number; outputTokens: number; cachedTokens: number }>; toolCalls?: Array<{ tool: string; calls: number; outputTokens: number; avgMs: number; minMs: number; maxMs: number; errors: number; cacheRisk: boolean }> } {
        const total = { requests: 0, dollars: 0, runs: 0, workers: 0, workerIds: [] as string[], inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheMisses: 0 };
        const perModel: NonNullable<ReturnType<OpenCodeWorkerRuntime['usageSince']>['perModel']> = {};
        const tools = new Map<string, NonNullable<ReturnType<OpenCodeWorkerRuntime['usageSince']>['toolCalls']>[number]>();
        const models = new Map<string, string>();
        const runIds = new Set<string>();
        const workerIds = new Set<string>();
        let unreported = 0;
        for (const record of this.readLedger(canonical(workspacePath))) {
            if (record.type === 'start') { models.set(record.runId, record.model); }
            if (record.ts < sinceMs) { continue; }
            if (record.type === 'after_tool') {
                const name = record.tool ?? 'unknown';
                const ms = record.durMs ?? 0;
                const tool = tools.get(name) ?? { tool: name, calls: 0, outputTokens: 0, avgMs: 0, minMs: ms, maxMs: ms, errors: 0, cacheRisk: false };
                tool.avgMs = (tool.avgMs * tool.calls + ms) / (tool.calls + 1);
                tool.calls++; tool.outputTokens += record.toolTokens?.output ?? 0;
                tool.minMs = Math.min(tool.minMs, ms); tool.maxMs = Math.max(tool.maxMs, ms);
                tool.errors += record.status === 'error' ? 1 : 0;
                tools.set(name, tool);
            }
            if (record.type === 'start' || (record.type === 'checkpoint' && !record.ping)) {
                runIds.add(record.runId);
                workerIds.add(record.workerId);
            }
            if (record.type !== 'checkpoint' || !record.usage) { continue; }
            total.requests++;
            workerIds.add(record.workerId);
            if (record.costStatus === 'unreported') { unreported++; }
            total.dollars += record.usage.cost;
            total.inputTokens += record.usage.input + record.usage.cacheRead + record.usage.cacheWrite;
            total.outputTokens += record.usage.output;
            total.cachedTokens += record.usage.cacheRead;
            if (record.usage.cacheRead < (record.usage.input + record.usage.cacheRead + record.usage.cacheWrite) / 2) { total.cacheMisses++; }
            const model = models.get(record.runId) ?? record.model ?? 'unknown';
            const bucket = perModel[model] ??= { requests: 0, dollars: 0, runs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
            bucket.requests++; bucket.dollars += record.usage.cost;
            bucket.inputTokens += record.usage.input + record.usage.cacheRead + record.usage.cacheWrite;
            bucket.outputTokens += record.usage.output; bucket.cachedTokens += record.usage.cacheRead;
        }
        total.runs = runIds.size;
        total.workerIds = [...workerIds];
        total.workers = workerIds.size;
        // Requests whose runtime reports no billed cost (agy): their dollars are unknown, not part of a real $0.
        return { ...total, perModel, toolCalls: [...tools.values()], ...(unreported ? { unreportedCostRequests: unreported } : {}) };
    }

    private admit(routed: Extract<RouteResult, { runId: string }>, workspace: string, packet: WorkerPacket, knowledge = ''): RunView {
        const run: RunRecord = {
            runId: routed.runId, workerId: routed.workerId, sessionId: this.sessionsByWorker.get(routed.workerId) ?? '',
            state: 'STARTING', profile: packet.profile, model: routed.model, thinking: routed.thinking,
            dispatchTurnId: packet.dispatchTurnId, track: String(packet.track ?? '').trim().slice(0, 24), startedAt: this.now(), updatedAt: this.now(), elapsedMs: 0, usage: emptyUsage(),
            queuePosition: routed.queuePosition, workspace, cwd: packet.cwd ? canonical(packet.cwd) : workspace, packet: renderPacket(packet), command: packet.command, evidence: [], waiters: [],
            nextInputTokens: this.router.worker(routed.workerId)?.contextTokens ?? 0, knowledge, lastPromptTokens: 0, lastCachedTokens: 0,
            ...(packet.thinking && packet.thinking !== routed.thinking ? { thinkingNote: `thinking: ${routed.thinking} (worker's)` } : {}),
            ...(this.router.worker(routed.workerId)?.forkedFrom ? { forkedFrom: this.router.worker(routed.workerId)?.forkedFrom } : {}),
            ...(packet.agyPermissions === 'skip' ? { agyPermissions: 'skip' as const } : {}),
        };
        this.runs.set(run.runId, run);
        if (routed.queuePosition === 0) { this.launch(run, run.packet); }
        return this.view(run);
    }

    /**
     * Starts the run. An agy run with a packet verify command first runs that command once to record the failing lines
     * that existed before the worker touched anything (see failingLines); only then does agy launch.
     */
    private launch(run: RunRecord, message: string): void {
        run.queuePosition = 0;
        // The no-edits check compares against the allowed files as they were before the run's first launch.
        if (isAgyModel(run.model) && !run.filesAtStart) { run.filesAtStart = fileStates(run); }
        if (!isAgyModel(run.model) || run.baseline !== undefined || !run.command || !this.agyVerifyLoop()) { this.launchProcess(run, message); return; }
        const { runVerifyCommand, VERIFY_TIMEOUT_MS } = require('./agyRuntime') as typeof import('./agyRuntime');
        run.baseline = [];
        void runVerifyCommand(run.command, run.cwd, VERIFY_TIMEOUT_MS, (child) => { run.child = child; }).then((baseline) => {
            run.baseline = failingLines(baseline.output);
            if (run.reason === 'cancelled by caller') { this.finalizeRun(run, 'CANCELLED', -1); } else { this.launchProcess(run, message); }
        });
    }

    private finalizeRun(run: RunRecord, state: RunState, exitCode: number): void {
        const worker = this.router.worker(run.workerId);
        this.router.complete(run.workerId, run.runId, { contextTokens: run.nextInputTokens || worker?.contextTokens || 0 });
        this.record(run, { type: state === 'COMPLETED' ? 'stop' : 'error', exitCode, state, reason: run.reason });
        this.finish(run, state, run.reason);
        const next = worker?.active;
        if (next) {
            const queued = this.runs.get(next.runId);
            if (queued && queued.state === 'STARTING') { this.launch(queued, queued.packet); }
        }
    }

    private launchProcess(run: RunRecord, message: string): void {
        this.unusedPings.delete(run.workerId);
        run.startedAt = this.now();
        let sessionId = this.sessionsByWorker.get(run.workerId) || run.sessionId;
        const agy = isAgyModel(run.model);
        // A conversation created before --add-dir was passed has no workspace; resuming it can never read or edit files.
        if (agy && sessionId && this.agyAddDir.get(run.workerId) !== true) {
            sessionId = '';
            run.sessionId = '';
            this.sessionsByWorker.delete(run.workerId);
        }
        const { agyArgs, agyEventNormalizer, deniedContinueMessage, verifyFailureMessage, runVerifyCommand, MAX_VERIFY_ROUNDS, VERIFY_TIMEOUT_MS, VERIFY_FACT_TAIL_CHARS,
            isCapacityError, agyFatalReason, isAgyErrorLine, missingCheckFile, CAPACITY_RETRY_DELAYS_MS, CAPACITY_RETRY_MESSAGE } = agy
            ? require('./agyRuntime') as typeof import('./agyRuntime') : {} as Partial<typeof import('./agyRuntime')>;
        // An error from an earlier launch of this run never decides this launch's outcome.
        if (agy && run.reason !== 'cancelled by caller') { run.reason = undefined; }
        // OpenCode reads the profile instructions from its agent file; agy gets the same text at the start of its conversation,
        // claude as an appended system prompt on every launch.
        const claude = isClaudeModel(run.model);
        const profile = agy || claude ? this.router.profile(run.profile) : undefined;
        // --print-logs is required: without it `opencode run` is SIGKILLed after ~14s.
        const args = claude ? (require('./claudeRuntime') as typeof import('./claudeRuntime')).claudeArgs({ model: run.model, thinking: run.thinking,
            sessionId, addDir: run.cwd, message, profile, instructions: profile ? workerInstructions(profile) : undefined,
            mcpUrl: profile?.mcp.length ? this.claudeMcpUrl() : '' })
            : agyArgs ? agyArgs({ model: run.model, thinking: run.thinking, conversationId: sessionId, addDir: run.cwd, skipPermissions: run.agyPermissions === 'skip',
            edit: profile?.edit, message: !sessionId && profile ? `${workerInstructions(profile)}\n\n${message}` : message })
            : ['run', '--print-logs', '--log-level', 'ERROR', '--format', 'json', '--agent', `aa-${run.profile}`,
                '--model', run.model, '--variant', run.thinking, '--dir', run.cwd, '--title', `${run.workerId}/${run.runId}`];
        const openCode = !agy && !claude;
        if (sessionId && openCode) { args.push('--session', sessionId); }
        if (this.attachUrl && openCode) { args.push('--attach', this.attachUrl); }
        if (openCode) { args.push(message); }
        let child: ChildLike;
        try {
            child = openCode ? this.spawner(args)
                : this.spawner(args, { command: claude ? this.claudeCommand : this.agyCommand, cwd: run.cwd, title: `${run.workerId}/${run.runId}` });
        } catch (error) {
            if (!this.terminal(run.state)) {
                run.reason = (error as Error).message;
                this.finalizeRun(run, 'FAILED', -1);
            }
            return;
        }
        const normalize = claude ? (require('./claudeRuntime') as typeof import('./claudeRuntime')).claudeEventNormalizer()
            : agyEventNormalizer ? agyEventNormalizer(profile?.mcp ?? []) : (event: any) => [event];
        run.child = child;
        run.pid = child.pid;
        // The start fact is written at spawn, so a run that never speaks is still in the ledger with its pid, session and directory.
        if (agy && !sessionId) { this.agyAddDir.set(run.workerId, true); }
        this.record(run, { type: 'start', sessionId, pid: child.pid, dir: run.cwd, ...(agy ? { addDir: true } : {}), ...(run.agyPermissions ? { reason: 'agy permissions skipped by packet opt-in (agyPermissions: skip)' } : {}) });
        const cancelStall = this.setTimer(() => this.stall(run, sessionId), STALL_AFTER_SECONDS * 1000);
        // Headless OpenCode rejects anything that would ask and then ends the run; that rejection is the real reason.
        const rejected: string[] = [];
        // Headless agy auto-denies an action no allow-rule grants and ends its turn; asking it again only repeats the denial.
        const denied: string[] = [];
        let outOfPolicy = false;
        let capacity = false;
        let fatal = '';
        // agy output naming an unavailable model or expired login ends the run at once; a 429 is retried at exit.
        const scanAgy = (text: string) => {
            if (!agy || fatal || !isCapacityError || !agyFatalReason) { return; }
            if (isCapacityError(text)) { capacity = true; return; }
            fatal = agyFatalReason(text, run.model);
            if (fatal) { cancelStall(); child.kill('SIGTERM'); }
        };
        // An editing packet whose allowed files are all unchanged since the run started made no edits, whatever its report says.
        const noEdits = () => agy && !!run.filesAtStart && Object.keys(run.filesAtStart).length > 0
            && Object.entries(fileStates(run)).every(([file, state]) => run.filesAtStart?.[file] === state);
        let errBuffer = '';
        child.stderr?.on('data', (chunk: Buffer) => {
            errBuffer += chunk.toString();
            const lines = errBuffer.split('\n');
            errBuffer = lines.pop() ?? '';
            for (const line of lines) {
                if (isAgyErrorLine?.(line)) { scanAgy(line); }
                const match = /permission requested:\s*(.+?);\s*auto-rejecting/i.exec(line);
                if (match && !rejected.includes(match[1])) { rejected.push(match[1]); }
            }
        });
        let buffer = '';
        let lastText = '';
        let started = false;
        child.stdout?.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const event of lines.flatMap((line) => { try { return normalize(JSON.parse(line)); } catch { return []; } })) {
                if (event?.sessionID && !run.sessionId) {
                    run.sessionId = event.sessionID;
                    this.sessionsByWorker.set(run.workerId, event.sessionID);
                    // agy and claude name their conversation before any other fact: the ledger must hold it, so a reload can resume it.
                    if (agy || claude) { this.record(run, { type: 'message_update' }); }
                }
                if (!started) { started = true; cancelStall(); }
                if (run.state === 'STARTING' || run.state === 'STALLED') { run.state = 'RUNNING'; run.reason = undefined; }
                const part = event?.part ?? {};
                if (event?.type === 'text' && part.text) {
                    lastText = String(part.text);
                    this.record(run, { type: 'message_update' });
                } else if (event?.type === 'step_finish') {
                    const tokens = part.tokens ?? {};
                    const usage: RunUsage = { input: tokens.input ?? 0, output: tokens.output ?? 0, reasoning: tokens.reasoning ?? 0,
                        cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0, cost: part.cost ?? 0, steps: 1 };
                    for (const key of Object.keys(usage) as Array<keyof RunUsage>) { run.usage[key] += usage[key]; }
                    run.nextInputTokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
                    run.lastPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
                    run.lastCachedTokens = usage.cacheRead;
                    this.record(run, { type: 'checkpoint', usage, callId: part.id ? String(part.id) : undefined, ...(agy ? { costStatus: 'unreported' as const } : {}) });
                } else if (event?.type === 'denied') {
                    for (const action of event.actions as string[]) { if (!denied.includes(action)) { denied.push(action); } }
                    this.record(run, { type: 'approval', status: 'denied', reason: `agy auto-denied: ${denied.join(', ')}` });
                } else if (/permission/i.test(String(event?.type))) {
                    run.state = 'WAITING_APPROVAL';
                    this.record(run, { type: 'approval' });
                } else if (event?.type === 'error') {
                    if (agy && event.outOfPolicy) { outOfPolicy = true; }
                    const detail = String(event.error?.data?.message ?? event.error?.message ?? event.error?.name ?? event.message ?? 'provider or tool error');
                    run.reason = CREDENTIAL.test(detail) ? 'provider or tool error (credential omitted)' : detail.replace(/\s+/g, ' ').slice(0, 240);
                    this.record(run, { type: 'error', reason: run.reason });
                    // A Claude error result (error_max_turns, error_during_execution, ...) ends the run FAILED with its reason.
                    if (claude && !fatal) { fatal = run.reason; }
                    scanAgy(detail);
                } else if (part.tool) {
                    const status = String(part.state?.status ?? '');
                    const callId = String(part.callID ?? part.id ?? '');
                    if (status !== 'completed' && status !== 'error') {
                        this.record(run, { type: 'before_tool', tool: String(part.tool), callId });
                    } else {
                        const input = JSON.stringify(part.state?.input ?? {});
                        const output = String(part.state?.output ?? part.state?.error ?? '');
                        const time = part.state?.time ?? {};
                        this.record(run, { type: 'after_tool', tool: String(part.tool), callId, status: status === 'error' ? 'error' : 'ok',
                            durMs: time.start && time.end ? time.end - time.start : undefined,
                            toolTokens: { input: Math.ceil(input.length / 4), output: Math.ceil(output.length / 4) } });
                    }
                }
            }
        });
        child.on('exit', (code, signal) => {
            cancelStall();
            run.evidence = lastText.trim().split('\n').slice(-MAX_EVIDENCE_LINES);
            const knowledge = [...run.evidence].reverse().find((line) => /^\W*Knowledge:/i.test(line));
            if (knowledge) { run.knowledge = knowledge.replace(/^\W*Knowledge:\s*/i, '').slice(0, 200); }
            const finalize = (state: RunState, exitCode: number) => this.finalizeRun(run, state, exitCode);
            if (fatal) { run.reason = fatal; finalize('FAILED', code ?? -1); return; }
            // A capacity error (429) is retried in the same conversation after a backoff; it never ends COMPLETED.
            if (capacity && run.reason !== 'cancelled by caller' && CAPACITY_RETRY_DELAYS_MS && CAPACITY_RETRY_MESSAGE) {
                const retry = run.capacityRetries ?? 0;
                if (retry >= CAPACITY_RETRY_DELAYS_MS.length) { run.reason = `agy capacity (429), retried ${retry}x`; finalize('FAILED', code ?? -1); return; }
                const delay = CAPACITY_RETRY_DELAYS_MS[retry];
                run.capacityRetries = retry + 1;
                run.reason = undefined;
                this.record(run, { type: 'approval', reason: `agy capacity (429); retry ${retry + 1} in ${delay / 1000}s` });
                run.cancelCapacityRetry = this.setTimer(() => {
                    run.cancelCapacityRetry = undefined;
                    if (run.reason === 'cancelled by caller') { finalize('CANCELLED', -1); return; }
                    this.launch(run, run.sessionId ? CAPACITY_RETRY_MESSAGE : run.packet);
                }, delay);
                return;
            }
            if (agy && this.agyVerifyLoop() && code === 0 && !signal && !run.reason && !outOfPolicy && !denied.includes('mcp')) {
                if (denied.includes('command') && !run.deniedContinued && run.sessionId && deniedContinueMessage) {
                    run.deniedContinued = true;
                    this.record(run, { type: 'denied_continue', reason: 'agy command denied; resumed with file-tools instruction' });
                    this.launch(run, deniedContinueMessage(run.command));
                    return;
                }
                if (runVerifyCommand && verifyFailureMessage && run.command) {
                    // A check that cannot run proves nothing: its missing script fails the run instead of passing or looping.
                    const missing = missingCheckFile?.(run.command, run.cwd);
                    if (missing) { run.reason = `check file missing: ${missing}`; finalize('FAILED', code ?? -1); return; }
                    void runVerifyCommand(run.command, run.cwd, VERIFY_TIMEOUT_MS, (verifyChild) => { run.child = verifyChild; }).then((verify) => {
                        if (run.reason === 'cancelled by caller') { finalize('CANCELLED', code ?? -1); return; }
                        const round = (run.verifyRounds ?? 0) + 1;
                        run.verifyRounds = round;
                        const tail = verify.output.slice(-(VERIFY_FACT_TAIL_CHARS ?? 1500));
                        this.record(run, { type: 'verify_round', round, exitCode: verify.exitCode, tail });
                        if (tail) { run.evidence = [...run.evidence, ...tail.split('\n')].slice(-MAX_EVIDENCE_LINES); }
                        const failing = failingLines(verify.output);
                        if (verify.exitCode === 0) {
                            // A passing check after no edits is a completion only when the packet says a no-op is acceptable.
                            if (noEdits() && !/^\W*No-op acceptable:\s*yes\W*$/im.test(run.packet)) { run.reason = 'no edits made'; finalize('FAILED', 0); } else { finalize('COMPLETED', 0); }
                        } else if (failing.length && run.baseline && failing.every((line) => run.baseline?.includes(line))
                            && !failureOwnedByPacket(failing, run.packet, verify.output)) {
                            run.reason = `pre-existing failure: every failing line was already failing before the worker started (${failing.slice(0, 3).join(' | ')}); not caused by this packet`;
                            finalize('FAILED', verify.exitCode);
                        } else if (round < (MAX_VERIFY_ROUNDS ?? 3) && run.sessionId) {
                            this.launch(run, verifyFailureMessage(verify.output));
                        } else {
                            run.reason = tail || `verify command exited with ${verify.exitCode}`;
                            finalize('FAILED', verify.exitCode);
                        }
                    });
                    return;
                }
            }
            // Only a `Result:` line ends a packet; text that stops mid-thought is an unfinished run, not a completion.
            const hasResult = run.evidence.some((line) => /^\W*Result:\s*(PASS|FAIL|BLOCKED)\b/i.test(line));
            const unfinished = code === 0 && !signal && run.reason !== 'cancelled by caller' && !outOfPolicy && !hasResult;
            if (unfinished && !denied.length && run.sessionId && (run.autoResumes ?? 0) < MAX_AUTO_RESUMES) {
                run.autoResumes = (run.autoResumes ?? 0) + 1;
                this.record(run, { type: 'approval', reason: rejected.length ? `auto-rejected, resumed with feedback: ${rejected.join('; ')}` : 'stopped without a Result line, resumed' });
                this.launch(run, rejected.length ? rejectionFeedback(rejected) : UNFINISHED_FEEDBACK);
                return;
            }
            const cancelled = run.reason === 'cancelled by caller';
            const silent = unfinished;
            if (silent) {
                run.reason = denied.length
                    // Live agy: --dangerously-skip-permissions grants commands but still denies MCP calls in headless mode.
                    ? `agy auto-denied ${denied.join(', ')} (headless agy cannot ask). Grant it with a scoped permissions.allow rule in ~/.gemini/antigravity-cli/settings.json`
                        + `${denied.includes('mcp') ? ' (mcp(<server>); skipping permissions does not grant MCP)' : ''}${denied.includes('command') ? ' (command(<prefix>), e.g. command(rtk))' : ''}`
                        + `${denied.some((action) => action !== 'mcp') && run.agyPermissions !== 'skip' ? ', or re-dispatch with agyPermissions: skip' : ''}; then resume`
                    : rejected.length
                    ? `permission auto-rejected: ${rejected.join(', ')} (not allowed for this worker; allow it in the OpenCode config or change the packet)`
                    : run.evidence.join('').trim() === '' ? 'worker ended without a report (no Result/Evidence text)' : 'worker stopped without a Result line';
            }
            let state: RunState = cancelled ? 'CANCELLED' : code === 0 && !signal && !silent && !outOfPolicy ? 'COMPLETED' : 'FAILED';
            // agy completes only through a passed check and real edits: an API error or a skipped check is never a completion.
            if (state === 'COMPLETED' && agy) {
                if (run.reason) { state = 'FAILED'; }
                else if (this.agyVerifyLoop()) { state = 'FAILED'; run.reason = `verify command did not run${denied.length ? ` (agy auto-denied ${denied.join(', ')})` : ''}`; }
                else if (noEdits()) { state = 'FAILED'; run.reason = 'no edits made'; }
            }
            if (state === 'FAILED' && !run.reason) { run.reason = signal ? `terminated by ${signal}` : `exit code ${code}`; }
            finalize(state, code ?? -1);
        });
    }

    /** No stdout event STALL_AFTER_SECONDS after spawn: surface it at once. The process is never killed automatically. */
    private stall(run: RunRecord, sessionId: string): void {
        if (run.state !== 'STARTING') { return; }
        // agy emits nothing while it writes files: an allowed file edited since the last check re-arms the detector instead.
        if (isAgyModel(run.model)) {
            const since = Math.max(run.stallCheckAt ?? 0, run.startedAt);
            const launchedAt = run.startedAt;
            run.stallCheckAt = this.now();
            if (this.touchFromEdits(run) > since) {
                this.setTimer(() => { if (run.startedAt === launchedAt) { this.stall(run, sessionId); } }, STALL_AFTER_SECONDS * 1000);
                return;
            }
        }
        run.state = 'STALLED';
        run.reason = `no event ${STALL_AFTER_SECONDS} s after spawn (session ${sessionId || run.sessionId || 'none'}, dir ${run.cwd})`;
        this.record(run, { type: 'error', state: 'STALLED', reason: run.reason });
        for (const waiter of run.waiters.splice(0)) { waiter(); }
    }

    private finish(run: RunRecord, state: RunState, reason?: string): void {
        if (run.track !== 'validator') this.onPresence?.(run.workspace, { id: run.workerId, displayName: run.profile }, false);
        run.state = state;
        run.reason = reason;
        run.endedAt = this.now();
        run.updatedAt = run.endedAt;
        for (const waiter of run.waiters.splice(0)) { waiter(); }
    }

    /** An allowed file modified during this launch counts as agy activity: refreshes updatedAt, returns the newest edit time. */
    private touchFromEdits(run: RunRecord): number {
        let latest = run.lastEditMs ?? 0;
        for (const file of packetAllowedFiles(run.packet)) {
            try { latest = Math.max(latest, fs.statSync(path.resolve(run.cwd, file)).mtimeMs); } catch { /* not created yet */ }
        }
        if (latest > run.startedAt) { run.lastEditMs = latest; run.updatedAt = Math.max(run.updatedAt, Math.floor(latest)); }
        return run.lastEditMs ?? 0;
    }

    private terminal(state: RunState): boolean {
        return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
    }

    private view(run: RunRecord): RunView {
        if (isAgyModel(run.model) && !this.terminal(run.state)) { this.touchFromEdits(run); }
        const { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, track, startedAt, endedAt, updatedAt, usage, queuePosition, reason, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens, forkedFrom, thinkingNote, agyPermissions } = run;
        return { runId, workerId, sessionId, state, profile, model, thinking, dispatchTurnId, track, startedAt, endedAt, updatedAt, nextInputTokens, knowledge, lastPromptTokens, lastCachedTokens,
            elapsedMs: (endedAt ?? this.now()) - startedAt, usage: { ...usage }, queuePosition, reason, ...(forkedFrom ? { forkedFrom } : {}), ...(thinkingNote ? { thinkingNote } : {}),
            ...(isAgyModel(model) ? { costStatus: 'unreported' as const } : {}), ...(agyPermissions ? { agyPermissions } : {}) };
    }

    private record(run: RunRecord, fact: Pick<LifecycleRecord, 'type'> & Partial<LifecycleRecord>): void {
        if (fact.type === 'start' && run.track !== 'validator') this.onPresence?.(run.workspace, { id: run.workerId, displayName: run.profile }, true);
        const record: LifecycleRecord = {
            ts: this.now(), workspace: run.workspace, ...(run.cwd && run.cwd !== run.workspace ? { cwd: run.cwd } : {}), workerId: run.workerId, runId: run.runId, sessionId: run.sessionId,
            dispatchTurnId: run.dispatchTurnId, source: run.model.split('/')[0] || 'unknown', ...(run.track ? { track: run.track } : {}),
            ...(run.forkedFrom ? { forkedFrom: run.forkedFrom } : {}), profile: run.profile, model: run.model, thinking: run.thinking, ...fact,
            ...(run.track === 'validator' ? { lastUsedAt: this.now(), inputTokens: run.nextInputTokens } : {}),
        };
        run.updatedAt = record.ts;
        fs.mkdirSync(this.ledgerDir, { recursive: true });
        fs.appendFileSync(path.join(this.ledgerDir, `${workspaceKey(run.workspace)}.jsonl`), `${JSON.stringify(record)}\n`);
    }

    /**
     * The owner's ledger plus the ledgers of its git worktrees: runs dispatched before owner/cwd were separated were
     * keyed by the worktree path they ran in. Rule: a worktree is any path `git worktree list` reports for the owner.
     */
    private readLedger(workspace: string): LifecycleRecord[] {
        const records: LifecycleRecord[] = [];
        for (const key of [workspace, ...worktreesOf(workspace)]) {
            const file = path.join(this.ledgerDir, `${workspaceKey(key)}.jsonl`);
            let text = '';
            try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
            for (const line of text.split('\n')) {
                if (!line) { continue; }
                try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
            }
        }
        return records.length > 1 ? records.sort((a, b) => a.ts - b.ts) : records;
    }
}
