import { talkHtml } from './talk.js';
import { createSimulatedRoom } from './simulatedActors.js';
import { createTalkController } from '../../media/aitalk/talkController.js';
import { selectReply, replyMessage } from '../../media/aitalk/talkRules.js';
import { VSCODE_DARK_THEME } from '../kit.js';
import {
	AVATAR_FIXTURES,
	USER_PROFILE_FIXTURE,
	USER_PROFILE_RUNTIME_SRC,
	USER_PROFILE_FALLBACK_AVATAR,
	avatarFor,
	avatarFallbackFor,
} from '../fixtures/avatars/index.js';

export {
	AVATAR_FIXTURES,
	USER_PROFILE_FIXTURE,
	USER_PROFILE_RUNTIME_SRC,
	USER_PROFILE_FALLBACK_AVATAR,
	avatarFor,
	avatarFallbackFor,
	createTalkController,
	createSimulatedRoom,
};

const isNode = typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);

let webviewSource = '';
let combinedBrowserCss = '';
if (isNode) {
	const fs = process.getBuiltinModule ? process.getBuiltinModule('node:fs') : await import('node:fs');
	webviewSource = fs.readFileSync(new URL('../../media/webview.js', import.meta.url), 'utf8');
} else {
	const [rawWebview, rawMainCss, rawTalkCss, rawTeamCss] = await Promise.all([
		import('../../media/webview.js?raw'),
		import('../../media/main.css?raw'),
		import('../../media/aitalk/talk.css?raw'),
		import('../../media/team/team.css?raw'),
		import('../../media/main.css'),
		import('../../media/aitalk/talk.css'),
		import('../../media/team/team.css'),
	]);
	webviewSource = rawWebview.default || '';
	combinedBrowserCss = [
		rawMainCss.default || '',
		rawTalkCss.default || '',
		VSCODE_DARK_THEME,
		rawTeamCss.default || '',
	].join('\n');
}

function sliceBetween(src, startMarker, endMarker) {
	const from = src.indexOf(startMarker);
	const to = src.indexOf(endMarker, from);
	if (from < 0 || to < 0) {
		throw new Error(`Missing marker in webview.js: ${startMarker}`);
	}
	return src.slice(from, to);
}

let cachedWorkersKit = null;

/**
 * Extracts the production Workers card + Usage banner + Turn trace renderers
 * from media/webview.js (the exact same markers used by storybook/kit.js).
 */
export function getWorkersKit() {
	if (cachedWorkersKit) return cachedWorkersKit;
	const banner = sliceBetween(webviewSource, '// ── Usage banner', '// ── end Usage banner ──');
	const trace = sliceBetween(webviewSource, '// ── Turn trace rows', '// ── end Turn trace rows ──');
	const workers = sliceBetween(webviewSource, '// ── Workers tab: pure render', '// ── end Workers pure render ──');
	cachedWorkersKit = new Function(
		`${banner}\n${trace}\n${workers}\nreturn { usageBannerHtml, chatBannerHtml, cacheAgeLabel, efficiencyScore, turnTotalsLead, traceRowsHtml, traceGroupsHtml, TRACE_HEAD, workerBannerHtml, workerTraceHtml, workersSummaryHtml, renderWorkersHtml, workersScoreboardHtml, workersBenchmarkHtml, workerCostTips };`
	)();
	return cachedWorkersKit;
}

export const PRODUCTION_TABS = [
	{ id: 'aitalk', label: 'AITalk', icon: 'codicon-comment-discussion', title: 'Workspace group chat' },
	{ id: 'specs', label: 'Specs', icon: 'codicon-Checklist', title: 'Spec Kit features: progress, next task, active feature' },
	{ id: 'observability', label: 'Trace', icon: 'codicon-pulse', title: 'Main agent and Validator' },
	{ id: 'team', label: 'Team', icon: 'codicon-organization', title: 'Team members in this workspace: state, cost, session links' },
	{ id: 'settings', label: 'Settings', icon: 'codicon-settings-gear', title: 'Settings' },
];

export const TEAM_WIDGET_WIDTH_PX = 420;
export const TEAM_WIDGET_WIDTH = '420px';

export const AVAILABLE_TEAM_MODELS = [
	{ id: 'github-copilot/claude-opus-5.5', adapter: 'opencode', efforts: ['high', 'medium', 'low'] },
	{ id: 'github-copilot/claude-sonnet-5.5', adapter: 'opencode', efforts: ['high', 'medium', 'low'] },
	{ id: 'github-copilot/gpt-6.1-sol', adapter: 'opencode', efforts: ['high', 'medium', 'low'] },
	{ id: 'github-copilot/gpt-6-luna', adapter: 'opencode', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-4-argon-high', adapter: 'agy', baseFamily: 'agy/gemini-4-argon', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-4-argon-medium', adapter: 'agy', baseFamily: 'agy/gemini-4-argon', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-4-argon-low', adapter: 'agy', baseFamily: 'agy/gemini-4-argon', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-3.8-flash-high', adapter: 'agy', baseFamily: 'agy/gemini-3.8-flash', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-3.8-flash-medium', adapter: 'agy', baseFamily: 'agy/gemini-3.8-flash', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-3.8-flash-low', adapter: 'agy', baseFamily: 'agy/gemini-3.8-flash', efforts: ['high', 'medium', 'low'] },
	{ id: 'agy/gemini-3.1-pro-high', adapter: 'agy', baseFamily: 'agy/gemini-3.1-pro', efforts: ['high', 'low'] },
	{ id: 'agy/gemini-3.1-pro-low', adapter: 'agy', baseFamily: 'agy/gemini-3.1-pro', efforts: ['high', 'low'] },
];

export const CREATIVE_ROLE_STATUSES = {
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

export const MAIN_AGENT_PERSONAS = {
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

export const VALIDATOR_TRACE_FIXTURES = [
	{
		kind: 'tool',
		id: 'VAL-T1',
		name: 'askaway_memory',
		elapsedMs: 140,
	},
	{
		kind: 'request',
		id: 'VAL-1',
		model: 'gpt-6-luna',
		dollars: 0.01,
		inputTokens: 1420,
		outputTokens: 180,
		cachedTokens: 1100,
	},
];

export const TEAM_ROSTER_FIXTURES = [
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
		traceEvents: VALIDATOR_TRACE_FIXTURES,
		agentFile: '.github/agents/validator.agent.md',
		workingStatus: CREATIVE_ROLE_STATUSES.priya.working,
		idleStatus: CREATIVE_ROLE_STATUSES.priya.idle,
	},
	{
		id: 'anika',
		name: 'Anika',
		role: 'Architect',
		kind: 'worker',
		profile: 'build',
		profiles: ['build'],
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
		profile: 'build',
		profiles: ['build', 'code'],
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

export const ALLOWED_EDIT_FIELDS = ['name', 'role', 'model', 'thinking', 'agentFile'];

export function esc(value) {
	return String(value ?? '').replace(/[&<>"']/g, (ch) => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
	));
}

export function computeInitials(name) {
	const parts = String(name || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (!parts.length) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function isAgyModel(modelId) {
	return String(modelId || '').startsWith('agy/');
}

export function effortsForModel(modelId) {
	const str = String(modelId || '');
	if (str.startsWith('agy/gemini-3.1-pro')) {
		return ['high', 'low'];
	}
	const entry = AVAILABLE_TEAM_MODELS.find((m) => m.id === str);
	return entry ? entry.efforts.slice() : ['high', 'medium', 'low'];
}

export function syncModelAndThinking(currentModel, currentThinking, changedField, newValue) {
	let model = String(currentModel || 'github-copilot/claude-opus-5.5');
	let thinking = String(currentThinking || 'high');

	if (changedField === 'model') {
		model = String(newValue || model);
		if (isAgyModel(model)) {
			const match = /-(high|medium|low)$/.exec(model);
			if (match) {
				thinking = match[1];
			}
		}
		const allowed = effortsForModel(model);
		if (!allowed.includes(thinking)) {
			thinking = allowed[0];
		}
	} else if (changedField === 'thinking') {
		const allowed = effortsForModel(model);
		thinking = allowed.includes(String(newValue)) ? String(newValue) : allowed[0];
		if (isAgyModel(model)) {
			const base = model.replace(/-(high|medium|low)$/, '');
			const candidate = `${base}-${thinking}`;
			if (AVAILABLE_TEAM_MODELS.some((m) => m.id === candidate)) {
				model = candidate;
			}
		}
	}

	return {
		model,
		thinking,
		adapter: isAgyModel(model) ? 'agy' : 'opencode',
		supportedEfforts: effortsForModel(model),
	};
}

export function resolveMainAgentIdentity(selectedAgent = 'AskAway Build') {
	const key = String(selectedAgent || '').trim() || 'AskAway Build';
	if (MAIN_AGENT_PERSONAS[key]) {
		return {
			...MAIN_AGENT_PERSONAS[key],
			initials: computeInitials(MAIN_AGENT_PERSONAS[key].name),
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
		turnDollars: 0.04,
		monthDollars: 1.20,
		agentFile: `.github/agents/${slug}.agent.md`,
		workingStatus: 'Working on turn…',
		idleStatus: 'Standing by',
		initials: computeInitials(key),
		isUnknownAgent: true,
	};
}

export function formatMemberCost(dollars) {
	const val = Number(dollars);
	if (!Number.isFinite(val) || val <= 0) return '$0';
	if (val < 0.01) return `$${val.toFixed(4)}`;
	return `$${val.toFixed(2)}`;
}

export function memberCostSummary(member) {
	const agy = isAgyModel(member?.model);
	const tasks = Array.isArray(member?.tasks) ? member.tasks : [];
	let turnDollars = 0;
	if (agy) {
		turnDollars = 0;
	} else if (tasks.length > 0) {
		turnDollars = tasks.reduce((sum, t) => (
			sum + (isAgyModel(t.model) || t.adapter === 'agy' ? 0 : Number(t.dollars ?? 0))
		), 0);
	} else {
		turnDollars = Number(member?.turnDollars ?? 0);
	}
	const baseMonth = agy ? 0 : Number(member?.monthDollars ?? 0);
	const monthDollars = agy ? 0 : Math.max(baseMonth, turnDollars);
	return {
		turnDollars,
		monthDollars,
		turnCostText: formatMemberCost(turnDollars),
		monthCostText: formatMemberCost(monthDollars),
	};
}

export function avatarMarkup(member, { sizeClass = '', avatarOverrides = null, emptyAlt = false, hideInitialsText = false } = {}) {
	const id = typeof member === 'string' ? member : member?.id;
	const name = typeof member === 'string' ? member : (member?.name || member?.id || '?');
	const src = avatarFor(id, avatarOverrides);
	const initials = member?.initials || computeInitials(name);
	const cls = ['team-avatar-badge', sizeClass, src ? 'has-image' : 'has-initials'].filter(Boolean).join(' ');
	if (src) {
		const isMachs = String(id).toLowerCase() === 'machs';
		const extraAttr = isMachs
			? ` data-fixture-path="${esc(USER_PROFILE_FIXTURE.fixturePath)}" data-fallback-src="${esc(USER_PROFILE_FIXTURE.fallbackAvatar)}" onerror="if(this.dataset.fallbackSrc&&this.src!==this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;}"`
			: '';
		const altAttr = emptyAlt ? '' : esc(name);
		return `<span class="${cls}" data-member-id="${esc(id)}" data-initials="${esc(initials)}">` +
			`<img class="team-avatar-img" src="${esc(src)}" alt="${altAttr}" data-alt="${esc(name)}"${extraAttr} />` +
			`</span>`;
	}
	return `<span class="${cls}" data-member-id="${esc(id)}" data-initials="${esc(initials)}">` +
		`<span class="team-avatar-initials">${hideInitialsText ? '' : esc(initials)}</span>` +
		`</span>`;
}

/**
 * Converts a member task into the worker shape expected by webview.js's renderWorkersHtml
 * and returns the rendered card HTML with user-visible "worker" wording converted to "task".
 */
export function toSharedWorkerRecord(task, now = 1_700_000_000_000) {
	const agy = task.adapter === 'agy' || isAgyModel(task.model);
	const workerId = String(task.workerId || task.id || 'worker-task-1');
	const runId = String(task.runId || `run-${workerId.replace(/^worker-/, '')}-1`);
	const state = String(task.state || 'RUNNING').toUpperCase();
	const requests = Number(task.requests ?? (agy ? 2 : 3));
	const input = Number(task.inputTokens ?? 4200);
	const output = Number(task.outputTokens ?? 380);
	const cacheRead = agy ? 0 : Number(task.cachedTokens ?? 3400);
	const dollars = agy ? 0 : Number(task.dollars ?? 0.0185);
	const elapsedMs = Number(task.elapsedMs ?? 12_000);
	const lastActivityAt = Number(task.lastActivityAt ?? (now - 8_000));

	return {
		workerId,
		profile: task.profile || 'build',
		adapter: agy ? 'agy' : 'opencode',
		model: task.model || 'github-copilot/claude-opus-5.5',
		thinking: task.thinking || 'high',
		state,
		expired: false,
		sessionId: task.sessionId || `ses_${workerId.replace(/[^a-zA-Z0-9]/g, '_')}`,
		sessionOpenAction: `opencode --session ${task.sessionId || `ses_${workerId.replace(/[^a-zA-Z0-9]/g, '_')}`}`,
		cacheExpiresAt: agy ? 0 : Number(task.cacheExpiresAt ?? (now + 240_000)),
		lastPingAt: agy ? 0 : Number(task.lastPingAt ?? (now - 60_000)),
		knowledge: task.objective || task.knowledge || '',
		banner: {
			requests,
			dollars,
			lastIn: input,
			turnOut: output,
			lastCached: cacheRead,
			cacheInput: input + cacheRead,
			lastActivityAt,
		},
		runs: task.runs || [
			{
				runId,
				state,
				queuePosition: 0,
				dispatchTurnId: task.dispatchTurnId || 'turn-active',
				elapsedMs,
				usage: {
					input,
					output,
					cacheRead,
					cacheWrite: 0,
					cost: agy ? 0 : (dollars || 0),
					steps: requests,
				},
			},
		],
		trace: task.trace || {
			source: 'opencode',
			runs: {
				[runId]: task.traceEvents || [
					{
						kind: 'request',
						id: 'REQ1',
						model: String(task.model || '').split('/').pop() || 'model',
						dollars: agy ? 0 : (dollars || 0.01),
						inputTokens: input,
						outputTokens: output,
						cachedTokens: cacheRead,
					},
				],
			},
		},
	};
}

function replaceUserVisibleWorkerWording(html, isAgy) {
	let out = String(html || '').replace(
		/(title="[^"]*")|(&gt;[^<]*&lt;)|(>[^<]+<)/g,
		(segment) => segment
			.replace(/\bWorkers\b/g, 'Tasks')
			.replace(/\bworkers\b/g, 'tasks')
			.replace(/\bWorker\b/g, 'Task')
			.replace(/\bworker\b/g, 'task')
	);
	if (isAgy) {
		out = out
			.replace(/cost=unreported/gi, 'cost=$0')
			.replace(/cost unreported/gi, '$0')
			.replace(/\$0\.0+/g, '$0');
	}
	return out;
}

export function renderMemberTaskCardHtml(task, { now = 1_700_000_000_000, expandedTraces = {}, openIds = {} } = {}) {
	const kit = getWorkersKit();
	const record = toSharedWorkerRecord(task, now);
	const fullWorkersHtml = kit.renderWorkersHtml(
		{
			generatedAt: now,
			server: { state: 'ATTACHED', endpoint: 'http://127.0.0.1:4096' },
			workers: [record],
			turnWorkerIds: [record.workerId],
		},
		'',
		expandedTraces,
		true,
		openIds,
		{ [record.workerId]: record.trace }
	);
	const cardStart = fullWorkersHtml.indexOf('<div class="worker-card"');
	const cardHtml = cardStart >= 0 ? fullWorkersHtml.slice(cardStart) : fullWorkersHtml;
	return replaceUserVisibleWorkerWording(cardHtml, record.adapter === 'agy');
}

export function renderValidatorTracePanelHtml(member, state) {
	const kit = getWorkersKit();
	const traceEvents = Array.isArray(member?.traceEvents) && member.traceEvents.length
		? member.traceEvents
		: VALIDATOR_TRACE_FIXTURES;
	const rowsHtml = kit.traceRowsHtml(traceEvents, {
		openIds: state?.openTraceIds || {},
		now: state?.now || 1_700_000_000_000,
	});
	const tableHtml = `<div class="team-member-tasks-panel team-member-trace-panel" data-member-tasks="${esc(member.id)}" data-member-trace="${esc(member.id)}">` +
		`<table class="observability-table obs-timeline-table team-validator-trace" data-validator-trace="${esc(member.id)}">${kit.TRACE_HEAD}<tbody>${rowsHtml}</tbody></table>` +
		`</div>`;
	return replaceUserVisibleWorkerWording(tableHtml, isAgyModel(member?.model));
}

export function renderProductionTabBarHtml(activeTab = 'team') {
	const btns = PRODUCTION_TABS.map((t) => {
		const isActive = t.id === activeTab;
		return `<button class="widget-tab tab-btn${isActive ? ' active' : ''}" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" title="${esc(t.title)}">${esc(t.label)}</button>`;
	}).join('');
	return `<nav class="widget-tabs tab-bar" id="widget-tabs" role="tablist" aria-label="Main Tabs">${btns}</nav>`;
}

export function getActiveTurnMembers(state) {
	const members = (state.members || []).filter((m) => m.activeInTurn || m.pinnedFirst);
	return members.slice().sort((a, b) => {
		const aPinned = Boolean(a.pinnedFirst || a.id === 'priya' || a.kind === 'validator');
		const bPinned = Boolean(b.pinnedFirst || b.id === 'priya' || b.kind === 'validator');
		if (aPinned !== bPinned) return aPinned ? -1 : 1;
		return 0;
	});
}

export function memberStatusInfo(member) {
	const tasks = member.tasks || [];
	const hasRunningTask = tasks.some((t) => {
		const s = String(t.state || '').toUpperCase();
		return s === 'RUNNING' || s === 'STARTING' || s === 'WAITING_APPROVAL';
	});
	const isWorking = Boolean(member.working || member.typing || hasRunningTask);
	const statuses = CREATIVE_ROLE_STATUSES[member.id] || {
		working: member.workingStatus || 'Working on turn…',
		idle: member.idleStatus || 'Standing by',
	};
	const text = isWorking
		? (member.workingStatus || statuses.working)
		: (member.idleStatus || statuses.idle);
	return {
		state: isWorking ? 'working' : 'idle',
		text,
	};
}

export function renderMemberRowHtml(member, state) {
	const status = memberStatusInfo(member);
	const cost = memberCostSummary(member);
	const isValidator = member.kind === 'validator' || member.id === 'priya';
	const traceEvents = isValidator
		? (Array.isArray(member.traceEvents) && member.traceEvents.length ? member.traceEvents : VALIDATOR_TRACE_FIXTURES)
		: [];
	const tasks = member.tasks || [];
	const taskCount = tasks.length;
	const isTasksExpanded = Boolean(state.expandedTasksByMember && state.expandedTasksByMember[member.id]);
	const isHighlighted = state.highlightedMemberId === member.id;
	const supportedEfforts = effortsForModel(member.model);
	const modelOptionsHtml = AVAILABLE_TEAM_MODELS.map((m) => (
		`<option value="${esc(m.id)}"${m.id === member.model ? ' selected' : ''}>${esc(m.id)}</option>`
	)).join('');
	const effortOptionsHtml = supportedEfforts.map((eff) => (
		`<option value="${esc(eff)}"${eff === member.thinking ? ' selected' : ''}>${esc(eff)}</option>`
	)).join('');

	const pillLabel = isValidator
		? `Trace (${traceEvents.length}) ${isTasksExpanded ? '▾' : '▸'}`
		: `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} ${isTasksExpanded ? '▾' : '▸'}`;
	const tasksTrayHtml = isTasksExpanded
		? (isValidator
			? renderValidatorTracePanelHtml(member, state)
			: `<div class="team-member-tasks-panel" data-member-tasks="${esc(member.id)}">` +
				(tasks.length
					? tasks.map((t) => renderMemberTaskCardHtml(t, {
						now: state.now || 1_700_000_000_000,
						expandedTraces: state.expandedTraces || {},
						openIds: state.openTraceIds || {},
					})).join('')
					: `<div class="team-tasks-empty">No tasks in this turn.</div>`) +
			  `</div>`)
		: '';

	return `<div class="team-member-row${isHighlighted ? ' team-member-row-highlighted is-highlighted' : ''}${status.state === 'working' ? ' is-working' : ''}" data-member-id="${esc(member.id)}" data-pinned="${member.pinnedFirst ? 'true' : 'false'}" data-highlighted="${isHighlighted ? 'true' : 'false'}">` +
		`<div class="team-member-row-main">` +
			`<div class="team-member-portrait" data-member-id="${esc(member.id)}">` +
				avatarMarkup(member, { sizeClass: 'team-portrait-72', avatarOverrides: state.avatarOverrides }) +
			`</div>` +
			`<div class="team-member-body">` +
				`<div class="team-member-headline">` +
					`<span class="team-member-identity"><strong class="team-member-name">${esc(member.name)}</strong> &middot; <span class="team-member-role">${esc(member.role)}</span></span>` +
					`<span class="team-member-status team-status-${esc(status.state)}" data-status-state="${esc(status.state)}">● ${esc(status.text)}</span>` +
					`<span class="team-member-cost" data-member-cost="${esc(member.id)}" data-turn-cost="${esc(cost.turnCostText)}" data-month-cost="${esc(cost.monthCostText)}">Turn <strong class="team-cost-turn">${esc(cost.turnCostText)}</strong> &middot; Month <strong class="team-cost-month">${esc(cost.monthCostText)}</strong></span>` +
					`<button type="button" class="team-edit-member-btn" data-edit-member="${esc(member.id)}" title="Edit ${esc(member.name)}">Edit</button>` +
				`</div>` +
				`<div class="team-member-controls">` +
					`<span class="team-member-profile">Profile: <code>${esc(member.profile)}</code></span>` +
					`<label class="team-control-field">Model ` +
						`<select class="team-model-select" data-member-id="${esc(member.id)}" aria-label="${esc(member.name)} Model">${modelOptionsHtml}</select>` +
					`</label>` +
					`<label class="team-control-field">Thinking ` +
						`<select class="team-thinking-select" data-member-id="${esc(member.id)}" aria-label="${esc(member.name)} Thinking">${effortOptionsHtml}</select>` +
					`</label>` +
					`<a href="#" class="team-agent-file-link" data-agent-file="${esc(member.agentFile)}" data-member-id="${esc(member.id)}">Agent file ↗</a>` +
				`</div>` +
			`</div>` +
			`<div class="team-member-tasks-col">` +
				`<button type="button" class="team-tasks-pill${isTasksExpanded ? ' expanded' : ''}" data-toggle-tasks="${esc(member.id)}" data-toggle-trace="${esc(member.id)}" aria-expanded="${isTasksExpanded ? 'true' : 'false'}">${esc(pillLabel)}</button>` +
			`</div>` +
		`</div>` +
		tasksTrayHtml +
	`</div>`;
}

export function renderMemberEditModalHtml(member, state) {
	if (!member) return '';
	const draft = state.editDraft || {
		name: member.name,
		role: member.role,
		model: member.model,
		thinking: member.thinking,
		agentFile: member.agentFile,
	};
	const supportedEfforts = effortsForModel(draft.model);
	const modelOptionsHtml = AVAILABLE_TEAM_MODELS.map((m) => (
		`<option value="${esc(m.id)}"${m.id === draft.model ? ' selected' : ''}>${esc(m.id)}</option>`
	)).join('');
	const effortOptionsHtml = supportedEfforts.map((eff) => (
		`<option value="${esc(eff)}"${eff === draft.thinking ? ' selected' : ''}>${esc(eff)}</option>`
	)).join('');
	const dropdownOpen = Boolean(state.modelDropdownOpen);
	const openModelMenuHtml = dropdownOpen
		? `<div class="team-model-dropdown-list" role="listbox" aria-label="Available models">` +
			AVAILABLE_TEAM_MODELS.map((m) => (
				`<div class="team-model-dropdown-option${m.id === draft.model ? ' selected' : ''}" role="option" aria-selected="${m.id === draft.model ? 'true' : 'false'}" data-pick-edit-model="${esc(m.id)}" data-adapter="${esc(m.adapter)}">${esc(m.id)}</div>`
			)).join('') +
		  `</div>`
		: '';

	return `<div class="team-edit-modal" role="dialog" aria-label="Edit ${esc(member.name)}" data-editing-member="${esc(member.id)}">` +
		`<div class="team-edit-modal-head">` +
			`<div class="team-edit-modal-portrait">${avatarMarkup(member, { sizeClass: 'team-portrait-48', avatarOverrides: state.avatarOverrides })}</div>` +
			`<div class="team-edit-modal-title">Edit member</div>` +
			`<button type="button" class="team-edit-close-btn" data-close-edit="true" title="Close">✕</button>` +
		`</div>` +
		`<div class="team-edit-form">` +
			`<label class="team-edit-label">Display name` +
				`<input type="text" class="team-edit-input" data-edit-field="name" value="${esc(draft.name)}" />` +
			`</label>` +
			`<label class="team-edit-label">Role` +
				`<input type="text" class="team-edit-input" data-edit-field="role" value="${esc(draft.role)}" />` +
			`</label>` +
			`<div class="team-edit-label">Model` +
				`<div class="team-edit-model-wrap">` +
					`<select class="team-edit-select" data-edit-field="model">${modelOptionsHtml}</select>` +
					openModelMenuHtml +
				`</div>` +
			`</div>` +
			`<label class="team-edit-label">Thinking effort` +
				`<select class="team-edit-select" data-edit-field="thinking">${effortOptionsHtml}</select>` +
			`</label>` +
			`<div class="team-edit-label">Agent file` +
				`<a href="#" class="team-agent-file-link" data-edit-field="agentFile" data-agent-file="${esc(draft.agentFile)}" data-member-id="${esc(member.id)}">${esc(draft.agentFile)} ↗</a>` +
			`</div>` +
		`</div>` +
		`<div class="team-edit-actions">` +
			`<button type="button" class="team-edit-save-btn" data-save-edit="${esc(member.id)}">Save</button>` +
		`</div>` +
	`</div>`;
}

export function renderTeamTabHtml(state) {
	const activeMembers = getActiveTurnMembers(state);
	const rowsHtml = activeMembers.map((m) => renderMemberRowHtml(m, state)).join('');
	const editingMember = state.editingMemberId
		? (state.members || []).find((m) => m.id === state.editingMemberId)
		: null;
	const modalHtml = editingMember ? renderMemberEditModalHtml(editingMember, state) : '';

	return `<div class="team-tab-panel" data-active-member-count="${activeMembers.length}">` +
		`<div class="team-member-list" role="list">${rowsHtml}</div>` +
		modalHtml +
	`</div>`;
}

/**
 * Enhances the raw AITalk HTML from media/aitalk/talkRender.js so that:
 * - User bubbles and header presence show "Machs" and the fixture portrait from storybook/fixtures/avatars/machs.svg
 * - Member bubbles, header roster, join/leave notices, and @autocomplete all show avatarFor(memberId)
 * - Every participant name and avatar carries data-member-id for click-to-Team-row navigation
 * - Duplicate first names in @autocomplete show their role to choose and route by member id
 */
export function decorateTalkHtml(rawTalkHtml, state, roomSnapshot = null) {
	const memberById = new Map();
	const memberByName = new Map();
	for (const m of state.members || []) {
		memberById.set(m.id, m);
		memberByName.set(String(m.name || '').toLowerCase(), m);
	}
	const machsMember = {
		id: 'machs',
		name: USER_PROFILE_FIXTURE.name,
		role: '',
		kind: 'user',
		initials: 'MA',
	};
	memberById.set('machs', machsMember);
	memberById.set('user', machsMember);
	memberById.set('you', machsMember);
	memberByName.set('machs', machsMember);
	memberByName.set('you', machsMember);

	let html = String(rawTalkHtml || '');

	// 1. Decorate header subtitle roster: plain list of present names ("Machs, Priya, Bhaskar, ...") with clickable data-member-id, no images
	const presentAiMembers = (state.members || [])
		.filter((m) => m.present)
		.slice()
		.sort((a, b) => {
			const aPinned = Boolean(a.pinnedFirst || a.id === 'priya' || a.kind === 'validator');
			const bPinned = Boolean(b.pinnedFirst || b.id === 'priya' || b.kind === 'validator');
			if (aPinned !== bPinned) return aPinned ? -1 : 1;
			return 0;
		});
	const presentParticipants = [machsMember, ...presentAiMembers];
	if (presentParticipants.length) {
		const rosterInner = presentParticipants.map((m) => (
			`<span class="aitalk-roster-member" data-member-id="${esc(m.id)}"><span class="aitalk-roster-name" data-member-id="${esc(m.id)}">${esc(m.name)}</span></span>`
		)).join(', ');
		const typingSuffix = roomSnapshot?.typing
			? ` <span class="talk-typing-inline">${esc(roomSnapshot.typing)}</span>`
			: '';
		html = html.replace(
			/<div class="talk-subtitle">[\s\S]*?<\/div>/,
			`<div class="talk-subtitle"><span class="aitalk-roster" title="In this room">${rosterInner}</span>${typingSuffix}</div>`
		);
	}

	// Ensure user presence avatar in header also carries fixture fallback
	html = html.replace(
		/<span class="presence-avatar" aria-hidden="true"><img src="([^"]+)" alt=""><\/span>/g,
		(_, src) => `<span class="presence-avatar" aria-hidden="true"><img src="${src}" alt="" data-fixture-path="${esc(USER_PROFILE_FIXTURE.fixturePath)}" data-fallback-src="${esc(USER_PROFILE_FIXTURE.fallbackAvatar)}" onerror="if(this.dataset.fallbackSrc&&this.src!==this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;}"></span>`
	);

	// 2. Decorate join and leave notices: keep exact text ("Bhaskar joined", "Diego left") while adding face + clickable data-member-id
	html = html.replace(
		/<div class="talk-pill-row"><span class="talk-pill system\s*">([^<]+)<\/span><\/div>/g,
		(full, noticeText) => {
			const trimmed = noticeText.trim();
			const match = /^(.+?)\s+(joined|left)$/.exec(trimmed);
			if (!match) return full;
			const actorName = match[1];
			const m = memberByName.get(actorName.toLowerCase()) || memberById.get(actorName.toLowerCase()) || { id: actorName.toLowerCase(), name: actorName };
			const face = avatarMarkup(m, {
				sizeClass: 'aitalk-inline-face',
				avatarOverrides: state.avatarOverrides,
				emptyAlt: true,
				hideInitialsText: true,
			});
			return `<div class="talk-pill-row aitalk-presence" data-actor="${esc(m.id)}" data-member-id="${esc(m.id)}">${face}<span class="aitalk-presence-label" data-member-id="${esc(m.id)}">${esc(trimmed)}</span></div>`;
		}
	);

	// 3. Decorate message bubbles by matching each message id from roomSnapshot.messages
	const messages = roomSnapshot?.messages || [];
	for (const msg of messages) {
		if (!msg || !msg.id || msg.kind === 'system' || msg.kind === 'day' || msg.kind === 'memory') continue;
		const resolvedId = (msg.author === 'user' || msg.author === 'you') ? 'machs' : msg.author;
		const m = memberById.get(resolvedId) || memberByName.get(String(resolvedId).toLowerCase()) || {
			id: resolvedId,
			name: resolvedId,
			kind: 'worker',
			initials: computeInitials(resolvedId),
		};
		const faceHtml = avatarMarkup(m, {
			sizeClass: 'aitalk-bubble-face',
			avatarOverrides: state.avatarOverrides,
			emptyAlt: true,
		});
		const rowToken = `id="talk-${esc(msg.id)}"`;
		const rowIdx = html.indexOf(rowToken);
		if (rowIdx < 0) continue;

		const rowStart = html.lastIndexOf('<div', rowIdx);
		const searchFrom = rowIdx + rowToken.length;
		const boundaryTokens = [
			'<div class="talk-row',
			'<div data-primary="true" class="talk-row',
			'<div class="talk-pill-row',
			'<div id="talk-bottom">',
		];
		let sliceEnd = html.length;
		for (const tok of boundaryTokens) {
			const idx = html.indexOf(tok, searchFrom);
			if (idx > rowStart && idx < sliceEnd) {
				sliceEnd = idx;
			}
		}
		let rowHtml = html.slice(rowStart, sliceEnd);

		rowHtml = rowHtml.replace(
			/^<div([^>]*?)class="talk-row ([^"]+)" id="([^"]+)">/,
			`<div$1class="talk-row $2 aitalk-msg" id="$3" data-id="${esc(msg.id)}" data-actor="${esc(m.id)}" data-member-id="${esc(m.id)}">`
		);

		if (rowHtml.includes('<span class="talk-avatar ')) {
			rowHtml = rowHtml.replace(
				/<span class="talk-avatar ([^"]*)"(?: data-member="[^"]*")? aria-hidden="true">[\s\S]*?<\/span>/,
				`<span class="talk-avatar $1 aitalk-avatar" data-member-id="${esc(m.id)}" aria-hidden="true">${faceHtml}</span>`
			);
		} else if (m.id === 'machs') {
			rowHtml = rowHtml.replace(
				/<div class="talk-bubble/,
				`<span class="talk-avatar who-you aitalk-avatar" data-member-id="machs" aria-hidden="true">${faceHtml}</span><div class="talk-bubble`
			);
		}

		if (rowHtml.includes('<span class="talk-sender ')) {
			rowHtml = rowHtml.replace(
				/<span class="talk-sender ([^"]*)"(?: data-member="[^"]*")?>([^<]*)<\/span>/,
				`<span class="talk-sender $1 aitalk-who" data-member-id="${esc(m.id)}">${esc(m.name)}</span>`
			);
		} else if (m.id === 'machs') {
			rowHtml = rowHtml.replace(
				/(<div class="talk-bubble[^"]*">)/,
				`$1<span class="talk-sender who-you aitalk-who" data-member-id="machs">${esc(m.name)}</span>`
			);
		}

		html = html.slice(0, rowStart) + rowHtml + html.slice(sliceEnd);
	}

	// Decorate quote authors and inline @mentions with data-member-id
	html = html.replace(
		/<b class="talk-quote-who">([^<]+)<\/b>/g,
		(_, qWho) => {
			const qName = (qWho === 'You' || qWho === 'user') ? USER_PROFILE_FIXTURE.name : qWho;
			const qMember = memberByName.get(String(qName).toLowerCase()) || memberById.get(String(qName).toLowerCase());
			const qIdAttr = qMember ? ` data-member-id="${esc(qMember.id)}"` : '';
			return `<b class="talk-quote-who aitalk-quote-who"${qIdAttr}>${esc(qName)}</b>`;
		}
	);

	html = html.replace(
		/<b class="talk-mention">@([^<]+)<\/b>/g,
		(full, mentioned) => {
			const target = memberByName.get(String(mentioned).toLowerCase()) || memberById.get(String(mentioned).toLowerCase());
			if (!target) return full;
			return `<b class="talk-mention" data-member-id="${esc(target.id)}">@${esc(mentioned)}</b>`;
		}
	);

	// 4. Decorate @mention autocomplete popup with faces, role disambiguation, and data-member-id
	const candidates = state.autocompleteCandidates || [];
	if (candidates.length) {
		const nameCounts = new Map();
		for (const c of candidates) {
			const key = String(c.name || '').toLowerCase();
			nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
		}
		const acItemsHtml = candidates.map((m, i) => {
			const isDup = (nameCounts.get(String(m.name || '').toLowerCase()) || 0) > 1;
			const face = avatarMarkup(m, {
				sizeClass: 'aitalk-ac-face',
				avatarOverrides: state.avatarOverrides,
				emptyAlt: true,
			});
			return `<button type="button" role="option" class="talk-mention-option aitalk-ac-item${i === (state.acIndex || 0) ? ' active' : ''}" data-member-id="${esc(m.id)}" data-mention="${esc(m.name)}" data-role="${esc(m.role || '')}" data-disambiguated="${isDup ? 'true' : 'false'}" aria-selected="${i === (state.acIndex || 0) ? 'true' : 'false'}">` +
				`<span class="talk-avatar small" data-member-id="${esc(m.id)}" aria-hidden="true">${face}</span>` +
				`<span class="talk-mention-name"><b class="aitalk-ac-name">${esc(m.name)}</b><small class="aitalk-ac-role">${esc(m.role || '')}</small></span>` +
			`</button>`;
		}).join('');
		const customAc = `<div class="talk-mentions aitalk-ac" role="listbox" aria-label="Mention a participant">${acItemsHtml}</div>`;
		if (html.includes('<div class="talk-mentions"')) {
			html = html.replace(/<div class="talk-mentions" role="listbox" aria-label="Mention a participant">[\s\S]*?<\/div>/, customAc);
		} else {
			html = html.replace('<div class="talk-composer">', `<div class="talk-composer">${customAc}`);
		}
	}

	const mainIdentity = resolveMainAgentIdentity(state.selectedAgent || 'AskAway Build');
	if (!mainIdentity.isUnknownAgent) {
		html = html.replace(/AA\.Orchestrator/g, 'Mahesh').replace(/AskAway Build/g, 'Bhaskar');
	}

	return html;
}

export function renderTeamShellHtml(state, rawTalkHtml = '', roomSnapshot = null) {
	const theme = state.theme === 'light' ? 'light' : 'dark';
	const activeTab = state.activeTab === 'aitalk' ? 'aitalk' : 'team';
	const isAitalk = activeTab === 'aitalk';
	const isTeam = activeTab === 'team';
	const tabBarHtml = renderProductionTabBarHtml(activeTab);
	const decoratedTalkHtml = decorateTalkHtml(rawTalkHtml, state, roomSnapshot);
	const teamTabHtml = renderTeamTabHtml(state);
	const mainIdentity = resolveMainAgentIdentity(state.selectedAgent || 'AskAway Build');

	return `<div class="team-storybook-shell team-proto-root team-theme-${theme}" data-theme="${theme}" data-active-tab="${esc(activeTab)}" data-selected-agent="${esc(mainIdentity.name)}" data-widget-width="${TEAM_WIDGET_WIDTH_PX}">` +
		tabBarHtml +
		`<section class="tab-panel team-pane team-aitalk-pane${isAitalk ? ' active pane-active' : ''}" id="panel-aitalk" data-pane="aitalk" data-panel-width="${TEAM_WIDGET_WIDTH_PX}" role="tabpanel" aria-label="AITalk pane"${isAitalk ? '' : ' hidden'}>` +
			decoratedTalkHtml +
		`</section>` +
		`<section class="tab-panel team-pane team-directory-pane${isTeam ? ' active pane-active' : ''}" id="panel-team" data-pane="team" data-panel-width="${TEAM_WIDGET_WIDTH_PX}" role="tabpanel" aria-label="Team pane"${isTeam ? '' : ' hidden'}>` +
			teamTabHtml +
		`</section>` +
	`</div>`;
}

export function computeAutocompleteCandidates(members, draft) {
	const m = /(?:^|\s)@([A-Za-z0-9_-]*)$/.exec(String(draft || ''));
	if (!m) return [];
	const q = m[1].toLowerCase();
	return (members || [])
		.filter((x) => x && x.id !== 'user' && x.id !== 'machs' && x.activeInTurn && x.present)
		.filter((x) => (
			String(x.name || '').toLowerCase().includes(q) ||
			String(x.role || '').toLowerCase().includes(q) ||
			String(x.id || '').toLowerCase().includes(q)
		));
}

export function createTeamController(options = {}) {
	const selectedAgent = options.selectedAgent || options.activeAgent || 'AskAway Build';
	const mainPersona = resolveMainAgentIdentity(selectedAgent);
	let clock = Number(options.now || 1_700_000_000_000);
	const now = () => clock;

	const baseMembers = TEAM_ROSTER_FIXTURES.map((m) => ({
		...m,
		initials: computeInitials(m.name),
		activeInTurn: false,
		present: false,
		working: false,
		typing: false,
		tasks: [],
	}));

	if (mainPersona.isUnknownAgent) {
		baseMembers.unshift({
			...mainPersona,
			activeInTurn: false,
			present: false,
			working: false,
			typing: false,
			tasks: [],
		});
	}

	if (Array.isArray(options.extraMembers)) {
		for (const extra of options.extraMembers) {
			baseMembers.push({
				...extra,
				initials: computeInitials(extra.name),
				activeInTurn: Boolean(extra.activeInTurn),
				present: Boolean(extra.present),
				working: Boolean(extra.working),
				typing: Boolean(extra.typing),
				tasks: Array.isArray(extra.tasks) ? extra.tasks.slice() : [],
			});
		}
	}

	const state = {
		theme: options.theme === 'light' ? 'light' : 'dark',
		selectedAgent,
		mainMemberId: mainPersona.id,
		activeTab: options.activeTab || 'team',
		members: baseMembers,
		expandedTasksByMember: { ...(options.expandedTasksByMember || {}) },
		expandedTraces: { ...(options.expandedTraces || {}) },
		openTraceIds: {},
		highlightedMemberId: options.highlightedMemberId || null,
		editingMemberId: options.editingMemberId || null,
		editDraft: null,
		modelDropdownOpen: Boolean(options.modelDropdownOpen),
		avatarOverrides: options.avatarOverrides || null,
		autocompleteCandidates: [],
		acIndex: 0,
		selectedMentionMemberId: null,
		draft: '',
		intents: [],
		routedMessages: [],
		now: clock,
		stepIndex: -1,
	};

	// Always pin Priya (Product Owner / Validator) in the room for the turn
	const priya = state.members.find((m) => m.id === 'priya');
	if (priya) {
		priya.activeInTurn = true;
		priya.present = true;
	}

	function buildRoomMembers() {
		const list = [
			{
				id: 'machs',
				kind: 'user',
				displayName: USER_PROFILE_FIXTURE.name,
				name: USER_PROFILE_FIXTURE.name,
				colour: 'who-you',
				rank: 400,
				presencePolicy: 'alwaysPresent',
				canProxyWhenAway: false,
				presence: 'online',
			},
		];
		const orderedAiMembers = state.members.slice().sort((a, b) => {
			const aPinned = Boolean(a.pinnedFirst || a.id === 'priya' || a.kind === 'validator');
			const bPinned = Boolean(b.pinnedFirst || b.id === 'priya' || b.kind === 'validator');
			if (aPinned !== bPinned) return aPinned ? -1 : 1;
			return 0;
		});
		for (const m of orderedAiMembers) {
			list.push({
				id: m.id,
				kind: m.kind === 'validator' ? 'validator' : (m.kind === 'main' ? 'agent' : 'worker'),
				displayName: m.name,
				name: m.name,
				role: m.role,
				colour: m.kind === 'validator' ? 'who-validator' : (m.kind === 'main' ? 'who-agent' : 'who-worker'),
				rank: m.kind === 'validator' ? 300 : (m.kind === 'main' ? 200 : 100),
				presencePolicy: m.pinnedFirst ? 'alwaysPresent' : 'joinsPerTurn',
				canProxyWhenAway: Boolean(m.kind === 'validator'),
				presence: m.present ? 'online' : 'left',
			});
		}
		return list;
	}

	let latestRoomSnapshot = { messages: [], members: buildRoomMembers(), typing: '', unread: 0 };
	const room = createSimulatedRoom({
		messages: [],
		members: latestRoomSnapshot.members,
		typing: '',
		unread: 0,
		render: (snap) => {
			latestRoomSnapshot = snap;
		},
		schedule: (fn) => fn(),
	});
	room.start();

	const listeners = new Set();
	let msgCounter = 1;

	function emitIntent(intent) {
		state.intents.push(intent);
		if (typeof options.onIntent === 'function') {
			options.onIntent(intent);
		}
	}

	function syncTalkRoster() {
		const snap = room.snapshot();
		for (const m of state.members) {
			const rm = snap.members.find((x) => x.id === m.id);
			if (rm) {
				const oldName = rm.displayName || rm.name;
				if (oldName && oldName !== m.name) {
					for (const msg of snap.messages || []) {
						if (msg && msg.kind === 'system' && typeof msg.text === 'string') {
							if (msg.text === `${oldName} joined`) msg.text = `${m.name} joined`;
							if (msg.text === `${oldName} left`) msg.text = `${m.name} left`;
						}
					}
					if (snap.typing === `${oldName} is typing…`) {
						room.act({ do: 'typing', who: `${m.name} is typing…` });
					}
				}
				rm.displayName = m.name;
				rm.name = m.name;
				rm.role = m.role;
				rm.presence = m.present ? 'online' : 'left';
			}
		}
		latestRoomSnapshot = room.snapshot();
	}

	function notify() {
		state.now = clock;
		state.autocompleteCandidates = computeAutocompleteCandidates(state.members, state.draft);
		latestRoomSnapshot = room.snapshot();
		for (const fn of listeners) {
			fn(state);
		}
	}

	function findMember(memberId) {
		return state.members.find((m) => m.id === memberId) || null;
	}

	function memberJoin(memberId, { working = true } = {}) {
		const m = findMember(memberId);
		if (!m) return null;
		clock += 500;
		m.activeInTurn = true;
		const wasPresent = m.present;
		m.present = true;
		m.working = working;
		if (!wasPresent) {
			room.act({ do: 'join', who: m.id });
		}
		if (working && m.kind === 'worker') {
			m.typing = true;
			room.act({ do: 'typing', who: `${m.name} is typing…` });
		}
		notify();
		return m;
	}

	function memberLeave(memberId) {
		const m = findMember(memberId);
		if (!m) return null;
		clock += 500;
		m.working = false;
		m.typing = false;
		if (m.present) {
			m.present = false;
			room.act({ do: 'typing', who: '' });
			room.act({ do: 'leave', who: m.id });
		}
		notify();
		return m;
	}

	function assignTask(memberId, taskSpec = {}) {
		const m = findMember(memberId);
		if (!m) return null;
		if (!m.present) {
			memberJoin(memberId, { working: true });
		} else {
			m.activeInTurn = true;
			m.working = true;
			m.typing = true;
			room.act({ do: 'typing', who: `${m.name} is typing…` });
		}
		const index = m.tasks.length + 1;
		const task = {
			workerId: taskSpec.workerId || `worker-${m.id}-${index}`,
			runId: taskSpec.runId || `run-${m.id}-${index}`,
			profile: taskSpec.profile || m.profile,
			adapter: isAgyModel(taskSpec.model || m.model) ? 'agy' : 'opencode',
			model: taskSpec.model || m.model,
			thinking: taskSpec.thinking || m.thinking,
			state: taskSpec.state || 'RUNNING',
			objective: taskSpec.objective || `${m.role} task ${index}`,
			requests: taskSpec.requests ?? (isAgyModel(taskSpec.model || m.model) ? 2 : 3),
			inputTokens: taskSpec.inputTokens ?? 4800,
			outputTokens: taskSpec.outputTokens ?? 410,
			cachedTokens: isAgyModel(taskSpec.model || m.model) ? 0 : (taskSpec.cachedTokens ?? 3900),
			dollars: isAgyModel(taskSpec.model || m.model) ? 0 : (taskSpec.dollars ?? 0.0192),
			elapsedMs: taskSpec.elapsedMs ?? 11_000,
			lastActivityAt: clock - 4_000,
		};
		m.tasks.push(task);
		notify();
		return task;
	}

	function completeMemberTasks(memberId) {
		const m = findMember(memberId);
		if (!m) return null;
		for (const t of m.tasks) {
			t.state = 'COMPLETED';
		}
		m.working = false;
		m.typing = false;
		room.act({ do: 'typing', who: '' });
		notify();
		return m;
	}

	function setMemberModel(memberId, newModel) {
		const m = findMember(memberId);
		if (!m) return null;
		const synced = syncModelAndThinking(m.model, m.thinking, 'model', newModel);
		m.model = synced.model;
		m.thinking = synced.thinking;
		if (state.editingMemberId === memberId && state.editDraft) {
			state.editDraft.model = synced.model;
			state.editDraft.thinking = synced.thinking;
		}
		const intent = {
			type: 'setMemberModel',
			memberId: m.id,
			model: m.model,
			thinking: m.thinking,
		};
		emitIntent(intent);
		notify();
		return m;
	}

	function setMemberThinking(memberId, newThinking) {
		const m = findMember(memberId);
		if (!m) return null;
		const synced = syncModelAndThinking(m.model, m.thinking, 'thinking', newThinking);
		m.model = synced.model;
		m.thinking = synced.thinking;
		if (state.editingMemberId === memberId && state.editDraft) {
			state.editDraft.model = synced.model;
			state.editDraft.thinking = synced.thinking;
		}
		const intent = {
			type: 'setMemberModel',
			memberId: m.id,
			model: m.model,
			thinking: m.thinking,
		};
		emitIntent(intent);
		notify();
		return m;
	}

	function openAgentFile(memberId) {
		const m = findMember(memberId);
		if (!m) return null;
		const filePath = (state.editingMemberId === memberId && state.editDraft?.agentFile) || m.agentFile;
		const intent = {
			type: 'openAgentFile',
			memberId: m.id,
			path: filePath,
			profile: m.profile,
		};
		emitIntent(intent);
		notify();
		return intent;
	}

	function toggleMemberTasks(memberId) {
		state.expandedTasksByMember[memberId] = !state.expandedTasksByMember[memberId];
		notify();
		return state.expandedTasksByMember[memberId];
	}

	function toggleTaskTrace(workerId) {
		state.expandedTraces[workerId] = !state.expandedTraces[workerId];
		notify();
		return state.expandedTraces[workerId];
	}

	function openMemberEdit(memberId, { modelDropdownOpen = false } = {}) {
		const m = findMember(memberId);
		if (!m) return null;
		state.editingMemberId = m.id;
		state.modelDropdownOpen = Boolean(modelDropdownOpen);
		state.editDraft = {
			name: m.name,
			role: m.role,
			model: m.model,
			thinking: m.thinking,
			agentFile: m.agentFile,
		};
		notify();
		return state.editDraft;
	}

	function updateEditDraft(field, value) {
		if (!state.editingMemberId || !state.editDraft) return null;
		const memberId = state.editingMemberId;
		if (field === 'model') {
			const synced = syncModelAndThinking(state.editDraft.model, state.editDraft.thinking, 'model', value);
			state.editDraft.model = synced.model;
			state.editDraft.thinking = synced.thinking;
			setMemberModel(memberId, synced.model);
			return state.editDraft;
		}
		if (field === 'thinking') {
			const synced = syncModelAndThinking(state.editDraft.model, state.editDraft.thinking, 'thinking', value);
			state.editDraft.model = synced.model;
			state.editDraft.thinking = synced.thinking;
			setMemberThinking(memberId, synced.thinking);
			return state.editDraft;
		}
		if (field === 'name' || field === 'role') {
			state.editDraft[field] = String(value ?? '');
			const m = findMember(memberId);
			if (m && state.editDraft[field].trim()) {
				m[field] = state.editDraft[field].trim();
				m.initials = computeInitials(m.name);
				syncTalkRoster();
			}
			notify();
		}
		return state.editDraft;
	}

	function saveMemberEdit() {
		if (!state.editingMemberId || !state.editDraft) return null;
		const m = findMember(state.editingMemberId);
		if (m) {
			if (state.editDraft.name?.trim()) m.name = state.editDraft.name.trim();
			if (state.editDraft.role?.trim()) m.role = state.editDraft.role.trim();
			m.initials = computeInitials(m.name);
			syncTalkRoster();
		}
		state.editingMemberId = null;
		state.editDraft = null;
		state.modelDropdownOpen = false;
		notify();
		return m;
	}

	function closeMemberEdit() {
		state.editingMemberId = null;
		state.editDraft = null;
		state.modelDropdownOpen = false;
		notify();
	}

	function selectMemberFromTalk(memberIdOrName) {
		const raw = String(memberIdOrName || '').replace(/^@/, '').trim();
		const resolvedId = (raw === 'user' || raw === 'you') ? 'machs' : raw.toLowerCase();
		const m = findMember(resolvedId) || state.members.find((x) => x.name.toLowerCase() === resolvedId);
		if (!m) return null;
		m.activeInTurn = true;
		state.activeTab = 'team';
		state.highlightedMemberId = m.id;
		emitIntent({
			type: 'focusTeamMember',
			memberId: m.id,
		});
		notify();
		return m;
	}

	function switchTab(tabId) {
		state.activeTab = tabId === 'aitalk' ? 'aitalk' : 'team';
		notify();
	}

	function setDraft(text) {
		state.draft = String(text ?? '');
		state.autocompleteCandidates = computeAutocompleteCandidates(state.members, state.draft);
		notify();
		return state.autocompleteCandidates;
	}

	function pickAutocomplete(memberIdOrIndex = 0) {
		const candidates = state.autocompleteCandidates || [];
		const picked = typeof memberIdOrIndex === 'string'
			? candidates.find((c) => c.id === memberIdOrIndex || c.name.toLowerCase() === memberIdOrIndex.toLowerCase())
			: (candidates[memberIdOrIndex] || candidates[0]);
		if (!picked) return null;
		state.selectedMentionMemberId = picked.id;
		state.draft = String(state.draft || '').replace(/@([A-Za-z0-9_-]*)$/, `@${picked.name} `);
		state.autocompleteCandidates = [];
		notify();
		return picked;
	}

	function sendUserMessage(textOverride) {
		const text = String(textOverride !== undefined ? textOverride : (state.draft || '')).trim();
		if (!text) return null;
		clock += 500;
		let targetMember = state.selectedMentionMemberId ? findMember(state.selectedMentionMemberId) : null;
		if (!targetMember) {
			const mentionMatch = /@([A-Za-z0-9_-]+)/.exec(text);
			if (mentionMatch) {
				const q = mentionMatch[1].toLowerCase();
				targetMember = state.members.find((m) => m.activeInTurn && (m.name.toLowerCase() === q || m.id.toLowerCase() === q)) || null;
			}
		}
		state.selectedMentionMemberId = null;
		state.draft = '';
		state.autocompleteCandidates = [];
		room.intent({ type: 'aitalkPost', text });
		const latestMsg = room.snapshot().messages.at(-1);
		if (latestMsg && targetMember) {
			latestMsg.toActorId = targetMember.id;
			const routed = {
				messageId: latestMsg.id,
				memberId: targetMember.id,
				name: targetMember.name,
				role: targetMember.role,
				text,
			};
			state.routedMessages.push(routed);
			emitIntent({
				type: 'routeMention',
				memberId: targetMember.id,
				name: targetMember.name,
				text,
			});
		}
		notify();
		return latestMsg;
	}

	// Build the 11-step ActiveTurn timeline (~40s across keyframes)
	const main = findMember(state.mainMemberId);
	let askPriyaMsgId = null;

	const steps = [
		// Step 0 (0s): Main agent joins at turn start
		() => {
			memberJoin(main.id, { working: true });
		},
		// Step 1 (3.5s): Main agent asks Priya a question -> shows as main agent's bubble first, then Priya's typing
		() => {
			const priyaMember = findMember('priya');
			if (priyaMember) {
				priyaMember.working = true;
				priyaMember.typing = true;
			}
			askPriyaMsgId = `msg-ask-priya-${msgCounter++}`;
			room.act({
				do: 'add',
				message: {
					id: askPriyaMsgId,
					author: main.id,
					text: '@Priya Should the Team tab show all 12 roster members or only members active in this turn?',
					time: '10:31',
				},
			});
			room.act({ do: 'typing', who: 'Priya is typing…' });
			notify();
		},
		// Step 2 (7.5s): Priya replies quoting the main agent's question
		() => {
			const priyaMember = findMember('priya');
			if (priyaMember) {
				priyaMember.working = false;
				priyaMember.typing = false;
			}
			const quote = selectReply(room.snapshot().messages, askPriyaMsgId);
			room.act({
				do: 'add',
				message: {
					...replyMessage(
						'Only members active in the current turn, with Priya pinned first.',
						'priya',
						quote,
						`msg-priya-reply-${msgCounter++}`
					),
					time: '10:31',
				},
			});
			notify();
		},
		// Step 3 (11.5s): Anika joined (design task)
		() => {
			assignTask('anika', {
				workerId: 'worker-anika-1',
				runId: 'run-anika-1',
				profile: 'build',
				model: 'github-copilot/claude-opus-5.5',
				thinking: 'high',
				state: 'RUNNING',
				objective: 'Design Team row layout and shared task card boundary',
				dollars: 0.024,
				requests: 3,
			});
		},
		// Step 4 (16s): Diego joined (two tasks) -> Team shows Priya, Bhaskar/Mahesh, Anika, Diego `2 tasks`
		() => {
			assignTask('diego', {
				workerId: 'worker-diego-1',
				runId: 'run-diego-1',
				profile: 'build',
				model: 'agy/gemini-4-argon-high',
				thinking: 'high',
				state: 'RUNNING',
				objective: 'Wire Team tab row controls and model/effort sync',
				requests: 2,
			});
			assignTask('diego', {
				workerId: 'worker-diego-2',
				runId: 'run-diego-2',
				profile: 'code',
				model: 'agy/gemini-4-argon-high',
				thinking: 'high',
				state: 'RUNNING',
				objective: 'Connect AITalk faces, @mentions, and click-to-profile highlight',
				requests: 3,
			});
		},
		// Step 5 (20.5s): User types @Di -> autocomplete shows Diego (face + Diego + Developer)
		() => {
			setDraft('@Di');
		},
		// Step 6 (24.5s): User picks Diego -> asks a question
		() => {
			pickAutocomplete('diego');
			sendUserMessage('@Diego Are both tasks rendering through the shared card with agy cost at $0?');
			const diego = findMember('diego');
			if (diego) {
				diego.typing = true;
				room.act({ do: 'typing', who: 'Diego is typing…' });
			}
			notify();
		},
		// Step 7 (28.5s): Diego answers quoting Machs
		() => {
			const diego = findMember('diego');
			if (diego) {
				diego.typing = false;
			}
			const lastUserMsg = [...room.snapshot().messages].reverse().find((e) => e.author === 'machs');
			const quote = lastUserMsg ? selectReply(room.snapshot().messages, lastUserMsg.id) : null;
			room.act({
				do: 'add',
				message: {
					...replyMessage(
						'Yes — both tasks reuse the shared card renderer and show $0 for agy.',
						'diego',
						quote,
						`msg-diego-reply-${msgCounter++}`
					),
					time: '10:33',
				},
			});
			notify();
		},
		// Step 8 (32.5s): Tara joined (verify)
		() => {
			assignTask('tara', {
				workerId: 'worker-tara-1',
				runId: 'run-tara-1',
				profile: 'verify',
				model: 'github-copilot/gpt-6-luna',
				thinking: 'low',
				state: 'RUNNING',
				objective: 'Run test-team-storybook.cjs and test-aitalk-ui.cjs checks',
				dollars: 0.0042,
				requests: 2,
			});
		},
		// Step 9 (36.5s): Tasks complete -> Tara status becomes "All green"
		() => {
			completeMemberTasks('anika');
			completeMemberTasks('diego');
			completeMemberTasks('tara');
			main.working = false;
			notify();
		},
		// Step 10 (40s): Anika left, Diego left, Tara left
		() => {
			memberLeave('anika');
			memberLeave('diego');
			memberLeave('tara');
		},
	];

	const stepTimestampsMs = [0, 3500, 7500, 11500, 16000, 20500, 24500, 28500, 32500, 36500, 40000];

	function stepTo(targetIndex) {
		const clamped = Math.max(-1, Math.min(steps.length - 1, targetIndex));
		while (state.stepIndex < clamped) {
			state.stepIndex += 1;
			steps[state.stepIndex]();
		}
		return state;
	}

	function renderRawTalkHtml() {
		const snap = room.snapshot();
		return talkHtml(snap.messages, {
			embedded: true,
			theme: state.theme,
			members: snap.members,
			typing: snap.typing,
			unread: snap.unread,
			draft: state.draft,
			popover: state.autocompleteCandidates.length > 0,
			presence: {
				mode: 'here',
				name: USER_PROFILE_FIXTURE.name,
				photo: avatarFor('machs', state.avatarOverrides),
			},
		});
	}

	function renderHtml() {
		return renderTeamShellHtml(state, renderRawTalkHtml(), room.snapshot());
	}

	// Apply initial scenario setup
	const scenario = options.scenario || 'active-turn';
	if (scenario === 'active-turn' || scenario === 'orchestrator' || scenario === 'unknown-agent' || scenario === 'light') {
		const initialStep = options.initialStep !== undefined ? options.initialStep : 4;
		stepTo(initialStep);
	} else if (scenario === 'member-edit') {
		stepTo(options.initialStep !== undefined ? options.initialStep : 4);
		openMemberEdit(options.editingMemberId || 'diego', { modelDropdownOpen: true });
	} else if (scenario === 'name-click') {
		state.activeTab = 'aitalk';
		stepTo(options.initialStep !== undefined ? options.initialStep : 4);
		selectMemberFromTalk(options.clickedMemberId || 'priya');
	}

	return {
		state,
		room,
		steps,
		stepTimestampsMs,
		totalDurationMs: 40000,
		stepTo,
		renderHtml,
		findMember,
		memberJoin,
		memberLeave,
		assignTask,
		completeMemberTasks,
		setMemberModel,
		setMemberThinking,
		openAgentFile,
		toggleMemberTasks,
		toggleMemberTrace: toggleMemberTasks,
		toggleTaskTrace,
		openMemberEdit,
		updateEditDraft,
		saveMemberEdit,
		closeMemberEdit,
		selectMemberFromTalk,
		switchTab,
		setDraft,
		pickAutocomplete,
		sendUserMessage,
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
}

export function mountTeamStory(options = {}) {
	let urlStep;
	if (typeof window !== 'undefined' && window.location && window.location.search) {
		const params = new URLSearchParams(window.location.search);
		if (params.has('step')) {
			const parsed = Number(params.get('step'));
			if (Number.isFinite(parsed)) urlStep = parsed;
		}
	}

	const controller = createTeamController({
		...options,
		initialStep: urlStep !== undefined ? urlStep : options.initialStep,
	});

	if (typeof document === 'undefined') {
		return {
			controller,
			get innerHTML() {
				return controller.renderHtml();
			},
		};
	}

	const host = document.createElement('div');
	host.className = 'team-story-host';
	const styleEl = document.createElement('style');
	styleEl.textContent = combinedBrowserCss;
	const contentEl = document.createElement('div');
	host.append(styleEl, contentEl);

	function paint() {
		contentEl.innerHTML = controller.renderHtml();
		if (controller.state.highlightedMemberId) {
			const row = contentEl.querySelector(`.team-member-row[data-member-id="${controller.state.highlightedMemberId}"]`);
			if (row && typeof row.scrollIntoView === 'function') {
				row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		}
	}

	paint();
	controller.onChange(paint);

	host.addEventListener('click', (e) => {
		const tabBtn = e.target.closest('.tab-btn[data-tab]');
		if (tabBtn) {
			e.preventDefault();
			controller.switchTab(tabBtn.getAttribute('data-tab'));
			return;
		}

		const acItem = e.target.closest('.aitalk-ac-item[data-member-id], .talk-mention-option[data-member-id]');
		if (acItem) {
			e.preventDefault();
			controller.pickAutocomplete(acItem.getAttribute('data-member-id'));
			const input = contentEl.querySelector('.talk-composer textarea');
			if (input) input.focus();
			return;
		}

		const sendBtn = e.target.closest('[data-send]');
		if (sendBtn) {
			e.preventDefault();
			const input = contentEl.querySelector('.talk-composer textarea');
			controller.sendUserMessage(input ? input.value : undefined);
			return;
		}

		const talkMemberEl = e.target.closest('#panel-aitalk [data-member-id]');
		if (talkMemberEl && !e.target.closest('.talk-mentions')) {
			e.preventDefault();
			controller.selectMemberFromTalk(talkMemberEl.getAttribute('data-member-id'));
			return;
		}

		const toggleTasksBtn = e.target.closest('[data-toggle-tasks]');
		if (toggleTasksBtn) {
			e.preventDefault();
			controller.toggleMemberTasks(toggleTasksBtn.getAttribute('data-toggle-tasks'));
			return;
		}

		const traceBtn = e.target.closest('[data-worker-action="trace"]');
		if (traceBtn) {
			e.preventDefault();
			controller.toggleTaskTrace(traceBtn.getAttribute('data-worker-id'));
			return;
		}

		const agentFileLink = e.target.closest('.team-agent-file-link[data-member-id]');
		if (agentFileLink) {
			e.preventDefault();
			controller.openAgentFile(agentFileLink.getAttribute('data-member-id'));
			return;
		}

		const editBtn = e.target.closest('[data-edit-member]');
		if (editBtn) {
			e.preventDefault();
			controller.openMemberEdit(editBtn.getAttribute('data-edit-member'), { modelDropdownOpen: true });
			return;
		}

		const pickEditModel = e.target.closest('[data-pick-edit-model]');
		if (pickEditModel) {
			e.preventDefault();
			controller.updateEditDraft('model', pickEditModel.getAttribute('data-pick-edit-model'));
			return;
		}

		const saveEditBtn = e.target.closest('[data-save-edit]');
		if (saveEditBtn) {
			e.preventDefault();
			controller.saveMemberEdit();
			return;
		}

		const closeEditBtn = e.target.closest('[data-close-edit]');
		if (closeEditBtn) {
			e.preventDefault();
			controller.closeMemberEdit();
		}
	});

	host.addEventListener('change', (e) => {
		const modelSelect = e.target.closest('.team-model-select[data-member-id]');
		if (modelSelect) {
			controller.setMemberModel(modelSelect.getAttribute('data-member-id'), modelSelect.value);
			return;
		}

		const thinkingSelect = e.target.closest('.team-thinking-select[data-member-id]');
		if (thinkingSelect) {
			controller.setMemberThinking(thinkingSelect.getAttribute('data-member-id'), thinkingSelect.value);
			return;
		}

		const editField = e.target.closest('[data-edit-field]');
		if (editField) {
			controller.updateEditDraft(editField.getAttribute('data-edit-field'), editField.value);
		}
	});

	host.addEventListener('input', (e) => {
		const talkInput = e.target.closest('.talk-composer textarea');
		if (talkInput) {
			controller.setDraft(talkInput.value);
			const restored = contentEl.querySelector('.talk-composer textarea');
			if (restored) {
				restored.focus();
				restored.setSelectionRange(restored.value.length, restored.value.length);
			}
		}
	});

	if (options.liveScript && urlStep === undefined && typeof window !== 'undefined') {
		const timers = [];
		controller.stepTimestampsMs.forEach((delayMs, idx) => {
			if (idx > controller.state.stepIndex) {
				timers.push(setTimeout(() => {
					controller.stepTo(idx);
				}, delayMs));
			}
		});
		host._liveTimers = timers;
	}

	if (typeof window !== 'undefined') {
		window.__teamController = controller;
	}
	host.__teamController = controller;
	return host;
}

export const mountTeamPrototype = mountTeamStory;
