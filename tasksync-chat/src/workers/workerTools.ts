import { z } from 'zod';
import { MAX_WAIT_SECONDS, OpenCodeWorkerRuntime, WorkerPacket } from './openCodeRuntime';

export const WORKER_TOOL_NAMES = ['worker_start', 'worker_submit', 'worker_list', 'worker_status', 'worker_wait', 'worker_cancel', 'worker_resume', 'worker_logs'] as const;

type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) => unknown;

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
    workspacePath: z.string().optional().describe('Defaults to the current workspace.'),
};

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** Registers exactly the eight Spec 001 worker operations. Results are bounded facts so the caller's context stays small. */
export function registerWorkerTools(register: Register, runtime: () => OpenCodeWorkerRuntime, defaultWorkspace: string): void {
    const packetOf = (args: any): WorkerPacket => ({ ...args, workspacePath: args.workspacePath || defaultWorkspace, allowedFiles: args.allowedFiles ?? [] });

    register('worker_start', {
        description: 'Start an async worker run for one self-contained packet. Returns a non-terminal handle immediately; never waits for completion.',
        inputSchema: z.object(packetShape),
    }, async (args) => reply(runtime().start(packetOf(args))));

    register('worker_submit', {
        description: 'Queue a packet on an existing warm worker (reuses its OpenCode session). Refuses explicitly if the worker is retired or ineligible.',
        inputSchema: z.object({ workerId: z.string(), ...packetShape }),
    }, async (args) => reply(runtime().submit(args.workerId, packetOf(args))));

    register('worker_list', {
        description: 'List runs in a workspace with state, model, cost, queue position, and the session-open command.',
        inputSchema: z.object({ workspacePath: z.string().optional() }),
    }, async (args) => reply(runtime().list(args.workspacePath || defaultWorkspace).map((run) => ({
        runId: run.runId, workerId: run.workerId, state: run.state, profile: run.profile, model: run.model,
        queuePosition: run.queuePosition, elapsedMs: run.elapsedMs, cost: run.usage.cost, sessionOpenAction: run.sessionOpenAction,
    }))));

    register('worker_status', {
        description: 'Current state, usage, and blocker reason for one run.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => reply(runtime().status(args.runId) ?? { status: 'UNKNOWN_RUN', runId: args.runId }));

    register('worker_wait', {
        description: `Wait for a run to finish, at most ${MAX_WAIT_SECONDS}s. On the ceiling it returns STILL_RUNNING: end your turn and check back instead of waiting again.`,
        inputSchema: z.object({ runId: z.string(), timeoutSeconds: z.number().min(0).max(MAX_WAIT_SECONDS).optional() }),
    }, async (args) => reply(await runtime().wait(args.runId, args.timeoutSeconds ?? MAX_WAIT_SECONDS)));

    register('worker_cancel', {
        description: 'Cancel a run. A queued run is removed before it starts; a running one is stopped.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => reply(runtime().cancel(args.runId)));

    register('worker_resume', {
        description: 'Continue a failed or cancelled run in its OpenCode session, or report that a fresh submission is required.',
        inputSchema: z.object({ runId: z.string() }),
    }, async (args) => reply(runtime().resume(args.runId)));

    register('worker_logs', {
        description: 'Lifecycle facts for a run (types, tools, usage). Never transcript text.',
        inputSchema: z.object({ runId: z.string(), limit: z.number().int().positive().max(100).optional() }),
    }, async (args) => reply(runtime().logs(args.runId).slice(-(args.limit ?? 20)).map((fact) => ({
        ts: fact.ts, type: fact.type, tool: fact.tool, usage: fact.usage, exitCode: fact.exitCode,
    }))));
}
