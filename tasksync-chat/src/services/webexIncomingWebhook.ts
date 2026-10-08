import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { SecurityRunner, WEBEX_ACCESS_TOKEN_KEY } from './webexAuth';

export const WEBEX_WEBHOOK_APP = 'https://apphub.webex.com/applications/incoming-webhooks-cisco-systems-38054-23307-75252';
const valid = (value: string) => /^https:\/\/webexapis\.com\/v1\/webhooks\/incoming\/[A-Za-z0-9_=-]+$/.test(value);
const key = (roomId: string) => `askaway.webex.incomingWebhook.${roomId}`;
const security: SecurityRunner = (file, args) => new Promise((resolve, reject) => execFile(file, args, error => error ? reject(new Error('Keychain update failed.')) : resolve()));

export class WebexIncomingWebhook {
    constructor(private secrets: vscode.SecretStorage, private runner: SecurityRunner = security,
        private platform = process.platform, private baseUrl?: string) {}

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
            if (chosen.roomId === facts.self.generalRoomId && this.platform === 'darwin') {
                await this.runner('security', ['add-generic-password', '-U', '-a', 'vibecoding', '-s', 'webex-general-webhook-url', '-w', url]);
            }
            if (!await this.send(chosen.roomId, 'AskAway: Webex notifications configured.')) { throw new Error('Confirmation failed.'); }
        } catch { await vscode.window.showErrorMessage('AskAway: Webex notification configuration failed.'); }
    }

    async prompt(root: string, state: vscode.Memento): Promise<void> {
        if (!vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false) ||
            !await this.secrets.get(WEBEX_ACCESS_TOKEN_KEY) || state.get('webex.notifications.dismissed', false)) { return; }
        try {
            const facts = JSON.parse(await fs.readFile(path.join(root, '.askaway/webex-spaces.json'), 'utf8'));
            const id = facts.self?.workspaceRoomId;
            if (!id || await this.configured(id)) { return; }
            const title = facts.teams.flatMap((team: { rooms: { id: string; title: string }[] }) => team.rooms).find((room: { id: string }) => room.id === id)?.title || path.basename(root);
            const action = await vscode.window.showInformationMessage(`AskAway: Configure Webex notifications for ${title}.`, 'Configure', 'Later', "Don't ask in this workspace");
            if (action === 'Configure') { await this.configure(root); }
            if (action === "Don't ask in this workspace") { await state.update('webex.notifications.dismissed', true); }
        } catch { /* No resolved destination yet. */ }
    }
}

export function isIncomingWebhookSender(message: { personEmail?: string; personDisplayName?: string; displayName?: string }): boolean {
    return /incoming[ ._-]*webhooks?/i.test(`${message.personEmail || ''} ${message.personDisplayName || ''} ${message.displayName || ''}`);
}
