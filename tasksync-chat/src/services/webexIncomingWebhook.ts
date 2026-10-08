import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { SecurityRunner, WEBEX_ACCESS_TOKEN_KEY } from './webexAuth';
import { WebexStatus } from './webexStatus';

export const WEBEX_WEBHOOK_APP = 'https://apphub.webex.com/applications/incoming-webhooks-cisco-systems-38054-23307-75252';
const valid = (value: string) => /^https:\/\/webexapis\.com\/v1\/webhooks\/incoming\/[A-Za-z0-9_=-]+$/.test(value);
const key = (roomId: string) => `askaway.webex.incomingWebhook.${roomId}`;
const security: SecurityRunner = (file, args) => new Promise((resolve, reject) => execFile(file, args, error => error ? reject(new Error('Keychain update failed.')) : resolve()));

export class WebexIncomingWebhook {
    constructor(private secrets: vscode.SecretStorage, private runner: SecurityRunner = security,
        private platform = process.platform, private baseUrl?: string, private status?: WebexStatus) {}

    async configured(roomId: string): Promise<boolean> { return !!await this.secrets.get(key(roomId)); }

    async send(roomId: string, markdown: string): Promise<string | undefined> {
        const url = await this.secrets.get(key(roomId));
        if (!url || !valid(url)) { return undefined; }
        try {
            const endpoint = this.baseUrl ? `${this.baseUrl.replace(/\/$/, '')}/${url.split('/').pop()}` : url;
            const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown }) });
            if (!response.ok) { return undefined; }
            const data = await response.json().catch(() => ({})) as { id?: string };
            return data.id || `incoming:${randomUUID()}`;
        } catch { return undefined; }
    }

    async configure(root: string): Promise<void> {
        try {
            const facts = JSON.parse(await fs.readFile(path.join(root, '.askaway/webex-spaces.json'), 'utf8'));
            const rooms = facts.teams.flatMap((team: { rooms: { id: string; title: string }[] }) => team.rooms);
            const choices = await Promise.all([facts.self.workspaceRoomId, facts.self.generalRoomId].filter((id, index, ids) => id && ids.indexOf(id) === index).map(async (id: string) => ({
                label: rooms.find((room: { id: string }) => room.id === id)?.title || path.basename(root), roomId: id,
                description: await this.configured(id) ? 'configured' : 'not configured'
            })));
            const chosen = await vscode.window.showQuickPick(choices, { title: 'Configure Webex Notifications' });
            if (!chosen) { return; }
            await vscode.env.clipboard.writeText(chosen.label);
            if (!await vscode.env.openExternal(vscode.Uri.parse(WEBEX_WEBHOOK_APP))) { return; }
            const url = await vscode.window.showInputBox({ title: chosen.label, password: true, ignoreFocusOut: true,
                prompt: 'Create an Incoming Webhook for this space (name copied), then paste its URL here.',
                validateInput: value => valid(value) ? undefined : 'Enter a Webex incoming webhook URL.' });
            if (!url) { return; }
            if (!valid(url)) { throw new Error('Invalid webhook.'); }
            await this.secrets.store(key(chosen.roomId), url);
            if (chosen.roomId === facts.self.generalRoomId && this.platform === 'darwin' &&
                !(process.env.ASKAWAY_TEST_NO_KEYCHAIN === '1' && this.runner === security)) {
                await this.runner('security', ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-general-webhook-url', '-w', url]);
            }
            if (!await this.send(chosen.roomId, 'AskAway: Webex notifications configured.')) { throw new Error('Confirmation failed.'); }
        } catch { void vscode.window.showErrorMessage('AskAway: Webex notification configuration failed.'); }
    }

    async prompt(root: string, state: vscode.Memento): Promise<void> {
        const reason = !vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false) ? 'disabled'
            : !await this.secrets.get(WEBEX_ACCESS_TOKEN_KEY) ? 'not signed in'
            : state.get('webex.notifications.dismissed', false) ? 'dismissed in workspace' : undefined;
        if (reason) { await this.status?.record('webhook check', { prompt: 'suppressed', reason }); return; }
        try {
            const facts = JSON.parse(await fs.readFile(path.join(root, '.askaway/webex-spaces.json'), 'utf8'));
            const workspaceConfigured = !!facts.self?.workspaceRoomId && await this.configured(facts.self.workspaceRoomId);
            const generalConfigured = !!facts.self?.generalRoomId && await this.configured(facts.self.generalRoomId);
            const ids = [facts.self?.workspaceRoomId, facts.self?.generalRoomId].filter((id, index, all) => id && all.indexOf(id) === index);
            for (const id of ids) {
                const configured = await this.configured(id);
                await this.status?.record('webhook check', { workspaceConfigured, generalConfigured, roomId: id,
                    prompt: configured ? 'suppressed' : 'shown', reason: configured ? 'already configured' : 'missing webhook' });
                if (configured) { continue; }
                const title = facts.teams.flatMap((team: { rooms: { id: string; title: string }[] }) => team.rooms).find((room: { id: string }) => room.id === id)?.title || path.basename(root);
                void Promise.resolve(vscode.window.showInformationMessage(`AskAway: Configure Webex notifications for ${title}.`, 'Configure', 'Later', "Don't ask in this workspace")).then(async action => {
                    if (action === 'Configure') { await this.configure(root); }
                    if (action === "Don't ask in this workspace") { await state.update('webex.notifications.dismissed', true); }
                }).catch(async error => { await this.status?.record('webhook check', { exception: (error as Error).message }); });
            }
        } catch (error) { await this.status?.record('webhook check', { prompt: 'suppressed', reason: 'check failed', exception: (error as Error).message }); }
    }
}

export function isIncomingWebhookSender(message: { personEmail?: string; personDisplayName?: string; displayName?: string }): boolean {
    return /incoming[ ._-]*webhooks?/i.test(`${message.personEmail || ''} ${message.personDisplayName || ''} ${message.displayName || ''}`);
}
