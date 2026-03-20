import * as vscode from 'vscode';
import * as fs from 'fs';
import { AskAwayWebviewProvider } from './webview/webviewProvider';
import { getImageMimeType } from './utils/imageUtils';
import { PlanTaskStatus } from './plan/planTypes';

export interface Input {
    question: string;
    taskId?: string;
    taskStatus?: PlanTaskStatus;
}

export interface AskUserToolResult {
    response: string;
    attachments: string[];
    queue: boolean;
    taskId?: string;
    taskStatus?: PlanTaskStatus;
}

/**
 * Reads a file as Uint8Array for efficient binary handling
 */
async function readFileAsBuffer(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
}

/**
 * Creates a cancellation promise with proper cleanup to prevent memory leaks.
 * Returns both the promise and a dispose function to clean up the event listener.
 */
function createCancellationPromise(token: vscode.CancellationToken): {
    promise: Promise<never>;
    dispose: () => void;
} {
    let disposable: vscode.Disposable | undefined;

    const promise = new Promise<never>((_, reject) => {
        if (token.isCancellationRequested) {
            reject(new vscode.CancellationError());
            return;
        }
        disposable = token.onCancellationRequested(() => {
            reject(new vscode.CancellationError());
        });
    });

    return {
        promise,
        dispose: () => disposable?.dispose()
    };
}

/**
 * Core logic to ask user, reusable by MCP server
 * Queue handling and history tracking is done in waitForUserResponse()
 * Plan mode: taskId and taskStatus are passed through for orchestrator logic
 */
export async function askUser(
    params: Input,
    provider: AskAwayWebviewProvider,
    token: vscode.CancellationToken
): Promise<AskUserToolResult> {
    // Check if already cancelled before starting
    if (token.isCancellationRequested) {
        // Signal messaging services that Copilot conversation is done
        provider.getWebexService()?.notifyCopilotStopped();
        provider.getTelegramService()?.notifyCopilotStopped();
        throw new vscode.CancellationError();
    }

    // ── Plan mode: If Copilot reports task status, let the orchestrator handle it ──
    // Auto-map to active plan task if Copilot didn't include taskId
    let taskId = params.taskId;
    let taskStatus = params.taskStatus;
    if (!taskId) {
        const activeId = provider.getActivePlanTaskId();
        if (activeId) {
            taskId = activeId;
            // Copilot didn't include taskId — it doesn't know about the plan system.
            // Use AI to classify: is this a completion report or a mid-task question?
            taskStatus = await provider.classifyTaskProgress(activeId, params.question);
        }
    }
    if (taskId && taskStatus) {
        const planResult = await provider.handlePlanTaskUpdate(
            taskId, 
            taskStatus, 
            params.question,
            token
        );
        if (planResult) {
            return {
                response: planResult.response,
                attachments: [],
                queue: true,  // Keep Copilot calling ask_user for the next plan task
                taskId: taskId,
                taskStatus: taskStatus
            };
        }
        // If planResult is null, fall through to normal ask_user flow
    }

    // Notify messaging services that Copilot is still alive (resets idle timer)
    provider.getWebexService()?.notifyCopilotActivity();
    provider.getTelegramService()?.notifyCopilotActivity();
    provider.getTelegramService()?.notifyToolCallStarted();

    // Create cancellation promise with cleanup capability
    const cancellation = createCancellationPromise(token);

    try {
        // Race the user response against cancellation
        const result = await Promise.race([
            provider.waitForUserResponse(params.question),
            cancellation.promise
        ]);

        // Notify Telegram that the tool call returned (Copilot is processing again)
        provider.getTelegramService()?.notifyToolCallReturned();

        // Handle case where request was superseded by another call
        if (result.cancelled) {
            return {
                response: result.value,
                attachments: [],
                queue: result.queue
            };
        }

        let responseText = result.value;
        const validAttachments: string[] = [];

        // Process attachments to resolve context content
        if (result.attachments && result.attachments.length > 0) {
            for (const att of result.attachments) {
                if (att.uri.startsWith('context://')) {
                    // Start of context content
                    responseText += `\n\n[Attached Context: ${att.name}]\n`;

                    const content = await provider.resolveContextContent(att.uri);
                    if (content) {
                        responseText += content;
                    } else {
                        responseText += '(Context content not available)';
                    }

                    // End of context content
                    responseText += '\n[End of Context]\n';
                } else {
                    // Regular file attachment
                    validAttachments.push(att.uri);
                }
            }
        }

        // ── Plan mode: Auto-merge user feedback into task instructions ──
        // When Copilot asks the user mid-task and the user responds,
        // merge the user's response into the task description so context accumulates.
        const mergeTaskId = params.taskId || provider.getActivePlanTaskId();
        if (mergeTaskId && (params.taskStatus === 'in-progress' || (!params.taskStatus && provider.getActivePlanTaskId()))) {
            provider.mergeUserFeedbackIntoTask(mergeTaskId, params.question, responseText);
        }

        // Keep Copilot in the loop when there's an active plan task
        const hasActivePlan = !!provider.getActivePlanTaskId();

        return {
            response: responseText,
            attachments: validAttachments,
            queue: result.queue || hasActivePlan
        };
    } catch (error) {
        // Re-throw cancellation errors without logging (they're expected)
        if (error instanceof vscode.CancellationError) {
            // Signal messaging services that Copilot conversation ended
            provider.getWebexService()?.notifyCopilotStopped();
            provider.getTelegramService()?.notifyCopilotStopped();
            throw error;
        }
        // Log other errors
        console.error('[AskAway] askUser error:', error instanceof Error ? error.message : error);
        // Show error to user so they know something went wrong
        vscode.window.showErrorMessage(`AskAway: ${error instanceof Error ? error.message : 'Failed to show question'}`);
        return {
            response: '',
            attachments: [],
            queue: false
        };
    } finally {
        // Always clean up the cancellation listener to prevent memory leaks
        cancellation.dispose();
    }
}

export function registerTools(context: vscode.ExtensionContext, provider: AskAwayWebviewProvider) {

    // Register ask_user tool (VS Code native LM tool)
    let askUserTool: vscode.Disposable | undefined;
    try {
        askUserTool = vscode.lm.registerTool('ask_user', {
        prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Input>) {
            const rawQuestion = typeof options?.input?.question === 'string' ? options.input.question : '';
            const questionPreview = rawQuestion.trim().replace(/\s+/g, ' ');

            const MAX_PREVIEW_LEN = 40;
            const truncated = questionPreview.length > MAX_PREVIEW_LEN
                ? questionPreview.slice(0, MAX_PREVIEW_LEN - 3) + '...'
                : questionPreview;

            return {
                invocationMessage: truncated ? `ask_user: ${truncated}` : 'ask_user'
            };
        },
        async invoke(options: vscode.LanguageModelToolInvocationOptions<Input>, token: vscode.CancellationToken) {
            const params = options.input;

            try {
                const result = await askUser(params, provider, token);

                // Force queued:true when plan mode is active, so Copilot keeps calling
                const isQueued = result.queue || !!provider.getActivePlanTaskId();

                // Build result parts - text first, then images
                const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        response: result.response,
                        queued: isQueued,
                        attachmentCount: result.attachments.length
                    }))
                ];

                // When plan mode is active, add a follow-up instruction so Copilot
                // executes the task and calls ask_user again instead of ending.
                if (isQueued && !result.taskId) {
                    // This is a queued plan task — wrap the response with continuation instruction
                    resultParts[0] = new vscode.LanguageModelTextPart(JSON.stringify({
                        response: result.response,
                        queued: true,
                        attachmentCount: result.attachments.length,
                        instruction: 'This is a queued task from the planning board. Execute it fully, then call ask_user to report what you did and get the next task.'
                    }));
                }

                // Add image attachments as LanguageModelDataPart for vision models
                if (result.attachments && result.attachments.length > 0) {
                    const imagePromises = result.attachments.map(async (uri) => {
                        try {
                            const fileUri = vscode.Uri.parse(uri);
                            const filePath = fileUri.fsPath;

                            // Check if file exists
                            if (!fs.existsSync(filePath)) {
                                console.error('[AskAway] Attachment file does not exist:', filePath);
                                return null;
                            }

                            const mimeType = getImageMimeType(filePath);

                            // Only process image files (skip non-image attachments)
                            if (mimeType !== 'application/octet-stream') {
                                const data = await readFileAsBuffer(filePath);
                                const dataPart = vscode.LanguageModelDataPart.image(data, mimeType);
                                return dataPart;
                            }
                            return null;
                        } catch (error) {
                            console.error('[AskAway] Failed to read image attachment:', error);
                            return null;
                        }
                    });

                    const imageParts = await Promise.all(imagePromises);
                    for (const part of imageParts) {
                        if (part !== null) {
                            resultParts.push(part);
                        }
                    }
                }

                return new vscode.LanguageModelToolResult(resultParts);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart("Error: " + message)
                ]);
            }
        }
    });

    } catch (regError) {
        console.warn('[AskAway] ask_user tool already registered by another extension, skipping registration');

        // This is the most common cause of "works in debug, fails when installed":
        // another extension has already claimed ask_user, so AskAway never receives tool calls.
        vscode.window.showWarningMessage(
            'AskAway could not register ask_user because another extension already registered it. Disable conflicting extensions (for example TaskSync) to enable AskAway Telegram/Webex routing.',
            'Open Extensions',
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Extensions') {
                vscode.commands.executeCommand('workbench.view.extensions');
            } else if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'askaway');
            }
        });
    }

    if (askUserTool) {
        context.subscriptions.push(askUserTool);
    }

    // ── Register talk_to_user tool (Voice conversation) ──
    let talkToUserTool: vscode.Disposable | undefined;
    try {
        talkToUserTool = vscode.lm.registerTool('talk_to_user', {
            prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<Input>) {
                const rawQuestion = typeof options?.input?.question === 'string' ? options.input.question : '';
                const questionPreview = rawQuestion.trim().replace(/\s+/g, ' ');
                const MAX_PREVIEW_LEN = 40;
                const truncated = questionPreview.length > MAX_PREVIEW_LEN
                    ? questionPreview.slice(0, MAX_PREVIEW_LEN - 3) + '...'
                    : questionPreview;
                return {
                    invocationMessage: truncated ? `🎤 ${truncated}` : '🎤 talk_to_user'
                };
            },
            async invoke(options: vscode.LanguageModelToolInvocationOptions<Input>, token: vscode.CancellationToken) {
                const params = options.input;
                try {
                    // Use voice mode — TTS speaks the question, mic records the answer
                    const result = await provider.waitForVoiceResponse(params.question, token);
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(JSON.stringify({
                            response: result,
                            mode: 'voice'
                        }))
                    ]);
                } catch (err: unknown) {
                    if (err instanceof vscode.CancellationError) {
                        throw err;
                    }
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart("Error: " + message)
                    ]);
                }
            }
        });
    } catch (regError) {
        console.warn('[AskAway] talk_to_user tool already registered, skipping');
    }

    if (talkToUserTool) {
        context.subscriptions.push(talkToUserTool);
    }
}
