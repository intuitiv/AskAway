import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Same text as src/agents/sharedVoice.ts (test-style-voice.cjs checks); inline so this module stays import-free for test harnesses.
export const SHARED_VOICE = `<!-- shared-voice:start -->
## Shared voice: writing to the reviewer or Validator
Lead with the result or the decision needed.
Use simple, clear sentences and plain words.
Keep each sentence short; give one point at a time.
Use short bullets only when there are several points.
Say what changed, what passed, and what still needs work.
Ask questions in at most 30 words, with one concrete example.
Correct spelling, but keep the direct, conversational tone.
No filler, formal greetings, sales language, or AI-sounding phrases.
Avoid "Certainly", "delve", "Great question", and "I hope this finds you well".
Use emoji sparingly; a thumbs-up can be enough for a simple acknowledgement.
Keep evidence and uncertainty; never invent facts or copy private details.
<!-- shared-voice:end -->`;

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
    /** Set when the model and thinking come from the Team member's own choice, so an agy model is honored. */
    selected?: boolean;}

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

/**
 * Every loaded profile: the extension's built-in ones plus the user's own (~/.askaway/worker-profiles), where a user
 * file of the same name wins. `source` says whether the extension ships that name (reviewer, 2026-10-16: devx and
 * authoring are his own profiles, never shipped). A missing directory contributes nothing.
 */
export function catalogWorkerProfiles(builtinDir: string, userDir: string): Array<WorkerProfile & { origin: 'builtin' | 'user' }> {
    const load = (dir: string) => fs.existsSync(dir) ? loadWorkerProfiles(dir) : [];
    const builtin = load(builtinDir);
    const shipped = new Set(builtin.map((profile) => profile.name));
    const byName = new Map(builtin.map((profile) => [profile.name, profile]));
    for (const profile of load(userDir)) { byName.set(profile.name, profile); }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
        .map((profile) => ({ ...profile, origin: shipped.has(profile.name) ? 'builtin' as const : 'user' as const }));
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

/** Interim default while agy is not fully working (reviewer, 2026-10-16: "Use Sol in between, till we make agy fully working."). */
export const INTERIM_DEFAULT_MODEL = 'github-copilot/gpt-6.1-sol';

/** The model a packet without an explicit model runs on: the profile default, except that agy is only ever chosen explicitly. */
export function defaultModel(profile: Pick<WorkerProfile, 'model'> & { selected?: boolean }): string {
    return !profile.selected && profile.model.startsWith('agy/') ? INTERIM_DEFAULT_MODEL : profile.model;
}

/** A profile running the model and thinking its Team member picked (a Team choice is allowed even when the file's lists do not name it). */
export function withSelection(profile: WorkerProfile, selection: { model?: string; thinking?: string } | undefined): WorkerProfile {
    if (!selection) { return profile; }
    const model = selection.model || profile.model;
    const thinking = selection.thinking || profile.thinking;
    return {
        ...profile, model, thinking, selected: true,
        models: profile.models.includes(model) ? profile.models : [...profile.models, model],
        thinkingOptions: profile.thinkingOptions.includes(thinking) ? profile.thinkingOptions : [...profile.thinkingOptions, thinking],
    };
}

/** Resolves the requested selection exactly. There is no fallback to another model or thinking level. */
export function resolveSelection(profile: WorkerProfile, request: WorkerSelection = {}): SelectionResult {
    const model = request.model ?? defaultModel(profile);
    const thinking = request.thinking ?? profile.thinking;
    // agy and claude are runtimes, not personas: every profile may run any of their models (`agy/<name>`, `claude/<name>`); the CLI rejects an unknown one.
    if (!profile.models.includes(model) && !/^(agy|claude)\/[a-z0-9][a-z0-9.-]*$/.test(model)) {
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
        `model: ${defaultModel(profile)}`,
        `steps: ${profile.steps}`,
        ...(permission.length ? ['permission:', ...permission] : []),
        '---',
        '',
        workerInstructions(profile),
        '',
    ];
    return lines.join('\n');
}

/** A profile's worker instructions (prompt, tier guidance, shared basics and voice); any runtime sends the same text. */
export function workerInstructions(profile: WorkerProfile): string {
    return [profile.prompt, '', TIER_GUIDANCE[profile.tier], '', WORKER_BASICS, SHARED_VOICE].join('\n');
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

let pluginFailureLogged = false;
/** The identity plugin only adds queued AITalk delivery: a failure to write it is logged once and never stops a worker from starting. */
function syncIdentityPlugin(pluginDir: string): void {
    try { (require('./openCodeIdentityPlugin') as typeof import('./openCodeIdentityPlugin')).syncOpenCodeIdentityPlugin(pluginDir); } catch (error) {
        if (!pluginFailureLogged) { pluginFailureLogged = true; console.warn('[AskAway] Could not write the OpenCode identity plugin; queued AITalk messages will not reach OpenCode workers:', (error as Error).message); }
    }
}

/** Writes one OpenCode agent file per profile, named `aa-<profile>.md`; with `pluginDir` it also writes the AskAway identity plugin there. */
export function syncOpenCodeAgents(profiles: WorkerProfile[], agentsDir: string, workspaceAgentsDir?: string, pluginDir?: string): string[] {
    fs.mkdirSync(agentsDir, { recursive: true });
    if (pluginDir) { syncIdentityPlugin(pluginDir); }
    const written = profiles.map((profile) => {
        const file = path.join(agentsDir, `aa-${profile.name}.md`);
        fs.writeFileSync(file, toOpenCodeAgent(profile) + '\n<!-- AskAway generated agent -->\n');
        return file;
    });
    if (workspaceAgentsDir && workspaceAgentsDir !== agentsDir && fs.existsSync(workspaceAgentsDir)) {
        for (const name of fs.readdirSync(workspaceAgentsDir)) {
            if (!/^aa-[a-z0-9-]+\.md$/.test(name)) continue;
            const file = path.join(workspaceAgentsDir, name);
            if (!fs.lstatSync(file).isFile()) continue;
            const text = fs.readFileSync(file, 'utf8');
            if (text.includes('<!-- AskAway generated agent -->') || text.includes('## Worker basics (every AskAway worker)')) fs.unlinkSync(file);
        }
    }
    return written;
}

export const AGY_MCP_RULE_FORMAT = 'mcp(askaway/<tool>)';
export const AGY_BASH_RULE = 'command(rtk)';

/** Maps a worker profile's MCP and bash policy to headless agy `permissions.allow` rules. */
export function toAgyPermissions(profile: Pick<WorkerProfile, 'mcp' | 'bash'>): string[] {
    const rules: string[] = [];
    for (const entry of profile.mcp ?? []) {
        if (!entry.startsWith('askaway_')) { continue; }
        const tool = entry.slice('askaway_'.length);
        if (!tool || /^(worker|commentary)(?:_|$)/.test(tool)) { continue; }
        const rule = AGY_MCP_RULE_FORMAT.replace('<tool>', tool);
        if (!rules.includes(rule)) { rules.push(rule); }
    }
    if (profile.bash && profile.bash !== 'deny' && !rules.includes(AGY_BASH_RULE)) {
        rules.push(AGY_BASH_RULE);
    }
    return rules;
}

/**
 * Merges the union of all profiles' agy permission rules into `permissions.allow` of agy's settings JSON idempotently,
 * keeps all other keys untouched, skips if the settings folder does not exist or the file is malformed, writes only when
 * changed, and returns whether it changed.
 */
export function syncAgyPermissions(
    profiles: WorkerProfile[],
    settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json'),
): boolean {
    if (!fs.existsSync(path.dirname(settingsPath))) {
        return false;
    }
    try {
        const existingText = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
        const parsedRaw = existingText.trim() ? JSON.parse(existingText) : {};
        if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
            throw new Error('settings root is not a JSON object');
        }
        const parsed = parsedRaw as Record<string, any>;
        const existingPermissions = parsed.permissions && typeof parsed.permissions === 'object' && !Array.isArray(parsed.permissions)
            ? parsed.permissions as Record<string, any> : {};
        const existingAllow = Array.isArray(existingPermissions.allow) ? existingPermissions.allow.map(String) : [];
        const allow = [...existingAllow];
        for (const profile of profiles) {
            for (const rule of toAgyPermissions(profile)) {
                if (!allow.includes(rule)) { allow.push(rule); }
            }
        }
        const next: Record<string, any> = {
            ...parsed,
            permissions: {
                ...existingPermissions,
                allow,
            },
        };
        const nextText = JSON.stringify(next, null, 2) + '\n';
        if (existingText.trim() !== '' && (existingText === nextText || JSON.stringify(parsed) === JSON.stringify(next))) {
            return false;
        }
        fs.writeFileSync(settingsPath, nextText, 'utf8');
        return true;
    } catch (error) {
        // Never log error.message: JSON.parse errors quote file content, which may hold tokens.
        console.warn(`[AskAway] Skipping agy permissions sync: ${path.basename(settingsPath)} is not readable valid JSON`);
        return false;
    }
}
