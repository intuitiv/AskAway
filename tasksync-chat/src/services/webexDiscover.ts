import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WebexAuth } from './webexAuth';
import { WebexStatus } from './webexStatus';

interface DiscoveryOptions {
    baseUrl?: string;
    refresh?: () => Promise<string | undefined>;
    wait?: (milliseconds: number) => Promise<void>;
    status?: WebexStatus;
}

export async function webexDiscover(auth: WebexAuth, workspace: { fsPath: string; name: string }, options: DiscoveryOptions = {}): Promise<boolean> {
    try {
        const base = new URL(options.baseUrl || 'https://webexapis.com/v1/');
        if (!base.pathname.endsWith('/')) { base.pathname += '/'; }
        let { accessToken: token } = await auth.tokens();
        if (!token) { throw new Error('Missing Webex token.'); }
        const secretValues = new Set([token, (await auth.tokens()).refreshToken].filter((value): value is string => !!value));
        let refreshed = false;
        const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        async function get(url: URL): Promise<Response> {
            if (url.origin !== base.origin || url.username || url.password) { throw new Error('Invalid pagination URL.'); }
            let rateRetried = false;
            for (;;) {
                const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
                await options.status?.http('discovery', 'GET', url, response);
                if (response.status === 429 && !rateRetried) {
                    rateRetried = true;
                    const retry = response.headers.get('Retry-After') || '1';
                    const seconds = Number(retry);
                    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
                    await wait(Number.isFinite(delay) ? Math.max(0, delay) : 1000);
                    continue;
                }
                if (response.status === 401 && !refreshed && options.refresh) {
                    refreshed = true;
                    const newToken = await options.refresh();
                    if (newToken) {
                        token = newToken;
                        secretValues.add(newToken);
                        const updated = await auth.tokens();
                        if (updated.refreshToken) { secretValues.add(updated.refreshToken); }
                        continue;
                    }
                }
                if (!response.ok) { throw new Error('Webex request failed.'); }
                return response;
            }
        }
        async function list(endpoint: string): Promise<Record<string, unknown>[]> {
            let url: URL | undefined = new URL(endpoint, base);
            const items: Record<string, unknown>[] = [];
            const visited = new Set<string>();
            while (url) {
                if (visited.has(url.href)) { throw new Error('Repeated pagination URL.'); }
                visited.add(url.href);
                const response = await get(url);
                const data = await response.json() as { items: Record<string, unknown>[] };
                items.push(...data.items);
                const next = response.headers.get('Link')?.split(',').find(link => /;\s*rel\s*=\s*"?next"?(?:\s|;|$)/i.test(link));
                const href = next && /<([^>]+)>/.exec(next)?.[1];
                url = href ? new URL(href, url) : undefined;
            }
            return items;
        }
        const me = await (await get(new URL('people/me', base))).json() as { id: string; displayName: string; emails: string[] };
        const teams = [];
        for (const team of await list('teams')) {
            const rooms = (await list(`rooms?teamId=${encodeURIComponent(String(team.id))}&max=100`)).map(room => ({
                id: room.id, title: room.title, type: room.type, created: room.created, lastActivity: room.lastActivity
            }));
            teams.push({ id: team.id, name: team.name, rooms });
        }
        const self = teams.find(team => String(team.name).toLowerCase() === 'self');
        const general = self?.rooms.find(room => room.title === 'AskAway General');
        const facts = {
            discoveredAt: new Date().toISOString(), me: { id: me.id, displayName: me.displayName, emails: me.emails }, teams,
            self: { teamId: self?.id ?? null, generalRoomId: general?.id ?? null, workspaceRoomId: self?.rooms.find(room => room.title === workspace.name)?.id ?? null }
        };
        const serialized = JSON.stringify(facts, null, 2);
        if ([...secretValues].some(secret => serialized.includes(secret))) { throw new Error('Unsafe discovery response.'); }
        const directory = path.join(workspace.fsPath, '.askaway');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'webex-spaces.json'), serialized, 'utf8');
        if (general && typeof general.id === 'string') {
            try { await auth.mirror('webex-general-room-id', general.id); }
            catch (error) { await options.status?.record('discovery', { exception: (error as Error).message, mirror: 'failed; SecretStorage remains authoritative' }); }
        }
        await options.status?.record('discovery');
        // Not awaited: a notification promise only settles when the user dismisses it, which stalled space setup.
        void vscode.window.showInformationMessage(`AskAway: Discovered ${teams.length} teams, ${teams.reduce((count, team) => count + team.rooms.length, 0)} rooms. self: ${self ? 'found' : 'not found'}; General: ${general ? 'found' : 'not found'}.`);
        return true;
    } catch (error) {
        await options.status?.record('discovery', { exception: (error as Error).message });
        void vscode.window.showErrorMessage('AskAway: Webex space discovery failed.');
        return false;
    }
}
