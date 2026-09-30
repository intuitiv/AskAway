import { execFile } from 'child_process';

export type GhExec = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;

export class GhError extends Error {
    constructor(public kind: 'unauthenticated' | 'rate-limited' | 'network' | 'failed', message: string) {
        super(message);
        this.name = 'GhError';
    }
}

export function classifyGhFailure(stderr: string): GhError['kind'] {
    if (/auth login|not logged|authentication/i.test(stderr)) { return 'unauthenticated'; }
    if (/rate limit/i.test(stderr)) { return 'rate-limited'; }
    if (/could not resolve|timed? ?out|connection/i.test(stderr)) { return 'network'; }
    return 'failed';
}

const defaultExec: GhExec = (args) => new Promise((resolve) => {
    execFile('gh', args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) { resolve({ stdout, stderr, code: 0 }); return; }
        const code = typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? (error as unknown as { code: number }).code : 1;
        resolve({ stdout: stdout ?? '', stderr: stderr || error.message, code });
    });
});

export function createGh(exec: GhExec = defaultExec) {
    async function text(args: string[]): Promise<string> {
        const result = await exec(args);
        if (result.code !== 0) {
            const firstLine = (result.stderr || '').split(/\r?\n/)[0].trim() || 'gh failed';
            throw new GhError(classifyGhFailure(result.stderr || ''), firstLine);
        }
        return result.stdout;
    }
    async function json<T>(args: string[]): Promise<T> {
        return JSON.parse(await text(args)) as T;
    }
    return { text, json };
}
