import * as os from 'os';
import * as path from 'path';
import { CommentaryStore } from '../commentary/commentary';
import { OpenCodeWorkerRuntime } from './openCodeRuntime';
import { defaultServerDeps, DEFAULT_OPENCODE_SERVER_URL, ensureSharedOpenCodeServer, ServerStatus } from './sharedServer';
import { loadWorkerProfiles } from './workerProfiles';

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
    const live = sharedWorkerRuntime().serverEndpoint !== '' || await defaultServerDeps.probe(serverUrl());
    sharedWorkerRuntime().rehydrate(workspacePath, live);
}

function serverUrl(): string {
    return process.env.ASKAWAY_OPENCODE_SERVER_URL || DEFAULT_OPENCODE_SERVER_URL;
}

export function sharedServerStatus(): ServerStatus | undefined {
    return serverStatus;
}

export function sharedCommentaryStore(): CommentaryStore {
    commentary ??= new CommentaryStore();
    return commentary;
}
