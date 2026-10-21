import * as fs from 'fs/promises';
import * as path from 'path';
import { CloudRun, defaultIO, serial } from './cloudQueue';
import { availabilityPolicy } from '../services/availabilityGate';
import type { RemoteChannel } from '../services/remoteChannel';
import { remoteDigestPoster } from '../commentary/telegramLive';

export function cloudDigestPoster(root: string,
    webex: () => Pick<RemoteChannel, 'isConfigured' | 'sendText'> | undefined,
    telegram: () => Pick<RemoteChannel, 'isConfigured' | 'sendText'> | undefined) {
    return remoteDigestPoster(() => {
        if (!availabilityPolicy().liveStatus) { return undefined; }
        const preferred = webex();
        const useWebex = preferred?.isConfigured() === true;
        const channel = useWebex ? preferred : telegram();
        if (!channel?.isConfigured()) { return undefined; }
        return { isConfigured: () => channel.isConfigured(), sendLive: async (html: string) => {
            if (!availabilityPolicy().liveStatus) { return undefined; }
            const text = useWebex ? html.replace(/<b>(.*?)<\/b>/g, '**$1**')
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : html;
            return await channel.sendText(text, text, undefined, { notify: false }) as number | undefined;
        } };
    });
}

export interface DigestState { day?: string; fingerprints: Record<string, string> }
const identity = (run: CloudRun) => `${run.slug}:${run.taskId}:${run.attempt}`;
const fingerprint = (run: CloudRun) => JSON.stringify([run.state, run.history, run.report, run.commits, run.checkRuns, run.decisionNeeded, run.staleSince, run.model]);

export function digestLines(runs: CloudRun[], previous: DigestState = { fingerprints: {} }, now = Date.now()): string[] {
    return runs.filter(run => previous.fingerprints[identity(run)] !== fingerprint(run))
        .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt)).map(run => {
            const seconds = Math.max(0, Math.round(((Date.parse(run.endedAt ?? '') || now) - Date.parse(run.startedAt ?? run.queuedAt)) / 1000));
            const evidence = [run.report?.url, run.report?.verifyOutput, ...(run.commits ?? []).map(c => c.url), ...(run.checkRuns ?? []).map(c => c.url)].filter(Boolean).join(' · ') || 'none';
            const blocker = run.staleSince ? `Polling stale since ${run.staleSince}` : ['Returned', 'Timed out', 'No response', 'Checks failed', 'Held'].includes(run.state) ? run.decisionNeeded || run.state : run.report?.result === 'blocked' ? run.report.question : 'none';
            return `${run.taskId} · ${run.state} · PR: ${run.pr} · evidence: ${evidence} · duration: ${seconds}s · model: ${run.model} · blocker: ${blocker} · decision needed: ${run.decisionNeeded || 'none'}`;
        });
}

export class CloudDigestScheduler {
    constructor(private readonly io = {
        loadRuns: defaultIO.load,
        async loadState(root: string): Promise<DigestState> {
            try { return JSON.parse(await fs.readFile(path.join(root, '.askaway/cloud-digest.json'), 'utf8')); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return { fingerprints: {} }; } throw error; }
        },
        async saveState(root: string, state: DigestState) {
            await fs.mkdir(path.join(root, '.askaway'), { recursive: true });
            await fs.writeFile(path.join(root, '.askaway/cloud-digest.json'), JSON.stringify(state));
        }
    }, private readonly now: () => number = Date.now) {}

    async tick(root: string, time: string, post: (lines: string[]) => Promise<boolean>): Promise<void> {
        await serial(`digest:${root}`, async () => {
            const now = this.now();
            const date = new Date(now);
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { return; }
            const [hours, minutes] = time.split(':').map(Number);
            if (date.getHours() * 60 + date.getMinutes() < hours * 60 + minutes) { return; }
            const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
            const previous = await this.io.loadState(root);
            if (previous.day === day) { return; }
            const runs = await this.io.loadRuns(root);
            const lines = digestLines(runs, previous, now);
            if (lines.length && !await post(lines)) { return; }
            await this.io.saveState(root, { day, fingerprints: Object.fromEntries(runs.map(run => [identity(run), fingerprint(run)])) });
        });
    }
}
