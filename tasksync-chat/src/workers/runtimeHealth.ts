import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_OPENCODE_SERVER_URL, probeHttp } from './sharedServer';

/** Worker runtimes are gated by Settings toggles and a health check; at least one stays on (reviewer, 2026-10-16). */
export type RuntimeName = 'opencode' | 'agy';
export interface RuntimeState { enabled: boolean; ok: boolean; reason: string; checkedAt: number }
export interface RuntimeHealth { opencode: RuntimeState; agy: RuntimeState & { models: string[] } }

export interface RuntimeHealthDeps {
    enabled: (runtime: RuntimeName) => boolean;
    setEnabled: (runtime: RuntimeName, enabled: boolean) => Promise<void>;
    warn: (message: string) => void;
    home: () => string;
    pathDirs: () => string[];
    exists: (file: string) => boolean;
    agyModels: (binary: string) => Promise<string>;
    probeOpenCode: () => Promise<boolean>;
    now: () => number;
}

const LABEL: Record<RuntimeName, string> = { opencode: 'OpenCode', agy: 'agy' };
export const AGY_LOGIN_REASON = 'agy login expired: run agy and sign in';
export const OPENCODE_DOWN_REASON = 'OpenCode server is not up';
export const WORKERS_DISABLED_REASON = 'WORKERS_DISABLED: enable OpenCode or agy in Settings';
const DAY_HOUR = 6;

function vscodeApi(): any {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try { return require('vscode'); } catch { return undefined; }
}

const defaultDeps: RuntimeHealthDeps = {
    enabled: (runtime) => vscodeApi()?.workspace.getConfiguration('askaway.workers').get(`${runtime}.enabled`, runtime === 'opencode') ?? runtime === 'opencode',
    setEnabled: async (runtime, enabled) => {
        const vscode = vscodeApi();
        await vscode?.workspace.getConfiguration('askaway.workers').update(`${runtime}.enabled`, enabled, vscode.ConfigurationTarget.Global);
    },
    warn: (message) => { void vscodeApi()?.window.showWarningMessage(message); },
    home: () => os.homedir(),
    pathDirs: () => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
    exists: (file) => fs.existsSync(file),
    agyModels: (binary) => new Promise((resolve, reject) => {
        childProcess.execFile(binary, ['models'], { timeout: 30_000, encoding: 'utf8' }, (error, stdout) => {
            if (error) { reject(new Error(error.killed ? 'timed out after 30s' : error.message)); } else { resolve(String(stdout)); }
        });
    }),
    probeOpenCode: () => probeHttp(process.env.ASKAWAY_OPENCODE_SERVER_URL || DEFAULT_OPENCODE_SERVER_URL),
    now: () => Date.now(),
};

let deps: RuntimeHealthDeps = defaultDeps;
const listeners = new Set<(health: RuntimeHealth) => void>();
const unchecked = (): RuntimeState => ({ enabled: false, ok: false, reason: 'not checked yet', checkedAt: 0 });
let state: RuntimeHealth = { opencode: unchecked(), agy: { ...unchecked(), models: [] } };
const inflight = new Map<RuntimeName, Promise<void>>();

/** Replaces the host seams (settings, files, `agy models`, server probe, clock); tests pass fakes, omitted fields keep defaults. */
export function configureRuntimeHealth(overrides: Partial<RuntimeHealthDeps> = {}): void {
    deps = { ...defaultDeps, ...overrides };
    state = { opencode: unchecked(), agy: { ...unchecked(), models: [] } };
    inflight.clear();
}

export function getRuntimeHealth(): RuntimeHealth {
    return {
        opencode: { ...state.opencode, enabled: deps.enabled('opencode') },
        agy: { ...state.agy, models: [...state.agy.models], enabled: deps.enabled('agy') },
    };
}

export function onDidChangeRuntimeHealth(listener: (health: RuntimeHealth) => void): { dispose(): void } {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
}

function emit(): void {
    const health = getRuntimeHealth();
    for (const listener of listeners) { listener(health); }
}

/** The most recent 06:00 local at or before `now`: a check older than it is stale. */
export function lastMorning(now: number): number {
    const morning = new Date(now);
    morning.setHours(DAY_HOUR, 0, 0, 0);
    if (morning.getTime() > now) { morning.setDate(morning.getDate() - 1); }
    return morning.getTime();
}

function findAgy(): string {
    const dirs = [...deps.pathDirs(), path.join(deps.home(), '.local', 'bin')];
    return dirs.map((dir) => path.join(dir, 'agy')).find((file) => deps.exists(file)) ?? '';
}

async function checkAgy(): Promise<RuntimeHealth['agy']> {
    const checkedAt = deps.now();
    const enabled = deps.enabled('agy');
    if (!enabled) { return { enabled, ok: false, reason: 'agy is off in Settings', checkedAt, models: [] }; }
    const binary = findAgy();
    if (!binary) { return { enabled, ok: false, reason: 'agy is not installed: ~/.local/bin/agy not found on PATH', checkedAt, models: [] }; }
    // Presence only: the token file is never read.
    if (!deps.exists(path.join(deps.home(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'))) {
        return { enabled, ok: false, reason: AGY_LOGIN_REASON, checkedAt, models: [] };
    }
    let output: string;
    try { output = await deps.agyModels(binary); } catch (error) {
        // A timeout or network failure says nothing about the login.
        return { enabled, ok: false, reason: `agy models check failed: ${String((error as Error)?.message ?? error).split('\n')[0].slice(0, 120)}`, checkedAt, models: [] };
    }
    const models = output.split('\n').filter((line) => line.includes('\t')).map((line) => line.split('\t')[0].trim()).filter((id) => /^[\w.-]+$/.test(id));
    // A signed-out agy prints only its built-in fallback list, which has no Argon model.
    const ok = models.some((id) => /argon/i.test(id));
    return { enabled, ok, reason: ok ? '' : AGY_LOGIN_REASON, checkedAt, models };
}

async function checkOpenCode(): Promise<RuntimeState> {
    const checkedAt = deps.now();
    const enabled = deps.enabled('opencode');
    if (!enabled) { return { enabled, ok: false, reason: 'OpenCode is off in Settings', checkedAt }; }
    const ok = await deps.probeOpenCode().catch(() => false);
    return { enabled, ok, reason: ok ? '' : OPENCODE_DOWN_REASON, checkedAt };
}

/** Checks one runtime, or both; concurrent calls for the same runtime share one check. */
export async function recheckRuntimeHealth(runtime?: RuntimeName): Promise<RuntimeHealth> {
    const names: RuntimeName[] = runtime ? [runtime] : ['opencode', 'agy'];
    await Promise.all(names.map((name) => {
        let pending = inflight.get(name);
        if (!pending) {
            pending = (name === 'agy' ? checkAgy().then((next) => { state.agy = next; }) : checkOpenCode().then((next) => { state.opencode = next; }))
                .finally(() => inflight.delete(name));
            inflight.set(name, pending);
        }
        return pending;
    }));
    emit();
    return getRuntimeHealth();
}

/** Hourly tick: rechecks both runtimes once per day after 06:00 local (agy expects a login every day). */
export async function runtimeHealthTick(): Promise<boolean> {
    const morning = lastMorning(deps.now());
    if (state.agy.checkedAt >= morning && state.opencode.checkedAt >= morning) { return false; }
    await recheckRuntimeHealth();
    return true;
}

/** Activation: one check now, then the hourly daily-recheck timer; a failed check is reported, never an unhandled rejection. */
export function startRuntimeHealth(intervalMs = 3_600_000): { dispose(): void } {
    const report = (error: unknown) => deps.warn(`Worker runtime check failed: ${String((error as Error)?.message ?? error)}`);
    recheckRuntimeHealth().catch(report);
    const timer = setInterval(() => { runtimeHealthTick().catch(report); }, intervalMs);
    timer.unref?.();
    return { dispose: () => clearInterval(timer) };
}

/** Turns a runtime on or off; turning off the last enabled one is refused with a warning. */
export async function setRuntimeEnabled(runtime: RuntimeName, enabled: boolean): Promise<boolean> {
    const other: RuntimeName = runtime === 'agy' ? 'opencode' : 'agy';
    if (!enabled && !deps.enabled(other)) {
        deps.warn(`Keep at least one worker runtime on: turn on ${LABEL[other]} before turning off ${LABEL[runtime]}.`);
        emit();
        return false;
    }
    await deps.setEnabled(runtime, enabled);
    await recheckRuntimeHealth(runtime);
    return true;
}

/** A toggle changed outside the webview (settings.json): both off is reverted to keep the changed one on. */
export async function runtimeSettingChanged(runtime: RuntimeName): Promise<void> {
    if (!deps.enabled('opencode') && !deps.enabled('agy')) {
        deps.warn(`Keep at least one worker runtime on: ${LABEL[runtime]} stays on.`);
        await deps.setEnabled(runtime, true);
    }
    await recheckRuntimeHealth(runtime);
}

/** The worker-tool gate: a refusal for a disabled or unhealthy runtime, or null. `before` skips the OpenCode probe (its server may not be started yet). */
export async function runtimeRefusal(runtimes: RuntimeName[], phase: 'before' | 'ready' = 'ready'): Promise<Record<string, unknown> | null> {
    if (!deps.enabled('opencode') && !deps.enabled('agy')) { return { status: 'WORKERS_DISABLED', reason: WORKERS_DISABLED_REASON }; }
    const unique = [...new Set(runtimes)];
    for (const runtime of unique) {
        if (!deps.enabled(runtime)) { return { status: 'RUNTIME_OFF', runtime, reason: `${LABEL[runtime]} is off in Settings` }; }
    }
    for (const runtime of unique) {
        if (runtime === 'opencode' && phase === 'before') { continue; }
        const current = state[runtime];
        // OpenCode is probed on every dispatch; agy only when its last check failed or predates this morning 06:00.
        if (runtime === 'opencode' || !current.ok || current.checkedAt < lastMorning(deps.now())) { await recheckRuntimeHealth(runtime); }
        const checked = state[runtime];
        if (!checked.ok) { return { status: 'RUNTIME_UNHEALTHY', runtime, reason: checked.reason }; }
    }
    return null;
}

export type RuntimeHealthMessage = { type: 'setRuntimeEnabled'; runtime: RuntimeName; enabled: boolean } | { type: 'recheckRuntimeHealth' };

/** Webview glue: posts `runtimeHealth` now and on every change; the returned dispose stops it. */
export function bindRuntimeHealthView(post: (message: { type: 'runtimeHealth'; health: RuntimeHealth }) => void): { dispose(): void } {
    post({ type: 'runtimeHealth', health: getRuntimeHealth() });
    return onDidChangeRuntimeHealth((health) => post({ type: 'runtimeHealth', health }));
}

export async function handleRuntimeHealthMessage(message: RuntimeHealthMessage): Promise<void> {
    if (message.type === 'recheckRuntimeHealth') { await recheckRuntimeHealth(); return; }
    if (message.runtime === 'agy' || message.runtime === 'opencode') { await setRuntimeEnabled(message.runtime, message.enabled === true); }
}
