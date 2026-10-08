import { CloudRun, QueueIO, QueueRequest, defaultIO, queueTask } from './cloudQueue';
import { pollPr } from './cloudPoller';
import { SpecScanResult } from '../specs/specKitScanner';
import { acceptCloudTask, VerifyRunner, verifyWorkerRunner } from './cloudAccept';
import { serial } from './cloudQueue';

export function cloudTaskView(run: CloudRun, now = Date.now()) {
    const duration = Math.max(0, Date.parse(run.endedAt ?? '') || now) - Date.parse(run.startedAt ?? run.queuedAt);
    const output = [run.model, run.report?.verifyOutput, run.report?.url, run.acceptance?.evidence,
        ...(run.commits ?? []).map(commit => commit.url), ...(run.checkRuns ?? []).map(check => `${check.name}: ${check.status} / ${check.conclusion ?? 'pending'} ${check.url}`),
        run.decisionNeeded, run.staleSince ? `Polling stale since ${run.staleSince}` : undefined].filter(Boolean).join('\n');
    return { state: run.state, events: [{ kind: 'tool', id: run.taskId, tool: run.state,
        status: run.state === 'Checks failed' ? 'failed' : 'ok', durMs: Math.max(0, duration),
        inputPreview: run.report?.commands.join('\n') ?? run.request.task.verify.join('\n'), outputPreview: output, group: 'cloud' }] };
}
export function attachCloudRuns(data: SpecScanResult, runs: CloudRun[]) {
    return { ...data, specs: data.specs.map(spec => {
        const enrich = <T extends { id: string }>(task: T, slug: string) => {
            const run = runs.filter(run => run.slug === slug && run.taskId === task.id).at(-1);
            return run ? { ...task, cloud: cloudTaskView(run) } : task;
        };
        return { ...spec, tasks: spec.tasks.map(task => enrich(task, spec.slug)),
            cycles: spec.cycles.map(cycle => ({ ...cycle, tasks: cycle.tasks.map(task => enrich(task, task.specSlug)) })) };
    }) };
}
export function shouldPollCloud(enabled: boolean, runs: CloudRun[]): boolean {
    return enabled && runs.some(run => ['Queued', 'Working', 'Pushed', 'Checks passed', 'Checks failed', 'Checks waiting for approval'].includes(run.state));
}
export function cloudWorkers(runs: CloudRun[], now = Date.now()) {
    return runs.slice().sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt)).map(run => {
        const view = cloudTaskView(run, now);
        const id = `cloud:${run.slug}:${run.taskId}:${run.attempt}`;
        return { workerId: id, profile: run.taskId, model: run.model, state: run.state,
            adapter: 'GitHub', thinking: '', cloud: true, expired: false, blocker: run.decisionNeeded,
            runs: [{ runId: id, state: run.state, elapsedMs: view.events[0].durMs }],
            trace: { source: 'opencode', runs: { [id]: view.events } } };
    });
}
export class CloudSpecsController {
    constructor(private io: QueueIO = defaultIO, private now: () => number = Date.now,
        private verify: VerifyRunner | undefined = io === defaultIO ? verifyWorkerRunner : undefined) {}
    click(request: QueueRequest) { return queueTask({ ...request, explicitRequest: true }, this.io); }
    async refresh(root: string, data: SpecScanResult) { return attachCloudRuns(data, await this.io.load(root)); }
    async workers(root: string) { return cloudWorkers(await this.io.load(root), this.now()); }
    async pollDelay(root: string, pollMinutes = 3): Promise<number> {
        const runs = (await this.io.load(root)).filter(run => shouldPollCloud(true, [run]));
        return Math.max(0, Math.min(...runs.map(run => run.nextPollAt ? Date.parse(run.nextPollAt) - this.now() : Math.min(15, Math.max(1, pollMinutes)) * 60000)));
    }
    async poll(root: string, enabled: boolean, agentLogins: string[], pollMinutes = 3) {
        const runs = await this.io.load(root);
        if (!enabled) { return; }
        for (const pr of new Set(runs.filter(run => shouldPollCloud(true, [run])).map(run => run.pr))) {
            await pollPr(root, pr, this.io, agentLogins, this.now(), pollMinutes);
        }
        if (this.verify) {
            await serial(root, async () => {
                const latest = await this.io.load(root);
                for (let index = 0; index < latest.length; index++) {
                    if (latest[index].state === 'Needs review') { latest[index] = await acceptCloudTask(latest[index], this.verify, this.io); }
                }
                await this.io.save(root, latest);
            });
        }
    }
}
