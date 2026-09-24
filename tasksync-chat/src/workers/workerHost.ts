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
export function sharedWorkerRuntimeReady(): Promise<OpenCodeWorkerRuntime> {
    ready ??= ensureSharedOpenCodeServer(process.env.ASKAWAY_OPENCODE_SERVER_URL || DEFAULT_OPENCODE_SERVER_URL, defaultServerDeps)
        .then((status) => {
            serverStatus = status;
            // A failed attach is retried on the next worker call instead of being cached.
            if (status.state === 'ATTACHED') { sharedWorkerRuntime().setServerEndpoint(status.endpoint); } else { ready = undefined; }
            return sharedWorkerRuntime();
        });
    return ready;
}

export function sharedServerStatus(): ServerStatus | undefined {
    return serverStatus;
}

export function sharedCommentaryStore(): CommentaryStore {
    commentary ??= new CommentaryStore();
    return commentary;
}
