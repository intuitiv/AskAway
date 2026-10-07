import * as fs from 'fs';
import * as path from 'path';

export type WorkerTier = 'light' | 'mid' | 'heavy';
export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface WorkerProfile {
    name: string;
    description: string;
    tier: WorkerTier;
    model: string;
    thinking: string;
    models: string[];
    thinkingOptions: string[];
    edit: PermissionAction;
    bash: PermissionAction;
    webfetch: PermissionAction;
    mcp: string[];
    skills: string[];
    steps: number;
    prompt: string;
    source: string;
}

export interface WorkerSelection {
    model?: string;
    thinking?: string;
}

export type SelectionResult =
    | { status: 'SELECTED'; profile: string; model: string; thinking: string }
    | { status: 'SELECTION_UNAVAILABLE'; profile: string; reason: string };

const TIERS: WorkerTier[] = ['light', 'mid', 'heavy'];
const ACTIONS: PermissionAction[] = ['allow', 'ask', 'deny'];

function parseValue(raw: string): string | string[] {
    const value = raw.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
        return value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    }
    return unquote(value);
}

function unquote(raw: string): string {
    const value = raw.trim();
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function asList(value: string | string[] | undefined): string[] {
    if (value === undefined) { return []; }
    return Array.isArray(value) ? value : [value];
}

function asAction(value: string | string[] | undefined, fallback: PermissionAction): PermissionAction {
    return typeof value === 'string' && ACTIONS.includes(value as PermissionAction) ? value as PermissionAction : fallback;
}

/** Parses one portable worker profile. Throws when a required field is missing or inconsistent. */
export function parseWorkerProfile(markdown: string, source = ''): WorkerProfile {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!match) { throw new Error(`${source}: missing frontmatter`); }
    const fields: Record<string, string | string[]> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (kv) { fields[kv[1]] = parseValue(kv[2]); }
    }
    const name = typeof fields.name === 'string' ? fields.name : '';
    const tier = fields.tier as WorkerTier;
    const model = typeof fields.model === 'string' ? fields.model : '';
    const thinking = typeof fields.thinking === 'string' ? fields.thinking : '';
    const models = asList(fields.models);
    const thinkingOptions = asList(fields.thinkingOptions);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) { throw new Error(`${source}: invalid name "${name}"`); }
    if (!TIERS.includes(tier)) { throw new Error(`${source}: invalid tier "${String(fields.tier)}"`); }
    if (!models.includes(model)) { throw new Error(`${source}: default model "${model}" is not in models`); }
    if (!thinkingOptions.includes(thinking)) { throw new Error(`${source}: default thinking "${thinking}" is not in thinkingOptions`); }
    return {
        name,
        description: typeof fields.description === 'string' ? fields.description : '',
        tier,
        model,
        thinking,
        models,
        thinkingOptions,
        edit: asAction(fields.edit, 'deny'),
        bash: asAction(fields.bash, 'ask'),
        webfetch: asAction(fields.webfetch, 'deny'),
        mcp: asList(fields.mcp),
        skills: asList(fields.skills),
        steps: Number(fields.steps) > 0 ? Number(fields.steps) : 40,
        prompt: match[2].trim(),
        source,
    };
}

/** Loads every `*.md` profile in a directory. A malformed profile fails loudly rather than being skipped. */
export function loadWorkerProfiles(dir: string): WorkerProfile[] {
    return fs.readdirSync(dir)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => parseWorkerProfile(fs.readFileSync(path.join(dir, file), 'utf8'), path.join(dir, file)));
}

/** Selection-time refresh for file-backed profiles; in-memory fixture profiles stay unchanged. */
export function workerProfileRefresh(profiles: WorkerProfile[]): () => WorkerProfile[] | undefined {
    const dirs = [...new Set(profiles.filter(p => p.source).map(p => path.dirname(p.source)))];
    const signature = () => dirs.map(dir => fs.readdirSync(dir).filter(file => file.endsWith('.md')).sort()
        .map(file => {
            const stat = fs.statSync(path.join(dir, file));
            return `${dir}/${file}:${stat.mtimeMs}:${stat.size}`;
        }).join('|')).join('|');
    let previous = signature();
    return () => {
        const current = signature();
        if (current === previous) { return undefined; }
        const refreshed = [...profiles.filter(p => !p.source), ...dirs.flatMap(loadWorkerProfiles)];
        previous = current;
        return refreshed;
    };
}

/** Resolves the requested selection exactly. There is no fallback to another model or thinking level. */
export function resolveSelection(profile: WorkerProfile, request: WorkerSelection = {}): SelectionResult {
    const model = request.model ?? profile.model;
    const thinking = request.thinking ?? profile.thinking;
    if (!profile.models.includes(model)) {
        return { status: 'SELECTION_UNAVAILABLE', profile: profile.name, reason: `model ${model} is not allowed for ${profile.name}` };
    }
    if (!profile.thinkingOptions.includes(thinking)) {
        return { status: 'SELECTION_UNAVAILABLE', profile: profile.name, reason: `thinking ${thinking} is not allowed for ${profile.name}` };
    }
    return { status: 'SELECTED', profile: profile.name, model, thinking };
}

/**
 * Workers are isolated by canonical workspace path, so equal labels on different real paths never merge. Thinking is not
 * part of the key (reviewer, 2026-10-07): a reused worker keeps its own thinking so its session config and cache stay intact.
 */
export function workerRegistryKey(workspacePath: string, profileName: string, selection: { model: string; thinking?: string }): string {
    let canonical = workspacePath;
    try {
        canonical = fs.realpathSync(workspacePath);
    } catch {
        // A missing path keeps its literal value as identity.
    }
    return `${canonical}::${profileName}::${selection.model}`;
}

/** Emits the OpenCode primary-agent definition for a profile; `opencode run --agent` needs primary mode. */
export function toOpenCodeAgent(profile: WorkerProfile): string {
    // Only denies and scoped allows are emitted: an agent-level `bash: allow` would override global rm/sudo/push denies.
    const permission: string[] = [];
    // Workers never spawn OpenCode subagents: delegation belongs to the orchestrator through worker_* tools.
    permission.push('  task: deny');
    for (const [key, action] of [['edit', profile.edit], ['bash', profile.bash], ['webfetch', profile.webfetch]] as const) {
        if (action === 'deny') { permission.push(`  ${key}: deny`); }
    }
    if (profile.edit === 'allow') {
        // Without an explicit allow, edits fall back to the global "ask" and are auto-rejected in a headless run.
        permission.push('  edit:', '    "*": allow', '    "**": allow', '    "**/*.env": deny', '    "**/*.env.*": deny');
    }
    for (const pattern of profile.mcp) {
        permission.push(`  ${JSON.stringify(pattern)}: allow`);
    }
    if (profile.skills.length) {
        permission.push('  skill:', '    "*": deny', ...profile.skills.map((pattern) => `    ${JSON.stringify(pattern)}: allow`));
    }
    const lines = [
        '---',
        `description: ${JSON.stringify(profile.description)}`,
        'mode: primary',
        `model: ${profile.model}`,
        `steps: ${profile.steps}`,
        ...(permission.length ? ['permission:', ...permission] : []),
        '---',
        '',
        profile.prompt,
        '',
        TIER_GUIDANCE[profile.tier],
        '',
        WORKER_BASICS,
        '',
    ];
    return lines.join('\n');
}

// Worker runs are headless: an approval prompt is auto-rejected and ends the run, so the rules below keep work inside the allowlist.
const WORKER_BASICS = `## Worker basics (every AskAway worker)
- You run headless. Nobody can answer a question or an approval prompt: a command that needs approval is auto-rejected and ends your run.
- Prefix every shell command with \`rtk \` (e.g. \`rtk npm test\`, \`rtk ./gradlew :app:test\`). One command per call: no \`&&\`, \`|\`, \`;\` or redirects.
- Never \`git commit\`, \`git push\`, \`git reset\`, or delete files; the orchestrator owns git. Never read or print secrets or \`.env\` files.
- Stay inside the packet: its objective, allowed files, and verification command. Anything else goes under \`Not done:\` with the reason.
- A check that could not run is never a pass. Exit 0 with zero tests matched is FAIL.
- End with your mode's output, then exactly these three lines:
  \`Result: PASS | FAIL | BLOCKED\`
  \`Evidence: <exact command and observed line, or path:line>\`
  \`Not done: <items, or none>\``;

/** Guidance per tier, tuned to the model class that tier runs on (light: Luna 6; mid: Sol 6.1; heavy: Opus 5.5). */
const TIER_GUIDANCE: Record<WorkerTier, string> = {
    light: `## How to work (small, fast model)
- Follow your steps literally and in order. Do not improvise a different method.
- Keep to about 10 tool calls. Stop as soon as the packet's question is answered.
- Copy exact lines, paths, and numbers from tool output; never paraphrase or round them.
- If a step fails twice, stop and report BLOCKED with the exact error instead of trying alternatives.`,
    mid: `## How to work (strong model)
- Think before the first tool call: restate the objective and the check that will judge you.
- Do exactly the packet. No refactors, renames, formatting, or extras outside scope, even when tempting.
- Prefer the smallest correct change at the rule that owns the behaviour.
- Stop as soon as the verification passes; report, do not polish.`,
    heavy: `## How to work (top model, used for consequential decisions)
- Reason explicitly: name the alternatives you considered and why you rejected them.
- Prefer evidence over reasoning: reproduce, measure, or read the source before concluding.
- Keep the output short even when the reasoning was long.`,
};

/** Writes one OpenCode agent file per profile, named `aa-<profile>.md`. */
export function syncOpenCodeAgents(profiles: WorkerProfile[], agentsDir: string): string[] {
    fs.mkdirSync(agentsDir, { recursive: true });
    return profiles.map((profile) => {
        const file = path.join(agentsDir, `aa-${profile.name}.md`);
        fs.writeFileSync(file, toOpenCodeAgent(profile));
        return file;
    });
}
