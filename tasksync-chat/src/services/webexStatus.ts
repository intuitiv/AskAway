import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebexAuth } from './webexAuth';
import { scrubText } from './assistant/webexResolver';

export class WebexStatus {
    private steps: Record<string, unknown>[] = [];
    constructor(private root: string, private auth: WebexAuth, private output?: vscode.OutputChannel,
        private service?: () => { hasToken: boolean }) {}

    async record(step: string, details: Record<string, unknown> = {}): Promise<void> {
        const tokens = await this.auth.tokens();
        const config = vscode.workspace.getConfiguration('askaway.webex');
        const inspect = config.inspect?.<boolean>('enabled');
        let self: { teamId?: string; workspaceRoomId?: string } = {};
        let spaces: { rooms?: { id?: string; title?: string }[] }[] = [];
        try {
            const facts = JSON.parse(fs.readFileSync(path.join(this.root, '.askaway/webex-spaces.json'), 'utf8'));
            self = facts.self || {}; spaces = Array.isArray(facts.teams) ? facts.teams : [];
        } catch { /* Not discovered yet. */ }
        // The reviewer sees the space by name; its id stays in webex-spaces.json.
        const workspaceSpace = spaces.flatMap(team => team.rooms ?? []).find(room => room.id && room.id === self.workspaceRoomId)?.title ?? null;
        const entry = { timestamp: new Date().toISOString(), step,
            setting: { global: inspect?.globalValue ?? null, workspace: inspect?.workspaceValue ?? null, effective: config.get('enabled', false) },
            hasAccessToken: !!tokens.accessToken, hasRefreshToken: !!tokens.refreshToken,
            serviceHasToken: this.service?.().hasToken ?? false, selfTeamIdPresent: !!self.teamId,
            workspaceSpace, workspaceSpaceKnown: !!self.workspaceRoomId, ...details };
        let line = JSON.stringify(entry);
        for (const secret of [tokens.accessToken, tokens.refreshToken]) { if (secret) line = line.split(secret).join('[redacted]'); }
        line = line.replace(/https:\/\/webexapis\.com\/v1\/webhooks\/incoming\/[^"\s]+/g, '[redacted webhook]');
        // Neither the status file nor the Output channel may carry a Webex id (R-CATHY-02): details such as a request path can.
        line = scrubText(line);
        const scrubbed = JSON.parse(line);
        // The status file keeps Webex's tracking id for support diagnostics; the Output channel line above stays scrubbed.
        const tracking = (details as { http?: { trackingId?: unknown } }).http?.trackingId;
        const stored = typeof tracking === 'string' && scrubbed.http ? { ...scrubbed, http: { ...scrubbed.http, trackingId: tracking } } : scrubbed;
        this.steps.push(stored);
        fs.mkdirSync(path.join(this.root, '.askaway'), { recursive: true });
        fs.writeFileSync(path.join(this.root, '.askaway/webex-status.json'), JSON.stringify({ ...stored, steps: this.steps }, null, 2));
        this.output?.appendLine(`[WebexStatus] ${line}`);
    }

    async http(step: string, method: string, url: string | URL, response: Response): Promise<void> {
        const body = await response.clone().json().catch(() => ({})) as { message?: string; trackingId?: string };
        await this.record(step, { http: { method, path: new URL(url).pathname, status: response.status,
            message: body.message ?? null, trackingId: body.trackingId ?? response.headers.get('trackingid') } });
    }
}
