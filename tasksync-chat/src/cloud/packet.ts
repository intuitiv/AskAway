const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
    { kind: 'github-token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
    { kind: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: 'slack-token', pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
    { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
    { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

export function knownSecretValues(env: Record<string, string | undefined> = process.env): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(env)) {
        if (value && value.length >= 8 && /TOKEN|SECRET|KEY|PASSWORD/i.test(name)) { values.push(value); }
    }
    return values;
}

export function secretFindings(fields: Record<string, string>, known: string[] = []): Array<{ field: string; kind: string }> {
    const findings: Array<{ field: string; kind: string }> = [];
    const credentials = known.filter((value) => value.length >= 8);
    for (const [field, text] of Object.entries(fields)) {
        for (const { kind, pattern } of SECRET_PATTERNS) {
            if (pattern.test(text)) { findings.push({ field, kind }); }
        }
        if (credentials.some((value) => text.includes(value))) { findings.push({ field, kind: 'known-credential' }); }
    }
    return findings;
}

export interface PacketTask {
    taskId: string;
    stage: string;
    details: string;
    allowedPaths: string[];
    verify: string[];
    expect: string;
    ceilingMinutes?: number;
    stopCondition?: string;
}

export interface PacketStory {
    story: string;
    independentTest: string;
}

export interface PacketFacts {
    slug: string;
    attempt: number;
    base: string;
    knownValues?: string[];
}

export interface PacketReference {
    slug: string;
    taskId: string;
    story: string;
    stage: string;
    packetPath: string;
    packetSha: string;
    knownValues?: string[];
}

function refuseSecrets(fields: Record<string, string>, known: string[]): void {
    const finding = secretFindings(fields, known)[0];
    if (finding) { throw new Error(`secret detected in ${finding.field}`); }
}

export function buildPacket(task: PacketTask, story: PacketStory, facts: PacketFacts): { path: string; text: string } {
    if (!Number.isInteger(facts.attempt) || facts.attempt < 1) { throw new Error('attempt must start at 1'); }
    const ceilingMinutes = task.ceilingMinutes ?? 50;
    if (!Number.isInteger(ceilingMinutes) || ceilingMinutes < 1 || ceilingMinutes > 59) {
        throw new Error('ceilingMinutes must be between 1 and 59');
    }
    const stopCondition = task.stopCondition ?? 'Stop and ask on any undecided behaviour instead of guessing. Stop when verify passes.';
    const packetPath = `.askaway/specs/${facts.slug}/packets/${task.taskId}-${facts.attempt}.md`;
    const known = facts.knownValues ?? knownSecretValues();
    refuseSecrets({
        stage: task.stage, story: story.story, task: task.taskId, details: task.details,
        base: facts.base, allowedPaths: task.allowedPaths.join('\n'), verify: task.verify.join('\n'),
        expect: task.expect, stopCondition, independentTest: story.independentTest, packetPath,
    }, known);
    const scalar = (value: string) => JSON.stringify(value);
    const text = [
        '---', `stage: ${scalar(task.stage)}`, `story: ${scalar(story.story)}`, `task: ${scalar(task.taskId)}`,
        `draft: ${['specify', 'clarify', 'plan', 'tasks'].includes(task.stage)}`, `base: ${scalar(facts.base)}`,
        'allowedPaths:', ...task.allowedPaths.map(value => `  - ${scalar(value)}`),
        'verify:', ...task.verify.map(value => `  - ${scalar(value)}`),
        `expect: ${scalar(task.expect)}`, `ceilingMinutes: ${ceilingMinutes}`, `stopCondition: ${scalar(stopCondition)}`,
        'reportFormat: |', `  Report ${task.taskId}`, '  - Result: done | blocked', '  - Commits: <sha list>',
        '  - Verify output: <last line of each command>', '  - Model: <self-reported name, or not observed: reason>',
        '  - Question (if blocked): <one question>', '---', '', '## Task details', task.details, '',
        '## Story Independent Test', story.independentTest, '',
        '## Read before starting (committed artifacts, not repeated here)',
        `- specs/${facts.slug}/spec.md, plan.md (Decision Register), data-model.md, contracts/`,
        '- AGENTS.md, .github/copilot-instructions.md', '',
        '## Rules', `- Push commits to this PR's branch only; prefix each commit message with \`[${task.taskId}]\`.`,
        '- Never merge a PR; stop and ask rather than pass a human gate.',
        '- Change only `allowedPaths`. Do not change any `**Status**:` line.',
        '- Model: PR default (not independently observed); report model names are self-reported.', '',
    ].join('\n');
    refuseSecrets({ packet: text }, known);
    return { path: packetPath, text };
}

export function buildComment(ref: PacketReference): string {
    const known = ref.knownValues ?? knownSecretValues();
    refuseSecrets({ task: ref.taskId, story: ref.story, stage: ref.stage, slug: ref.slug,
        packetPath: ref.packetPath, packetSha: ref.packetSha }, known);
    const comment = [
        `@copilot Please do ${ref.taskId} (${ref.story}, stage ${ref.stage}) of ${ref.slug}: follow ${ref.packetPath} at ${ref.packetSha.slice(0, 7)}.`,
        "Work on this PR's branch only; stay inside allowedPaths; run the packet's verify commands.",
        "Stop and ask on anything undecided; reply using the packet's reportFormat.",
    ].join('\n');
    if (comment.split('\n').length > 5) { throw new Error('comment must be at most 5 lines'); }
    refuseSecrets({ comment }, known);
    return comment;
}
