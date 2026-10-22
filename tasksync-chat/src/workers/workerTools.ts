import { z } from 'zod';
import { MAX_WAIT_SECONDS, OpenCodeWorkerRuntime, WorkerPacket } from './openCodeRuntime';
import { projectWorkersState } from './workersState';
import { catalogWorkerProfiles, defaultModel, withSelection } from './workerProfiles';
import { memberSelectionForProfile, teamRoster } from '../team/roster';
import type { TurnBudget } from './turnBudget';
type Caller = { recipient: string; workspace?: string };
let delivery: ((result: string, caller?: Caller) => string) | undefined;
export function setToolResultDelivery(handler: (result: string, caller?: Caller) => string): void { delivery = handler; }
type RuntimeName = 'opencode' | 'agy' | 'claude';
/** `before` checks toggles and agy/claude health without starting anything; `ready` also probes the OpenCode server once it was started. */
type RuntimeGate = (runtimes: RuntimeName[], phase: 'before' | 'ready') => Promise<Record<string, unknown> | null>;
let runtimeGate: RuntimeGate | undefined;
let runtimeInspect: (() => OpenCodeWorkerRuntime) | undefined;
/** The host installs the Settings/health gate and a runtime getter that never starts the OpenCode server; without a gate every runtime is allowed. */
export function setWorkerRuntimeGate(gate: RuntimeGate | undefined, inspect?: () => OpenCodeWorkerRuntime): void { runtimeGate = gate; runtimeInspect = inspect; }

const runtimeOfModel = (model: string): RuntimeName => model.startsWith('agy/') ? 'agy' : model.startsWith('claude/') ? 'claude' : 'opencode';
/** The runtimes a dispatch uses, by effective model: the packet's runtime or model, else the warm worker's, else the profile default. */
function dispatchRuntimes(action: string, args: any, live: OpenCodeWorkerRuntime): RuntimeName[] {
    if (action === 'resume') { return [runtimeOfModel(String(live.status(args.runId)?.model ?? ''))]; }
    const workerModel = args.workerId ? String(live.router?.worker(args.workerId)?.model ?? '') : '';
    const packets: any[] = action === 'fanout' ? (Array.isArray(args.packets) ? args.packets : []) : [args];
    return packets.map((packet): RuntimeName => {
        if (packet.runtime === 'agy' || packet.runtime === 'opencode' || packet.runtime === 'claude') { return packet.runtime; }
        const profile = typeof packet.profile === 'string' ? live.router?.profile(packet.profile) : undefined;
        return runtimeOfModel(String(packet.model || workerModel || (profile ? defaultModel(profile) : '')));
    });
}

/** Where worker profiles come from: the extension's built-in directory, the user's own, and the runtime toggles. */
export interface WorkerProfileCatalog { builtinDir: string; userDir: string; enabled: (runtime: RuntimeName) => boolean }
let profileCatalog: WorkerProfileCatalog | undefined;
/** The host installs the profile directories and runtime toggles behind `action: "profiles"`. */
export function setWorkerProfileCatalog(catalog: WorkerProfileCatalog | undefined): void { profileCatalog = catalog; }

/** The enabled profiles (their default model's runtime is on), each with its Team member and role. */
export function enabledWorkerProfiles(catalog: WorkerProfileCatalog): Array<{ profile: string; member: string; role: string; model: string; thinking: string; runtime: RuntimeName; source: 'builtin' | 'user' }> {
    const roster = teamRoster(catalog.userDir);
    return catalogWorkerProfiles(catalog.builtinDir, catalog.userDir).map((listed) => {
        const profile = { ...withSelection(listed, memberSelectionForProfile(listed.name, catalog.userDir)), origin: listed.origin };
        const model = defaultModel(profile);
        const member = roster.find((entry) => entry.kind === 'worker' && entry.profiles.includes(profile.name));
        return { profile: profile.name, member: member?.name ?? '', role: member?.role ?? '', model, thinking: profile.thinking, runtime: runtimeOfModel(model), source: profile.origin };
    }).filter((entry) => catalog.enabled(entry.runtime));
}

export const WORKER_TOOL_NAMES = ['worker_start', 'worker_submit', 'worker_list', 'worker_status', 'worker_wait', 'worker_cancel', 'worker_resume', 'worker_logs', 'worker_fanout', 'worker_profiles'] as const;
/** Hosts see ONE `worker` tool; `action` selects the operation, like the `gradle` tool (reviewer, 2026-09-25). */
export const WORKER_ACTIONS = WORKER_TOOL_NAMES.map((name) => name.slice('worker_'.length)) as ['start', 'submit', 'list', 'status', 'wait', 'cancel', 'resume', 'logs', 'fanout', 'profiles'];

type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) => unknown;

/** One tool contract, consumed by every host adapter (MCP server, VS Code LM tools, package.json manifest). */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodObject<any>;
    run: (args: any) => unknown | Promise<unknown>;
}

const packetShape = {
    profile: z.string().describe('Worker mode: one of the enabled profiles that `action: "profiles"` lists.'),
    runtime: z.enum(['opencode', 'agy', 'claude']).optional().describe('Worker runtime; default opencode. agy runs `model` (e.g. gemini-4-argon-medium) through the agy CLI for any mode; its cost is unreported and it has no OpenCode viewer. claude runs `model` (sonnet, opus, haiku or any id the Claude CLI accepts) through Claude Code headless; its cost is reported.'),
    agyPermissions: z.enum(['review', 'skip']).optional().describe('agy only. Default review: headless agy auto-denies commands/MCP calls its settings.json permissions.allow does not grant, and the run FAILS with that reason. skip: explicit per-run --dangerously-skip-permissions; refused for modes that deny edits or shell.'),
    model: z.string().optional().describe('provider/model; must be allowed by the mode. Omit for the mode default.'),
    thinking: z.string().optional().describe('Reasoning variant; must be allowed by the mode.'),
    dispatchTurnId: z.string().min(1).describe('The orchestrator turn this work is attributed to.'),
    baseRevision: z.string().min(1).describe('Explicit commit, tag, or remote ref.'),
    objective: z.string().min(1),
    allowedFiles: z.array(z.string()).describe('Files the worker may change; empty means read-only.'),
    acceptance: z.string().min(1).describe('One observable assertion.'),
    expected: z.string().min(1).describe('The exact expected result.'),
    // Workers run headless: a `cd`, `&&`, `|`, `;` or redirect is auto-rejected by the bash allowlist and kills the run.
    command: z.string().min(1).regex(/^(?!\s*cd\s)[^&|;<>]+$/, 'one simple command from the repo root, no cd/&&/|/;/redirects')
        .describe('One simple verification command run from the repo root, e.g. `rtk npm --prefix tasksync-chat run test:workers`. No cd, &&, |, ; or redirects.'),
    estimatedSeconds: z.number().positive().optional(),
    track: z.string().max(24).optional().describe('Your plan\'s track for this packet, e.g. "A"; it is kept in the worker state with the task.'),
    workspacePath: z.string().optional().describe('Defaults to the current workspace.'),
};


/** The refusal a worker start/submit gets once the turn total reached the limit; null when dispatch is allowed. */
export function workerBudgetRefusal(action: string, budget: Pick<TurnBudget, 'spentAiu' | 'limitAiu' | 'exceeded'> | null | undefined): Record<string, unknown> | null {
    if ((action !== 'start' && action !== 'submit' && action !== 'fanout') || !budget || !budget.exceeded) { return null; }
    const spent = Number(budget.spentAiu.toFixed(2));
    return {
        status: 'BUDGET_EXCEEDED',
        spentAiu: spent,
        limitAiu: budget.limitAiu,
        reason: `Turn budget reached: ${spent}/${budget.limitAiu} AIU (main agent + workers). No new worker is dispatched; finish with what you have.`,
    };
}

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** Validates input against the contract, runs it, and returns the bounded JSON text every host sends back. */
export async function invokeDefinition(definition: ToolDefinition, input: unknown, deliver = true, caller?: Caller): Promise<string> {
    const parsed = definition.inputSchema.safeParse(input ?? {});
    if (!parsed.success) {
        return JSON.stringify({ status: 'INVALID_INPUT', reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    }
    if (deliver && delivery) {
        const { beginAITalkTool } = require('../aitalk/delivery') as typeof import('../aitalk/delivery');
        beginAITalkTool(caller);
    }
    const result = JSON.stringify(await definition.run(parsed.data));
    return deliver && delivery ? delivery(result, caller) : result;
}

export function registerToolDefinitions(register: Register, definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
        // `_meta` (the caller's identity) rides in the arguments, so the host schema must let it through instead of stripping it.
        const schema: any = definition.inputSchema;
        register(definition.name, { description: definition.description, inputSchema: typeof schema.passthrough === 'function' ? schema.passthrough() : schema },
            async (args: any, extra?: any) => {
                // Identity: the transport `_meta`, plus the OpenCode session id from the arguments; nothing else in `args._meta` is trusted.
                const aitalk = args?._meta || extra?._meta || definition.name === 'aitalk' ? require('../aitalk/delivery') as typeof import('../aitalk/delivery') : undefined;
                const meta = aitalk?.callMeta(args, extra);
                const input = { ...args }; delete input._meta;
                // Only a call that names its caller (or a commentary line, which needs a workspace) touches the AITalk delivery boundary.
                const caller = aitalk?.mcpAITalkCaller({ _meta: meta });
                // The feed a line belongs to is the worker's own workspace, never the server owner's.
                const workspace = (caller ?? aitalk?.currentAITalkCaller())?.workspace;
                if (definition.name === 'aitalk' && !input.workspacePath && workspace) input.workspacePath = workspace;
                const run = async () => ({ content: [{ type: 'text' as const, text: await invokeDefinition(definition, input, false) }] });
                if (!caller || !aitalk) return run();
                const result = await aitalk.withAITalkMcpDelivery(run, caller.workspace ?? '')(input, { _meta: meta });
                return { content: [{ type: 'text' as const, text: result.content.map((part: any) => part.text).join('\n\n') }] };
            });
    }
}

export function registerWorkerTools(register: Register, runtime: () => RuntimeSource, defaultWorkspace: string): void {
    registerToolDefinitions(register, [workerTool(runtime, defaultWorkspace)]);
}

/** Profiles a worker may start: they change nothing (R-WTOOL-46). */
export const WORKER_CHILD_PROFILES = ['explore', 'research', 'verify', 'quality'];
export const WORKER_MAX_LIVE_CHILDREN = 2;
/** Children per calling worker, keyed `${workspace}\0${caller}` so the same worker id in another workspace shares nothing. In memory only. */
const childrenOf = new Map<string, { runs: Set<string>; workers: Set<string> }>();
const childWorkers = new Set<string>();
const TERMINAL_STATES = ['COMPLETED', 'FAILED', 'CANCELLED', 'REMOVED'];
const refuse = (reason: string) => ({ status: 'REFUSED', reason });
const guardKey = (workspace: string | undefined, worker: string) => `${workspace ?? ''}\0${worker}`;

type WorkerCaller = { key: string; unidentified: boolean; workspace: string };
/** The calling worker, or undefined for the main agent and for hosts that name no caller. */
function callingWorker(): WorkerCaller | undefined {
    let delivery: typeof import('../aitalk/delivery');
    try { delivery = require('../aitalk/delivery'); }
    catch (error: any) { if (error?.code === 'MODULE_NOT_FOUND') { return undefined; } throw error; } // a per-file build without the AITalk modules names no caller
    const caller = delivery.currentAITalkCaller();
    if (!caller) { return undefined; }
    const workspace = caller.workspace ?? '';
    // A carrier no worker owns is nobody: never the main agent, and it gets nothing from the worker tool.
    if (caller.unidentified) { return { key: guardKey(workspace, caller.recipient), unidentified: true, workspace }; }
    const { roomFor } = require('../aitalk/actors') as typeof import('../aitalk/actors');
    try {
        const members = roomFor(workspace).store.snapshot(true).members;
        if (members.some((member: any) => member.id === caller.recipient && member.kind !== 'worker')) { return undefined; }
    } catch { /* an unreadable room names no main agent: the caller stays a worker */ }
    return { key: guardKey(workspace, caller.recipient), unidentified: false, workspace };
}

function collectRuns(value: unknown, into: Array<{ runId: string; workerId: string }> = []): Array<{ runId: string; workerId: string }> {
    if (Array.isArray(value)) { value.forEach((item) => collectRuns(item, into)); }
    else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.runId === 'string' && typeof record.workerId === 'string') { into.push({ runId: record.runId, workerId: record.workerId }); }
        else { Object.values(record).forEach((item) => collectRuns(item, into)); }
    }
    return into;
}

/** What a worker may do with the worker tool: read-only children, at most two live, one level deep; the main agent is unrestricted. */
async function workerCallerRefusal(parent: WorkerCaller, action: string, args: any, runtime: () => RuntimeSource): Promise<Record<string, unknown> | null> {
    if (parent.unidentified) { return refuse('This call could not be tied to a known worker, so it cannot use the worker tool. Report what you need in your final report.'); }
    const mine = childrenOf.get(parent.key) ?? { runs: new Set<string>(), workers: new Set<string>() };
    if (action === 'start' || action === 'submit' || action === 'fanout') {
        if (childWorkers.has(parent.key)) { return refuse('A worker started by a worker cannot start workers (nesting depth is 1). Report what you need in your final report.'); }
        // submit and fanout reuse an existing worker: a worker may reuse only its own children, never itself or anyone else's worker.
        if ((action === 'submit' || action === 'fanout') && !mine.workers.has(String(args.workerId))) {
            return refuse('A worker may submit or fan out only on child workers it started itself, not on itself or on another worker.');
        }
        const packets: any[] = action === 'fanout' ? (Array.isArray(args.packets) ? args.packets : []) : [args];
        const bad = packets.find((packet) => !WORKER_CHILD_PROFILES.includes(String(packet?.profile)));
        if (bad) { return refuse(`A worker may start only read-only profiles (${WORKER_CHILD_PROFILES.join(', ')}); "${bad.profile}" is not allowed.`); }
        const live = await Promise.resolve(runtime());
        const running = [...mine.runs].filter((runId) => { const state = (live.status(runId) as any)?.state; return state && !TERMINAL_STATES.includes(state); }).length;
        if (running + packets.length > WORKER_MAX_LIVE_CHILDREN) { return refuse(`A worker may have at most ${WORKER_MAX_LIVE_CHILDREN} child runs live; ${running} are running. Wait for one or cancel it first.`); }
        return null;
    }
    if (['status', 'wait', 'cancel', 'resume', 'logs'].includes(action) && !mine.runs.has(String(args.runId))) {
        return refuse('A worker may only use the worker tool on the child runs it started itself.');
    }
    return null;
}

/** `waitBudgetMs` caps a wait by the caller's prompt-cache clock; hosts whose callers keep their own cache omit it. */
export interface WorkerToolOptions {
    waitBudgetMs?: (requestedMs: number) => number;
    /** Live turn spend (main + workers) against askaway.turnBudgetAiu; start and submit are refused once exceeded. */
    turnBudget?: () => TurnBudget | Promise<TurnBudget>;
}

/** The eight operations behind one tool: the host schema merges every field, then each action validates its own. */
export function workerTool(source: () => RuntimeSource, defaultWorkspace: string, options: WorkerToolOptions = {}): ToolDefinition {
    const operations = new Map(workerToolDefinitions(source, defaultWorkspace, options).map((d) => [d.name.slice('worker_'.length), d]));
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const operation of operations.values()) {
        for (const [field, schema] of Object.entries(operation.inputSchema.shape as Record<string, z.ZodTypeAny>)) {
            shape[field] = shape[field] ?? schema.optional();
        }
    }
    return {
        name: 'worker',
        description: 'Control async OpenCode workers. Pick `action`:\n'
            + '- start: run one self-contained packet (profile, dispatchTurnId, baseRevision, objective, allowedFiles, acceptance, expected, command; optional model, thinking, track). Returns a handle at once.\n'
            + '- submit: same packet plus workerId, queued on a warm worker (reuses its session, ~4x cheaper).\n'
            + '- list: live workers with knowledge, nextInputTokens, warmForSeconds; check before start.\n'
            + '- profiles: the enabled worker profiles (built-in and the user\'s own) with member, role, model, thinking, runtime, source.\n'
            + '- fanout: ONLY when you explicitly want parallel copies of one warm worker: workerId (an IDLE warm worker holding the shared context) + packets (2..8, same fields as start; model/thinking must match the warm worker or be omitted). Forks its session once per packet, each a new worker on the same model so the cache is reused. Max 8 workers run at once (PARALLEL_CAP).\n'
            + `- status | wait | cancel | resume | logs: by runId. status adds the report (evidence) once the run is terminal. wait blocks at most ${MAX_WAIT_SECONDS}s (timeoutSeconds), then STILL_RUNNING: end your turn. logs: facts only (limit).\n`
            + 'Replies are bounded JSON facts, never transcripts.',
        inputSchema: z.object({ action: z.enum(WORKER_ACTIONS).describe('Which operation to run.'), ...shape }),
        run: async ({ action, ...args }) => {
            const operation = operations.get(action);
            const parent = operation ? callingWorker() : undefined;
            if (parent) {
                const refusal = await workerCallerRefusal(parent, action, args, source);
                if (refusal) { return refusal; }
            }
            if (operation && options.turnBudget && (action === 'start' || action === 'submit' || action === 'fanout')) {
                const refusal = workerBudgetRefusal(action, await options.turnBudget());
                if (refusal) { return refusal; }
            }
            if (operation && runtimeGate && (action === 'start' || action === 'submit' || action === 'fanout' || action === 'resume')) {
                // Refuse before anything starts; the OpenCode server is started (and then probed) only when OpenCode is involved.
                const runtimes = dispatchRuntimes(action, args, runtimeInspect ? runtimeInspect() : await Promise.resolve(source()));
                const before = await runtimeGate(runtimes, 'before');
                if (before) { return before; }
                if (runtimes.includes('opencode')) {
                    await Promise.resolve(source());
                    const ready = await runtimeGate(runtimes, 'ready');
                    if (ready) { return ready; }
                }
            }
            if (!operation) { return { status: 'INVALID_INPUT', reason: `action: one of ${WORKER_ACTIONS.join(', ')}` }; }
            const result = JSON.parse(await invokeDefinition(operation, args, false));
            if (parent && (action === 'start' || action === 'submit' || action === 'fanout')) {
                // Only runs this caller just started are its children.
                const mine = childrenOf.get(parent.key) ?? { runs: new Set<string>(), workers: new Set<string>() };
                for (const run of collectRuns(result)) {
                    mine.runs.add(run.runId); mine.workers.add(run.workerId);
                    childWorkers.add(guardKey(parent.workspace, run.workerId));
                }
                childrenOf.set(parent.key, mine);
            }
            return result;
        },
    };
}

type RuntimeSource = OpenCodeWorkerRuntime | Promise<OpenCodeWorkerRuntime>;

/** Exactly the eight Spec 001 worker operations. Results are bounded facts so the caller's context stays small. */
export function workerToolDefinitions(source: () => RuntimeSource, defaultWorkspace: string, options: WorkerToolOptions = {}): ToolDefinition[] {
    const runtime = () => Promise.resolve(source());
    // The owner is the dispatching window's workspace; the packet's workspacePath only says where OpenCode runs.
    const packetOf = (args: any): WorkerPacket => ({ ...args, workspacePath: defaultWorkspace || args.workspacePath, ...(args.workspacePath ? { cwd: args.workspacePath } : {}), allowedFiles: args.allowedFiles ?? [] });
    const definitions: ToolDefinition[] = [];
    const register = (name: string, config: { description: string; inputSchema: z.ZodObject<any> }, run: (args: any) => unknown | Promise<unknown>) => {
        definitions.push({ name, description: config.description, inputSchema: config.inputSchema, run });
    };

    register('worker_start', {
        description: 'Start an async worker run for one self-contained packet. Returns a non-terminal handle immediately; never waits for completion.',
        inputSchema: z.object(packetShape),
    }, async (args) => (await runtime()).start(packetOf(args)));

    register('worker_submit', {
        description: 'Queue a packet on an existing warm worker (reuses its OpenCode session). If that worker is busy for more than ~30s the session is forked into a new parallel worker instead (status FORKED, forkedFrom). Refuses explicitly if the worker is retired, REMOVED (the reviewer took it out of rotation: start a fresh one) or ineligible, or CWD_MISMATCH when the packet run directory (workspacePath) differs from the worker one: a session is never reused across directories.',
        inputSchema: z.object({ workerId: z.string(), ...packetShape }),
    }, async (args) => (await runtime()).submitForking(args.workerId, packetOf(args)));

    register('worker_fanout', {
        description: 'Warm-then-fan-out: fork an idle warm worker\'s session once per packet (2..8). Each fork is a new parallel worker with the same profile, model and thinking. Refused whole on a model mismatch or when it would exceed 8 running workers (PARALLEL_CAP). Use only when explicitly wanted.',
        inputSchema: z.object({ workerId: z.string(), packets: z.array(z.object(packetShape)).min(2).max(8) }),
    }, async (args) => (await runtime()).fanout(args.workerId, args.packets.map(packetOf)));

    register('worker_list', {
        description: 'List this workspace\'s live workers (running or still warm) so you can reuse one: mode, model, state, what it knows, '
            + 'next-request input size, and seconds until its cache goes cold. Prefer submit to a warm worker whose knowledge fits the packet.',
        inputSchema: z.object({ workspacePath: z.string().optional() }),
    }, async (args) => {
        const live = await runtime();
        const now = live.now();
        return projectWorkersState(live, defaultWorkspace || args.workspacePath, () => now).workers
            .filter((worker) => !worker.expired)
            .map((worker) => ({
                workerId: worker.workerId, profile: worker.profile, model: worker.model, thinking: worker.thinking, state: worker.state,
                knowledge: worker.knowledge, nextInputTokens: worker.nextInputTokens,
                warmForSeconds: worker.cacheExpiresAt ? Math.max(0, Math.round((worker.cacheExpiresAt - now) / 1000)) : 0,
                lastRunId: worker.runs[worker.runs.length - 1]?.runId ?? '', cost: worker.model.startsWith('agy/') ? 'unreported' : worker.usage.cost, sessionOpenAction: worker.sessionOpenAction,
            }));
    });

    register('worker_profiles', {
        description: 'The enabled worker profiles (built-in and the user\'s own) with member, role, model, thinking, runtime and source.',
        inputSchema: z.object({}),
    }, async () => profileCatalog ? enabledWorkerProfiles(profileCatalog) : { status: 'PROFILES_UNAVAILABLE', reason: 'no profile catalog is installed in this host' });

    register('worker_status', {
        description: 'Current state, usage, and blocker reason for one run; once terminal (COMPLETED/FAILED/CANCELLED) also its report as evidence lines.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => (await runtime()).status(args.runId) ?? { status: 'UNKNOWN_RUN', runId: args.runId });

    register('worker_wait', {
        description: `Wait for a run to finish, at most ${MAX_WAIT_SECONDS}s. On the ceiling it returns STILL_RUNNING: end your turn and check back instead of waiting again. Returns STALLED at once when the worker process emitted no event 60 s after spawn (it is not killed; cancel it or resume).`,
        inputSchema: z.object({ runId: z.string(), timeoutSeconds: z.number().min(0).optional() }),
    }, async (args) => {
        const requested = Math.min(args.timeoutSeconds ?? MAX_WAIT_SECONDS, MAX_WAIT_SECONDS);
        const seconds = options.waitBudgetMs ? Math.min(requested, Math.floor(options.waitBudgetMs(requested * 1000) / 1000)) : requested;
        return (await runtime()).wait(args.runId, seconds);
    });

    register('worker_cancel', {
        description: 'Cancel a run. A queued run is removed before it starts; a running one is stopped.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => (await runtime()).cancel(args.runId));

    register('worker_resume', {
        description: 'Continue a failed or cancelled run in its OpenCode session, or report that a fresh submission is required.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => (await runtime()).resume(args.runId));

    register('worker_logs', {
        description: 'Lifecycle facts for a run (types, tools, usage). Never transcript text.',
        inputSchema: z.object({ runId: z.string(), limit: z.number().int().positive().max(100).optional() }),
    }, async (args) => (await runtime()).logs(args.runId).slice(-(args.limit ?? 20)).map((fact) => ({
        ts: fact.ts, type: fact.type, tool: fact.tool, usage: fact.usage, exitCode: fact.exitCode,
        ...(fact.round !== undefined ? { round: fact.round } : {}), ...(fact.tail !== undefined ? { tail: fact.tail } : {}),
        ...(fact.costStatus ? { costStatus: fact.costStatus } : {}),
    })));

    return definitions;
}
