/**
 * Plan Mode — Data model for the intelligent task orchestrator / planning board.
 * 
 * The planning board sits between the user (architect) and Copilot (executor):
 * - User drafts tasks and queues them
 * - Copilot picks tasks one-by-one, reports status via ask_user tool
 * - Orchestrator auto-advances or pauses for user review based on task config
 */

// ── Task Status ──

export type PlanTaskStatus = 
    | 'pending'         // Not yet started
    | 'in-progress'     // Copilot is currently working on this
    | 'completed'       // Done successfully
    | 'blocked'         // Copilot is stuck, needs user input
    | 'need-review';    // Copilot finished, but user must review before proceeding

// ── Single Task ──

export interface PlanTask {
    /** Unique task ID (e.g., "plan_001", "plan_001_sub_1") */
    id: string;

    /** Short title displayed on the card */
    title: string;

    /** Detailed description / instructions for Copilot */
    description: string;

    /** Current status */
    status: PlanTaskStatus;

    /** If true, user must review completion before moving to next task */
    requiresReview: boolean;

    /** Subtasks (auto-split by LLM or manually added) */
    subtasks: PlanTask[];

    /** Parent task ID (for subtasks) */
    parentId?: string;

    /** Copilot's completion summary (filled when status becomes completed/need-review) */
    completionNote?: string;

    /** Timestamp when task was created */
    createdAt: number;

    /** Timestamp when task was last updated */
    updatedAt: number;

    /** Order index for drag-drop reordering */
    order: number;
}

// ── Plan (collection of tasks) ──

export interface Plan {
    /** Unique plan ID */
    id: string;

    /** Plan name (user-defined) */
    name: string;

    /** All top-level tasks in order */
    tasks: PlanTask[];

    /** ID of the currently active task (being worked on by Copilot) */
    activeTaskId: string | null;

    /** Whether plan mode auto-advances to next task on completion */
    autoAdvance: boolean;

    /** Timestamp created */
    createdAt: number;

    /** Timestamp last updated */
    updatedAt: number;
}

// ── Tool call extensions for plan mode ──

/** Extended input for ask_user when used in plan mode */
export interface PlanAwareInput {
    question: string;
    taskId?: string;
    taskStatus?: PlanTaskStatus;
}

// ── Messages between webview and extension for plan mode ──

export type PlanToWebviewMessage =
    | { type: 'updatePlan'; plan: Plan | null }
    | { type: 'planTaskStatusChanged'; taskId: string; status: PlanTaskStatus; note?: string }
    | { type: 'planAutoAdvance'; taskId: string; nextTaskId: string };

export type PlanFromWebviewMessage =
    | { type: 'planAddTask'; title: string; description: string; requiresReview: boolean; afterTaskId?: string }
    | { type: 'planEditTask'; taskId: string; title: string; description: string; requiresReview: boolean }
    | { type: 'planDeleteTask'; taskId: string }
    | { type: 'planReorderTask'; taskId: string; newOrder: number }
    | { type: 'planSetMode'; enabled: boolean }
    | { type: 'planSplitTask'; taskId: string }
    | { type: 'planAcceptSplit'; taskId: string; subtasks: Array<{ title: string; description: string }> }
    | { type: 'planRejectSplit'; taskId: string }
    | { type: 'planReviewApprove'; taskId: string }
    | { type: 'planReviewReject'; taskId: string; feedback: string }
    | { type: 'planToggleAutoAdvance'; enabled: boolean }
    | { type: 'planStartExecution' }
    | { type: 'planPauseExecution' };

// ── Helper functions ──

/** Generate a unique plan task ID */
export function generateTaskId(parentId?: string): string {
    const base = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return parentId ? `${parentId}_sub_${Math.random().toString(36).substring(2, 7)}` : base;
}

/** Create a new empty task */
export function createTask(
    title: string,
    description: string,
    order: number,
    requiresReview: boolean = false,
    parentId?: string
): PlanTask {
    return {
        id: generateTaskId(parentId),
        title,
        description,
        status: 'pending',
        requiresReview,
        subtasks: [],
        parentId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        order
    };
}

/** Create a new empty plan */
export function createPlan(name: string): Plan {
    return {
        id: `plan_${Date.now()}`,
        name,
        tasks: [],
        activeTaskId: null,
        autoAdvance: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

/** Find a task by ID (searches subtasks recursively) */
export function findTaskById(tasks: PlanTask[], taskId: string): PlanTask | null {
    for (const task of tasks) {
        if (task.id === taskId) { return task; }
        const found = findTaskById(task.subtasks, taskId);
        if (found) { return found; }
    }
    return null;
}

/** Get the next pending task in order */
export function getNextPendingTask(tasks: PlanTask[]): PlanTask | null {
    // Sort by order, find first pending
    const sorted = [...tasks].sort((a, b) => a.order - b.order);
    for (const task of sorted) {
        if (task.status === 'pending') { return task; }
        // Check subtasks too
        if (task.subtasks.length > 0) {
            const subPending = getNextPendingTask(task.subtasks);
            if (subPending) { return subPending; }
        }
    }
    return null;
}

/** Count tasks by status */
export function countByStatus(tasks: PlanTask[]): Record<PlanTaskStatus, number> {
    const counts: Record<PlanTaskStatus, number> = {
        'pending': 0,
        'in-progress': 0,
        'completed': 0,
        'blocked': 0,
        'need-review': 0
    };
    for (const task of tasks) {
        counts[task.status]++;
        // Count subtasks too
        if (task.subtasks.length > 0) {
            const subCounts = countByStatus(task.subtasks);
            for (const status of Object.keys(subCounts) as PlanTaskStatus[]) {
                counts[status] += subCounts[status];
            }
        }
    }
    return counts;
}
