import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as http from 'http';

export const DEFAULT_OPENCODE_SERVER_URL = 'http://127.0.0.1:4096';

export interface ServerDeps {
    probe: (url: string) => Promise<boolean>;
    spawn: (port: number) => void;
    sleep: (ms: number) => Promise<void>;
}

export interface ServerStatus { state: 'ATTACHED' | 'NOT_ATTACHED'; endpoint: string; started: boolean; reason: string }

/**
 * Attaches to the one shared OpenCode server, starting it when nothing answers.
 * The fixed port is the cross-window mutex: a second `opencode serve` cannot bind it and exits.
 */
export async function ensureSharedOpenCodeServer(url: string, deps: ServerDeps, attempts = 20, intervalMs = 500): Promise<ServerStatus> {
    if (await deps.probe(url)) { return { state: 'ATTACHED', endpoint: url, started: false, reason: '' }; }
    deps.spawn(Number(new URL(url).port));
    for (let i = 0; i < attempts; i++) {
        await deps.sleep(intervalMs);
        if (await deps.probe(url)) { return { state: 'ATTACHED', endpoint: url, started: true, reason: '' }; }
    }
    return { state: 'NOT_ATTACHED', endpoint: '', started: true, reason: `no OpenCode server answered at ${url} within ${(attempts * intervalMs) / 1000}s` };
}

/** Any HTTP answer means a server is listening; a refused or timed-out connection means none is. */
export function probeHttp(url: string, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const request = http.get(`${url}/config`, (response) => { response.resume(); resolve(true); });
        request.setTimeout(timeoutMs, () => { request.destroy(); resolve(false); });
        request.on('error', () => resolve(false));
    });
}

export const defaultServerDeps: ServerDeps = {
    probe: (url) => probeHttp(url),
    spawn: (port) => {
        fs.mkdirSync('/tmp/aa', { recursive: true });
        const stderr = fs.openSync('/tmp/aa/opencode-serve.err', 'a');
        // Detached so it outlives this window and keeps serving every other workspace.
        childProcess.spawn('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'],
            { detached: true, stdio: ['ignore', 'ignore', stderr] }).unref();
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
