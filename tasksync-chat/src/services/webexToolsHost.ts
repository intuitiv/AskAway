import * as vscode from 'vscode';
import { WebexAuth } from './webexAuth';
import { runWebexTool, WebexToolDeps } from './webexTools';
import { readAvailability } from '../webview/webviewProvider';

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
