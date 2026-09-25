import * as os from 'os';
import * as path from 'path';
import { CommentaryStore } from '../commentary/commentary';
import { OpenCodeWorkerRuntime } from './openCodeRuntime';
import { defaultRestartDeps, defaultServerDeps, DEFAULT_OPENCODE_SERVER_URL, ensureSharedOpenCodeServer, restartSharedOpenCodeServer, RestartDeps, ServerStatus } from './sharedServer';
import { loadWorkerProfiles } from './workerProfiles';
import { SessionMessage } from './workersState';

let runtime: OpenCodeWorkerRuntime | undefined;
let ready: Promise<OpenCodeWorkerRuntime> | undefined;
let commentary: CommentaryStore | undefined;
let serverStatus: ServerStatus | undefined;

/** One runtime per extension host, shared by the MCP surface, the VS Code LM tools, and the Workers tab. */
export function sharedWorkerRuntime(): OpenCodeWorkerRuntime {
    runtime ??= new OpenCodeWorkerRuntime(loadWorkerProfiles(path.join(os.homedir(), '.askaway', 'worker-profiles')));
    return runtime;
}

/** The runtime once it is attached to the shared OpenCode server (started on first worker use, not at activation). */
export function sharedWorkerRuntimeReady(workspacePath?: string): Promise<OpenCodeWorkerRuntime> {
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
        if (workspacePath) { runtime.rehydrate(workspacePath, serverStatus?.state === 'ATTACHED'); }
        return runtime;
    });
}

/** For views: restores workers after a reload using a probe only, so opening a tab never starts a server. */
export async function observeWorkers(workspacePath: string): Promise<void> {
    const runtime = sharedWorkerRuntime();
    // Probe every time: a server that stopped must not keep showing as attached.
    const live = await defaultServerDeps.probe(serverUrl());
    runtime.setServerEndpoint(live ? serverUrl() : '');
    if (!live) { ready = undefined; }
    runtime.rehydrate(workspacePath, live);
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
    commentary ??= new CommentaryStore();
    return commentary;
}
