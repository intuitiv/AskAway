import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CreativeRoleStatus {
	working: string;
	idle: string;
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
	/** The member's picture from the Team Edit form (~/.askaway/profile/avatars/<id>.<ext>); unset shows initials. */
	avatarFile?: string;
}

export interface MainAgentIdentity extends TeamRosterEntry {
	initials: string;
	isUnknownAgent: boolean;
}

export const CREATIVE_ROLE_STATUSES: Record<string, CreativeRoleStatus> = {
	mahesh: { working: 'Splitting the work…', idle: 'Plan ready' },
	bhaskar: { working: 'Wiring it up…', idle: 'Reviewing diffs' },
	priya: { working: 'Thinking like you…', idle: 'On call' },
	anika: { working: 'Sketching boundaries…', idle: 'Blueprints set' },
	diego: { working: 'Shipping code…', idle: 'Coffee break' },
	tara: { working: 'Breaking things…', idle: 'All green' },
	pavel: { working: 'Profiling hot paths…', idle: 'Frame budget clean' },
	paolo: { working: 'Waiting on CI…', idle: 'Pipes clear' },
	sana: { working: 'Digging through code…', idle: 'Notes indexed' },
	shreya: { working: 'Tracing the fault line…', idle: 'Root cause pinned' },
	cathy: { working: 'Checking the threads…', idle: 'Inbox zero' },
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
		workingStatus: CREATIVE_ROLE_STATUSES.mahesh.working,
		idleStatus: CREATIVE_ROLE_STATUSES.mahesh.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.bhaskar.working,
		idleStatus: CREATIVE_ROLE_STATUSES.bhaskar.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.mahesh.working,
		idleStatus: CREATIVE_ROLE_STATUSES.mahesh.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.bhaskar.working,
		idleStatus: CREATIVE_ROLE_STATUSES.bhaskar.idle,
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
		agentFile: '.github/agents/validator.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.priya.working,
		idleStatus: CREATIVE_ROLE_STATUSES.priya.idle,
	},
	{
		id: 'anika',
		name: 'Anika',
		role: 'Architect',
		kind: 'worker',
		// Owns the `build` worker profile; Bhaskar is the AskAway Build chat agent and never owns worker tasks.
		profile: 'build',
		profiles: ['build', 'plan', 'architect'],
		model: 'github-copilot/claude-opus-5.5',
		thinking: 'high',
		turnDollars: 0.024,
		monthDollars: 3.10,
		agentFile: '.github/agents/build.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.anika.working,
		idleStatus: CREATIVE_ROLE_STATUSES.anika.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.diego.working,
		idleStatus: CREATIVE_ROLE_STATUSES.diego.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.tara.working,
		idleStatus: CREATIVE_ROLE_STATUSES.tara.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.pavel.working,
		idleStatus: CREATIVE_ROLE_STATUSES.pavel.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.paolo.working,
		idleStatus: CREATIVE_ROLE_STATUSES.paolo.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.sana.working,
		idleStatus: CREATIVE_ROLE_STATUSES.sana.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.shreya.working,
		idleStatus: CREATIVE_ROLE_STATUSES.shreya.idle,
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
		workingStatus: CREATIVE_ROLE_STATUSES.cathy.working,
		idleStatus: CREATIVE_ROLE_STATUSES.cathy.idle,
	},
];

/** The user's own worker profiles (~/.askaway/worker-profiles). Members that are specific to one user (e.g. the
 *  authoring and devx profiles) never ship in the extension: a profile no built-in member owns is a member of its own,
 *  named by its `member:`/`role:` frontmatter or the Team Edit form (members.json); profiles sharing `member:` share one row. */
export const USER_PROFILES_DIR = path.join(os.homedir(), '.askaway', 'worker-profiles');

/** Team Edit form overrides, keyed by stable member id; outside the repo and the extension (reviewer, 2026-10-16). */
export const MEMBERS_FILE = path.join(os.homedir(), '.askaway', 'team', 'members.json');
export const AVATARS_DIR = path.join(os.homedir(), '.askaway', 'profile', 'avatars');
export interface MemberOverride { name?: string; role?: string; status?: string; avatar?: string }
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
	const status = text(override.status);
	const avatar = text(override.avatar);
	return {
		...entry, name: text(override.name) || entry.name, role: text(override.role) || entry.role,
		workingStatus: status || entry.workingStatus, idleStatus: status || entry.idleStatus,
		avatarFile: avatar && fs.existsSync(avatar) ? avatar : entry.avatarFile,
	};
}

/** Saves the Edit form: name, role and status line, and copies a picked picture to avatarsDir/<id>.<ext>. */
export function saveMemberProfile(id: string, profile: { name?: string; role?: string; status?: string; picture?: string },
	file = MEMBERS_FILE, avatarsDir = AVATARS_DIR): MemberOverride {
	if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error(`invalid member id: ${id}`);
	const overrides = readMemberOverrides(file);
	const next: MemberOverride = { ...overrides[id] };
	for (const key of ['name', 'role', 'status'] as const) {
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
		initials: initialsOf(key),
		isUnknownAgent: true,
	};
}
