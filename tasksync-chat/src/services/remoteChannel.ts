export type RemoteMessageId = string | number;
export type RemoteReply = (taskId: string, text: string, user: string) => void | Promise<void>;
export interface RemoteDestination { id: RemoteMessageId; general: boolean }
export interface RemoteChannel {
    isConfigured(): boolean;
    postText(markdown: string, fallback: string, replyTaskId?: string): Promise<boolean>;
    destination(workspace?: string, general?: boolean): Promise<RemoteDestination | undefined>;
    sendText(formatted: string, fallback: string, destination?: RemoteDestination, options?: { notify?: boolean }): Promise<RemoteMessageId | undefined>;
    editLive(messageId: RemoteMessageId, formatted: string): Promise<boolean>;
    finishLive(messageId: RemoteMessageId, head: string, markdown: string, taskId: string): Promise<boolean>;
    sendDocument(filePath: string, caption: string, replyTaskId?: string): Promise<boolean>;
    postQuestion(taskId: string, question: string, choices?: string[]): Promise<void>;
    onReply(callback: RemoteReply): void;
    resolveTask(taskId: string): void;
    beginTurn?(workspace: string, prompt: string, status: string): Promise<RemoteMessageId | undefined>;
    finishTurn?(markdown: string, taskId: string, filePath: string): Promise<boolean>;
}
