import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const WEBEX_ACCESS_TOKEN_KEY = 'askaway.webex.accessToken';
export const WEBEX_REFRESH_TOKEN_KEY = 'askaway.webex.refreshToken';
export type SecurityRunner = (file: string, args: string[]) => Promise<void>;
export function isWebexToken(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 8192 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}
const securityRunner: SecurityRunner = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, error => error ? reject(new Error('Webex Keychain storage failed.')) : resolve());
});
const credentialStates = new WeakMap<vscode.SecretStorage, { revision: number; pending: Promise<void> }>();

export class WebexAuth {
    constructor(private secrets: vscode.SecretStorage, private runner: SecurityRunner = securityRunner,
        private platform: string = process.platform) {}

    private get state() {
        let state = credentialStates.get(this.secrets);
        if (!state) { state = { revision: 0, pending: Promise.resolve() }; credentialStates.set(this.secrets, state); }
        return state;
    }

    get revision(): number { return this.state.revision; }

    async store(accessToken: string, refreshToken?: string): Promise<void> {
        await this.storeIfCurrent(accessToken, refreshToken);
    }

    async storeIfCurrent(accessToken: string, refreshToken?: string, expectedRevision?: number): Promise<boolean> {
        if (!isWebexToken(accessToken) || (refreshToken !== undefined && !isWebexToken(refreshToken))) {
            throw new Error('Invalid Webex credentials.');
        }
        const state = this.state;
        if (expectedRevision !== undefined && state.revision !== expectedRevision) { return false; }
        const revision = ++state.revision;
        const write = state.pending.then(async () => {
            if (expectedRevision !== undefined && state.revision !== revision) { return false; }
            await this.secrets.store(WEBEX_ACCESS_TOKEN_KEY, accessToken);
            if (refreshToken) { await this.secrets.store(WEBEX_REFRESH_TOKEN_KEY, refreshToken); }
            await this.mirror('webex-access-token', accessToken);
            return true;
        });
        state.pending = write.then(() => {}, () => {});
        try { return await write; } catch { throw new Error('Could not store Webex credentials.'); }
    }

    async mirror(service: 'webex-access-token' | 'webex-general-room-id', value: string): Promise<void> {
        if (process.env.ASKAWAY_TEST_NO_KEYCHAIN === '1' && this.runner === securityRunner) { return; }
        try {
            if (this.platform === 'darwin') {
                await this.runner('security', ['add-generic-password', '-U', '-a', 'vibecoding', '-s', service, '-w', value]);
            }
        } catch { throw new Error('Could not update Webex Keychain storage.'); }
    }

    async tokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
        try {
            await this.state.pending;
            return { accessToken: await this.secrets.get(WEBEX_ACCESS_TOKEN_KEY), refreshToken: await this.secrets.get(WEBEX_REFRESH_TOKEN_KEY) };
        } catch {
            throw new Error('Could not read Webex credentials.');
        }
    }
}

export async function setWebexToken(auth: WebexAuth, credentialsFile?: string): Promise<boolean> {
    try {
        const { clientId, clientSecret } = readWebexCredentials(credentialsFile);
        if (!clientId || !clientSecret) { throw new Error('Missing integration credentials.'); }
        const scopesFile = credentialsFile || path.join(os.homedir(), '.webex.md');
        const scopeLine = fs.readFileSync(scopesFile, 'utf8').split(/\r?\n/).find(line => /^Scopes?:/i.test(line));
        const validateScopes = (value: string): string | undefined => {
            const names = value.trim().split(/[\s,]+/);
            return value.length <= 4096 && names.length > 0 && names.every(name => /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/.test(name))
                ? [...new Set(names)].join(' ') : undefined;
        };
        let scopes = scopeLine ? validateScopes(scopeLine.replace(/^Scopes?:/i, '')) : undefined;
        if (!scopes) {
            const entered = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
                prompt: 'Copy the exact registered scope names from your Webex developer integration (space-separated, including spark:kms if listed). Do not paste its URL or credentials.',
                validateInput: value => validateScopes(value) ? undefined : 'Enter only registered scope names, separated by spaces or commas.' });
            if (!entered) { return false; }
            scopes = validateScopes(entered);
            if (!scopes) { await vscode.window.showErrorMessage('AskAway: Enter only the scope names registered for your Webex integration and retry Set Webex Token.'); return false; }
        }
        const redirect = 'http://localhost:5000/callback';
        const state = randomBytes(32).toString('hex');
        const authorize = new URL('https://webexapis.com/v1/authorize');
        authorize.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: scopes, state }).toString();
        if (!await vscode.env.openExternal(vscode.Uri.parse(authorize.toString()))) { return false; }
        const pasted = await vscode.window.showInputBox({ password: true, prompt: 'Paste the full redirected browser URL after Webex authorization', ignoreFocusOut: true });
        if (!pasted) { return false; }
        const callback = new URL(pasted);
        const params = callback.searchParams;
        if (callback.origin === 'http://localhost:5000' && callback.pathname === '/callback' && !callback.username && !callback.password && !callback.hash &&
            params.getAll('state').length === 1 && params.get('state') === state && params.getAll('error').length === 1 && params.get('error') === 'invalid_scope') {
            await vscode.window.showErrorMessage('AskAway: Webex rejected the requested scopes. Copy the exact registered scope names from your Webex developer integration into the local Scopes: field, or remove that field to enter them in the local prompt. Then rerun Set Webex Token; never paste callback URLs in chat.');
            return false;
        }
        if (callback.origin !== 'http://localhost:5000' || callback.pathname !== '/callback' || callback.username || callback.password || callback.hash ||
            [...params.keys()].some(key => key.startsWith('error')) || params.getAll('code').length !== 1 || params.getAll('state').length !== 1 ||
            params.get('state') !== state || !isWebexToken(params.get('code'))) { throw new Error('Invalid OAuth callback.'); }
        const response = await fetch('https://webexapis.com/v1/access_token', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code: params.get('code')!, redirect_uri: redirect }).toString()
        });
        if (!response.ok) { throw new Error('OAuth exchange failed.'); }
        const data = await response.json() as { access_token?: unknown; refresh_token?: unknown };
        if (!isWebexToken(data.access_token) || !isWebexToken(data.refresh_token)) { throw new Error('Invalid OAuth tokens.'); }
        await auth.store(data.access_token, data.refresh_token);
        return true;
    } catch {
        await vscode.window.showErrorMessage('AskAway: Webex authorization failed.');
        return false;
    }
}

export function registerWebexAuthCommands(context: Pick<vscode.ExtensionContext, 'secrets' | 'subscriptions'>, onStored: () => Promise<void>,
    auth = new WebexAuth(context.secrets), credentialsFile?: string): void {
    const run = async () => {
        if (await setWebexToken(auth, credentialsFile)) {
            try { await onStored(); } catch { await vscode.window.showErrorMessage('AskAway: Could not reload Webex authorization.'); }
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('askaway.setWebexToken', run), vscode.commands.registerCommand('askaway.authorizeWebex', run));
}

export function readWebexCredentials(filePath = path.join(os.homedir(), '.webex.md')): { clientId?: string; clientSecret?: string } {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        return { clientId: lines.find(line => line.startsWith('Client ID:'))?.slice(10).trim(), clientSecret: lines.find(line => line.startsWith('Client secret:'))?.slice(14).trim() };
    } catch { return {}; }
}
