import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebexAuth } from './webexAuth';

export class WebexStatus {
    private steps: Record<string, unknown>[] = [];
    constructor(private root: string, private auth: WebexAuth, private output?: vscode.OutputChannel,
        private service?: () => { hasToken: boolean }) {}

    async record(step: string, details: Record<string, unknown> = {}): Promise<void> {
        const tokens = await this.auth.tokens();
        const config = vscode.workspace.getConfiguration('askaway.webex');
        const inspect = config.inspect?.<boolean>('enabled');
        let self: { teamId?: string; workspaceRoomId?: string } = {};
        try { self = JSON.parse(fs.readFileSync(path.join(this.root, '.askaway/webex-spaces.json'), 'utf8')).self || {}; } catch { /* Not discovered yet. */ }
        const entry = { timestamp: new Date().toISOString(), step,
            setting: { global: inspect?.globalValue ?? null, workspace: inspect?.workspaceValue ?? null, effective: config.get('enabled', false) },
            hasAccessToken: !!tokens.accessToken, hasRefreshToken: !!tokens.refreshToken,
            serviceHasToken: this.service?.().hasToken ?? false, selfTeamIdPresent: !!self.teamId,
            workspaceRoomId: self.workspaceRoomId ?? null, ...details };
        let line = JSON.stringify(entry);
        for (const secret of [tokens.accessToken, tokens.refreshToken]) { if (secret) line = line.split(secret).join('[redacted]'); }
        line = line.replace(/https:\/\/webexapis\.com\/v1\/webhooks\/incoming\/[^"\s]+/g, '[redacted webhook]');
        this.steps.push(JSON.parse(line));
        fs.mkdirSync(path.join(this.root, '.askaway'), { recursive: true });
        fs.writeFileSync(path.join(this.root, '.askaway/webex-status.json'), JSON.stringify({ ...JSON.parse(line), steps: this.steps }, null, 2));
        this.output?.appendLine(`[WebexStatus] ${line}`);
    }

    async http(step: string, method: string, url: string | URL, response: Response): Promise<void> {
        const body = await response.clone().json().catch(() => ({})) as { message?: string; trackingId?: string };
        await this.record(step, { http: { method, path: new URL(url).pathname, status: response.status,
            message: body.message ?? null, trackingId: body.trackingId ?? response.headers.get('trackingid') } });
    }
}
