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
	rhea: { working: 'Checking every rule…', idle: 'Standards met' },
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
		profile: 'code',
		profiles: ['code', 'developer'],
		model: 'agy/gemini-4-argon-high',
		thinking: 'high',
		turnDollars: 0,
		monthDollars: 0,
		agentFile: '.github/agents/code.agent.md',
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
		id: 'rhea',
		name: 'Rhea',
		role: 'Rules Expert',
		kind: 'worker',
		profile: 'review',
		profiles: ['review', 'quality'],
		model: 'github-copilot/gpt-6-luna',
		thinking: 'low',
		turnDollars: 0.01,
		monthDollars: 0.80,
		agentFile: '.github/agents/review.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.rhea.working,
		idleStatus: CREATIVE_ROLE_STATUSES.rhea.idle,
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
