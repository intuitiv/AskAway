import * as vscode from 'vscode';
import { WebexAuth } from './webexAuth';
import { runWebexTool, WebexToolDeps } from './webexTools';
import { readAvailability } from '../webview/webviewProvider';
import * as path from 'path';
import { execFile } from 'child_process';
import { webexSuiteTools } from './webexSuite';
import { registerToolDefinitions, ToolDefinition } from '../workers/workerTools';

export function registerWebexToolsHost(register: Parameters<typeof registerToolDefinitions>[0], tools: ToolDefinition[]): void {
    registerToolDefinitions(register, tools);
}

export function createWebexSuiteHost(secrets: vscode.SecretStorage, workspace: string) {
    const auth = new WebexAuth(secrets);
    const request = async (url: string, options: RequestInit = {}) => {
        if (!vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false)) { throw new Error('Disabled.'); }
        const { accessToken } = await auth.tokens();
        if (!accessToken) { throw new Error('Not configured.'); }
        return fetch(url, { ...options, redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    };
    return webexSuiteTools({
        cacheDir: path.join(workspace, path.basename(workspace) === 'tasksync-chat' ? '.webex-cache' : 'tasksync-chat/.webex-cache'),
        approve: draft => approveWebexSend(workspace, draft),
        request: (method, endpoint, body) => request(`https://webexapis.com/v1${endpoint}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
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
}

/** Interim permission boundary; replace this function when the final permission mechanism is agreed. */
export async function approveWebexSend(workspace: string, draft: Parameters<WebexToolDeps['approve']>[0]): ReturnType<WebexToolDeps['approve']> {
    if (readAvailability(workspace)?.mode !== 'here') { return 'unavailable'; }
    const choice = await vscode.window.showWarningMessage(
        `Send Webex message to ${draft.recipientLabel}?\n\n${draft.text}${draft.parentId ? `\n\nReply to: ${draft.parentId}` : ''}`,
        { modal: true }, 'Send', 'Cancel');
    return choice === 'Send' ? 'approved' : 'denied';
}

export function createWebexToolsHost(secrets: vscode.SecretStorage, workspace: string): (input: unknown) => Promise<Record<string, unknown>> {
    const auth = new WebexAuth(secrets);
    return async input => {
        try {
            if (!vscode.workspace.getConfiguration('askaway.webex').get<boolean>('enabled', false)) {
                return { status: 'disabled', reason: 'Webex is not configured.' };
            }
            const { accessToken } = await auth.tokens();
            if (!accessToken) { return { status: 'disabled', reason: 'Webex is not configured.' }; }
            return await runWebexTool(input, {
                approve: draft => approveWebexSend(workspace, draft),
                request: async (method, endpoint, body) => {
                    const response = await fetch(`https://webexapis.com/v1${endpoint}`, {
                        method, redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        ...(body ? { body: JSON.stringify(body) } : {}),
                    });
                    return { ok: response.ok, headers: response.headers, json: async () => {
                        const text = await response.text();
                        if (text.includes(accessToken)) { throw new Error('Unsafe Webex response.'); }
                        return JSON.parse(text);
                    } };
                },
            });
        } catch { return { status: 'error', reason: 'Webex request failed.' }; }
    };
}
