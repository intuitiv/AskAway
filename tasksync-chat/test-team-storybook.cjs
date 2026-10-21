#!/usr/bin/env node
/**
 * Caller-view verification suite for the Team tab & AITalk side-by-side Storybook prototype
 * (specs/010-team/comparison-prompt.md, sections 1–6).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
let passed = 0;

function pass(label) {
	passed += 1;
	console.log(`PASS: ${label}`);
}

function stripTags(html) {
	return String(html || '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function assertSingleVisiblePanel(html, expectedActiveTab, contextLabel) {
	assert.ok(!html.includes('team-split-canvas') && !html.includes('team-split-panes'), `${contextLabel}: must not render side-by-side split panes`);
	const aitalkTagMatch = html.match(/<section[^>]*id="panel-aitalk"[^>]*>/);
	const teamTagMatch = html.match(/<section[^>]*id="panel-team"[^>]*>/);
	assert.ok(aitalkTagMatch && teamTagMatch, `${contextLabel}: both #panel-aitalk and #panel-team tab panels must exist`);
	const aitalkTag = aitalkTagMatch[0];
	const teamTag = teamTagMatch[0];
	const aitalkHidden = /\bhidden\b/.test(aitalkTag);
	const teamHidden = /\bhidden\b/.test(teamTag);
	assert.notStrictEqual(aitalkHidden, teamHidden, `${contextLabel}: exactly one tab panel must be visible (not hidden) at a time`);
	if (expectedActiveTab === 'aitalk') {
		assert.ok(!aitalkHidden && aitalkTag.includes('pane-active'), `${contextLabel}: #panel-aitalk must be visible and active`);
		assert.ok(teamHidden && !teamTag.includes('pane-active'), `${contextLabel}: #panel-team must be hidden when AITalk is active`);
	} else {
		assert.ok(!teamHidden && teamTag.includes('pane-active'), `${contextLabel}: #panel-team must be visible and active`);
		assert.ok(aitalkHidden && !aitalkTag.includes('pane-active'), `${contextLabel}: #panel-aitalk must be hidden when Team is active`);
	}
}

(async () => {
	const teamProtoUrl = pathToFileURL(path.join(ROOT, 'storybook', 'prototypes', 'team.js')).href;
	const storiesUrl = pathToFileURL(path.join(ROOT, 'storybook', 'stories', 'Team.stories.js')).href;
	const talkProtoUrl = pathToFileURL(path.join(ROOT, 'storybook', 'prototypes', 'talk.js')).href;
	const avatarsUrl = pathToFileURL(path.join(ROOT, 'storybook', 'fixtures', 'avatars', 'index.js')).href;
	const mainConfigUrl = pathToFileURL(path.join(ROOT, 'storybook', '.storybook', 'main.js')).href;

	const teamProto = await import(teamProtoUrl);
	const storiesMod = await import(storiesUrl);
	const talkProtoMod = await import(talkProtoUrl);
	const avatarsMod = await import(avatarsUrl);
	const mainConfigMod = await import(mainConfigUrl);

	const {
		PRODUCTION_TABS,
		AVAILABLE_TEAM_MODELS,
		TEAM_ROSTER_FIXTURES,
		VALIDATOR_TRACE_FIXTURES,
		USER_PROFILE_FIXTURE,
		USER_PROFILE_RUNTIME_SRC,
		USER_PROFILE_FALLBACK_AVATAR,
		ALLOWED_EDIT_FIELDS,
		avatarFor,
		avatarFallbackFor,
		effortsForModel,
		resolveMainAgentIdentity,
		memberCostSummary,
		createTeamController,
		mountTeamStory,
		getWorkersKit,
	} = teamProto;

	// ── 1. Top tab bar: 5 production tabs, Workers renamed Team, no extras ──
	{
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		const html = ctrl.renderHtml();
		assertSingleVisiblePanel(html, 'team', 'Check 1 initial render');

		assert.deepStrictEqual(
			PRODUCTION_TABS.map((t) => t.label),
			['AITalk', 'Specs', 'Trace', 'Team', 'Settings'],
			'Production tab labels must be exactly AITalk, Specs, Trace, Team, Settings'
		);

		const tabBarMatch = html.match(/<nav class="widget-tabs tab-bar"[\s\S]*?<\/nav>/);
		assert.ok(tabBarMatch, 'Rendered HTML must contain <nav class="widget-tabs tab-bar">');
		const tabLabels = [...tabBarMatch[0].matchAll(/<button[^>]*data-tab="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
			.map((m) => ({ id: m[1], label: m[2].trim() }));
		assert.deepStrictEqual(
			tabLabels,
			[
				{ id: 'aitalk', label: 'AITalk' },
				{ id: 'specs', label: 'Specs' },
				{ id: 'observability', label: 'Trace' },
				{ id: 'team', label: 'Team' },
				{ id: 'settings', label: 'Settings' },
			],
			'Rendered tab bar must have the 5 production tabs (aitalk, specs, observability, team, settings) with Workers renamed Team and no extra buttons'
		);
		assert.ok(!tabBarMatch[0].includes('Workers'), 'Tab bar must not show legacy Workers label');
		assert.ok(!html.includes('team-summary-bar'), 'Team tab must not render a top rollup summary bar');
		assert.ok(!html.includes('team-sim-bar'), 'Team tab must not render a simulation bar');
		assert.ok(!html.includes('Add member'), 'Team tab must not render an Add member button');
		assert.ok(!html.includes('New session'), 'Team tab must not render a New session button');
		pass('1. Top tab bar renders the 5 production tabs with Workers renamed Team and no extra tabs or buttons');
	}

	// ── 2. Roster of 11 members, simple first names, roles only in Team tab (Rhea is user-level only, 2026-10-16) ──
	{
		assert.strictEqual(TEAM_ROSTER_FIXTURES.length, 11, 'TEAM_ROSTER_FIXTURES must have 11 members');
		const expectedNames = [
			'Mahesh', 'Bhaskar', 'Priya', 'Anika', 'Diego', 'Tara',
			'Pavel', 'Paolo', 'Sana', 'Shreya', 'Cathy',
		];
		assert.deepStrictEqual(
			TEAM_ROSTER_FIXTURES.map((m) => m.name),
			expectedNames,
			'TEAM_ROSTER_FIXTURES names must match the 11-member table'
		);
		for (const m of TEAM_ROSTER_FIXTURES) {
			assert.ok(/^[A-Z][a-z]+$/.test(m.name), `Member name "${m.name}" must be a simple first name without prefixes or dots`);
			assert.ok(m.role && m.role.length > 0, `Member "${m.name}" must have a role`);
			assert.ok(m.workingStatus && m.idleStatus, `Member "${m.name}" must have creative working & idle statuses`);
		}

		// Activate all 12 members in a turn to verify every row in Team tab vs AITalk
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		for (const m of ctrl.state.members) {
			ctrl.memberJoin(m.id, { working: true });
			// Team shows a member only with Turn spend (R-TEAM-52), so give every member some.
			m.turnDollars = Math.max(m.turnDollars || 0, 0.05);
		}
		const html = ctrl.renderHtml();
		const [aitalkPaneHtml, teamPaneHtml] = html.split('id="panel-team"');

		for (const m of TEAM_ROSTER_FIXTURES) {
			// Like production, the main-agent row is the selected chat agent only (Bhaskar for AskAway Build).
			if (m.kind === 'main' && m.id !== ctrl.state.mainMemberId) {
				assert.ok(!teamPaneHtml.includes(`data-member-row="${m.id}"`), `unselected main agent ${m.name} has no Team row`);
				continue;
			}
			// agy reports no cost, so an agy member's Turn is $0 and Team hides it (R-TEAM-52) unless it is Priya.
			const shown = m.id === 'priya' || !String(m.model).startsWith('agy/');
			assert.strictEqual(
				teamPaneHtml.includes(`<strong class="team-member-name">${m.name}</strong> &middot; <span class="team-member-role">${m.role}</span>`),
				shown,
				`Team tab ${shown ? 'must render' : 'hides the $0 agy member'} "${m.name} · ${m.role}"`
			);
			assert.ok(
				!aitalkPaneHtml.includes(`${m.name} · ${m.role}`) && !aitalkPaneHtml.includes(`${m.name} &middot; ${m.role}`),
				`AITalk pane must never display role "${m.name} · ${m.role}"`
			);
		}
		assert.ok(!aitalkPaneHtml.includes('team-member-role'), 'AITalk pane must not contain .team-member-role elements');
		pass('2. Roster has all 11 members with simple first names, creative statuses, and roles shown only in Team tab');
	}

	// ── 3. Avatars & AITalk header: header names have no <img>; Machs uses /user-profile/avatar.png with user.svg fixture fallback ──
	{
		const userSvgPath = path.join(ROOT, USER_PROFILE_FIXTURE.fixturePath);
		assert.strictEqual(USER_PROFILE_FIXTURE.name, 'Machs', 'User profile name must be Machs');
		assert.strictEqual(USER_PROFILE_RUNTIME_SRC, '/user-profile/avatar.png', 'User runtime avatar src must be /user-profile/avatar.png');
		assert.strictEqual(USER_PROFILE_FIXTURE.fixturePath, 'storybook/fixtures/avatars/user.svg');
		assert.ok(fs.existsSync(userSvgPath), 'storybook/fixtures/avatars/user.svg fallback fixture must exist on disk');
		assert.ok(!fs.existsSync(path.join(ROOT, 'storybook', 'fixtures', 'avatars', 'avatar.png')), 'User avatar.png must never be copied into the repo');
		assert.ok(!fs.existsSync(path.join(ROOT, 'storybook', 'fixtures', 'avatars', 'user.png')), 'User avatar.png must never be copied as user.png into the repo');
		assert.ok(USER_PROFILE_FALLBACK_AVATAR.startsWith('data:image/svg+xml;utf8,'), 'User fallback avatar must be an SVG data URI');
		assert.strictEqual(avatarFallbackFor('machs'), USER_PROFILE_FALLBACK_AVATAR, 'avatarFallbackFor("machs") returns SVG fixture fallback');
		assert.strictEqual(avatarFallbackFor('user'), USER_PROFILE_FALLBACK_AVATAR, 'avatarFallbackFor("user") returns SVG fixture fallback');

		// Verify Storybook main.js staticDirs mapping for ~/.askaway/profile -> /user-profile
		const expectedProfileDir = path.join(os.homedir(), '.askaway', 'profile');
		assert.strictEqual(mainConfigMod.USER_PROFILE_DIR, expectedProfileDir, 'Storybook main.js exports USER_PROFILE_DIR = ~/.askaway/profile');
		assert.strictEqual(mainConfigMod.USER_PROFILE_STATIC_MOUNT, '/user-profile', 'Storybook main.js mounts profile dir at /user-profile');
		if (fs.existsSync(expectedProfileDir)) {
			assert.ok(
				Array.isArray(mainConfigMod.default.staticDirs) &&
				mainConfigMod.default.staticDirs.some((d) => d.from === expectedProfileDir && d.to === '/user-profile'),
				'Storybook main.js maps ~/.askaway/profile to /user-profile in staticDirs when folder exists'
			);
		}

		assert.strictEqual(avatarsMod.avatarFor, avatarFor, 'Single lookup function avatarFor(memberId) is shared');
		const machsUri = avatarFor('machs');
		assert.strictEqual(machsUri, '/user-profile/avatar.png', 'avatarFor("machs") returns /user-profile/avatar.png');

		for (const m of TEAM_ROSTER_FIXTURES) {
			const uri = avatarFor(m.id);
			assert.ok(uri.startsWith('data:image/svg+xml;utf8,'), `avatarFor("${m.id}") must return SVG data URI`);
			assert.strictEqual(avatarFor(m.name), uri, `avatarFor("${m.name}") resolves same URI as id "${m.id}"`);
		}

		// Advance to step 7 and open @Di autocomplete so all avatar surfaces are present simultaneously for Diego & Machs
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 7, activeTab: 'aitalk' });
		ctrl.setDraft('@Di');
		ctrl.state.members.find((m) => m.id === 'diego').turnDollars = 0.05; // a member shows in Team only with Turn spend
		const html = ctrl.renderHtml();
		const diegoUri = avatarFor('diego');

		// (a) AITalk header below room name: plain list of present names with NO <img> or avatar badges
		const titleRegionMatch = html.match(/<div class="talk-title"><h2>AITalk<\/h2><div class="talk-subtitle">([\s\S]*?)<\/div><\/div>/);
		assert.ok(titleRegionMatch, 'AITalk header must render <h2>AITalk</h2> followed by .talk-subtitle');
		const subtitleHtml = titleRegionMatch[1];
		assert.ok(!/<img\b/i.test(subtitleHtml), 'AITalk header names line below room name must not contain any <img>');
		assert.ok(!subtitleHtml.includes('team-avatar-badge'), 'AITalk header names line must not contain .team-avatar-badge');
		assert.ok(
			subtitleHtml.includes('<span class="aitalk-roster-member" data-member-id="priya"><span class="aitalk-roster-name" data-member-id="priya">Priya</span></span>') &&
			subtitleHtml.includes('<span class="aitalk-roster-member" data-member-id="diego"><span class="aitalk-roster-name" data-member-id="diego">Diego</span></span>'),
			'AITalk header lists present names with clickable data-member-id and no images'
		);

		// (b) AITalk join/leave notices keep avatars
		assert.ok(
			html.includes(`<div class="talk-pill-row aitalk-presence" data-actor="diego" data-member-id="diego"><span class="team-avatar-badge aitalk-inline-face has-image" data-member-id="diego" data-initials="DI"><img class="team-avatar-img" src="${diegoUri}"`),
			'Diego avatar URI renders in AITalk join/leave notices'
		);
		// (c) AITalk message bubbles (Machs user bubble with /user-profile/avatar.png + user.svg fallback, and Diego member bubble)
		assert.ok(
			html.includes(`data-member-id="machs" aria-hidden="true"><span class="team-avatar-badge aitalk-bubble-face has-image" data-member-id="machs" data-initials="MA"><img class="team-avatar-img" src="/user-profile/avatar.png" alt="" data-alt="Machs" data-fixture-path="storybook/fixtures/avatars/user.svg" data-fallback-src="${USER_PROFILE_FALLBACK_AVATAR}"`),
			'Machs runtime avatar (/user-profile/avatar.png) with user.svg fixture fallback renders in AITalk user message bubble'
		);
		assert.ok(
			html.includes(`data-member-id="diego" aria-hidden="true"><span class="team-avatar-badge aitalk-bubble-face has-image" data-member-id="diego" data-initials="DI"><img class="team-avatar-img" src="${diegoUri}"`),
			'Diego avatar URI renders in AITalk member message bubble'
		);
		// (d) @ autocomplete menu
		assert.ok(
			html.includes(`class="talk-mention-option aitalk-ac-item active" data-member-id="diego"`) &&
			html.includes(`<span class="team-avatar-badge aitalk-ac-face has-image" data-member-id="diego" data-initials="DI"><img class="team-avatar-img" src="${diegoUri}"`),
			'Diego avatar URI renders in @ autocomplete menu'
		);
		// (e) Team tab member row (28px compact portrait)
		assert.ok(
			html.includes(`<div class="team-member-portrait team-compact-portrait" data-member-id="diego"><span class="team-avatar-badge team-portrait-56 has-image" data-member-id="diego" data-initials="DI"><img class="team-avatar-img" src="${diegoUri}"`),
			'Diego avatar URI renders as 28px portrait in Team tab member row'
		);

		// Override Diego's avatar URI once and verify all 4 avatar surfaces (join notice, bubble, @ menu, Team row) update automatically
		const customUri = 'data:image/svg+xml;utf8,custom-diego-portrait';
		const overrideCtrl = createTeamController({
			scenario: 'active-turn',
			initialStep: 7,
			avatarOverrides: { diego: customUri },
		});
		overrideCtrl.setDraft('@Di');
		overrideCtrl.state.members.find((m) => m.id === 'diego').turnDollars = 0.05;
		const overrideHtml = overrideCtrl.renderHtml();
		const occurrences = overrideHtml.split(`src="${customUri}"`).length - 1;
		assert.ok(occurrences >= 4, `Overriding avatarFor("diego") updates all avatar surfaces (observed ${occurrences} occurrences)`);
		pass('3. AITalk header lists names without <img>; Machs uses /user-profile/avatar.png with user.svg fixture fallback; member avatars resolve via avatarFor(memberId)');
	}

	// ── 4. Active native agent resolution: Orchestrator, Build, Unknown ──
	{
		const orch = resolveMainAgentIdentity('AA.Orchestrator');
		assert.strictEqual(orch.name, 'Mahesh');
		assert.strictEqual(orch.role, 'Orchestrator');

		const build = resolveMainAgentIdentity('AskAway Build');
		assert.strictEqual(build.name, 'Bhaskar');
		assert.strictEqual(build.role, 'Tech Lead');

		const unknown = resolveMainAgentIdentity('Custom.Planner');
		assert.strictEqual(unknown.name, 'Custom.Planner');
		assert.strictEqual(unknown.initials, 'CP');
		assert.strictEqual(unknown.isUnknownAgent, true);

		// Story 2: OrchestratorSelected
		const orchCtrl = createTeamController({ scenario: 'orchestrator', selectedAgent: 'AA.Orchestrator' });
		const orchHtml = orchCtrl.renderHtml();
		const [orchTalkHtml, orchTeamHtml] = orchHtml.split('id="panel-team"');
		assert.ok(orchTalkHtml.includes('data-member-id="mahesh"'), 'OrchestratorSelected uses Mahesh in AITalk');
		assert.ok(!orchTalkHtml.includes('AA.Orchestrator'), 'OrchestratorSelected never leaks raw AA.Orchestrator name in AITalk');
		assert.ok(
			orchTeamHtml.includes('data-member-id="mahesh"'),
			'OrchestratorSelected includes Mahesh row in Team tab'
		);

		// Story 3: UnknownAgent
		const unkCtrl = createTeamController({ scenario: 'unknown-agent', selectedAgent: 'Custom.Planner' });
		const unkHtml = unkCtrl.renderHtml();
		const [unkTalkHtml, unkTeamHtml] = unkHtml.split('id="panel-team"');
		assert.ok(unkTalkHtml.includes('Custom.Planner'), 'UnknownAgent shows actual agent name Custom.Planner in AITalk');
		assert.ok(unkTeamHtml.includes('data-member-id="custom-planner"'), 'UnknownAgent renders default row for Custom.Planner');
		assert.ok(unkTeamHtml.includes('>CP<'), 'UnknownAgent renders initials badge CP');
		assert.ok(
			!unkTeamHtml.includes('data-member-id="mahesh"'),
			'UnknownAgent never silently falls back to Mahesh as working main agent'
		);
		pass('4. Active native agent resolution maps AA.Orchestrator → Mahesh, AskAway Build → Bhaskar, and Unknown → actual name with initials');
	}

	// ── 5. Clicking a member name or @mention in AITalk switches active tab to Team & highlights row; tab strip switches back ──
	{
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4, activeTab: 'aitalk' });
		assertSingleVisiblePanel(ctrl.renderHtml(), 'aitalk', 'Before clicking name in AITalk');

		const selected = ctrl.selectMemberFromTalk('@Anika');
		assert.ok(selected && selected.id === 'anika', 'selectMemberFromTalk("@Anika") resolves Anika');
		assert.strictEqual(ctrl.state.activeTab, 'team', 'Clicking @Anika switches activeTab to team');
		assert.strictEqual(ctrl.state.highlightedMemberId, 'anika', 'Clicking @Anika highlights anika row');

		const html = ctrl.renderHtml();
		assertSingleVisiblePanel(html, 'team', 'After clicking @Anika in AITalk');
		assert.ok(
			/class="team-member-row team-compact-row team-member-row-highlighted is-highlighted is-working" data-member-id="anika"/.test(html),
			'Anika row in Team tab has .is-highlighted class after clicking @Anika in AITalk'
		);
		assert.ok(
			html.includes('class="widget-tab tab-btn active" id="tab-team" data-tab="team"'),
			'Team tab button is active after clicking @Anika in AITalk'
		);

		// Switching back via tab strip restores AITalk panel as the single visible panel
		ctrl.switchTab('aitalk');
		assert.strictEqual(ctrl.state.activeTab, 'aitalk', 'switchTab("aitalk") switches back to AITalk tab');
		assertSingleVisiblePanel(ctrl.renderHtml(), 'aitalk', 'After switching back to AITalk via tab strip');
		pass('5. Clicking a member name or @mention in AITalk switches to Team tab (one visible panel) and highlights that member row');
	}

	// ── 6. [n tasks ▸] pill collapsed by default, toggles open/closed, survives re-renders ──
	{
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		const initialHtml = ctrl.renderHtml();
		assert.ok(
			initialHtml.includes('data-toggle-tasks="diego" data-toggle-trace="diego" aria-expanded="false">2 tasks ▸</button>'),
			'Diego task pill is collapsed by default (aria-expanded="false" and "2 tasks ▸")'
		);
		assert.ok(
			!initialHtml.includes('data-member-tasks="diego"'),
			'Diego task drawer is not rendered when collapsed'
		);

		// Toggle open
		const isOpen = ctrl.toggleMemberTasks('diego');
		assert.strictEqual(isOpen, true, 'toggleMemberTasks opens Diego drawer');
		const openHtml = ctrl.renderHtml();
		assert.ok(
			openHtml.includes('data-toggle-tasks="diego" data-toggle-trace="diego" aria-expanded="true">2 tasks ▾</button>'),
			'Open pill has aria-expanded="true" and "2 tasks ▾"'
		);
		assert.ok(
			openHtml.includes('data-member-tasks="diego"'),
			'Open drawer renders data-member-tasks="diego"'
		);

		// Survives timeline advance / re-render
		ctrl.stepTo(6);
		const afterAdvanceHtml = ctrl.renderHtml();
		assert.ok(
			afterAdvanceHtml.includes('data-toggle-tasks="diego" data-toggle-trace="diego" aria-expanded="true">2 tasks ▾</button>'),
			'Expanded task pill survives state updates and re-renders'
		);

		// Toggle closed
		const isOpenAfterClose = ctrl.toggleMemberTasks('diego');
		assert.strictEqual(isOpenAfterClose, false, 'Second toggleMemberTasks closes Diego drawer');
		pass('6. [n tasks ▸] pill is collapsed by default, toggles open/closed, and survives re-renders');
	}

	// ── 7. Expanded task cards use renderWorkersHtml; Priya expands to shared traceRowsHtml; Trace story shows main agent only ──
	{
		const kit = getWorkersKit();
		assert.strictEqual(typeof kit.renderWorkersHtml, 'function', 'Real renderWorkersHtml loaded from media/webview.js');
		assert.strictEqual(typeof kit.traceRowsHtml, 'function', 'Real traceRowsHtml loaded from media/webview.js');

		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		ctrl.toggleMemberTasks('priya');
		ctrl.toggleMemberTasks('anika');
		ctrl.toggleMemberTasks('diego');
		ctrl.toggleTaskTrace('worker-anika-1');
		const html = ctrl.renderHtml();

		assert.ok(html.includes('class="worker-card"'), 'Expanded drawer renders real .worker-card from renderWorkersHtml');
		assert.ok(html.includes('class="worker-card-head"'), 'Expanded drawer renders .worker-card-head from renderWorkersHtml');
		assert.ok(html.includes('class="worker-banner-metrics"'), 'Expanded drawer renders .worker-banner-metrics from usageBannerHtml');
		assert.ok(html.includes('class="obs-event-request"'), 'Expanded trace renders .obs-event-request rows from traceRowsHtml');

		// Verify Priya's expanded row in Team contains the exact shared traceRowsHtml output
		const expectedPriyaTraceRows = kit.traceRowsHtml(VALIDATOR_TRACE_FIXTURES, { openIds: {}, now: ctrl.state.now });
		assert.ok(html.includes('data-validator-trace="priya"'), 'Priya row expands to validator trace table in Team tab');
		assert.ok(html.includes(expectedPriyaTraceRows), 'Priya expanded trace in Team tab reuses shared traceRowsHtml output');

		// Verify Trace tab story shows the main agent only (no Validator or workers)
		assert.strictEqual(talkProtoMod.traceSessions.length, 1, 'traceSessions in talkFixtures.js has only 1 session (main agent)');
		assert.strictEqual(talkProtoMod.traceSessions[0].label, 'Agent session', 'traceSessions[0] is the main Agent session');
		const traceStoryHtml = talkProtoMod.traceHtml(talkProtoMod.traceSessions, kit.traceRowsHtml);
		assert.ok(traceStoryHtml.includes('Agent session'), 'Trace tab story renders main Agent session');
		assert.ok(!traceStoryHtml.includes('Validator session'), 'Trace tab story does not render Validator session');
		const traceStoriesSrc = fs.readFileSync(path.join(ROOT, 'storybook', 'stories', 'Trace.stories.js'), 'utf8');
		assert.ok(traceStoriesSrc.includes('Main agent only'), 'Trace.stories.js labels the story as Main agent only');

		// Check visible text inside Team pane has no user-visible "worker" word
		const [, teamPaneHtml] = html.split('id="panel-team"');
		const visibleText = stripTags(teamPaneHtml);
		assert.ok(!/\bworker(s)?\b/i.test(visibleText), 'No user-visible "worker" text appears in rendered Team UI');
		pass('7. Expanded task cards use renderWorkersHtml; Priya expands to shared traceRowsHtml in Team; Trace story shows main agent only');
	}

	// ── 8. Per-member turn & month cost in Team rows; agy cost is $0 (replacing "cost unreported") and omits ping / cache age / warmth ──
	{
		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		ctrl.toggleMemberTasks('diego'); // Diego runs on agy/gemini-4-argon-high
		const html = ctrl.renderHtml();
		const [, teamPaneHtml] = html.split('id="panel-team"');

		// Every active member row shows Turn and Month cost
		for (const memberId of ['priya', 'bhaskar', 'anika', 'diego']) {
			const m = ctrl.findMember(memberId);
			const cost = memberCostSummary(m);
			assert.ok(
				teamPaneHtml.includes(`data-member-cost="${memberId}" data-turn-cost="${cost.turnCostText}" data-month-cost="${cost.monthCostText}"`),
				`Member "${memberId}" row in Team tab shows turn cost (${cost.turnCostText}) and month cost (${cost.monthCostText})`
			);
		}

		// Non-agy members show non-zero turn & month costs; agy member Diego shows $0 for both turn and month
		assert.ok(
			teamPaneHtml.includes('data-member-cost="priya" data-turn-cost="$0.01" data-month-cost="$1.42"'),
			'Priya row shows Turn $0.01 · Month $1.42'
		);
		assert.ok(
			teamPaneHtml.includes('data-member-cost="bhaskar" data-turn-cost="$0.08" data-month-cost="$6.80"'),
			'Bhaskar row shows Turn $0.08 · Month $6.80'
		);
		assert.ok(
			teamPaneHtml.includes('data-member-cost="anika" data-turn-cost="$0.02" data-month-cost="$3.10"'),
			'Anika row shows Turn $0.02 · Month $3.10'
		);
		assert.ok(
			teamPaneHtml.includes('data-member-cost="diego" data-turn-cost="$0.02" data-month-cost="$0.02"'),
			'Diego row shows Turn $0.02 (his Sol task; his agy task adds $0) · Month $0.02 (the one Team money format)'
		);

		const diegoPanelIdx = html.indexOf('data-member-tasks="diego"');
		assert.ok(diegoPanelIdx !== -1, 'Diego task panel is rendered');
		const agyCardIdx = html.indexOf('data-worker-id="worker-diego-2"', diegoPanelIdx);
		assert.ok(agyCardIdx !== -1, 'Diego agy task card is rendered');
		const diegoPanelHtml = html.slice(agyCardIdx, html.indexOf('</section>', agyCardIdx));

		assert.ok(diegoPanelHtml.includes('$0'), 'agy task card shows "$0" cost');
		assert.ok(!/cost unreported|unreported/i.test(html), 'Rendered HTML never shows "cost unreported" or "unreported"');
		assert.ok(!diegoPanelHtml.includes('health-cache'), 'agy task card omits cache age/warmth badge');
		assert.ok(!diegoPanelHtml.includes('Age:'), 'agy task card omits cache age text');
		assert.ok(!diegoPanelHtml.includes('warm for'), 'agy task card omits cache warmth text');
		assert.ok(!diegoPanelHtml.includes('pinged'), 'agy task card omits ping timestamp');
		pass('8. Each Team member row shows turn and month cost; agy shows $0 (never "cost unreported") and omits ping, cache age, and warmth');
	}

	// ── 9. Model dropdown, effort filtering, agy suffix sync, intents, task model preservation, duplicate @name disambiguation ──
	{
		const adapters = new Set(AVAILABLE_TEAM_MODELS.map((m) => m.adapter));
		assert.ok(adapters.has('opencode') && adapters.has('agy'), 'Model catalog includes both opencode (github-copilot/*) and agy providers');
		assert.deepStrictEqual(
			effortsForModel('agy/gemini-3.1-pro-high'),
			['high', 'low'],
			'gemini-3.1-pro filters effort options to high and low only'
		);
		assert.deepStrictEqual(
			effortsForModel('agy/gemini-4-argon-high'),
			['high', 'medium', 'low'],
			'gemini-4-argon supports high, medium, and low efforts'
		);

		const ctrl = createTeamController({ scenario: 'active-turn', initialStep: 4 });
		const anikaBefore = ctrl.findMember('anika');
		assert.strictEqual(anikaBefore.tasks[0].model, 'github-copilot/claude-opus-5.5');

		// Change Anika's model to agy/gemini-4-argon-low -> thinking syncs to low, existing task keeps claude-opus-5.5
		ctrl.setMemberModel('anika', 'agy/gemini-4-argon-low');
		const lastIntent1 = ctrl.state.intents.at(-1);
		assert.deepStrictEqual(lastIntent1, {
			type: 'setMemberModel',
			memberId: 'anika',
			model: 'agy/gemini-4-argon-low',
			thinking: 'low',
		});
		assert.strictEqual(ctrl.findMember('anika').thinking, 'low', 'agy model suffix -low syncs member thinking to low');
		assert.strictEqual(
			ctrl.findMember('anika').tasks[0].model,
			'github-copilot/claude-opus-5.5',
			'Changing a member model does not rewrite existing task models'
		);

		// Change Anika's thinking to high -> agy model suffix syncs to agy/gemini-4-argon-high
		ctrl.setMemberThinking('anika', 'high');
		const lastIntent2 = ctrl.state.intents.at(-1);
		assert.deepStrictEqual(lastIntent2, {
			type: 'setMemberModel',
			memberId: 'anika',
			model: 'agy/gemini-4-argon-high',
			thinking: 'high',
		});

		// Change Priya (always shown; an agy member has $0 Turn and Team hides it otherwise) to agy/gemini-3.1-pro-high and render to verify medium is omitted in select
		ctrl.setMemberModel('priya', 'agy/gemini-3.1-pro-high');
		const html = ctrl.renderHtml();
		const priyaThinkingSelectMatch = html.match(/<select class="team-thinking-select" data-member-id="priya"[^>]*>([\s\S]*?)<\/select>/);
		assert.ok(priyaThinkingSelectMatch, 'Priya thinking select is rendered');
		assert.ok(priyaThinkingSelectMatch[1].includes('value="high"'), 'gemini-3.1-pro thinking select includes high');
		assert.ok(priyaThinkingSelectMatch[1].includes('value="low"'), 'gemini-3.1-pro thinking select includes low');
		assert.ok(!priyaThinkingSelectMatch[1].includes('value="medium"'), 'gemini-3.1-pro thinking select omits medium');

		// Agent file ↗ intent
		const fileIntent = ctrl.openAgentFile('anika');
		assert.deepStrictEqual(fileIntent, {
			type: 'openAgentFile',
			memberId: 'anika',
			path: '.github/agents/build.agent.md',
			profile: 'build',
		});

		// Duplicate first-name disambiguation in @autocomplete & routing by memberId
		const dupCtrl = createTeamController({
			scenario: 'active-turn',
			initialStep: 4,
			extraMembers: [
				{
					id: 'diego-sec',
					name: 'Diego',
					role: 'Security Reviewer',
					profile: 'audit',
					model: 'github-copilot/claude-sonnet-5.5',
					thinking: 'medium',
					agentFile: '.github/agents/audit.agent.md',
					activeInTurn: true,
					present: true,
				},
			],
		});
		const cands = dupCtrl.setDraft('@Diego');
		assert.strictEqual(cands.length, 2, 'Both active Diego members appear in @Diego autocomplete');
		const dupHtml = dupCtrl.renderHtml();
		assert.ok(
			dupHtml.includes('data-member-id="diego" data-mention="Diego" data-role="Developer" data-disambiguated="true"') &&
			dupHtml.includes('data-member-id="diego-sec" data-mention="Diego" data-role="Security Reviewer" data-disambiguated="true"'),
			'Duplicate first names in @autocomplete show their role to disambiguate'
		);
		dupCtrl.pickAutocomplete('diego-sec');
		dupCtrl.sendUserMessage('@Diego Please review the auth boundary.');
		assert.strictEqual(dupCtrl.state.routedMessages.at(-1).memberId, 'diego-sec', 'Message routes to the selected memberId diego-sec');
		pass('9. Model dropdown, effort filtering, agy suffix sync, intents, task model preservation, and @name disambiguation work as specified');
	}

	// ── 10. Member Edit view has only the 5 allowed fields & live updates AITalk ──
	{
		assert.deepStrictEqual(ALLOWED_EDIT_FIELDS, ['name', 'role'], 'Edit is the profile: name and role (plus picture); the status phrases are fixed');
		const editCtrl = createTeamController({ scenario: 'member-edit', editingMemberId: 'diego' });
		const editHtml = editCtrl.renderHtml();
		const form = /<div class="team-member-edit-form" data-member-edit-form="diego">[\s\S]*?<\/div><\/div>/.exec(editHtml);
		assert.ok(form, 'Edit opens the shared inline profile form under the row (no modal)');
		assert.deepStrictEqual([...form[0].matchAll(/data-member-edit-field="([^"]+)"/g)].map((m) => m[1]), ['name', 'role'], 'form fields');
		assert.ok(form[0].includes('data-member-pick-picture="diego"'), 'form picks a picture');
		assert.ok(!/team-edit-modal|data-edit-field|agentFile/.test(editHtml), 'no Storybook-only modal');
		assert.ok(!/temperature|permissions|tool checkboxes|system prompt/i.test(form[0]), 'MemberEdit does not expose forbidden fields');

		// Live edit of display name updates AITalk roster and bubbles
		editCtrl.updateEditDraft('name', 'DiegoV');
		editCtrl.updateEditDraft('status', 'Pairing on the parser');
		editCtrl.saveMemberEdit();
		const updatedHtml = editCtrl.renderHtml();
		const [updatedTalkHtml, updatedTeamHtml] = updatedHtml.split('id="panel-team"');
		assert.ok(updatedTalkHtml.includes('DiegoV'), 'Editing member name updates AITalk pane live');
		assert.ok(updatedTeamHtml.includes('DiegoV'), 'Editing member name updates Team pane live');
		assert.ok(!updatedTeamHtml.includes('Pairing on the parser'), 'A status edit is ignored: the status phrases are fixed');
		pass('10. Member Edit is the shared inline profile form (name, role, picture) and updates AITalk live');
	}

	// ── 11. All 6 stories exist, show one active tab panel at a time, and ActiveTurn timeline covers full multi-agent flow ──
	{
		assert.strictEqual(storiesMod.default.title, 'AITalk/Team tab', 'Storybook default title must be AITalk/Team tab');
		const requiredStories = [
			'ActiveTurn',
			'OrchestratorSelected',
			'UnknownAgent',
			'MemberEdit',
			'NameClickOpensProfile',
			'LightTheme',
		];
		for (const name of requiredStories) {
			assert.ok(storiesMod[name] && typeof storiesMod[name].render === 'function', `Story "${name}" must be exported`);
			const mounted = storiesMod[name].render();
			assert.ok(mounted && mounted.innerHTML.includes('team-storybook-shell'), `Story "${name}" renders .team-storybook-shell`);
			assertSingleVisiblePanel(mounted.innerHTML, mounted.controller.state.activeTab, `Story ${name}`);
		}

		// Verify NameClickOpensProfile starts in AITalk and clicking Priya switches to Team with Priya highlighted
		const nameClickMounted = storiesMod.NameClickOpensProfile.render();
		assert.strictEqual(nameClickMounted.controller.state.activeTab, 'team', 'NameClickOpensProfile switches activeTab to team');
		assert.strictEqual(nameClickMounted.controller.state.highlightedMemberId, 'priya', 'NameClickOpensProfile highlights priya row');
		assertSingleVisiblePanel(nameClickMounted.innerHTML, 'team', 'NameClickOpensProfile story');

		// Verify LightTheme renders data-theme="light"
		const lightMounted = mountTeamStory({ scenario: 'light', theme: 'light' });
		assert.ok(lightMounted.innerHTML.includes('data-theme="light"'), 'LightTheme renders [data-theme="light"]');

		// Play through ActiveTurn from step 0 to step 10
		const turnCtrl = createTeamController({ scenario: 'active-turn', initialStep: 0 });
		// At step 0 Team shows Priya, the selected main agent Bhaskar, then the members with Turn spend by Turn descending, ties in roster order (R-TEAM-52, order by weight 2026-10-21)
		const step0Html = turnCtrl.renderHtml();
		const [, step0TeamHtml] = step0Html.split('id="panel-team"');
		const step0RowIds = [...step0TeamHtml.matchAll(/class="team-member-row[^"]*" data-member-id="([^"]+)"/g)].map((m) => m[1]);
		assert.deepStrictEqual(step0RowIds, ['priya', 'bhaskar', 'anika', 'paolo', 'sana', 'tara'], 'At turn start, Team shows Priya, the main agent, then only the members with Turn spend, by Turn descending (ties in roster order)');

		// Advance through step 10
		turnCtrl.stepTo(10);
		const finalTurnHtml = turnCtrl.renderHtml();
		assert.ok(finalTurnHtml.includes('Anika joined'), 'ActiveTurn includes Anika joined notice');
		assert.ok(finalTurnHtml.includes('Diego joined'), 'ActiveTurn includes Diego joined notice');
		assert.ok(finalTurnHtml.includes('Tara joined'), 'ActiveTurn includes Tara joined notice');
		assert.ok(finalTurnHtml.includes('Diego left'), 'ActiveTurn includes Diego left notice');
		assert.ok(finalTurnHtml.includes('talk-quote'), 'ActiveTurn includes reply quote in AITalk');

		const diegoMember = turnCtrl.findMember('diego');
		assert.strictEqual(diegoMember.present, false, 'Diego has left the room at step 10');
		assert.strictEqual(diegoMember.activeInTurn, true, 'Diego stays visible in Team tab after leaving the room during the turn');
		assert.strictEqual(diegoMember.tasks.length, 2, 'Diego retains 2 completed tasks in the turn');
		assert.ok(diegoMember.tasks.every((t) => t.state === 'COMPLETED'), 'Both Diego tasks are marked COMPLETED');
		pass('11. All 6 stories are exported under AITalk/Team tab with one visible panel per story and ActiveTurn completes the full multi-agent timeline');
	}

	// ── 12. Fixed widget width across tabs & presence of Machs, Priya, and main agent from the start of every story ──
	{
		const talkCss = fs.readFileSync(path.join(ROOT, 'media', 'aitalk', 'talk.css'), 'utf8');
		const teamCss = fs.readFileSync(path.join(ROOT, 'media', 'team', 'team.css'), 'utf8');

		const talkProtoBlock = talkCss.match(/\.talk-prototype\s*\{([\s\S]*?)\}/);
		assert.ok(talkProtoBlock, 'talk.css defines .talk-prototype');
		const talkWidthMatch = talkProtoBlock[1].match(/\bwidth:\s*(\d+px)\s*;/);
		assert.ok(talkWidthMatch, '.talk-prototype defines fixed width in px');
		const expectedWidth = talkWidthMatch[1]; // '420px'
		assert.strictEqual(expectedWidth, '420px', 'AITalk widget width is 420px');

		const shellBlock = teamCss.match(/\.team-storybook-shell,\s*\.team-proto-root\s*\{([\s\S]*?)\}/);
		const panesBlock = teamCss.match(/\.team-storybook-shell \.team-pane\s*\{([\s\S]*?)\}/);
		const aitalkPaneBlock = teamCss.match(/\.team-aitalk-pane\s*\{([\s\S]*?)\}/);
		const teamPaneBlock = teamCss.match(/\.team-directory-pane\s*\{([\s\S]*?)\}/);
		const memberListBlock = teamCss.match(/\.team-member-list\s*\{([\s\S]*?)\}/);
		assert.ok(shellBlock && panesBlock && aitalkPaneBlock && teamPaneBlock && memberListBlock, 'team.css defines shell, pane, and member list rules');

		// Widths are var(--team-widget-width, 420px): the Storybook value with the sidebar fallback.
		const widthOf = (block) => (block.match(/\bwidth:\s*(?:var\(--team-widget-width,\s*)?(\d+px)\)?\s*;/) || [])[1];
		const shellWidth = widthOf(shellBlock[1]);
		const panesWidth = widthOf(panesBlock[1]);
		const aitalkPaneWidth = widthOf(aitalkPaneBlock[1]);
		const teamPaneWidth = widthOf(teamPaneBlock[1]);
		assert.strictEqual(shellWidth, expectedWidth, 'Team storybook shell width equals AITalk widget width (420px)');
		assert.strictEqual(teamPaneWidth, aitalkPaneWidth, 'Team panel width equals AITalk panel width');
		assert.strictEqual(teamPaneWidth, expectedWidth, 'Team panel width is fixed at 420px');
		assert.strictEqual(panesWidth, expectedWidth, 'Both #panel-aitalk and #panel-team share 420px width');
		assert.ok(/flex-direction:\s*column/.test(memberListBlock[1]), 'Member rows stack vertically inside the Team panel');
		assert.strictEqual(storiesMod.default.parameters?.layout, 'centered', 'Team.stories.js uses centered layout matching Talk.stories.js and Trace.stories.js');

		// Startup (before turn starts, initialStep: -1): Machs and Priya are in the room and listed in header
		const startupCtrl = createTeamController({ scenario: 'active-turn', initialStep: -1, activeTab: 'aitalk' });
		const startupHtml = startupCtrl.renderHtml();
		const startupRosterNames = [...startupHtml.matchAll(/<span class="aitalk-roster-name" data-member-id="[^"]+">([^<]+)<\/span>/g)].map((m) => m[1]);
		assert.deepStrictEqual(
			startupRosterNames,
			['Machs', 'Priya'],
			'At startup before the turn, the AITalk header lists the user (Machs) and Priya'
		);

		// At the start of every story (1..6), Machs, Priya, and the main agent are present in AITalk and the main agent's join notice is the first notice of the turn
		const storyExpectations = [
			{ key: 'ActiveTurn', expectedMainId: 'bhaskar', expectedMainName: 'Bhaskar' },
			{ key: 'OrchestratorSelected', expectedMainId: 'mahesh', expectedMainName: 'Mahesh' },
			{ key: 'UnknownAgent', expectedMainId: 'custom-planner', expectedMainName: 'Custom.Planner' },
			{ key: 'MemberEdit', expectedMainId: 'bhaskar', expectedMainName: 'Bhaskar' },
			{ key: 'NameClickOpensProfile', expectedMainId: 'bhaskar', expectedMainName: 'Bhaskar' },
			{ key: 'LightTheme', expectedMainId: 'bhaskar', expectedMainName: 'Bhaskar' },
		];

		for (const { key, expectedMainId, expectedMainName } of storyExpectations) {
			const mounted = storiesMod[key].render();
			const html = mounted.innerHTML;
			const snap = mounted.controller.room.snapshot();

			// Width attributes on both panels match
			const aitalkWidthAttr = (html.match(/id="panel-aitalk"[^>]*data-panel-width="(\d+)"/) || [])[1];
			const teamWidthAttr = (html.match(/id="panel-team"[^>]*data-panel-width="(\d+)"/) || [])[1];
			assert.strictEqual(teamWidthAttr, aitalkWidthAttr, `${key}: #panel-team width attribute equals #panel-aitalk width attribute`);
			assert.strictEqual(teamWidthAttr, '420', `${key}: panel width is 420px`);

			// Room snapshot has Machs, Priya, and main agent online from story start
			const onlineIds = snap.members.filter((m) => m.presence === 'online').map((m) => m.id);
			assert.ok(onlineIds.includes('machs'), `${key}: user (Machs) is online in AITalk room from story start`);
			assert.ok(onlineIds.includes('priya'), `${key}: Priya is online in AITalk room from story start`);
			assert.ok(onlineIds.includes(expectedMainId), `${key}: main agent (${expectedMainName}) is online in AITalk room from story start`);

			// Header roster lists Machs, Priya, and main agent first
			const headerNames = [...html.matchAll(/<span class="aitalk-roster-name" data-member-id="[^"]+">([^<]+)<\/span>/g)].map((m) => m[1]);
			assert.deepStrictEqual(
				headerNames.slice(0, 3),
				['Machs', 'Priya', expectedMainName],
				`${key}: AITalk header lists Machs, Priya, and ${expectedMainName} from story start`
			);

			// First notice of the turn is "<MainAgent> joined"
			const systemNotices = snap.messages.filter((m) => m.kind === 'system').map((m) => m.text);
			assert.ok(systemNotices.length >= 1, `${key}: turn has at least one system join notice`);
			assert.strictEqual(
				systemNotices[0],
				`${expectedMainName} joined`,
				`${key}: main agent's join notice ("${expectedMainName} joined") is the first notice of the turn`
			);
			const renderedNotices = [...html.matchAll(/<span class="aitalk-presence-label"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
			assert.strictEqual(
				renderedNotices[0],
				`${expectedMainName} joined`,
				`${key}: first rendered notice in AITalk DOM is "${expectedMainName} joined"`
			);
		}
		pass('12. Team panel width equals AITalk panel width (420px); Machs, Priya, and the main agent are present in AITalk from the start of every story; main agent join is first notice');
	}

	console.log(`\nALL ${passed} CHECKS PASSED`);
})().catch((err) => {
	console.error('FAIL:', err && err.stack ? err.stack : err);
	process.exit(1);
});
