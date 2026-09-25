import { z } from 'zod';
import { MAX_WAIT_SECONDS, OpenCodeWorkerRuntime, WorkerPacket } from './openCodeRuntime';
import { projectWorkersState } from './workersState';

export const WORKER_TOOL_NAMES = ['worker_start', 'worker_submit', 'worker_list', 'worker_status', 'worker_wait', 'worker_cancel', 'worker_resume', 'worker_logs'] as const;
/** Hosts see ONE `worker` tool; `action` selects the operation, like the `gradle` tool (reviewer, 2026-09-25). */
export const WORKER_ACTIONS = WORKER_TOOL_NAMES.map((name) => name.slice('worker_'.length)) as ['start', 'submit', 'list', 'status', 'wait', 'cancel', 'resume', 'logs'];

type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) => unknown;

/** One tool contract, consumed by every host adapter (MCP server, VS Code LM tools, package.json manifest). */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: z.ZodObject<any>;
    run: (args: any) => unknown | Promise<unknown>;
}

const packetShape = {
    profile: z.string().describe('Worker mode: explore, research, verify, gradle, test, code, rca, review, authoring, devx.'),
    model: z.string().optional().describe('provider/model; must be allowed by the mode. Omit for the mode default.'),
    thinking: z.string().optional().describe('Reasoning variant; must be allowed by the mode.'),
    dispatchTurnId: z.string().min(1).describe('The orchestrator turn this work is attributed to.'),
    baseRevision: z.string().min(1).describe('Explicit commit, tag, or remote ref.'),
    objective: z.string().min(1),
    allowedFiles: z.array(z.string()).describe('Files the worker may change; empty means read-only.'),
    acceptance: z.string().min(1).describe('One observable assertion.'),
    expected: z.string().min(1).describe('The exact expected result.'),
    command: z.string().min(1).describe('The verification command.'),
    estimatedSeconds: z.number().positive().optional(),
    track: z.string().max(24).optional().describe('Your plan\'s track for this packet, e.g. "A"; the Workers tab shows one lane per track.'),
    workspacePath: z.string().optional().describe('Defaults to the current workspace.'),
};

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** Validates input against the contract, runs it, and returns the bounded JSON text every host sends back. */
export async function invokeDefinition(definition: ToolDefinition, input: unknown): Promise<string> {
    const parsed = definition.inputSchema.safeParse(input ?? {});
    if (!parsed.success) {
        return JSON.stringify({ status: 'INVALID_INPUT', reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    }
    return JSON.stringify(await definition.run(parsed.data));
}

export function registerToolDefinitions(register: Register, definitions: ToolDefinition[]): void {
    for (const definition of definitions) {
        register(definition.name, { description: definition.description, inputSchema: definition.inputSchema },
            async (args) => reply(await definition.run(args)));
    }
}

export function registerWorkerTools(register: Register, runtime: () => RuntimeSource, defaultWorkspace: string): void {
    registerToolDefinitions(register, [workerTool(runtime, defaultWorkspace)]);
}

/** The eight operations behind one tool: the host schema merges every field, then each action validates its own. */
export function workerTool(source: () => RuntimeSource, defaultWorkspace: string): ToolDefinition {
    const operations = new Map(workerToolDefinitions(source, defaultWorkspace).map((d) => [d.name.slice('worker_'.length), d]));
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
            + `- status | wait | cancel | resume | logs: by runId. wait blocks at most ${MAX_WAIT_SECONDS}s (timeoutSeconds), then STILL_RUNNING: end your turn. logs: facts only (limit).\n`
            + 'Replies are bounded JSON facts, never transcripts.',
        inputSchema: z.object({ action: z.enum(WORKER_ACTIONS).describe('Which operation to run.'), ...shape }),
        run: async ({ action, ...args }) => {
            const operation = operations.get(action);
            return operation ? JSON.parse(await invokeDefinition(operation, args)) : { status: 'INVALID_INPUT', reason: `action: one of ${WORKER_ACTIONS.join(', ')}` };
        },
    };
}

type RuntimeSource = OpenCodeWorkerRuntime | Promise<OpenCodeWorkerRuntime>;

/** Exactly the eight Spec 001 worker operations. Results are bounded facts so the caller's context stays small. */
export function workerToolDefinitions(source: () => RuntimeSource, defaultWorkspace: string): ToolDefinition[] {
    const runtime = () => Promise.resolve(source());
    const packetOf = (args: any): WorkerPacket => ({ ...args, workspacePath: args.workspacePath || defaultWorkspace, allowedFiles: args.allowedFiles ?? [] });
    const definitions: ToolDefinition[] = [];
    const register = (name: string, config: { description: string; inputSchema: z.ZodObject<any> }, run: (args: any) => unknown | Promise<unknown>) => {
        definitions.push({ name, description: config.description, inputSchema: config.inputSchema, run });
    };

    register('worker_start', {
        description: 'Start an async worker run for one self-contained packet. Returns a non-terminal handle immediately; never waits for completion.',
        inputSchema: z.object(packetShape),
    }, async (args) => (await runtime()).start(packetOf(args)));

    register('worker_submit', {
        description: 'Queue a packet on an existing warm worker (reuses its OpenCode session). Refuses explicitly if the worker is retired or ineligible.',
        inputSchema: z.object({ workerId: z.string(), ...packetShape }),
    }, async (args) => (await runtime()).submit(args.workerId, packetOf(args)));

    register('worker_list', {
        description: 'List this workspace\'s live workers (running or still warm) so you can reuse one: mode, model, state, what it knows, '
            + 'next-request input size, and seconds until its cache goes cold. Prefer submit to a warm worker whose knowledge fits the packet.',
        inputSchema: z.object({ workspacePath: z.string().optional() }),
    }, async (args) => {
        const live = await runtime();
        const now = live.now();
        return projectWorkersState(live, args.workspacePath || defaultWorkspace, () => now).workers
            .filter((worker) => !worker.expired)
            .map((worker) => ({
                workerId: worker.workerId, profile: worker.profile, model: worker.model, thinking: worker.thinking, state: worker.state,
                knowledge: worker.knowledge, nextInputTokens: worker.nextInputTokens,
                warmForSeconds: worker.cacheExpiresAt ? Math.max(0, Math.round((worker.cacheExpiresAt - now) / 1000)) : 0,
                lastRunId: worker.runs[worker.runs.length - 1]?.runId ?? '', cost: worker.usage.cost, sessionOpenAction: worker.sessionOpenAction,
            }));
    });

    register('worker_status', {
        description: 'Current state, usage, and blocker reason for one run.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => (await runtime()).status(args.runId) ?? { status: 'UNKNOWN_RUN', runId: args.runId });

    register('worker_wait', {
        description: `Wait for a run to finish, at most ${MAX_WAIT_SECONDS}s. On the ceiling it returns STILL_RUNNING: end your turn and check back instead of waiting again.`,
        inputSchema: z.object({ runId: z.string(), timeoutSeconds: z.number().min(0).max(MAX_WAIT_SECONDS).optional() }),
    }, async (args) => (await runtime()).wait(args.runId, args.timeoutSeconds ?? MAX_WAIT_SECONDS));

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
    })));

    return definitions;
}
