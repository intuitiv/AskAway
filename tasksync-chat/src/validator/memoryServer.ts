import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSharedOpenCodeServer, ServerStatus } from '../workers/sharedServer';

export const MEMORY_SERVER_URL = 'http://127.0.0.1:3111';

export interface MemoryServerPorts {
    spawn: (command: string, args: string[], options: childProcess.SpawnOptions) => { unref(): void };
    fetch: typeof fetch;
    env: NodeJS.ProcessEnv;
    executable: string;
    config: string;
}

function defaultPorts(): MemoryServerPorts {
    const executable = fs.realpathSync(childProcess.execFileSync('which', ['agentmemory'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    const config = [path.join(path.dirname(executable), 'iii-config.yaml'),
        path.join(path.dirname(executable), '..', 'iii-config.yaml')].find(p => fs.existsSync(p));
    if (!config) { throw new Error('agentmemory bundled loopback config is missing'); }
    const hosts = [...fs.readFileSync(config, 'utf8').matchAll(/^\s*host:\s*([^\s#]+)/gm)];
    if (!hosts.length || hosts.some(h => h[1] !== '127.0.0.1')) {
        throw new Error('agentmemory engine config must bind only to 127.0.0.1');
    }
    // Upstream hydrates this file after spawning, which could restore scrubbed keys.
    if (fs.existsSync(path.join(process.env.HOME || '', '.agentmemory', '.env'))) {
        throw new Error('agentmemory local .env could restore provider keys; refusing unsafe launch');
    }
    return { spawn: childProcess.spawn, fetch, env: process.env, executable, config };
}

function localEnvironment(ports: MemoryServerPorts): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    // Allow runtime necessities only: unknown future provider keys are excluded too.
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP']) {
        if (ports.env[key] !== undefined) { env[key] = ports.env[key]; }
    }
    return { ...env, CI: '1', EMBEDDING_PROVIDER: 'local', AUTO_FORGET_ENABLED: 'false',
        CONSOLIDATION_ENABLED: 'false', AGENTMEMORY_ALLOW_AGENT_SDK: 'false',
        AGENTMEMORY_AUTO_COMPRESS: 'false', FALLBACK_PROVIDERS: '',
        III_TELEMETRY_ENABLED: 'false', AGENTMEMORY_STATE_BACKEND: 'file',
        AGENTMEMORY_III_CONFIG: ports.config };
}

/** The bearer secret the local agentmemory server generated for itself; '' when none. Never log it. */
export function localMemorySecret(home = process.env.HOME || ''): string {
    try { return fs.readFileSync(path.join(home, '.agentmemory', 'secret'), 'utf8').trim(); } catch { return ''; }
}

/** The fixed REST port arbitrates across windows, just as for shared OpenCode. */
export async function ensureMemoryServer(ports?: MemoryServerPorts, secret?: string): Promise<ServerStatus> {
    const fetchPort = ports?.fetch || fetch;
    const deadline = Date.now() + 30000;
    try {
        const status = await ensureSharedOpenCodeServer(MEMORY_SERVER_URL, {
            probe: async url => {
                let response: Response;
                try {
                    response = await fetchPort(`${url}/agentmemory/health`, {
                        signal: AbortSignal.timeout(1000), redirect: 'error',
                        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
                    });
                } catch {
                    if (Date.now() >= deadline) { throw new Error('agentmemory /health timed out'); }
                    return false;
                }
                if (!response.ok) { throw new Error(`agentmemory /health failed (HTTP ${response.status})`); }
                const body = await response.json() as { status?: string };
                if (body.status !== 'healthy' && body.status !== 'ok') {
                    throw new Error('agentmemory /health returned an unhealthy or foreign server');
                }
                return true;
            },
            spawn: port => {
                const launch = ports || defaultPorts();
                launch.spawn(launch.executable, ['--port', String(port)], {
                    detached: true, stdio: 'ignore', cwd: path.dirname(launch.config),
                    env: localEnvironment(launch),
                }).unref();
            },
            sleep: async () => {},
        }, 1000, 0);
        if (status.state !== 'ATTACHED') { throw new Error('agentmemory /health did not become ready'); }
        return status;
    } catch (error) {
        // Only our own 'agentmemory …' messages are forwarded; upstream bodies never are (credentials).
        const reason = error instanceof Error && error.message.startsWith('agentmemory') ? error.message : 'secure local startup failed';
        throw new Error(`${reason}; memory server unavailable`);
    }
}
