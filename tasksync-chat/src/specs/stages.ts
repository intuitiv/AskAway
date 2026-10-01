/** Spec Kit stages in flow order; a stored stage is the last step completed (005 plan D-1). */
export const SPEC_STAGES = ['specify', 'clarify', 'plan', 'checklist', 'tasks', 'analyze', 'implement', 'converge'] as const;
export type SpecKitStage = typeof SPEC_STAGES[number];

export interface SpecArtifacts {
    spec: boolean;
    clarified: boolean;
    /** Count of `[NEEDS CLARIFICATION` markers still in spec.md. */
    openClarifications?: number;
    plan: boolean;
    checklists: boolean;
    tasks: boolean;
    tasksTotal: number;
    tasksDone: number;
}

export interface StageMismatch {
    stored: SpecKitStage;
    implied: SpecKitStage;
    reason: string;
}

const NEXT_STEP: Record<SpecKitStage, string> = {
    specify: '/sk.check (clarify)',
    clarify: '/sk.plan',
    plan: '/sk.check (checklist)',
    checklist: '/sk.tasks',
    tasks: '/sk.check (analyze)',
    analyze: '/sk.implement',
    implement: '/sk.check (converge)',
    converge: 'done'
};

const BUTTON: Record<SpecKitStage, string> = {
    specify: 'Plan',
    clarify: 'Plan',
    plan: 'Tasks',
    checklist: 'Tasks',
    tasks: 'Implement',
    analyze: 'Implement',
    implement: '',
    converge: ''
};

const REQUIRES: Record<SpecKitStage, keyof SpecArtifacts> = {
    specify: 'spec',
    clarify: 'spec',
    plan: 'plan',
    checklist: 'plan',
    tasks: 'tasks',
    analyze: 'tasks',
    implement: 'tasks',
    converge: 'tasks'
};

export function isSpecKitStage(value: unknown): value is SpecKitStage {
    return typeof value === 'string' && (SPEC_STAGES as readonly string[]).includes(value);
}

export function stageIndex(stage: SpecKitStage): number {
    return SPEC_STAGES.indexOf(stage);
}

function openTasks(a: SpecArtifacts): number {
    return Math.max(0, a.tasksTotal - a.tasksDone);
}

function hasOpenClarifications(a: SpecArtifacts): boolean {
    return (a.openClarifications ?? 0) > 0;
}

/** While spec.md has open clarification markers a pre-plan spec stays at `clarify`. */
export function effectiveStage(stage: SpecKitStage, a: SpecArtifacts): SpecKitStage {
    return hasOpenClarifications(a) && stageIndex(stage) <= stageIndex('clarify') ? 'clarify' : stage;
}

/** The step to suggest after `stage`; open tasks keep implementation going. */
export function nextStep(stage: SpecKitStage, artifacts: SpecArtifacts): string {
    if (stage === 'clarify' && hasOpenClarifications(artifacts)) { return '/sk.check'; }
    if ((stage === 'implement' || stage === 'converge') && openTasks(artifacts) > 0) { return '/sk.implement'; }
    return NEXT_STEP[stage];
}

/** Label of the stage action button; empty when only `/sk.check` applies. */
export function stageButton(stage: SpecKitStage, artifacts: SpecArtifacts): string {
    if (stage === 'clarify' && hasOpenClarifications(artifacts)) { return ''; }
    if ((stage === 'implement' || stage === 'converge') && openTasks(artifacts) > 0) { return 'Implement'; }
    return BUTTON[stage];
}

/** Stage implied by artifacts on disk; `analyze` and `converge` leave no artifact, so they are never implied. */
export function impliedStage(a: SpecArtifacts): SpecKitStage {
    if (a.tasks && a.tasksDone > 0) { return 'implement'; }
    if (a.tasks) { return 'tasks'; }
    if (a.plan && a.checklists) { return 'checklist'; }
    if (a.plan) { return 'plan'; }
    if (a.clarified || hasOpenClarifications(a)) { return 'clarify'; }
    return 'specify';
}

/** A stored stage is wrong when its artifact is missing or the artifacts are more than one step ahead of it. */
export function stageMismatch(stored: SpecKitStage, a: SpecArtifacts): StageMismatch | null {
    const implied = impliedStage(a);
    const required = REQUIRES[stored];
    if (!a[required]) {
        return { stored, implied, reason: `stored stage ${stored} needs ${required === 'spec' ? 'spec.md' : required === 'plan' ? 'plan.md' : 'tasks.md'}, which is missing` };
    }
    if (stageIndex(implied) > stageIndex(stored) + 1) {
        return { stored, implied, reason: `artifacts show ${implied}, stored stage is ${stored}` };
    }
    return null;
}
