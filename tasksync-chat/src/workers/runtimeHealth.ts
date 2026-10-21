import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_OPENCODE_SERVER_URL, probeHttp } from './sharedServer';
import { loadRuntimeModels, namespacedModels, parseOpenCodeModels, recordRuntimeModels, RUNTIME_MODELS_FILE } from './runtimeModels';

/**
 * Integrations (OpenCode, agy, Claude) are gated by Settings toggles and a health check; at least one stays on
 * (reviewer, 2026-10-16). All three run workers (agy and Claude through their CLIs) and are gated per dispatch.
 */
export type RuntimeName = 'opencode' | 'agy' | 'claude';
export const RUNTIME_NAMES: RuntimeName[] = ['opencode', 'agy', 'claude'];
/** The same facts for every integration; signIn says the CLI needs a manual login (agy, Claude), the rest of the reason stays internal. */
export interface RuntimeState { enabled: boolean; ok: boolean; checkedAt: number; signIn: boolean }
export type RuntimeHealth = Record<RuntimeName, RuntimeState>;
interface CheckedState { enabled: boolean; ok: boolean; checkedAt: number; reason: string; models: string[] }

export interface RuntimeHealthDeps {
    enabled: (runtime: RuntimeName) => boolean;
    setEnabled: (runtime: RuntimeName, enabled: boolean) => Promise<void>;
    warn: (message: string) => void;
    home: () => string;
    pathDirs: () => string[];
    exists: (file: string) => boolean;
    agyModels: (binary: string) => Promise<string>;
    /** `claude auth status --json` output; never reads a token. */
    claudeAuth: (binary: string) => Promise<string>;
    /** `opencode models` output: one provider/model per line. */
    opencodeModels: (binary: string) => Promise<string>;
    /** Where each runtime's discovered models are kept between restarts. */
    modelsFile: () => string;
    probeOpenCode: () => Promise<boolean>;
    /** Restarts the shared OpenCode server (the existing Workers restart). */
    restartOpenCode: () => Promise<void>;
    now: () => number;
}

const LABEL: Record<RuntimeName, string> = { opencode: 'OpenCode', agy: 'agy', claude: 'Claude' };
export const AGY_LOGIN_REASON = 'agy login expired: run agy and sign in';
export const OPENCODE_DOWN_REASON = 'OpenCode server is not up';
export const CLAUDE_LOGIN_REASON = 'Claude is not signed in';
export const WORKERS_DISABLED_REASON = 'WORKERS_DISABLED: enable OpenCode, agy or Claude in Settings';
const WORKER_RUNTIMES: RuntimeName[] = ['opencode', 'agy', 'claude'];
const DAY_HOUR = 6;

function vscodeApi(): any {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try { return require('vscode'); } catch { return undefined; }
}

/** Runs a CLI check; a non-zero exit still yields its stdout (a signed-out `claude auth status` exits 1 with JSON). */
function runCheck(binary: string, args: string[], seconds: number): Promise<string> {
    return new Promise((resolve, reject) => {
        childProcess.execFile(binary, args, { timeout: seconds * 1000, encoding: 'utf8' }, (error, stdout) => {
            if (error && (error.killed || !String(stdout).trim())) { reject(new Error(error.killed ? `timed out after ${seconds}s` : error.message)); } else { resolve(String(stdout)); }
        });
    });
}

const defaultDeps: RuntimeHealthDeps = {
    enabled: (runtime) => vscodeApi()?.workspace.getConfiguration('askaway.workers').get(`${runtime}.enabled`, runtime !== 'claude') ?? runtime !== 'claude',
    setEnabled: async (runtime, enabled) => {
        const vscode = vscodeApi();
        await vscode?.workspace.getConfiguration('askaway.workers').update(`${runtime}.enabled`, enabled, vscode.ConfigurationTarget.Global);
    },
    warn: (message) => { void vscodeApi()?.window.showWarningMessage(message); },
    home: () => os.homedir(),
    pathDirs: () => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
    exists: (file) => fs.existsSync(file),
    agyModels: (binary) => runCheck(binary, ['models'], 30),
    claudeAuth: (binary) => runCheck(binary, ['auth', 'status', '--json'], 20),
    opencodeModels: (binary) => runCheck(binary, ['models'], 30),
    modelsFile: () => RUNTIME_MODELS_FILE,
    probeOpenCode: () => probeHttp(process.env.ASKAWAY_OPENCODE_SERVER_URL || DEFAULT_OPENCODE_SERVER_URL),
    restartOpenCode: async () => {
        // Lazy: the worker host pulls in the whole OpenCode runtime.
        const { restartSharedServer } = require('./workerHost') as typeof import('./workerHost');
        await restartSharedServer(vscodeApi()?.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    },
    now: () => Date.now(),
};

let deps: RuntimeHealthDeps = defaultDeps;
const listeners = new Set<(health: RuntimeHealth) => void>();
const unchecked = (): CheckedState => ({ enabled: false, ok: false, reason: 'not checked yet', checkedAt: 0, models: [] });
const fresh = (): Record<RuntimeName, CheckedState> => ({ opencode: unchecked(), agy: unchecked(), claude: unchecked() });
let state = fresh();
const inflight = new Map<RuntimeName, Promise<void>>();

/** Replaces the host seams (settings, files, CLI checks, server probe/restart, clock); tests pass fakes, omitted fields keep defaults. */
export function configureRuntimeHealth(overrides: Partial<RuntimeHealthDeps> = {}): void {
    deps = { ...defaultDeps, ...overrides };
    state = fresh();
    inflight.clear();
}

/** The uniform `{enabled, ok, checkedAt}` per integration that the webview shows. */
export function getRuntimeHealth(): RuntimeHealth {
    const view = (name: RuntimeName): RuntimeState => {
        const current = state[name];
        const enabled = deps.enabled(name);
        return { enabled, ok: current.ok, checkedAt: current.checkedAt, signIn: enabled && !current.ok && (current.reason === AGY_LOGIN_REASON || current.reason === CLAUDE_LOGIN_REASON) };
    };
    return { opencode: view('opencode'), agy: view('agy'), claude: view('claude') };
}

/** Internal detail of the last check (reason for logs and refusals; agy model ids). */
export function runtimeDetail(runtime: RuntimeName): { reason: string; models: string[] } {
    return { reason: state[runtime].reason, models: [...state[runtime].models] };
}

/** Worker model ids of the enabled integrations (agy/…, claude/…, provider/model), from the last checks, kept across restarts. */
export function getRuntimeModelIds(): string[] {
    return namespacedModels(loadRuntimeModels(deps.modelsFile()), (runtime) => deps.enabled(runtime));
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

function findBinary(name: string): string {
    const dirs = [...deps.pathDirs(), path.join(deps.home(), '.local', 'bin')];
    return dirs.map((dir) => path.join(dir, name)).find((file) => deps.exists(file)) ?? '';
}

const firstLine = (error: unknown) => String((error as Error)?.message ?? error).split('\n')[0].slice(0, 120);

async function checkAgy(enabled: boolean, checkedAt: number): Promise<CheckedState> {
    const binary = findBinary('agy');
    if (!binary) { return { enabled, ok: false, reason: 'agy is not installed: ~/.local/bin/agy not found on PATH', checkedAt, models: [] }; }
    // Presence only: the token file is never read.
    if (!deps.exists(path.join(deps.home(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'))) {
        return { enabled, ok: false, reason: AGY_LOGIN_REASON, checkedAt, models: [] };
    }
    let output: string;
    try { output = await deps.agyModels(binary); } catch (error) {
        // A timeout or network failure says nothing about the login.
        return { enabled, ok: false, reason: `agy models check failed: ${firstLine(error)}`, checkedAt, models: [] };
    }
    const models = output.split('\n').filter((line) => line.includes('\t')).map((line) => line.split('\t')[0].trim()).filter((id) => /^[\w.-]+$/.test(id));
    // A signed-out agy prints only its built-in fallback list, which has no Argon model.
    const ok = models.some((id) => /argon/i.test(id));
    return { enabled, ok, reason: ok ? '' : AGY_LOGIN_REASON, checkedAt, models };
}

async function checkClaude(enabled: boolean, checkedAt: number): Promise<CheckedState> {
    const binary = findBinary('claude');
    if (!binary) { return { enabled, ok: false, reason: 'Claude is not installed: claude not found on PATH', checkedAt, models: [] }; }
    let output: string;
    try { output = await deps.claudeAuth(binary); } catch (error) {
        return { enabled, ok: false, reason: `Claude auth check failed: ${firstLine(error)}`, checkedAt, models: [] };
    }
    let loggedIn = false;
    try { loggedIn = JSON.parse(output)?.loggedIn === true; } catch { /* not JSON: not signed in */ }
    // The CLI has no model listing; these aliases always resolve to its current Sonnet, Opus and Haiku.
    return { enabled, ok: loggedIn, reason: loggedIn ? '' : CLAUDE_LOGIN_REASON, checkedAt, models: loggedIn ? ['sonnet', 'opus', 'haiku'] : [] };
}

async function checkOpenCode(enabled: boolean, checkedAt: number): Promise<CheckedState> {
    const ok = await deps.probeOpenCode().catch(() => false);
    let models: string[] = [];
    if (ok) {
        const binary = findBinary('opencode') || path.join(deps.home(), '.opencode', 'bin', 'opencode');
        try { models = parseOpenCodeModels(await deps.opencodeModels(binary)); } catch { /* The server is up; the model list is just not refreshed. */ }
    }
    return { enabled, ok, reason: ok ? '' : OPENCODE_DOWN_REASON, checkedAt, models };
}

const CHECKS: Record<RuntimeName, (enabled: boolean, checkedAt: number) => Promise<CheckedState>> = { opencode: checkOpenCode, agy: checkAgy, claude: checkClaude };

async function check(runtime: RuntimeName): Promise<CheckedState> {
    const checkedAt = deps.now();
    const enabled = deps.enabled(runtime);
    if (!enabled) { return { enabled, ok: false, reason: `${LABEL[runtime]} is off in Settings`, checkedAt, models: [] }; }
    return CHECKS[runtime](enabled, checkedAt);
}

/** Checks one integration, or all; concurrent calls for the same one share one check. */
export async function recheckRuntimeHealth(runtime?: RuntimeName): Promise<RuntimeHealth> {
    const names = runtime ? [runtime] : RUNTIME_NAMES;
    await Promise.all(names.map((name) => {
        let pending = inflight.get(name);
        if (!pending) {
            pending = check(name).then((next) => {
                state[name] = next;
                // A healthy check refreshes the stored list; a failed or signed-out one (agy then prints only a fallback list) keeps the last good one.
                try { recordRuntimeModels(name, next.ok ? next.models : [], next.checkedAt, deps.modelsFile()); } catch { /* A read-only home never fails a check. */ }
            }).finally(() => inflight.delete(name));
            inflight.set(name, pending);
        }
        return pending;
    }));
    emit();
    return getRuntimeHealth();
}

/** The Integrations refresh button, the same for all three: OpenCode restarts its shared server, then each one is checked. */
export async function refreshIntegration(runtime: RuntimeName): Promise<RuntimeHealth> {
    if (runtime === 'opencode' && deps.enabled('opencode')) {
        await deps.restartOpenCode().catch((error) => deps.warn(`OpenCode restart failed: ${firstLine(error)}`));
    }
    return recheckRuntimeHealth(runtime);
}

/** Hourly tick: rechecks every integration once per day after 06:00 local (agy expects a login every day). */
export async function runtimeHealthTick(): Promise<boolean> {
    const morning = lastMorning(deps.now());
    if (RUNTIME_NAMES.every((name) => state[name].checkedAt >= morning)) { return false; }
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

const othersOn = (runtime: RuntimeName) => RUNTIME_NAMES.filter((name) => name !== runtime && deps.enabled(name));

/** Turns an integration on or off; turning off the last enabled one is refused with a warning. */
export async function setRuntimeEnabled(runtime: RuntimeName, enabled: boolean): Promise<boolean> {
    if (!enabled && othersOn(runtime).length === 0) {
        deps.warn(`Keep at least one worker runtime on: turn on another integration before turning off ${LABEL[runtime]}.`);
        emit();
        return false;
    }
    await deps.setEnabled(runtime, enabled);
    await recheckRuntimeHealth(runtime);
    return true;
}

/** A toggle changed outside the webview (settings.json): all off is reverted to keep the changed one on. */
export async function runtimeSettingChanged(runtime: RuntimeName): Promise<void> {
    if (RUNTIME_NAMES.every((name) => !deps.enabled(name))) {
        deps.warn(`Keep at least one worker runtime on: ${LABEL[runtime]} stays on.`);
        await deps.setEnabled(runtime, true);
    }
    await recheckRuntimeHealth(runtime);
}

/** The worker-tool gate: a refusal for a disabled or unhealthy runtime, or null. `before` skips the OpenCode probe (its server may not be started yet). */
export async function runtimeRefusal(runtimes: RuntimeName[], phase: 'before' | 'ready' = 'ready'): Promise<Record<string, unknown> | null> {
    if (WORKER_RUNTIMES.every((name) => !deps.enabled(name))) { return { status: 'WORKERS_DISABLED', reason: WORKERS_DISABLED_REASON }; }
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

/** Webview → host: a Settings toggle, the per-integration refresh button, or (legacy) recheck all. */
export type RuntimeHealthMessage =
    | { type: 'setRuntimeEnabled'; runtime: RuntimeName; enabled: boolean }
    | { type: 'refreshIntegration'; runtime: RuntimeName }
    | { type: 'recheckRuntimeHealth' };

/** Webview glue: posts `runtimeHealth` now and on every change; the returned dispose stops it. */
export function bindRuntimeHealthView(post: (message: { type: 'runtimeHealth'; health: RuntimeHealth; models: string[] }) => void): { dispose(): void } {
    post({ type: 'runtimeHealth', health: getRuntimeHealth(), models: getRuntimeModelIds() });
    return onDidChangeRuntimeHealth((health) => post({ type: 'runtimeHealth', health, models: getRuntimeModelIds() }));
}

const isRuntime = (value: unknown): value is RuntimeName => RUNTIME_NAMES.includes(value as RuntimeName);

export async function handleRuntimeHealthMessage(message: RuntimeHealthMessage): Promise<void> {
    if (message.type === 'recheckRuntimeHealth') { await recheckRuntimeHealth(); return; }
    if (!isRuntime(message.runtime)) { return; }
    if (message.type === 'refreshIntegration') { await refreshIntegration(message.runtime); return; }
    await setRuntimeEnabled(message.runtime, message.enabled === true);
}
