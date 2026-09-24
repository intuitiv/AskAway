import * as vscode from 'vscode';

const HANDOFF_TASK_PREFIX = 'handoff:';

export function createTelegramHandoffTaskId(turnTimestamp: number): string {
    return `${HANDOFF_TASK_PREFIX}${turnTimestamp}`;
}

export function isTelegramHandoffTaskId(taskId: string): boolean {
    return taskId.startsWith(HANDOFF_TASK_PREFIX);
}

export async function submitTelegramConversationReply(response: string): Promise<void> {
    const query = response.trim();
    if (!query) { throw new Error('Telegram conversation reply is empty'); }
    await vscode.commands.executeCommand('workbench.action.chat.open', { query, isPartialQuery: true });
    await vscode.commands.executeCommand('workbench.action.chat.submit');
}