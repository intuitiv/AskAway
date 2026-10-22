import * as vscode from 'vscode';
import { WebexAuth } from './webexAuth';
import { readAvailability } from '../webview/webviewProvider';
import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { createWebexProvider } from './webexSuite';
import { assistantTools, registerAssistantProvider } from './assistant/provider';
import type { ApprovalRequest } from './assistant/provider';
import { registerToolDefinitions, ToolDefinition } from '../workers/workerTools';

export function registerWebexToolsHost(register: Parameters<typeof registerToolDefinitions>[0], tools: ToolDefinition[]): void {
    registerToolDefinitions(register, tools);
}

let unregisterWebex: (() => void) | undefined;
/** Registers Webex as an assistant provider (replacing an earlier registration after a reload) and returns every registered provider's tools. */
export function createWebexSuiteHost(secrets: vscode.SecretStorage, workspace: string): ToolDefinition[] {
    const auth = new WebexAuth(secrets);
    const request = async (url: string, options: RequestInit = {}, json = true) => {
        if (!vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false)) { throw new Error('Disabled.'); }
        const { accessToken } = await auth.tokens();
        if (!accessToken) { throw new Error('Not configured.'); }
        return fetch(url, { ...options, redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, ...(json ? { 'Content-Type': 'application/json' } : {}) } });
    };
    const provider = createWebexProvider({
        cacheDir: path.join(workspace, path.basename(workspace) === 'tasksync-chat' ? '.webex-cache' : 'tasksync-chat/.webex-cache'),
        stateFile: path.join(workspace, '.askaway/webex-seen.json'),
        // The modal is only the explicit fallback for when AITalk is unavailable (R-TELE-43).
        modalFallback: approveWebexAction,
        request: (method, endpoint, body) => request(`https://webexapis.com/v1${endpoint}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
        // Webex takes one file per message: the caption goes with the first.
        uploadFiles: async (target, files, caption) => {
            let id = '';
            for (const [index, file] of files.entries()) {
                const form = new FormData();
                for (const [key, value] of Object.entries(target)) { form.set(key, value); }
                if (index === 0 && caption) { form.set('text', caption); }
                form.set('files', new Blob([await fs.readFile(file)]), path.basename(file));
                const response = await request('https://webexapis.com/v1/messages', { method: 'POST', body: form }, false);
                if (!response.ok) { throw new Error('Upload failed.'); }
                id = String((await response.json() as { id?: string }).id ?? '');
            }
            return { id };
        },
        download: async url => {
            const response = await request(url);
            if (!response.ok) { throw new Error('Download failed.'); }
            const disposition = response.headers.get('content-disposition') ?? '';
            const name = /filename="?([^";]+)/i.exec(disposition)?.[1] ?? 'attachment';
            return { name, bytes: Buffer.from(await response.arrayBuffer()) };
        },
        extract: file => new Promise((resolve, reject) => {
            const pdf = file.endsWith('.pdf');
            execFile(pdf ? 'pdftotext' : 'textutil', pdf ? [file, '-'] : ['-convert', 'txt', '-stdout', file], { maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
        }),
    });
    unregisterWebex?.();
    unregisterWebex = registerAssistantProvider(provider);
    return assistantTools();
}

/** The R-TELE-43 modal: asked only through the explicit `modalFallback`, and only while the reviewer is Here. */
export async function approveWebexAction(req: ApprovalRequest): Promise<'approved' | 'rejected' | 'unavailable'> {
    if (readAvailability()?.mode !== 'here') { return 'unavailable'; }
    const extra = Object.entries(req.details ?? {}).map(([key, value]) => `${key}: ${value}`).concat(req.files?.length ? [`Files: ${req.files.join(', ')}`] : []);
    const choice = await vscode.window.showWarningMessage(
        `${req.provider} ${req.action} to ${req.targetLabel}?${extra.length ? `\n\n${extra.join('\n')}` : ''}\n\n${req.body}`,
        { modal: true }, 'Send', 'Cancel');
    return choice === 'Send' ? 'approved' : 'rejected';
}
