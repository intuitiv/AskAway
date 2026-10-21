import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Hard-coded status phrases of one member (reviewer, 2026-10-21): the Team card rotates through them every 8 s; the first one is the classic line. */
export interface CreativeRoleStatus {
	working: string[];
	idle: string[];
}

export interface TeamRosterEntry {
	id: string;
	name: string;
	role: string;
	kind: 'main' | 'validator' | 'worker';
	nativeAgent?: string;
	pinnedFirst?: boolean;
	profile: string;
	profiles: string[];
	model: string;
	thinking: string;
	turnDollars: number;
	monthDollars: number;
	agentFile: string;
	workingStatus: string;
	idleStatus: string;
	/** 3 to 4 hard-coded phrases each, rotated by the Team card; the first equals workingStatus / idleStatus. */
	statusWorking: string[];
	statusIdle: string[];
	/** The roster's own model and thinking before the user's dropdown choice (Reset model to default). Set by applyMemberOverride. */
	defaultModel?: string;
	defaultThinking?: string;
	/** The member's picture from the Team Edit form (~/.askaway/profile/avatars/<id>.<ext>); unset shows initials. */
	avatarFile?: string;
}

export interface MainAgentIdentity extends TeamRosterEntry {
	initials: string;
	isUnknownAgent: boolean;
}

export const CREATIVE_ROLE_STATUSES: Record<string, CreativeRoleStatus> = {
	mahesh: { working: ['Splitting the work…', 'Herding the agents…', 'Drawing the dependency map…', 'Sequencing the next packets…'], idle: ['Plan ready', 'Roadmap pinned', 'Waiting for the next ask'] },
	bhaskar: { working: ['Wiring it up…', 'Reading the diff twice…', 'Merging the loose ends…', 'Pairing with the build…'], idle: ['Reviewing diffs', 'Merge queue calm', 'Tests green, tea hot'] },
	priya: { working: ['Thinking like you…', 'Checking it against the spec…', 'Asking "would they approve?"…', 'Reading between the lines…'], idle: ['On call', 'Spec in hand', 'Waiting for a verdict to give'] },
	anika: { working: ['Sketching boundaries…', 'Drawing the module lines…', 'Weighing two designs…', 'Naming the seams…'], idle: ['Blueprints set', 'Diagrams tidy', 'Whiteboard clean'] },
	diego: { working: ['Shipping code…', 'Typing at full tilt…', 'Refactoring with care…', 'Chasing a stray semicolon…'], idle: ['Coffee break', 'Stretching the fingers', 'Next ticket, please'] },
	tara: { working: ['Breaking things…', 'Poking the edge cases…', 'Writing the failing test…', 'Hunting flaky tests…'], idle: ['All green', 'Suite is calm', 'Coverage looks happy'] },
	pavel: { working: ['Profiling hot paths…', 'Counting milliseconds…', 'Squeezing the frame budget…', 'Reading the flame graph…'], idle: ['Frame budget clean', 'Flame graph flat', 'Benchmarks resting'] },
	paolo: { working: ['Waiting on CI…', 'Untangling the pipeline…', 'Tuning the Gradle cache…', 'Watching the build bar…'], idle: ['Pipes clear', 'Cache is warm', 'Builds on rails'] },
	sana: { working: ['Digging through code…', 'Following the references…', 'Reading the docs for you…', 'Collecting the evidence…'], idle: ['Notes indexed', 'Library is quiet', 'Sources filed'] },
	shreya: { working: ['Tracing the fault line…', 'Bisecting the history…', 'Following the stack trace…', 'Asking why, five times…'], idle: ['Root cause pinned', 'Case closed', 'No fires today'] },
	cathy: { working: ['Checking the threads…', 'Drafting a polite reply…', 'Catching up with the room…', 'Sorting the chatter…'], idle: ['Inbox zero', 'Room is quiet', 'Messages answered'] },
};

export const MAIN_AGENT_PERSONAS: Record<string, TeamRosterEntry> = {
	'AA.Orchestrator': {
		id: 'mahesh',
		name: 'Mahesh',
		role: 'Orchestrator',
		kind: 'main',
		nativeAgent: 'AA.Orchestrator',
		profile: 'AA.Orchestrator',
		profiles: ['AA.Orchestrator'],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0.06,
		monthDollars: 4.25,
		agentFile: '.github/agents/AA.Orchestrator.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.mahesh.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.mahesh.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.mahesh.working,
		statusIdle: CREATIVE_ROLE_STATUSES.mahesh.idle,
	},
	'AskAway Build': {
		id: 'bhaskar',
		name: 'Bhaskar',
		role: 'Tech Lead',
		kind: 'main',
		nativeAgent: 'AskAway Build',
		profile: 'AskAway Build',
		profiles: ['AskAway Build'],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0.08,
		monthDollars: 6.80,
		agentFile: '.github/agents/askaway-build.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.bhaskar.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.bhaskar.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.bhaskar.working,
		statusIdle: CREATIVE_ROLE_STATUSES.bhaskar.idle,
	},
};

export const TEAM_ROSTER: TeamRosterEntry[] = [
	{
		id: 'mahesh',
		name: 'Mahesh',
		role: 'Orchestrator',
		kind: 'main',
		nativeAgent: 'AA.Orchestrator',
		profile: 'AA.Orchestrator',
		profiles: ['AA.Orchestrator'],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0.06,
		monthDollars: 4.25,
		agentFile: '.github/agents/AA.Orchestrator.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.mahesh.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.mahesh.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.mahesh.working,
		statusIdle: CREATIVE_ROLE_STATUSES.mahesh.idle,
	},
	{
		id: 'bhaskar',
		name: 'Bhaskar',
		role: 'Tech Lead',
		kind: 'main',
		nativeAgent: 'AskAway Build',
		profile: 'AskAway Build',
		profiles: ['AskAway Build'],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0.08,
		monthDollars: 6.80,
		agentFile: '.github/agents/askaway-build.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.bhaskar.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.bhaskar.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.bhaskar.working,
		statusIdle: CREATIVE_ROLE_STATUSES.bhaskar.idle,
	},
	{
		id: 'priya',
		name: 'Priya',
		role: 'Product Owner',
		kind: 'validator',
		pinnedFirst: true,
		profile: 'validator',
		profiles: ['validator'],
		model: 'github-copilot/gpt-6-luna',
		thinking: 'low',
		turnDollars: 0.01,
		monthDollars: 1.42,
		agentFile: '~/.askaway/validator/validator.md',
		workingStatus: CREATIVE_ROLE_STATUSES.priya.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.priya.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.priya.working,
		statusIdle: CREATIVE_ROLE_STATUSES.priya.idle,
	},
	{
		id: 'anika',
		name: 'Anika',
		role: 'Architect',
		kind: 'worker',
		// Owns the `build` worker profile; Bhaskar is the AskAway Build chat agent and never owns worker tasks.
		profile: 'build',
		profiles: ['build', 'plan', 'architect'],
		model: 'github-copilot/claude-sonnet-5.5',
		thinking: 'high',
		turnDollars: 0.024,
		monthDollars: 3.10,
		agentFile: '.github/agents/build.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.anika.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.anika.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.anika.working,
		statusIdle: CREATIVE_ROLE_STATUSES.anika.idle,
	},
	{
		id: 'diego',
		name: 'Diego',
		role: 'Developer',
		kind: 'worker',
		// Build split (reviewer, 2026-10-16): `build` (high) is Anika's, `build-lite` (low) is Diego's.
		profile: 'build-lite',
		profiles: ['build-lite', 'code', 'developer'],
		model: 'github-copilot/gpt-6.1-sol',
		thinking: 'medium',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: '.github/agents/build-lite.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.diego.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.diego.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.diego.working,
		statusIdle: CREATIVE_ROLE_STATUSES.diego.idle,
	},
	{
		id: 'tara',
		name: 'Tara',
		role: 'Test Engineer',
		kind: 'worker',
		profile: 'verify',
		profiles: ['test', 'verify'],
		model: 'github-copilot/gpt-6-luna',
		thinking: 'low',
		turnDollars: 0.0042,
		monthDollars: 0.95,
		agentFile: '.github/agents/verify.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.tara.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.tara.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.tara.working,
		statusIdle: CREATIVE_ROLE_STATUSES.tara.idle,
	},
	{
		id: 'pavel',
		name: 'Pavel',
		role: 'Performance Analyst',
		kind: 'worker',
		profile: 'perf',
		profiles: ['perf'],
		model: 'agy/gemini-4-argon-high',
		thinking: 'high',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: '.github/agents/perf.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.pavel.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.pavel.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.pavel.working,
		statusIdle: CREATIVE_ROLE_STATUSES.pavel.idle,
	},
	{
		id: 'paolo',
		name: 'Paolo',
		role: 'Pipeline Expert',
		kind: 'worker',
		profile: 'gradle',
		profiles: ['gradle'],
		model: 'github-copilot/gpt-6-luna',
		thinking: 'low',
		turnDollars: 0.01,
		monthDollars: 0.65,
		agentFile: '.github/agents/gradle.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.paolo.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.paolo.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.paolo.working,
		statusIdle: CREATIVE_ROLE_STATUSES.paolo.idle,
	},
	{
		id: 'sana',
		name: 'Sana',
		role: 'Researcher',
		kind: 'worker',
		profile: 'explore',
		profiles: ['explore', 'research'],
		model: 'github-copilot/gpt-6-luna',
		thinking: 'low',
		turnDollars: 0.01,
		monthDollars: 1.15,
		agentFile: '.github/agents/explore.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.sana.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.sana.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.sana.working,
		statusIdle: CREATIVE_ROLE_STATUSES.sana.idle,
	},
	{
		id: 'shreya',
		name: 'Shreya',
		role: 'Root-Cause Analyst',
		kind: 'worker',
		profile: 'rca',
		profiles: ['rca'],
		model: 'agy/gemini-4-argon-high',
		thinking: 'high',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: '.github/agents/rca.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.shreya.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.shreya.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.shreya.working,
		statusIdle: CREATIVE_ROLE_STATUSES.shreya.idle,
	},
	{
		id: 'cathy',
		name: 'Cathy',
		role: 'Webex Chatter',
		kind: 'worker',
		profile: 'webex',
		profiles: ['webex'],
		model: 'agy/gemini-4-argon-high',
		thinking: 'high',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: '.github/agents/webex.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.cathy.working[0],
		idleStatus: CREATIVE_ROLE_STATUSES.cathy.idle[0],
		statusWorking: CREATIVE_ROLE_STATUSES.cathy.working,
		statusIdle: CREATIVE_ROLE_STATUSES.cathy.idle,
	},
];

/** The user's own worker profiles (~/.askaway/worker-profiles). Members that are specific to one user (e.g. the
 *  authoring and devx profiles) never ship in the extension: a profile no built-in member owns is a member of its own,
 *  named by its `member:`/`role:` frontmatter or the Team Edit form (members.json); profiles sharing `member:` share one row. */
export const USER_PROFILES_DIR = path.join(os.homedir(), '.askaway', 'worker-profiles');

/** Team Edit form overrides, keyed by stable member id; outside the repo and the extension (reviewer, 2026-10-16). */
export const MEMBERS_FILE = path.join(os.homedir(), '.askaway', 'team', 'members.json');
export const AVATARS_DIR = path.join(os.homedir(), '.askaway', 'profile', 'avatars');
/** `model` and `thinking` are the Team dropdowns' choice: kept in this home-level file, so every workspace shows and uses the same one. */
export interface MemberOverride { name?: string; role?: string; avatar?: string; model?: string; thinking?: string }
const MODEL_ID = /^[\w./:-]+$/;
const THINKING = /^[a-z]+$/;
const PICTURE_EXT = /^\.(png|jpe?g|gif|webp|svg)$/;

export function readMemberOverrides(file = MEMBERS_FILE): Record<string, MemberOverride> {
	try {
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch { return {}; }
}

export function applyMemberOverride<T extends TeamRosterEntry>(entry: T, overrides: Record<string, MemberOverride>): T {
	const override = overrides[entry.id];
	if (!override) return entry;
	const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
	const avatar = text(override.avatar);
	const model = text(override.model);
	const thinking = text(override.thinking);
	return {
		...entry, name: text(override.name) || entry.name, role: text(override.role) || entry.role,
		defaultModel: entry.defaultModel ?? entry.model, defaultThinking: entry.defaultThinking ?? entry.thinking,
		avatarFile: avatar && fs.existsSync(avatar) ? avatar : entry.avatarFile,
		model: MODEL_ID.test(model) ? model : entry.model, thinking: THINKING.test(thinking) ? thinking : entry.thinking,
	};
}

/** Saves a member's model and thinking choice for every workspace. */
export function saveMemberSelection(id: string, selection: { model: string; thinking: string }, file = MEMBERS_FILE): MemberOverride {
	if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error(`invalid member id: ${id}`);
	if (!MODEL_ID.test(selection.model)) throw new Error(`invalid model: ${selection.model}`);
	if (!THINKING.test(selection.thinking)) throw new Error(`invalid thinking: ${selection.thinking}`);
	const overrides = readMemberOverrides(file);
	const next: MemberOverride = { ...overrides[id], model: selection.model, thinking: selection.thinking };
	overrides[id] = next;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(overrides, null, 2) + '\n');
	return next;
}

/** The dropdown choices by member id, for the Team state. */
export function memberSelections(file = MEMBERS_FILE): Record<string, { model: string; thinking: string }> {
	const result: Record<string, { model: string; thinking: string }> = {};
	for (const [id, override] of Object.entries(readMemberOverrides(file))) {
		if (MODEL_ID.test(String(override?.model)) && THINKING.test(String(override?.thinking))) result[id] = { model: String(override.model), thinking: String(override.thinking) };
	}
	return result;
}

/** The Team dropdown choice of the member that owns a worker profile, or undefined (the profile's own default applies). */
export function memberSelectionForProfile(profile: string, dir = USER_PROFILES_DIR, file = MEMBERS_FILE): { model: string; thinking: string } | undefined {
	const selections = memberSelections(file);
	if (!Object.keys(selections).length) return undefined;
	const owner = teamRoster(dir, file).find((entry) => entry.kind !== 'main' && (entry.profile === profile || entry.profiles.includes(profile)));
	return owner ? selections[owner.id] : undefined;
}

/** Saves the Edit form: name and role, and copies a picked picture to avatarsDir/<id>.<ext>. The status line is no longer editable
 *  (reviewer, 2026-10-21): a `status` value in the message or in the stored file is ignored. */
export function saveMemberProfile(id: string, profile: { name?: string; role?: string; picture?: string },
	file = MEMBERS_FILE, avatarsDir = AVATARS_DIR): MemberOverride {
	if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error(`invalid member id: ${id}`);
	const overrides = readMemberOverrides(file);
	const next: MemberOverride = { ...overrides[id] };
	delete (next as { status?: string }).status;
	for (const key of ['name', 'role'] as const) {
		const value = profile[key];
		if (typeof value === 'string') next[key] = value.trim().slice(0, 120);
	}
	if (profile.picture) {
		const ext = path.extname(profile.picture).toLowerCase();
		if (!PICTURE_EXT.test(ext)) throw new Error('picture must be a png, jpg, gif, webp or svg image');
		fs.mkdirSync(avatarsDir, { recursive: true });
		const target = path.join(avatarsDir, id + ext);
		fs.copyFileSync(profile.picture, target);
		next.avatar = target;
	}
	overrides[id] = next;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(overrides, null, 2) + '\n');
	return next;
}

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function userRosterEntries(dir = USER_PROFILES_DIR): TeamRosterEntry[] {
	let files: string[];
	try { files = fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort(); } catch { return []; }
	const owned = new Set(TEAM_ROSTER.flatMap((m) => [m.id, ...m.profiles.map((p) => p.toLowerCase())]));
	const byId = new Map<string, TeamRosterEntry>();
	for (const file of files) {
		const source = path.join(dir, file);
		const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(source, 'utf8'));
		const fields: Record<string, string> = {};
		for (const line of (head ? head[1] : '').split(/\r?\n/)) {
			const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
			if (kv) fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
		}
		const profile = fields.name || file.replace(/\.md$/, '');
		if (!fields.member && owned.has(profile.toLowerCase())) continue;
		const id = slugOf(fields.member || profile);
		if (!id) continue;
		const name = fields.member || profile.charAt(0).toUpperCase() + profile.slice(1);
		const existing = byId.get(id);
		if (existing) { existing.profiles.push(profile); continue; }
		byId.set(id, {
			id, name, role: fields.role || 'Member', kind: 'worker', profile, profiles: [profile],
			model: fields.model || 'github-copilot/gpt-6-luna', thinking: fields.thinking || 'low',
			turnDollars: 0, monthDollars: 0, agentFile: source, workingStatus: 'Working on a task…', idleStatus: 'Standing by',
			statusWorking: ['Working on a task…', 'Heads down on it…', 'Making progress…'], statusIdle: ['Standing by', 'Ready when you are', 'Waiting for a task'],
		});
	}
	return [...byId.values()];
}

/** The Team roster: the extension's members, then the user's own profile members (built-in ids win), with the
 *  Edit form's name, role, status line and picture applied. */
export function teamRoster(dir = USER_PROFILES_DIR, membersFile = MEMBERS_FILE): TeamRosterEntry[] {
	const builtIn = new Set(TEAM_ROSTER.map((m) => m.id));
	const overrides = readMemberOverrides(membersFile);
	return [...TEAM_ROSTER, ...userRosterEntries(dir).filter((m) => !builtIn.has(m.id))].map((m) => applyMemberOverride(m, overrides));
}

export function initialsOf(name: string): string {
	const parts = String(name || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (!parts.length) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function resolveMainAgentIdentity(selectedAgent = 'AskAway Build'): MainAgentIdentity {
	const key = String(selectedAgent || '').trim() || 'AskAway Build';
	if (MAIN_AGENT_PERSONAS[key]) {
		return {
			...MAIN_AGENT_PERSONAS[key],
			initials: initialsOf(MAIN_AGENT_PERSONAS[key].name),
			isUnknownAgent: false,
		};
	}
	const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom-agent';
	return {
		id: slug,
		name: key,
		role: 'Custom Agent',
		kind: 'main',
		nativeAgent: key,
		profile: key,
		profiles: [key],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: `.github/agents/${slug}.agent.md`,
		workingStatus: 'Working on turn…',
		idleStatus: 'Standing by',
		statusWorking: ['Working on turn…', 'Thinking it through…', 'Writing the next step…'],
		statusIdle: ['Standing by', 'Ready when you are', 'Waiting for the next ask'],
		initials: initialsOf(key),
		isUnknownAgent: true,
	};
}
