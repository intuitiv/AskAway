import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const WEBEX_ACCESS_TOKEN_KEY = 'askaway.webex.accessToken';
export const WEBEX_REFRESH_TOKEN_KEY = 'askaway.webex.refreshToken';
export type SecurityRunner = (file: string, args: string[]) => Promise<void>;
const securityRunner: SecurityRunner = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, error => error ? reject(new Error('Webex Keychain storage failed.')) : resolve());
});

export class WebexAuth {
    constructor(private secrets: vscode.SecretStorage, private runner: SecurityRunner = securityRunner,
        private platform: string = process.platform) {}

    async store(accessToken: string, refreshToken?: string): Promise<void> {
        try {
            await this.secrets.store(WEBEX_ACCESS_TOKEN_KEY, accessToken);
            if (refreshToken) { await this.secrets.store(WEBEX_REFRESH_TOKEN_KEY, refreshToken); }
            await this.mirror('webex-access-token', accessToken);
        } catch {
            throw new Error('Could not store Webex credentials.');
        }
    }

    async mirror(service: 'webex-access-token' | 'webex-general-room-id', value: string): Promise<void> {
        try {
            if (this.platform === 'darwin') {
                await this.runner('security', ['add-generic-password', '-U', '-a', 'vibecoding', '-s', service, '-w', value]);
            }
        } catch { throw new Error('Could not update Webex Keychain storage.'); }
    }

    async tokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
        try {
            return { accessToken: await this.secrets.get(WEBEX_ACCESS_TOKEN_KEY), refreshToken: await this.secrets.get(WEBEX_REFRESH_TOKEN_KEY) };
        } catch {
            throw new Error('Could not read Webex credentials.');
        }
    }
}

export async function setWebexToken(auth: WebexAuth): Promise<boolean> {
    try {
        const token = await vscode.window.showInputBox({ password: true, prompt: 'Webex access token (OAuth integration or bot token)', ignoreFocusOut: true });
        if (!token) { return false; }
        const refresh = await vscode.window.showInputBox({ password: true, prompt: 'Optional Webex refresh token (Escape or empty to skip)', ignoreFocusOut: true });
        await auth.store(token, refresh || undefined);
        return true;
    } catch {
        await vscode.window.showErrorMessage('AskAway: Could not store Webex credentials.');
        return false;
    }
}

export function readWebexCredentials(filePath = path.join(os.homedir(), '.webex.md')): { clientId?: string; clientSecret?: string } {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { clientId: /^Client ID:\s*(.+)$/m.exec(content)?.[1].trim(), clientSecret: /^Client secret:\s*(.+)$/m.exec(content)?.[1].trim() };
    } catch { return {}; }
}
