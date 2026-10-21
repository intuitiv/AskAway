import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CommentaryStore } from '../commentary/commentary';
import { cacheSafeWaitMs } from '../observability/cacheClock';
import { memberSelectionForProfile } from '../team/roster';
import { startKeepWarmTimer } from './keepWarm';
import { OpenCodeWorkerRuntime, RuntimeOptions } from './openCodeRuntime';
import { defaultRestartDeps, defaultServerDeps, DEFAULT_OPENCODE_SERVER_URL, ensureSharedOpenCodeServer, restartSharedOpenCodeServer, RestartDeps, ServerStatus } from './sharedServer';
import { catalogWorkerProfiles, loadWorkerProfiles, syncAgyPermissions, syncOpenCodeAgents, WorkerProfile } from './workerProfiles';
import { SessionMessage } from './workersState';

let runtime: OpenCodeWorkerRuntime | undefined;
let presenceLifecycle: RuntimeOptions['onPresence'];
export function setWorkerPresenceLifecycle(callback: RuntimeOptions['onPresence']): void {
    presenceLifecycle = callback;
}
let ready: Promise<OpenCodeWorkerRuntime> | undefined;
let commentary: CommentaryStore | undefined;
let serverStatus: ServerStatus | undefined;
const keepWarmTimers = new Map<string, () => void>();
const serverAttachedListeners = new Set<() => void>();

export function onSharedServerAttached(listener: () => void): () => void {
    serverAttachedListeners.add(listener);
    return () => serverAttachedListeners.delete(listener);
}

/** The setting `askaway.workers.keepWarm` (default true); true as well outside VS Code. */
function keepWarmEnabled(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('vscode').workspace.getConfiguration('askaway.workers').get('keepWarm', true) !== false;
    } catch { return true; }
}

/** The main chat had a request within the 5-min cache window (the existing cache clock); `now` then, 0 when cold. */
function mainChatActiveAt(now: number): number {
    return cacheSafeWaitMs(COLD_PROBE_MS, now) < COLD_PROBE_MS ? now : 0;
}
const COLD_PROBE_MS = 1_000_000_000;

/** One keep-warm timer per workspace; it only acts once a runtime exists. */
function ensureKeepWarm(workspacePath: string): void {
    if (keepWarmTimers.has(workspacePath)) { return; }
    keepWarmTimers.set(workspacePath, startKeepWarmTimer(() => runtime, workspacePath, { enabled: keepWarmEnabled, mainActiveAt: mainChatActiveAt }));
}

/** The agy approval wrapper (tools/agy-approve.py) when installed at ~/.askaway/bin/agy-approve; delete that file to run plain agy. */
export function agyCommand(home = os.homedir(), env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): string {
    if (env.ASKAWAY_AGY_COMMAND) { return env.ASKAWAY_AGY_COMMAND; }
    const wrapper = path.join(home, '.askaway', 'bin', 'agy-approve');
    return exists(wrapper) ? wrapper : 'agy';
}

/** The claude binary the health check would accept (PATH, then ~/.local/bin), so a worker spawns the one that passed; plain `claude` when none is found. */
export function claudeCommand(home = os.homedir(), env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): string {
    if (env.ASKAWAY_CLAUDE_COMMAND) { return env.ASKAWAY_CLAUDE_COMMAND; }
    const dirs = [...(env.PATH ?? '').split(path.delimiter).filter(Boolean), path.join(home, '.local', 'bin')];
    return dirs.map((dir) => path.join(dir, 'claude')).find((file) => exists(file)) ?? 'claude';
}

let builtinProfilesDir: string | undefined;
/** The extension's own profiles (e.g. build, build-lite); set at activation before the runtime is created. */
export function setBuiltinWorkerProfilesDir(dir: string | undefined): void { builtinProfilesDir = dir; }

/** The profiles a worker can run: the same catalog `action: "profiles"` lists (built-in plus the user's, the user's file wins). */
export function hostWorkerProfiles(): WorkerProfile[] {
    const userDir = path.join(os.homedir(), '.askaway', 'worker-profiles');
    return builtinProfilesDir ? catalogWorkerProfiles(builtinProfilesDir, userDir) : loadWorkerProfiles(userDir);
}

/** One runtime per extension host, shared by the MCP surface, the VS Code LM tools, and the Workers tab. */
export function sharedWorkerRuntime(): OpenCodeWorkerRuntime {
    runtime ??= new OpenCodeWorkerRuntime(hostWorkerProfiles(), {
        onPresence: (workspace, worker, present) => presenceLifecycle?.(workspace, worker, present),
        agyCommand: agyCommand(),
        claudeCommand: claudeCommand(),
        memberSelection: (profile) => memberSelectionForProfile(profile),
    });
    return runtime;
}

/** Worker spend since the turn start; zeros while no runtime exists (never creates one). */
export function workerSpendSince(workspacePath: string | undefined, sinceMs: number): ReturnType<OpenCodeWorkerRuntime['usageSince']> {
    if (!runtime || !workspacePath || !sinceMs) { return { requests: 0, dollars: 0, runs: 0, workers: 0, workerIds: [], inputTokens: 0, outputTokens: 0 }; }
    return runtime.usageSince(workspacePath, sinceMs);
}

/** The runtime once it is attached to the shared OpenCode server (started on first worker use, not at activation). */
export async function sharedWorkerRuntimeReady(workspacePath?: string): Promise<OpenCodeWorkerRuntime> {
    const profiles = hostWorkerProfiles();
    syncOpenCodeAgents(profiles,
        path.join(os.homedir(), '.config', 'opencode', 'agents'), workspacePath ? path.join(workspacePath, '.opencode', 'agents') : undefined);
    syncAgyPermissions(profiles,
        path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json'));
    // A server that stopped since it was attached must be started again, not attached to.
    if (ready && serverStatus?.state === 'ATTACHED' && !(await defaultServerDeps.probe(serverUrl()))) { ready = undefined; }
    ready ??= ensureSharedOpenCodeServer(serverUrl(), defaultServerDeps)
        .then((status) => {
            serverStatus = status;
            if (status.state === 'ATTACHED') { sharedWorkerRuntime().setServerEndpoint(status.endpoint); } else {
                // Retry later instead of re-spawning on every call.
                setTimeout(() => { ready = undefined; }, 60_000);
            }
            return sharedWorkerRuntime();
        });
    return ready.then((runtime) => {
        if (workspacePath) { runtime.rehydrate(workspacePath, serverStatus?.state === 'ATTACHED'); ensureKeepWarm(workspacePath); }
        for (const listener of serverAttachedListeners) { listener(); }
        return runtime;
    });
}

/** For views: restores workers after a reload using a probe only, so opening a tab never starts a server. */
export async function observeWorkers(workspacePath: string): Promise<void> {
    const runtime = sharedWorkerRuntime();
    // Probe every time: a server that stopped must not keep showing as attached.
    const live = await defaultServerDeps.probe(serverUrl());
    serverStatus = { state: live ? 'ATTACHED' : 'NOT_ATTACHED', endpoint: live ? serverUrl() : '', started: false,
        reason: live ? '' : `no OpenCode server answered at ${serverUrl()}` };
    runtime.setServerEndpoint(live ? serverUrl() : '');
    if (!live) { ready = undefined; }
    runtime.rehydrate(workspacePath, live);
    ensureKeepWarm(workspacePath);
}

/** Starts the shared OpenCode server, or restarts it so it reloads its config; reconnects this workspace's workers. */
export async function restartSharedServer(workspacePath: string, deps: RestartDeps = defaultRestartDeps): Promise<ServerStatus & { stopped: number[] }> {
    const status = await restartSharedOpenCodeServer(serverUrl(), deps);
    serverStatus = status;
    const runtime = sharedWorkerRuntime();
    runtime.setServerEndpoint(status.endpoint);
    ready = status.state === 'ATTACHED' ? Promise.resolve(runtime) : undefined;
    runtime.rehydrate(workspacePath, status.state === 'ATTACHED');
    return status;
}

function serverUrl(): string {
    return process.env.ASKAWAY_OPENCODE_SERVER_URL || DEFAULT_OPENCODE_SERVER_URL;
}

/** A worker session's messages from the shared OpenCode server, which owns the transcript. */
export async function fetchSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const base = (sharedWorkerRuntime().serverEndpoint || serverUrl()).replace(/\/$/, '');
    const response = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/message`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    return await response.json() as SessionMessage[];
}

export function sharedServerStatus(): ServerStatus | undefined {
    return serverStatus;
}

export function sharedCommentaryStore(): CommentaryStore {
    if (!commentary) {
        commentary = new CommentaryStore();
        commentary.onChange(state => {
            const last = state.items.at(-1)?.ts;
            if (!last) return;
            const file = commentary!.file(state.workspacePath).replace(/\.json$/, '.progress.json');
            fs.writeFileSync(file, JSON.stringify({ lastCommentaryAt: last }));
        });
    }
    return commentary;
}
