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

/** Workers are isolated by canonical workspace path, so equal labels on different real paths never merge. */
export function workerRegistryKey(workspacePath: string, profileName: string, selection: { model: string; thinking: string }): string {
    let canonical = workspacePath;
    try {
        canonical = fs.realpathSync(workspacePath);
    } catch {
        // A missing path keeps its literal value as identity.
    }
    return `${canonical}::${profileName}::${selection.model}::${selection.thinking}`;
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
        permission.push('  edit:', '    "*": allow', '    "**/*.env": deny', '    "**/*.env.*": deny');
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
    ];
    return lines.join('\n');
}

/** Writes one OpenCode agent file per profile, named `aa-<profile>.md`. */
export function syncOpenCodeAgents(profiles: WorkerProfile[], agentsDir: string): string[] {
    fs.mkdirSync(agentsDir, { recursive: true });
    return profiles.map((profile) => {
        const file = path.join(agentsDir, `aa-${profile.name}.md`);
        fs.writeFileSync(file, toOpenCodeAgent(profile));
        return file;
    });
}
