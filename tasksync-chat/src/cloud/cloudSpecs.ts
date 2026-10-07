import { CloudRun, QueueIO, QueueRequest, defaultIO, queueTask } from './cloudQueue';
import { pollPr } from './cloudPoller';
import { SpecScanResult } from '../specs/specKitScanner';

export function cloudTaskView(run: CloudRun, now = Date.now()) {
    const duration = Math.max(0, Date.parse(run.endedAt ?? '') || now) - Date.parse(run.startedAt ?? run.queuedAt);
    const output = [run.model, run.report?.verifyOutput, run.report?.url,
        ...(run.commits ?? []).map(commit => commit.url), ...(run.checkRuns ?? []).map(check => `${check.name}: ${check.status} / ${check.conclusion ?? 'pending'} ${check.url}`),
        run.decisionNeeded].filter(Boolean).join('\n');
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
export class CloudSpecsController {
    constructor(private io: QueueIO = defaultIO) {}
    click(request: QueueRequest) { return queueTask({ ...request, explicitRequest: true }, this.io); }
    async refresh(root: string, data: SpecScanResult) { return attachCloudRuns(data, await this.io.load(root)); }
    async poll(root: string, enabled: boolean, agentLogins: string[]) {
        const runs = await this.io.load(root);
        if (!shouldPollCloud(enabled, runs)) { return; }
        for (const pr of new Set(runs.filter(run => shouldPollCloud(true, [run])).map(run => run.pr))) {
            await pollPr(root, pr, this.io, agentLogins);
        }
    }
}
