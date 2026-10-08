import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WebexAuth } from './webexAuth';
import { webexDiscover } from './webexDiscover';
import { WebexStatus } from './webexStatus';

type Workspace = { fsPath: string; name: string };
type Options = { baseUrl?: string; refresh?: () => Promise<string | undefined>; wait?: (ms: number) => Promise<void>; onResolved?: () => Promise<void>; status?: WebexStatus; onFailure?: (status: number) => void };
const pending = new Map<string, Promise<boolean>>();

export async function webexSpaces(auth: WebexAuth, workspace: Workspace, options: Options = {}): Promise<boolean> {
    const existing = pending.get(workspace.fsPath);
    if (existing) { return existing; }
    const run = (async () => {
        try {
            const file = path.join(workspace.fsPath, '.askaway', 'webex-spaces.json');
            const facts = JSON.parse(await fs.readFile(file, 'utf8'));
            const teams = facts.teams.filter((team: { name: string }) => team.name.toLowerCase() === 'self');
            if (teams.length !== 1) { throw new Error('Unresolved self team.'); }
            const team = teams[0];
            const general = team.rooms.filter((room: { title: string }) => room.title === 'AskAway General');
            const title = path.basename(workspace.fsPath);
            const rooms = team.rooms.filter((room: { title: string }) => room.title === title);
            if (general.length > 1 || rooms.length > 1) { throw new Error('Unresolved space.'); }
            const tokens = await auth.tokens();
            if (!tokens.accessToken) { throw new Error('Missing token.'); }
            const resolve = async (title: string, existing: { id: string; title: string } | undefined) => {
                if (existing) { return existing; }
                const base = (options.baseUrl || 'https://webexapis.com/v1/').replace(/\/$/, '');
                const response = await fetch(`${base}/rooms`, { method: 'POST', redirect: 'error',
                    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, teamId: team.id }) });
                await options.status?.http('space resolve', 'POST', `${base}/rooms`, response);
                if (!response.ok) {
                    options.onFailure?.(response.status);
                    if (response.status === 401 || response.status === 403) {
                        void vscode.window.showErrorMessage(`AskAway: Webex space creation failed: ${response.status}. Likely missing scope spark:rooms_write; reauthorize with that registered scope.`);
                    }
                    throw new Error(`Space creation failed: ${response.status}`);
                }
                const created = await response.json() as { id?: unknown };
                if (typeof created.id !== 'string' || !created.id) { throw new Error('Invalid room.'); }
                const room = { id: created.id, title };
                team.rooms.push(room);
                return room;
            };
            const room = await resolve(title, rooms[0]);
            const generalRoom = await resolve('AskAway General', general[0]);
            facts.self = { teamId: team.id, generalRoomId: generalRoom.id, workspaceRoomId: room.id };
            const serialized = JSON.stringify(facts, null, 2);
            if ([tokens.accessToken, tokens.refreshToken].some(secret => secret && serialized.includes(secret))) { throw new Error('Unsafe metadata.'); }
            await fs.writeFile(file, serialized, 'utf8');
            try { await auth.mirror('webex-general-room-id', generalRoom.id); }
            catch (error) { await options.status?.record('space resolve', { exception: (error as Error).message, mirror: 'failed; workspace metadata remains authoritative' }); }
            await options.status?.record('space resolve');
            await options.onResolved?.();
            return true;
        } catch (error) {
            await options.status?.record('space resolve', { exception: (error as Error).message });
            void vscode.window.showErrorMessage('AskAway: Webex workspace space resolution failed.');
            return false;
        }
    })();
    pending.set(workspace.fsPath, run);
    try { return await run; } finally { pending.delete(workspace.fsPath); }
}

export async function setupWebex(auth: WebexAuth, workspace: Workspace, options: Options = {}): Promise<boolean> {
    if (!await webexDiscover(auth, workspace, options) || !await webexSpaces(auth, workspace, { ...options, onResolved: undefined })) { return false; }
    await vscode.workspace.getConfiguration('askaway.webex').update('enabled', true, vscode.ConfigurationTarget.Global);
    await options.onResolved?.();
    return true;
}

export async function ensureWebexWorkspace(auth: WebexAuth, workspace: Workspace, options: Options = {}): Promise<boolean> {
    if (!vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false)) { return false; }
    if (!(await auth.tokens()).accessToken) {
        void vscode.window.showInformationMessage('AskAway: Webex is not signed in.', 'Sign in').then(action => {
            if (action === 'Sign in') { void vscode.commands.executeCommand('askaway.setWebexToken'); }
        });
        return false;
    }
    try {
        const facts = JSON.parse(await fs.readFile(path.join(workspace.fsPath, '.askaway', 'webex-spaces.json'), 'utf8'));
        const ownedGeneral = facts.teams?.find((team: { id: string }) => team.id === facts.self?.teamId)?.rooms
            .some((room: { id: string; title: string }) => room.id === facts.self?.generalRoomId && room.title === 'AskAway General');
        if (facts.self?.workspaceRoomId && ownedGeneral) { await options.onResolved?.(); return true; }
    } catch { /* Discovery creates the missing workspace metadata. */ }
    return await webexDiscover(auth, workspace, options) && await webexSpaces(auth, workspace, options);
}
