/**
 * Plan Board Editor — Full-screen Trello-style task board in an editor tab.
 * Opens via command "askaway.openPlanBoard" or the sidebar "Open Board" button.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Plan, PlanTask, PlanTaskStatus, createPlan, createTask, findTaskById, getNextPendingTask, countByStatus } from './planTypes';

export class PlanEditorProvider implements vscode.Disposable {
    private _panel: vscode.WebviewPanel | null = null;
    private _currentPlan: Plan | null = null;
    private _disposables: vscode.Disposable[] = [];
    private _onPlanChanged = new vscode.EventEmitter<Plan | null>();
    public readonly onPlanChanged = this._onPlanChanged.event;

    /** Callback from orchestrator: when Copilot reports task status */
    private _pendingReviewResolvers: Map<string, (response: string) => void> = new Map();
    private _planExecuting: boolean = false;

    /** Callback to push next-task prompts into the queue */
    private _enqueueTaskPrompt: ((prompt: string) => void) | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        this._loadPlanFromDisk();
    }

    public setEnqueueCallback(cb: (prompt: string) => void): void {
        this._enqueueTaskPrompt = cb;
    }

    /**
     * Re-enqueue the current in-progress task if plan is executing.
     * Called when switching back to plan mode so Copilot picks it up.
     */
    public reEnqueueActiveTask(): void {
        if (!this._currentPlan || !this._planExecuting) { return; }
        const activeTask = this._currentPlan.tasks.find(t => t.status === 'in-progress');
        if (activeTask && this._enqueueTaskPrompt) {
            this._enqueueTaskPrompt(this._formatTaskPrompt(activeTask));
        }
    }

    /** Open or reveal the plan board editor tab */
    public open(): void {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'askaway.planBoard',
            '📋 Plan Board',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'media'),
                    vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                ]
            }
        );

        this._panel.webview.html = this._getHtml(this._panel.webview);
        this._panel.webview.onDidReceiveMessage(
            (msg) => this._handleMessage(msg),
            undefined,
            this._disposables
        );

        this._panel.onDidDispose(() => {
            this._panel = null;
        }, undefined, this._disposables);

        // Send initial plan state after a short delay for webview readiness
        setTimeout(() => {
            this._sendPlanUpdate();
        }, 200);
    }

    public getPlan(): Plan | null {
        return this._currentPlan;
    }

    public isExecuting(): boolean {
        return this._planExecuting;
    }

    /** Return the ID of the current in-progress task, or null */
    public getActiveTaskId(): string | null {
        if (!this._currentPlan || !this._planExecuting) { return null; }
        const active = this._currentPlan.tasks.find(t => t.status === 'in-progress');
        return active?.id ?? null;
    }

    /**
     * Classify whether Copilot's ask_user call represents task completion
     * or a mid-task clarification question. Uses AI to analyze the question
     * content against the task context.
     * Returns 'completed' if the task appears done, 'in-progress' if it's
     * a mid-task question requiring user input.
     */
    public async classifyTaskProgress(
        taskId: string,
        question: string
    ): Promise<'completed' | 'in-progress'> {
        if (!this._currentPlan) { return 'in-progress'; }
        const task = findTaskById(this._currentPlan.tasks, taskId);
        if (!task) { return 'in-progress'; }

        try {
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4o-mini' });
            const model = models[0];
            if (!model) { return 'completed'; } // No model → assume done

            const prompt = `Given a coding task and the AI assistant's latest message, determine if the task is COMPLETED or if the AI is asking a QUESTION that needs a user answer.

TASK: ${task.title}
${task.description ? `DESCRIPTION: ${task.description}` : ''}

AI MESSAGE:
${question}

Reply with exactly one word: COMPLETED or QUESTION`;

            const messages = [vscode.LanguageModelChatMessage.User(prompt)];
            const response = await model.sendRequest(messages);
            let fullResponse = '';
            for await (const chunk of response.text) { fullResponse += chunk; }

            const answer = fullResponse.trim().toUpperCase();
            if (answer.includes('COMPLETED')) { return 'completed'; }
            if (answer.includes('QUESTION')) { return 'in-progress'; }
            // Default to completed if the classifier is ambiguous
            return 'completed';
        } catch (err) {
            console.error('[AskAway Plan] Classify error:', err);
            // On error, default to completed to keep the chain moving
            return 'completed';
        }
    }

    /**
     * Handle Copilot reporting task status via ask_user.
     * Returns auto-response (next task prompt) or null to fall through.
     */
    public async handleTaskUpdate(
        taskId: string,
        taskStatus: PlanTaskStatus,
        question: string
    ): Promise<{ response: string } | null> {
        if (!this._currentPlan) { return null; }

        const task = findTaskById(this._currentPlan.tasks, taskId);
        if (!task) {
            console.warn(`[AskAway Plan] Task ${taskId} not found`);
            return null;
        }

        // Update task
        task.status = taskStatus;
        task.completionNote = question;
        task.updatedAt = Date.now();
        this._currentPlan.updatedAt = Date.now();
        this._sendPlanUpdate();

        if (taskStatus === 'completed') {
            if (task.requiresReview) {
                task.status = 'need-review';
                this._sendPlanUpdate();
                // Wait for user review
                return new Promise<{ response: string }>((resolve) => {
                    this._pendingReviewResolvers.set(taskId, (response: string) => resolve({ response }));
                });
            }

            if (this._currentPlan.autoAdvance && this._planExecuting) {
                const nextTask = getNextPendingTask(this._currentPlan.tasks);
                if (nextTask) {
                    nextTask.status = 'in-progress';
                    nextTask.updatedAt = Date.now();
                    this._currentPlan.activeTaskId = nextTask.id;
                    this._sendPlanUpdate();
                    return { response: this._formatTaskPrompt(nextTask) };
                } else {
                    this._planExecuting = false;
                    this._currentPlan.activeTaskId = null;
                    this._sendPlanUpdate();
                    return { response: 'All planned tasks have been completed!' };
                }
            }
            return null;
        }

        // Blocked / in-progress / need-review → fall through to normal ask_user
        return null;
    }

    // ── Private methods ──

    private _formatTaskPrompt(task: PlanTask): string {
        let prompt = task.title;
        if (task.description) {
            prompt += `\n\n${task.description}`;
        }
        if (task.subtasks.length > 0) {
            prompt += `\n\nSubtasks:`;
            for (const sub of task.subtasks) {
                const icon = sub.status === 'completed' ? '✅' : sub.status === 'in-progress' ? '🔄' : '⬜';
                prompt += `\n${icon} ${sub.title}`;
            }
        }
        return prompt;
    }

    /** Format task prompt wrapped with continuation instruction for queued delivery */
    public formatQueuedTaskPrompt(task: PlanTask): string {
        return this._formatTaskPrompt(task);
    }

    /**
     * Auto-merge user feedback into a task's description using AI.
     * Copilot asked the user a question mid-task. The user's response contains
     * important context, cautions, or instructions. We merge them into the task
     * description so they persist and travel with future prompts.
     * Fire-and-forget — runs in background.
     */
    public async mergeUserFeedback(taskId: string, copilotQuestion: string, userResponse: string): Promise<void> {
        if (!this._currentPlan) { return; }
        const task = findTaskById(this._currentPlan.tasks, taskId);
        if (!task) { return; }

        // Skip trivial responses (single word approvals, etc.)
        const trimmed = userResponse.trim();
        if (trimmed.length < 15 || /^(yes|no|ok|sure|go|done|good|fine|yep|nope|y|n)$/i.test(trimmed)) {
            return;
        }

        try {
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4o-mini' });
            const model = models[0];
            if (!model) { return; }

            const existingDesc = task.description || '';
            const systemPrompt = `You are a concise technical writer. Given a task and a new Q&A exchange, extract ONLY the specific, concrete information the user provided (constraints, preferences, file paths, technology choices, parameters) and add it to the existing instructions. 

RULES:
- ONLY add information the user explicitly stated
- Do NOT add generic suggestions, action menus, or boilerplate
- Do NOT invent choices or workflows the user didn't mention
- Keep additions brief — one or two bullet points max
- If the user's response contains no actionable info, output the existing instructions unchanged
- Output ONLY the updated instructions text, nothing else`;

            const userPrompt = `TASK: ${task.title}

EXISTING INSTRUCTIONS:
${existingDesc || '(none)'}

NEW Q&A EXCHANGE:
AI asked: ${copilotQuestion}
User answered: ${userResponse}

Output the merged instructions:`;

            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(userPrompt)
            ];

            const response = await model.sendRequest(messages);
            let fullResponse = '';
            for await (const chunk of response.text) { fullResponse += chunk; }

            const merged = fullResponse.trim();
            if (merged.length > 0 && merged !== existingDesc) {
                task.description = merged;
                task.updatedAt = Date.now();
                this._sendPlanUpdate();
                console.log(`[AskAway Plan] Merged user feedback into task ${taskId}`);
            }
        } catch (err) {
            console.error('[AskAway Plan] Merge feedback error:', err);
            // Non-critical — just skip the merge
        }
    }

    private _sendPlanUpdate(): void {
        this._panel?.webview.postMessage({ type: 'updatePlan', plan: this._currentPlan, executing: this._planExecuting });
        this._savePlanToDisk();
        this._onPlanChanged.fire(this._currentPlan);
    }

    private _handleMessage(msg: any): void {
        switch (msg.type) {
            case 'addTask': {
                if (!this._currentPlan) {
                    this._currentPlan = createPlan('My Plan');
                }
                const order = this._currentPlan.tasks.length;
                const task = createTask(msg.title, msg.description || '', order, false);
                this._currentPlan.tasks.push(task);
                this._sendPlanUpdate();
                break;
            }
            case 'editTask': {
                if (!this._currentPlan) { break; }
                const t = findTaskById(this._currentPlan.tasks, msg.taskId);
                if (t) {
                    if (msg.title !== undefined) { t.title = msg.title; }
                    if (msg.description !== undefined) { t.description = msg.description; }
                    if (msg.requiresReview !== undefined) { t.requiresReview = msg.requiresReview; }
                    t.updatedAt = Date.now();
                    this._sendPlanUpdate();
                }
                break;
            }
            case 'deleteTask': {
                if (!this._currentPlan) { break; }
                this._currentPlan.tasks = this._currentPlan.tasks.filter(t => t.id !== msg.taskId);
                for (const t of this._currentPlan.tasks) {
                    t.subtasks = t.subtasks.filter(s => s.id !== msg.taskId);
                }
                this._currentPlan.tasks.forEach((t, i) => t.order = i);
                this._sendPlanUpdate();
                break;
            }
            case 'reorderTask': {
                if (!this._currentPlan) { break; }
                const idx = this._currentPlan.tasks.findIndex(t => t.id === msg.taskId);
                if (idx >= 0) {
                    const [removed] = this._currentPlan.tasks.splice(idx, 1);
                    const newIdx = Math.min(msg.newOrder, this._currentPlan.tasks.length);
                    this._currentPlan.tasks.splice(newIdx, 0, removed);
                    this._currentPlan.tasks.forEach((t, i) => t.order = i);
                    this._sendPlanUpdate();
                }
                break;
            }
            case 'moveTask': {
                if (!this._currentPlan) { break; }
                const moveTask = findTaskById(this._currentPlan.tasks, msg.taskId);
                if (moveTask) {
                    const newStatus = msg.newStatus as PlanTaskStatus;
                    // Enforce single in-progress: if moving to in-progress, reset others
                    if (newStatus === 'in-progress') {
                        for (const t of this._currentPlan.tasks) {
                            if (t.id !== msg.taskId && t.status === 'in-progress') {
                                t.status = 'pending';
                                t.updatedAt = Date.now();
                            }
                        }
                    }
                    moveTask.status = newStatus;
                    moveTask.updatedAt = Date.now();
                    // Update active task tracking
                    if (newStatus === 'in-progress') {
                        this._currentPlan.activeTaskId = moveTask.id;
                    } else if (this._currentPlan.activeTaskId === moveTask.id) {
                        this._currentPlan.activeTaskId = null;
                    }
                    // Handle reorder: remove and re-insert at the new position
                    const moveIdx = this._currentPlan.tasks.findIndex(t => t.id === msg.taskId);
                    if (moveIdx >= 0 && msg.newOrder !== undefined) {
                        const [movedTask] = this._currentPlan.tasks.splice(moveIdx, 1);
                        // Calculate insertion point among tasks with the same status
                        const sameTasks = this._currentPlan.tasks.filter(t => t.status === newStatus);
                        const targetIdx = msg.newOrder < sameTasks.length 
                            ? this._currentPlan.tasks.indexOf(sameTasks[msg.newOrder])
                            : (sameTasks.length > 0 
                                ? this._currentPlan.tasks.indexOf(sameTasks[sameTasks.length - 1]) + 1 
                                : this._currentPlan.tasks.length);
                        this._currentPlan.tasks.splice(targetIdx, 0, movedTask);
                        this._currentPlan.tasks.forEach((t, i) => t.order = i);
                    }
                    this._sendPlanUpdate();

                    // Auto-advance: when a task is manually moved to 'completed' during
                    // execution with autoAdvance, pick up the next pending task automatically
                    if (newStatus === 'completed' && this._planExecuting && this._currentPlan.autoAdvance) {
                        const nextTask = getNextPendingTask(this._currentPlan.tasks);
                        if (nextTask) {
                            nextTask.status = 'in-progress';
                            nextTask.updatedAt = Date.now();
                            this._currentPlan.activeTaskId = nextTask.id;
                            this._sendPlanUpdate();
                            if (this._enqueueTaskPrompt) {
                                this._enqueueTaskPrompt(this._formatTaskPrompt(nextTask));
                            }
                        } else {
                            // All tasks done
                            this._planExecuting = false;
                            this._currentPlan.activeTaskId = null;
                            this._sendPlanUpdate();
                        }
                    }
                }
                break;
            }
            case 'startExecution': {
                if (!this._currentPlan) { break; }
                this._planExecuting = true;
                // Check if there's already a task in-progress — continue with it
                let activeTask: PlanTask | undefined = this._currentPlan.tasks.find(t => t.status === 'in-progress');
                if (!activeTask) {
                    // No in-progress task — pick the first pending one
                    activeTask = getNextPendingTask(this._currentPlan.tasks) ?? undefined;
                    if (activeTask) {
                        activeTask.status = 'in-progress';
                        activeTask.updatedAt = Date.now();
                    }
                }
                if (activeTask) {
                    this._currentPlan.activeTaskId = activeTask.id;
                    this._sendPlanUpdate();
                    // Push task into queue
                    if (this._enqueueTaskPrompt) {
                        this._enqueueTaskPrompt(this._formatTaskPrompt(activeTask));
                    }
                } else {
                    vscode.window.showInformationMessage('No pending tasks to execute.');
                    this._planExecuting = false;
                }
                break;
            }
            case 'pauseExecution': {
                this._planExecuting = false;
                this._sendPlanUpdate();
                break;
            }
            case 'toggleAutoAdvance': {
                if (this._currentPlan) {
                    this._currentPlan.autoAdvance = msg.enabled;
                    this._sendPlanUpdate();
                }
                break;
            }
            case 'reviewApprove': {
                if (!this._currentPlan) { break; }
                const task = findTaskById(this._currentPlan.tasks, msg.taskId);
                if (task) { task.status = 'completed'; task.updatedAt = Date.now(); }
                const resolver = this._pendingReviewResolvers.get(msg.taskId);
                if (resolver) {
                    const nextTask = getNextPendingTask(this._currentPlan.tasks);
                    if (nextTask && this._planExecuting) {
                        nextTask.status = 'in-progress';
                        nextTask.updatedAt = Date.now();
                        this._currentPlan.activeTaskId = nextTask.id;
                        resolver(this._formatTaskPrompt(nextTask));
                    } else {
                        resolver('Task approved. No more tasks in the plan.');
                    }
                    this._pendingReviewResolvers.delete(msg.taskId);
                }
                this._sendPlanUpdate();
                break;
            }
            case 'reviewReject': {
                if (!this._currentPlan) { break; }
                const t2 = findTaskById(this._currentPlan.tasks, msg.taskId);
                if (t2) { t2.status = 'in-progress'; t2.updatedAt = Date.now(); }
                const res = this._pendingReviewResolvers.get(msg.taskId);
                if (res) {
                    res(`Task "${t2?.title}" needs revision. Feedback: ${msg.feedback}\n\n[taskId: ${msg.taskId}]`);
                    this._pendingReviewResolvers.delete(msg.taskId);
                }
                this._sendPlanUpdate();
                break;
            }
            case 'splitTask': {
                this._splitTask(msg.taskId);
                break;
            }
            case 'acceptSplit': {
                if (!this._currentPlan) { break; }
                const parent = findTaskById(this._currentPlan.tasks, msg.taskId);
                if (parent) {
                    parent.subtasks = (msg.subtasks as Array<{ title: string; description: string }>).map((s, i) =>
                        createTask(s.title, s.description, i, false, msg.taskId)
                    );
                    parent.updatedAt = Date.now();
                    this._sendPlanUpdate();
                }
                break;
            }
            case 'renamePlan': {
                if (this._currentPlan) {
                    this._currentPlan.name = msg.name;
                    this._sendPlanUpdate();
                }
                break;
            }
            case 'ready': {
                this._sendPlanUpdate();
                break;
            }
        }
    }

    private async _splitTask(taskId: string): Promise<void> {
        if (!this._currentPlan) { return; }
        const task = findTaskById(this._currentPlan.tasks, taskId);
        if (!task) { return; }

        try {
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4o-mini' });
            const model = models[0];
            if (!model) {
                vscode.window.showWarningMessage('No language model available for task splitting.');
                return;
            }

            const systemPrompt = `You are a task planner. Given a software development task, break it into 3-7 concrete subtasks. Return ONLY a JSON array: [{"title": "...", "description": "..."}]`;
            const userPrompt = `Split this task:\nTitle: ${task.title}\nDescription: ${task.description}`;
            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(userPrompt)
            ];

            const response = await model.sendRequest(messages);
            let fullResponse = '';
            for await (const chunk of response.text) { fullResponse += chunk; }

            const jsonMatch = fullResponse.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const subtasks = JSON.parse(jsonMatch[0]);
                this._panel?.webview.postMessage({ type: 'splitPreview', taskId, subtasks });
            } else {
                vscode.window.showWarningMessage('Could not parse subtasks. Try again or add manually.');
            }
        } catch (err) {
            console.error('[AskAway Plan] Split error:', err);
            vscode.window.showErrorMessage('Failed to split task.');
        }
    }

    // ── Persistence ──

    private _getStoragePath(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const dir = path.join(folders[0].uri.fsPath, '.askaway');
            if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
            return dir;
        }
        return undefined;
    }

    private _savePlanToDisk(): void {
        if (!this._currentPlan) { return; }
        const dir = this._getStoragePath();
        if (!dir) { return; }
        try {
            fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(this._currentPlan, null, 2));
        } catch (err) {
            console.error('[AskAway Plan] Save error:', err);
        }
    }

    private _loadPlanFromDisk(): void {
        const dir = this._getStoragePath();
        if (!dir) { return; }
        const planPath = path.join(dir, 'plan.json');
        try {
            if (fs.existsSync(planPath)) {
                this._currentPlan = JSON.parse(fs.readFileSync(planPath, 'utf-8')) as Plan;
            }
        } catch (err) {
            console.error('[AskAway Plan] Load error:', err);
        }
    }

    // ── HTML ──

    private _getHtml(webview: vscode.Webview): string {
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${codiconsUri}" rel="stylesheet">
    <title>Plan Board</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* Header */
        .board-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }
        .board-title-area {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .board-title {
            font-size: 16px;
            font-weight: 600;
            cursor: text;
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid transparent;
            outline: none;
        }
        .board-title:hover { border-color: var(--vscode-panel-border); }
        .board-title:focus { border-color: var(--vscode-focusBorder); }
        .board-title .codicon { font-size: 18px; color: var(--vscode-textLink-foreground); }
        .board-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .board-actions label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
        }
        .board-actions input[type="checkbox"] {
            accent-color: var(--vscode-textLink-foreground);
        }

        /* Progress */
        .board-progress {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 20px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }
        .progress-bar {
            flex: 1;
            height: 4px;
            background: var(--vscode-panel-border);
            border-radius: 2px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--vscode-textLink-foreground);
            border-radius: 2px;
            transition: width 0.4s ease;
        }
        .progress-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }

        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 12px;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-ghost {
            background: transparent;
            color: var(--vscode-descriptionForeground);
        }
        .btn-ghost:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }
        .btn-danger {
            background: transparent;
            color: var(--vscode-editorError-foreground, #f48771);
        }
        .btn-danger:hover {
            background: var(--vscode-editorError-foreground, #f48771);
            color: var(--vscode-editor-background);
        }

        /* Columns */
        .board-columns {
            display: flex;
            gap: 12px;
            padding: 16px 20px;
            flex: 1;
            overflow-x: auto;
            overflow-y: hidden;
        }
        .board-column {
            flex: 1;
            min-width: 220px;
            max-width: 400px;
            display: flex;
            flex-direction: column;
            background: var(--vscode-sideBar-background);
            border-radius: 8px;
            overflow: hidden;
        }
        .column-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .col-pending .column-header { color: var(--vscode-descriptionForeground); }
        .col-active .column-header { color: var(--vscode-charts-yellow, #e2c541); }
        .col-done .column-header { color: var(--vscode-charts-green, #89d185); }
        .column-count {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 1px 7px;
            border-radius: 10px;
            font-size: 11px;
        }
        .card-list {
            flex: 1;
            overflow-y: auto;
            padding: 4px 8px 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-height: 60px;
        }
        .card-list.drag-over {
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }

        /* Cards */
        .task-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px 12px;
            cursor: grab;
            transition: all 0.15s;
            position: relative;
        }
        .task-card:hover {
            border-color: var(--vscode-textLink-foreground);
            box-shadow: 0 2px 6px rgba(0,0,0,0.12);
        }
        .task-card.active {
            border-color: var(--vscode-charts-yellow, #e2c541);
            border-width: 2px;
            padding: 9px 11px;
            animation: cardPulse 2s ease-in-out infinite;
        }
        @keyframes cardPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(226, 197, 65, 0.3); }
            50% { box-shadow: 0 0 0 4px rgba(226, 197, 65, 0.1); }
        }
        .task-card.dragging { opacity: 0.5; cursor: grabbing; }
        .task-card[data-status="need-review"] { border-style: dashed; border-color: var(--vscode-textLink-foreground); }
        .task-card[data-status="blocked"] { border-style: dashed; border-color: var(--vscode-editorWarning-foreground, #cca700); }
        .card-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
            word-break: break-word;
        }
        .card-title input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-focusBorder);
            border-radius: 3px;
            padding: 3px 6px;
            font-size: 13px;
            font-weight: 600;
            font-family: inherit;
            outline: none;
        }
        .card-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            margin-bottom: 6px;
            word-break: break-word;
        }
        .card-desc textarea {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-focusBorder);
            border-radius: 3px;
            padding: 4px 6px;
            font-size: 11px;
            font-family: inherit;
            resize: vertical;
            min-height: 40px;
            outline: none;
        }
        .card-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
        }
        .card-badges { display: flex; gap: 4px; flex-wrap: wrap; }
        .badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            gap: 3px;
        }
        .badge-review { background: rgba(0,120,212,0.15); color: var(--vscode-textLink-foreground); }
        .badge-blocked { background: rgba(255,200,0,0.15); color: var(--vscode-editorWarning-foreground, #cca700); }
        .badge-subtasks { background: var(--vscode-editor-background); color: var(--vscode-descriptionForeground); }
        .badge-review-needed { background: rgba(0,120,212,0.15); color: var(--vscode-textLink-foreground); }
        .card-actions {
            display: flex;
            gap: 2px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .task-card:hover .card-actions { opacity: 1; }
        .card-action {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 3px;
            border-radius: 3px;
            display: flex;
        }
        .card-action:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }
        .card-note {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        /* Review actions on card */
        .review-actions {
            display: flex;
            gap: 4px;
            margin-top: 6px;
        }
        .review-actions .btn { font-size: 11px; padding: 3px 8px; }

        /* Inline add task */
        .add-task-inline {
            padding: 4px 8px 8px;
        }
        .add-task-input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 7px 10px;
            font-size: 12px;
            font-family: inherit;
            outline: none;
        }
        .add-task-input:focus { border-color: var(--vscode-focusBorder); }
        .add-task-input::placeholder { color: var(--vscode-input-placeholderForeground); }

        /* Empty state */
        .card-list:empty::after {
            content: 'No tasks';
            display: block;
            text-align: center;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 16px 0;
            opacity: 0.5;
        }

        /* Edit overlay */
        .edit-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
        }
        .edit-panel {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            width: 420px;
            max-width: 90vw;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .edit-panel h3 {
            font-size: 14px;
            font-weight: 600;
        }
        .edit-panel input, .edit-panel textarea {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 12px;
            font-family: inherit;
            outline: none;
            box-sizing: border-box;
        }
        .edit-panel input:focus, .edit-panel textarea:focus { border-color: var(--vscode-focusBorder); }
        .edit-panel textarea { resize: vertical; min-height: 80px; }
        .edit-panel label {
            display: flex; align-items: center; gap: 6px;
            font-size: 12px; color: var(--vscode-descriptionForeground); cursor: pointer;
        }
        .edit-panel .edit-actions { display: flex; gap: 8px; justify-content: flex-end; }

        /* Split preview */
        .split-preview {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin: 8px 0;
        }
        .split-preview h4 { font-size: 12px; margin-bottom: 8px; }
        .split-item {
            padding: 6px 8px;
            border-left: 3px solid var(--vscode-textLink-foreground);
            margin-bottom: 6px;
            background: var(--vscode-sideBar-background);
            border-radius: 0 4px 4px 0;
            display: flex;
            align-items: flex-start;
            gap: 6px;
        }
        .split-item-content { flex: 1; min-width: 0; }
        .split-item-title { font-size: 12px; font-weight: 600; }
        .split-item-desc { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .split-item-remove {
            flex-shrink: 0;
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 2px;
            border-radius: 3px;
            opacity: 0.6;
        }
        .split-item-remove:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
        }
        .split-items-container { max-height: 300px; overflow-y: auto; }

        /* Card subtasks */
        .card-subtasks { margin-top: 6px; }
        .card-subtasks-toggle {
            font-size: 11px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            user-select: none;
        }
        .card-subtasks-toggle:hover { text-decoration: underline; }
        .card-subtasks-items {
            display: none;
            margin-top: 4px;
            padding-left: 4px;
        }
        .card-subtasks.expanded .card-subtasks-items { display: block; }
        .card-subtask-item {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 2px 0;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .card-subtask-item.completed {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .card-subtask-item .codicon { font-size: 10px; }

        /* Hidden */
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <!-- Header -->
    <div class="board-header">
        <div class="board-title-area">
            <span class="codicon codicon-project" style="font-size: 18px; color: var(--vscode-textLink-foreground);"></span>
            <span class="board-title" id="board-title" contenteditable="true">Planning Board</span>
        </div>
        <div class="board-actions">
            <label title="Auto-advance to next task when completed (no review)">
                <input type="checkbox" id="auto-advance" checked>
                <span>Auto-advance</span>
            </label>
            <button class="btn btn-primary" id="start-btn">
                <span class="codicon codicon-play"></span> Start
            </button>
            <button class="btn btn-secondary hidden" id="pause-btn">
                <span class="codicon codicon-debug-pause"></span> Pause
            </button>
        </div>
    </div>

    <!-- Progress -->
    <div class="board-progress">
        <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
        <span class="progress-text" id="progress-text">0 / 0 tasks</span>
    </div>

    <!-- Columns -->
    <div class="board-columns">
        <!-- Pending -->
        <div class="board-column col-pending">
            <div class="column-header">
                <span>Pending</span>
                <span class="column-count" id="count-pending">0</span>
            </div>
            <div class="card-list" id="list-pending" data-status="pending"></div>
            <div class="add-task-inline">
                <input type="text" class="add-task-input" id="add-task-input" placeholder="+ Add a task..." />
            </div>
        </div>
        <!-- In Progress / Active -->
        <div class="board-column col-active">
            <div class="column-header">
                <span>In Progress</span>
                <span class="column-count" id="count-active">0</span>
            </div>
            <div class="card-list" id="list-active" data-status="in-progress"></div>
        </div>
        <!-- Done -->
        <div class="board-column col-done">
            <div class="column-header">
                <span>Done</span>
                <span class="column-count" id="count-done">0</span>
            </div>
            <div class="card-list" id="list-done" data-status="completed"></div>
        </div>
    </div>

    <!-- Edit Overlay (hidden by default) -->
    <div class="edit-overlay hidden" id="edit-overlay">
        <div class="edit-panel">
            <h3 id="edit-panel-title">Edit Task</h3>
            <input type="text" id="edit-title" placeholder="Task title" />
            <textarea id="edit-desc" placeholder="Description / instructions for Copilot" rows="4"></textarea>
            <label>
                <input type="checkbox" id="edit-review">
                <span>Require user review before auto-advancing</span>
            </label>
            <div id="edit-split-area"></div>
            <div class="edit-actions">
                <button class="btn btn-ghost" id="edit-split-btn">
                    <span class="codicon codicon-split-horizontal"></span> AI Split
                </button>
                <div style="flex:1"></div>
                <button class="btn btn-danger" id="edit-delete-btn">
                    <span class="codicon codicon-trash"></span> Delete
                </button>
                <button class="btn btn-secondary" id="edit-cancel-btn">Cancel</button>
                <button class="btn btn-primary" id="edit-save-btn">Save</button>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
    (function() {
        const vscode = acquireVsCodeApi();
        let plan = null;
        let executing = false;
        let editingTaskId = null;

        // ── DOM ──
        const boardTitle = document.getElementById('board-title');
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const autoAdvanceCb = document.getElementById('auto-advance');
        const addTaskInput = document.getElementById('add-task-input');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const listPending = document.getElementById('list-pending');
        const listActive = document.getElementById('list-active');
        const listDone = document.getElementById('list-done');
        const countPending = document.getElementById('count-pending');
        const countActive = document.getElementById('count-active');
        const countDone = document.getElementById('count-done');
        const editOverlay = document.getElementById('edit-overlay');
        const editTitle = document.getElementById('edit-title');
        const editDesc = document.getElementById('edit-desc');
        const editReview = document.getElementById('edit-review');
        const editSaveBtn = document.getElementById('edit-save-btn');
        const editCancelBtn = document.getElementById('edit-cancel-btn');
        const editDeleteBtn = document.getElementById('edit-delete-btn');
        const editSplitBtn = document.getElementById('edit-split-btn');
        const editSplitArea = document.getElementById('edit-split-area');

        // ── Events ──
        addTaskInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                var title = addTaskInput.value.trim();
                if (title) {
                    vscode.postMessage({ type: 'addTask', title: title, description: '' });
                    addTaskInput.value = '';
                }
            }
        });

        startBtn.addEventListener('click', function() { vscode.postMessage({ type: 'startExecution' }); });
        pauseBtn.addEventListener('click', function() { vscode.postMessage({ type: 'pauseExecution' }); });
        autoAdvanceCb.addEventListener('change', function() {
            vscode.postMessage({ type: 'toggleAutoAdvance', enabled: autoAdvanceCb.checked });
        });

        boardTitle.addEventListener('blur', function() {
            vscode.postMessage({ type: 'renamePlan', name: boardTitle.textContent.trim() || 'Planning Board' });
        });
        boardTitle.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); boardTitle.blur(); }
        });

        // Edit panel
        editSaveBtn.addEventListener('click', function() {
            if (!editingTaskId) return;
            vscode.postMessage({
                type: 'editTask',
                taskId: editingTaskId,
                title: editTitle.value.trim(),
                description: editDesc.value.trim(),
                requiresReview: editReview.checked
            });
            closeEditPanel();
        });
        editCancelBtn.addEventListener('click', closeEditPanel);
        editDeleteBtn.addEventListener('click', function() {
            if (!editingTaskId) return;
            vscode.postMessage({ type: 'deleteTask', taskId: editingTaskId });
            closeEditPanel();
        });
        editSplitBtn.addEventListener('click', function() {
            if (!editingTaskId) return;
            // Save first
            vscode.postMessage({
                type: 'editTask',
                taskId: editingTaskId,
                title: editTitle.value.trim(),
                description: editDesc.value.trim(),
                requiresReview: editReview.checked
            });
            vscode.postMessage({ type: 'splitTask', taskId: editingTaskId });
        });
        editOverlay.addEventListener('click', function(e) {
            if (e.target === editOverlay) closeEditPanel();
        });

        function closeEditPanel() {
            editOverlay.classList.add('hidden');
            editingTaskId = null;
            editSplitArea.innerHTML = '';
        }

        function openEditPanel(task) {
            editingTaskId = task.id;
            editTitle.value = task.title;
            editDesc.value = task.description || '';
            editReview.checked = task.requiresReview || false;
            editSplitArea.innerHTML = '';
            document.getElementById('edit-panel-title').textContent = 'Edit Task';
            editOverlay.classList.remove('hidden');
            editTitle.focus();
        }

        // Drag and drop
        [listPending, listActive, listDone].forEach(function(list) {
            list.addEventListener('dragover', function(e) {
                e.preventDefault();
                list.classList.add('drag-over');
            });
            list.addEventListener('dragleave', function() {
                list.classList.remove('drag-over');
            });
            list.addEventListener('drop', function(e) {
                e.preventDefault();
                list.classList.remove('drag-over');
                var taskId = e.dataTransfer.getData('text/plain');
                if (!taskId) return;
                var targetStatus = list.getAttribute('data-status');
                var cards = list.querySelectorAll('.task-card');
                var newOrder = cards.length;
                for (var i = 0; i < cards.length; i++) {
                    var rect = cards[i].getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) { newOrder = i; break; }
                }
                vscode.postMessage({ type: 'moveTask', taskId: taskId, newStatus: targetStatus, newOrder: newOrder });
            });
        });

        // ── Messages ──
        window.addEventListener('message', function(event) {
            var msg = event.data;
            switch (msg.type) {
                case 'updatePlan':
                    plan = msg.plan;
                    executing = msg.executing || false;
                    render();
                    break;
                case 'splitPreview':
                    showSplitPreview(msg.taskId, msg.subtasks);
                    break;
            }
        });

        // Notify ready
        vscode.postMessage({ type: 'ready' });

        // ── Render ──
        function render() {
            if (!plan) return;

            boardTitle.textContent = plan.name || 'Planning Board';
            autoAdvanceCb.checked = plan.autoAdvance !== false;
            startBtn.classList.toggle('hidden', executing);
            pauseBtn.classList.toggle('hidden', !executing);

            var pending = plan.tasks.filter(function(t) { return t.status === 'pending'; });
            var active = plan.tasks.filter(function(t) { return t.status === 'in-progress' || t.status === 'blocked' || t.status === 'need-review'; });
            var done = plan.tasks.filter(function(t) { return t.status === 'completed'; });

            renderColumn(listPending, pending);
            renderColumn(listActive, active);
            renderColumn(listDone, done);

            countPending.textContent = pending.length;
            countActive.textContent = active.length;
            countDone.textContent = done.length;

            var total = plan.tasks.length;
            var pct = total > 0 ? (done.length / total * 100) : 0;
            progressFill.style.width = pct + '%';
            progressText.textContent = done.length + ' / ' + total + ' tasks';
        }

        function renderColumn(container, tasks) {
            container.innerHTML = '';
            tasks.sort(function(a, b) { return a.order - b.order; });
            tasks.forEach(function(task) {
                container.appendChild(createCard(task));
            });
        }

        function createCard(task) {
            var card = document.createElement('div');
            card.className = 'task-card';
            card.setAttribute('data-status', task.status);
            card.setAttribute('draggable', 'true');

            if (plan && task.id === plan.activeTaskId) card.classList.add('active');

            // Title
            var title = document.createElement('div');
            title.className = 'card-title';
            title.textContent = task.title;
            card.appendChild(title);

            // Description (truncated)
            if (task.description) {
                var desc = document.createElement('div');
                desc.className = 'card-desc';
                desc.textContent = task.description.length > 80 ? task.description.substring(0, 77) + '...' : task.description;
                card.appendChild(desc);
            }

            // Meta
            var meta = document.createElement('div');
            meta.className = 'card-meta';

            var badges = document.createElement('div');
            badges.className = 'card-badges';

            if (task.requiresReview) {
                badges.innerHTML += '<span class="badge badge-review"><span class="codicon codicon-eye"></span> Review</span>';
            }
            if (task.subtasks && task.subtasks.length > 0) {
                var done = task.subtasks.filter(function(s) { return s.status === 'completed'; }).length;
                badges.innerHTML += '<span class="badge badge-subtasks">' + done + '/' + task.subtasks.length + ' sub</span>';
            }
            if (task.status === 'blocked') {
                badges.innerHTML += '<span class="badge badge-blocked"><span class="codicon codicon-warning"></span> Blocked</span>';
            }
            if (task.status === 'need-review') {
                badges.innerHTML += '<span class="badge badge-review-needed"><span class="codicon codicon-checklist"></span> Review</span>';
            }
            meta.appendChild(badges);

            // Subtask list on card (expandable)
            if (task.subtasks && task.subtasks.length > 0) {
                var subtaskList = document.createElement('div');
                subtaskList.className = 'card-subtasks';
                var stToggle = document.createElement('div');
                stToggle.className = 'card-subtasks-toggle';
                var done = task.subtasks.filter(function(s) { return s.status === 'completed'; }).length;
                stToggle.innerHTML = '<span class="codicon codicon-chevron-right"></span> Subtasks (' + done + '/' + task.subtasks.length + ')';
                stToggle.addEventListener('click', function(e) {
                    e.stopPropagation();
                    subtaskList.classList.toggle('expanded');
                    var icon = stToggle.querySelector('.codicon');
                    if (subtaskList.classList.contains('expanded')) {
                        icon.className = 'codicon codicon-chevron-down';
                    } else {
                        icon.className = 'codicon codicon-chevron-right';
                    }
                });
                subtaskList.appendChild(stToggle);

                var stItems = document.createElement('div');
                stItems.className = 'card-subtasks-items';
                task.subtasks.forEach(function(st) {
                    var stItem = document.createElement('div');
                    stItem.className = 'card-subtask-item';
                    if (st.status === 'completed') stItem.classList.add('completed');
                    var icon = st.status === 'completed' ? 'check' : (st.status === 'in-progress' ? 'play' : 'circle-outline');
                    stItem.innerHTML = '<span class="codicon codicon-' + icon + '"></span> ' + escapeHtml(st.title);
                    stItems.appendChild(stItem);
                });
                subtaskList.appendChild(stItems);
                card.appendChild(subtaskList);
            }

            // Actions
            var actions = document.createElement('div');
            actions.className = 'card-actions';

            if (task.status !== 'completed') {
                var editBtn = document.createElement('button');
                editBtn.className = 'card-action';
                editBtn.title = 'Edit';
                editBtn.innerHTML = '<span class="codicon codicon-edit"></span>';
                editBtn.addEventListener('click', function(e) { e.stopPropagation(); openEditPanel(task); });
                actions.appendChild(editBtn);
            }
            meta.appendChild(actions);
            card.appendChild(meta);

            // Review actions
            if (task.status === 'need-review') {
                var reviewDiv = document.createElement('div');
                reviewDiv.className = 'review-actions';
                var approveBtn = document.createElement('button');
                approveBtn.className = 'btn btn-primary';
                approveBtn.innerHTML = '<span class="codicon codicon-check"></span> Approve';
                approveBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    vscode.postMessage({ type: 'reviewApprove', taskId: task.id });
                });
                var rejectBtn = document.createElement('button');
                rejectBtn.className = 'btn btn-danger';
                rejectBtn.innerHTML = '<span class="codicon codicon-close"></span> Revise';
                rejectBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var fb = prompt('Feedback for revision:');
                    if (fb && fb.trim()) {
                        vscode.postMessage({ type: 'reviewReject', taskId: task.id, feedback: fb.trim() });
                    }
                });
                reviewDiv.appendChild(approveBtn);
                reviewDiv.appendChild(rejectBtn);
                card.appendChild(reviewDiv);
            }

            // Completion note
            if (task.completionNote && (task.status === 'completed' || task.status === 'need-review')) {
                var note = document.createElement('div');
                note.className = 'card-note';
                note.textContent = task.completionNote.substring(0, 120) + (task.completionNote.length > 120 ? '...' : '');
                card.appendChild(note);
            }

            // Drag
            card.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', task.id);
                card.classList.add('dragging');
            });
            card.addEventListener('dragend', function() { card.classList.remove('dragging'); });

            // Click to edit
            card.addEventListener('dblclick', function() {
                if (task.status !== 'completed') openEditPanel(task);
            });

            return card;
        }

        function showSplitPreview(taskId, subtasks) {
            if (editingTaskId !== taskId) return;
            editSplitArea.innerHTML = '';
            // Keep a mutable copy so user can delete individual items
            var currentSubtasks = subtasks.slice();
            var preview = document.createElement('div');
            preview.className = 'split-preview';
            var h4 = document.createElement('h4');
            h4.textContent = 'Proposed Subtasks (' + currentSubtasks.length + ')';
            preview.appendChild(h4);

            var itemsContainer = document.createElement('div');
            itemsContainer.className = 'split-items-container';

            function renderItems() {
                itemsContainer.innerHTML = '';
                h4.textContent = 'Proposed Subtasks (' + currentSubtasks.length + ')';
                acceptBtn.disabled = currentSubtasks.length === 0;
                currentSubtasks.forEach(function(s, idx) {
                    var item = document.createElement('div');
                    item.className = 'split-item';
                    var itemContent = document.createElement('div');
                    itemContent.className = 'split-item-content';
                    itemContent.innerHTML = '<div class="split-item-title">' + escapeHtml(s.title) + '</div>' +
                        '<div class="split-item-desc">' + escapeHtml(s.description) + '</div>';
                    item.appendChild(itemContent);

                    var removeBtn = document.createElement('button');
                    removeBtn.className = 'split-item-remove';
                    removeBtn.title = 'Remove this subtask';
                    removeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
                    removeBtn.setAttribute('data-index', String(idx));
                    removeBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var removeIdx = parseInt(this.getAttribute('data-index'));
                        currentSubtasks.splice(removeIdx, 1);
                        renderItems();
                    });
                    item.appendChild(removeBtn);
                    itemsContainer.appendChild(item);
                });
                if (currentSubtasks.length === 0) {
                    var empty = document.createElement('div');
                    empty.style.cssText = 'padding:12px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
                    empty.textContent = 'All subtasks removed. Discard or re-split.';
                    itemsContainer.appendChild(empty);
                }
            }

            preview.appendChild(itemsContainer);

            var actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end;';
            var acceptBtn = document.createElement('button');
            acceptBtn.className = 'btn btn-primary';
            acceptBtn.textContent = 'Accept Split';
            acceptBtn.addEventListener('click', function() {
                if (currentSubtasks.length === 0) return;
                vscode.postMessage({ type: 'acceptSplit', taskId: taskId, subtasks: currentSubtasks });
                editSplitArea.innerHTML = '';
            });
            var rejectBtn2 = document.createElement('button');
            rejectBtn2.className = 'btn btn-secondary';
            rejectBtn2.textContent = 'Discard';
            rejectBtn2.addEventListener('click', function() { editSplitArea.innerHTML = ''; });
            actions.appendChild(rejectBtn2);
            actions.appendChild(acceptBtn);
            preview.appendChild(actions);

            renderItems();
            editSplitArea.appendChild(preview);
        }

        function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    })();
    </script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    dispose(): void {
        this._panel?.dispose();
        this._disposables.forEach(d => d.dispose());
        this._onPlanChanged.dispose();
    }
}
