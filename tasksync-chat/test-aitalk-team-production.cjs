#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
	const render = await import('./media/aitalk/talkRender.js');
	const rules = await import('./media/aitalk/talkRules.js');
	const presence = await import('./media/aitalk/presence.js');
	const { createTalkController } = await import('./media/aitalk/talkController.js');
	const teamProto = await import('./storybook/prototypes/team.js');
	const providerSource = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
	const enrichSource = providerSource.slice(providerSource.indexOf('        const enrichMembers ='), providerSource.indexOf('        const root =', providerSource.indexOf('        const enrichMembers =')));
	const enrichCode = require('typescript').transpileModule(`function enrich(state) { ${enrichSource} return enrichMembers(state); }`, { compilerOptions: { target: 9 } }).outputText;
	let probes = 0;
	const enrich = vm.runInNewContext(enrichCode + ';enrich', { fs: { existsSync(file) { probes++; return file.endsWith('one.svg'); } }, vscode: { Uri: { joinPath: (_uri, ...parts) => ({ fsPath: parts.join('/') }) } } });
	const provider = { _memberAvatarUris: new Map(), _extensionUri: { fsPath: '/extension' }, _view: { webview: { asWebviewUri: uri => 'webview:' + uri.fsPath } } };
	const original = Object.freeze({ members: Object.freeze([Object.freeze({ id: 'one' }), Object.freeze({ id: 'missing' })]) });
	const enriched = enrich.call(provider, original);
	assert.notEqual(enriched, original);
	assert.notEqual(enriched.members[0], original.members[0]);
	assert.match(enriched.members[0].avatarSrc, /^webview:/);
	const firstProbes = probes;
	const refreshed = enrich.call(provider, original);
	assert.equal(probes, firstProbes, 'positive and missing avatar lookups are cached across refreshes');
	assert.equal(refreshed.members[0].avatarSrc, enriched.members[0].avatarSrc);
	assert.equal(original.members[0].avatarSrc, undefined);
	const customMembers = [{ id: 'u', kind: 'user', rank: 400 }, { id: 'expert-42', memberId: 'stable-42', name: 'Zelda', displayName: 'Zelda', role: 'Reviewer', rank: 100 }];
	assert.match(render.textHtml('@Zelda @Mahesh', customMembers), /data-member-id="stable-42">@Zelda<\/b> @Mahesh/);
	assert.equal(rules.resolveRosterMember('Zelda', customMembers).id, 'expert-42');
	assert.equal(rules.resolveRosterMember('Mahesh', customMembers), undefined);
	assert.match(render.mentionsHtml(customMembers, { draft: '@Zelda' }), /data-member-id="stable-42"/);
	assert.doesNotMatch(render.avatarBadgeHtml({ id: 'a', avatarSrc: 'broken', fallbackAvatar: 'fallback' }), /onerror=/);
	assert.doesNotMatch(presence.presenceHtml({ mode: 'here', name: 'User', photo: 'broken', fallbackAvatar: 'fallback' }), /onerror=/);
	const duplicateChoices = render.mentionsHtml([
		{ id: 'user', kind: 'user', displayName: 'User', rank: 400 },
		{ id: 'one', memberId: 'one', name: 'Diego', displayName: 'Old developer label', role: 'Developer' },
		{ id: 'two', memberId: 'two', name: 'Diego', displayName: 'Old reviewer label', role: 'Security Reviewer' },
	], { draft: '@Diego' });
	assert.ok(duplicateChoices.includes('data-member-id="one" data-mention="Diego" data-role="Developer" data-disambiguated="true"'));
	assert.ok(duplicateChoices.includes('data-member-id="two" data-mention="Diego" data-role="Security Reviewer" data-disambiguated="true"'));

	const roster = [
		{
			id: 'machs',
			memberId: 'machs',
			displayName: 'Machs',
			name: 'Machs',
			role: 'User',
			kind: 'user',
			rank: 400,
			presencePolicy: 'alwaysPresent',
			presence: 'online',
			photo: 'https://example.test/machs.png',
			avatarSrc: 'https://example.test/machs.png',
			fixturePath: '~/.askaway/profile/avatar.png',
			fallbackAvatar: 'https://example.test/machs-fallback.svg',
			initials: 'MA',
		},
		{
			id: 'priya',
			memberId: 'priya',
			displayName: 'Priya',
			name: 'Priya',
			role: 'Product Owner',
			kind: 'validator',
			rank: 300,
			pinnedFirst: true,
			presencePolicy: 'alwaysPresent',
			presence: 'online',
			avatarSrc: 'https://example.test/priya.svg',
			initials: 'PR',
		},
		{
			id: 'bhaskar',
			memberId: 'bhaskar',
			displayName: 'Bhaskar',
			name: 'Bhaskar',
			role: 'Tech Lead',
			kind: 'agent',
			rank: 200,
			presencePolicy: 'joinsPerTurn',
			presence: 'online',
			avatarSrc: 'https://example.test/bhaskar.svg',
			initials: 'BH',
		},
		{
			id: 'diego',
			memberId: 'diego',
			displayName: 'Diego',
			name: 'Diego',
			role: 'Developer',
			kind: 'worker',
			rank: 100,
			presencePolicy: 'joinsPerTurn',
			presence: 'left',
			avatarSrc: 'https://example.test/diego.svg',
			initials: 'DI',
		},
		{
			id: 'custom-runner',
			memberId: 'custom-runner',
			displayName: 'CustomRunner',
			name: 'CustomRunner',
			role: 'Selected Agent',
			kind: 'agent',
			rank: 200,
			presencePolicy: 'joinsPerTurn',
			presence: 'online',
			avatarSrc: '',
			initials: 'CR',
		},
	];

	// 1. Names-only comma-separated header with data-member-id (user first, then Priya, then present members, no images)
	{
		const header = render.headerHtml({
			name: 'AITalk',
			members: roster,
			presence: {
				mode: 'here',
				name: 'Machs',
				photo: 'https://example.test/machs.png',
				fixturePath: '~/.askaway/profile/avatar.png',
				fallbackAvatar: 'https://example.test/machs-fallback.svg',
			},
		});
		const subtitleMatch = header.match(/<div class="talk-subtitle">([\s\S]*?)<\/div>/);
		assert.ok(subtitleMatch, 'header must render .talk-subtitle');
		const subtitleHtml = subtitleMatch[1];
		assert.ok(!/<img\b/i.test(subtitleHtml), 'header roster must be names-only with no images');
		assert.ok(!subtitleHtml.includes('team-avatar-badge'), 'header roster must not include avatar badges');

		const memberMatches = [...subtitleHtml.matchAll(/<span class="aitalk-roster-member" data-member-id="([^"]+)"><span class="aitalk-roster-name" data-member-id="\1">([^<]+)<\/span><\/span>/g)];
		const ids = memberMatches.map((m) => m[1]);
		const names = memberMatches.map((m) => m[2]);
		assert.equal(ids[0], 'machs', 'user must be first in header roster');
		assert.equal(ids[1], 'priya', 'Priya must be second (pinned first among AI members) in header roster');
		assert.ok(ids.includes('bhaskar'), 'present member Bhaskar must appear in header roster');
		assert.ok(!ids.includes('diego'), 'absent member Diego must not appear in header roster');
		assert.ok(subtitleHtml.includes(memberMatches.map((m) => m[0]).join(', ')), 'header names must be comma-separated');
		assert.ok(header.includes('data-fixture-path="~/.askaway/profile/avatar.png"'), 'header user presence avatar includes fixture path fallback metadata');
	}

	// 2. Join/leave notices keep exact text 'Bhaskar joined' / 'Diego left' plus face and data-member-id
	{
		const joinHtml = render.systemHtml(
			{ id: 's1', kind: 'system', text: 'Bhaskar joined', author: 'bhaskar', memberId: 'bhaskar' },
			roster
		);
		const leaveHtml = render.systemHtml(
			{ id: 's2', kind: 'system', text: 'Diego left', author: 'diego', memberId: 'diego' },
			roster
		);
		assert.match(
			joinHtml,
			/<div class="talk-pill-row aitalk-presence" data-actor="bhaskar" data-member-id="bhaskar"><span class="team-avatar-badge aitalk-inline-face has-image" data-member-id="bhaskar" data-initials="BH"><img class="team-avatar-img" src="https:\/\/example\.test\/bhaskar\.svg"[^>]*><\/span><span class="aitalk-presence-label" data-member-id="bhaskar">Bhaskar joined<\/span><\/div>/
		);
		assert.match(
			leaveHtml,
			/<div class="talk-pill-row aitalk-presence" data-actor="diego" data-member-id="diego"><span class="team-avatar-badge aitalk-inline-face has-image" data-member-id="diego" data-initials="DI"><img class="team-avatar-img" src="https:\/\/example\.test\/diego\.svg"[^>]*><\/span><span class="aitalk-presence-label" data-member-id="diego">Diego left<\/span><\/div>/
		);
	}

	// 3. Faces (avatarSrc else initials) on messages, mention choices (face + name + role + disambiguation), and typing row
	{
		const dupRoster = [
			...roster,
			{
				id: 'sana-sec',
				memberId: 'sana-sec',
				displayName: 'Sana',
				name: 'Sana',
				role: 'Security Reviewer',
				kind: 'worker',
				rank: 100,
				presence: 'online',
				avatarSrc: 'https://example.test/sana1.svg',
				initials: 'SA',
			},
			{
				id: 'sana-qa',
				memberId: 'sana-qa',
				displayName: 'Sana',
				name: 'Sana',
				role: 'QA Verifier',
				kind: 'worker',
				rank: 100,
				presence: 'online',
				avatarSrc: '',
				initials: 'SQ',
			},
		];
		const messages = [
			{ id: 'm1', author: 'machs', text: 'Hey @Priya please check this', time: '10:30', delivery: 'delivered' },
			{ id: 'm2', author: 'priya', text: 'Looking now', time: '10:31', replyTo: 'm1' },
			{ id: 'm3', author: 'custom-runner', text: 'Running fallback initials', time: '10:32' },
		];
		const html = render.talkHtml(messages, {
			embedded: true,
			members: dupRoster,
			typing: 'Priya is typing…',
			draft: '@Sana',
			popover: true,
			presence: {
				mode: 'here',
				name: 'Machs',
				photo: 'https://example.test/machs.png',
			},
		});

		// Message bubbles have faces (avatarSrc else initials) and data-member-id
		assert.match(html, /id="talk-m1" data-id="m1" data-actor="machs" data-member-id="machs"/);
		assert.match(html, /data-member-id="machs" aria-hidden="true"><span class="team-avatar-badge aitalk-bubble-face has-image" data-member-id="machs" data-initials="MA"><img class="team-avatar-img" src="https:\/\/example\.test\/machs\.png"/);
		assert.match(html, /<b class="talk-mention" data-member-id="priya">@Priya<\/b>/);

		assert.match(html, /id="talk-m2" data-id="m2" data-actor="priya" data-member-id="priya"/);
		assert.match(html, /data-member-id="priya" aria-hidden="true"><span class="team-avatar-badge aitalk-bubble-face has-image" data-member-id="priya" data-initials="PR"><img class="team-avatar-img" src="https:\/\/example\.test\/priya\.svg"/);
		assert.match(html, /<b class="talk-quote-who aitalk-quote-who" data-member-id="machs">Machs<\/b>/);

		assert.match(html, /id="talk-m3" data-id="m3" data-actor="custom-runner" data-member-id="custom-runner"/);
		assert.match(html, /data-member-id="custom-runner" data-initials="CR"><span class="team-avatar-initials">CR<\/span>/);

		// Mention choices: face + name + role + disambiguation
		assert.match(html, /data-member-id="sana-sec" data-mention="Sana" data-role="Security Reviewer" data-disambiguated="true"/);
		assert.match(html, /data-member-id="sana-qa" data-mention="Sana" data-role="QA Verifier" data-disambiguated="true"/);
		assert.match(html, /<b class="aitalk-ac-name">Sana<\/b><small class="aitalk-ac-role">Security Reviewer<\/small>/);
		assert.match(html, /<b class="aitalk-ac-name">Sana<\/b><small class="aitalk-ac-role">QA Verifier<\/small>/);

		// Typing row: face + data-member-id
		assert.match(html, /data-member-id="priya" aria-hidden="true"><span class="team-avatar-badge aitalk-bubble-face has-image" data-member-id="priya" data-initials="PR"><img class="team-avatar-img" src="https:\/\/example\.test\/priya\.svg"[^>]*><\/span><\/span><div class="talk-bubble tail talk-typing"/);
	}

	// 4. Startup presence (user and Priya present from startup; main agent joins at turn start as first notice)
	//    and @member routing by roster id/name with disambiguation; actors.ts imports resolveMainAgentIdentity
	{
		const initialRegistry = [
			{ id: 'machs', memberId: 'machs', displayName: 'Machs', name: 'Machs', kind: 'user', rank: 400, presencePolicy: 'alwaysPresent', presence: 'online' },
			{ id: 'priya', memberId: 'priya', displayName: 'Priya', name: 'Priya', kind: 'validator', rank: 300, pinnedFirst: true, presencePolicy: 'alwaysPresent', presence: 'online' },
			{ id: 'bhaskar', memberId: 'bhaskar', displayName: 'Bhaskar', name: 'Bhaskar', kind: 'agent', rank: 200, presencePolicy: 'joinsPerTurn', presence: 'left' },
			{ id: 'sana-sec', memberId: 'sana-sec', displayName: 'Sana', name: 'Sana', role: 'Security Reviewer', kind: 'worker', rank: 100, presencePolicy: 'joinsPerTurn', presence: 'online' },
			{ id: 'sana-qa', memberId: 'sana-qa', displayName: 'Sana', name: 'Sana', role: 'QA Verifier', kind: 'worker', rank: 100, presencePolicy: 'joinsPerTurn', presence: 'online' },
		];
		const startupPresent = initialRegistry.filter((m) => m.presence !== 'left').map((m) => m.id);
		assert.deepEqual(startupPresent, ['machs', 'priya', 'sana-sec', 'sana-qa']);

		// Main agent joins at turn start as first notice
		const joined = rules.presenceChange(initialRegistry, 'bhaskar', true);
		assert.equal(joined.notices.length, 1);
		assert.equal(joined.notices[0].text, 'Bhaskar joined');
		assert.equal(joined.notices[0].memberId, 'bhaskar');

		// @member routing by roster id/name
		const routedByName = rules.routeMessage({ author: 'machs', text: '@Bhaskar check this' }, [], joined.registry);
		assert.deepEqual(routedByName, ['bhaskar']);

		// Disambiguated @Sana routes to the selected mentionMemberId
		const posted = rules.postMessage(
			{ id: 'p1', author: 'machs', text: '@Sana check auth', mentionMemberId: 'sana-qa' },
			[],
			joined.registry
		);
		assert.deepEqual(posted.messages[0].recipients, ['sana-qa']);
		assert.equal(posted.messages[0].toActorId, 'sana-qa');

		// Verify src/aitalk/actors.ts imports resolveMainAgentIdentity from ../team/roster
		const actorsSrc = fs.readFileSync(path.join(__dirname, 'src', 'aitalk', 'actors.ts'), 'utf8');
		assert.ok(
			actorsSrc.includes('resolveMainAgentIdentity') && actorsSrc.includes('../team/roster'),
			'src/aitalk/actors.ts must import resolveMainAgentIdentity from ../team/roster'
		);
	}

	// 5. Click on [data-member-id] or .talk-mention calls window.focusTeamMember(id) and extension.js switches to Team tab
	{
		const handlers = {};
		const sent = [];
		const focused = [];
		const input = { value: '', selectionStart: 0, selectionEnd: 0, matches: () => true, closest: () => null, focus() {}, setSelectionRange() {} };
		const host = {
			innerHTML: '',
			querySelector(selector) {
				if (selector === 'textarea') return input;
				return null;
			},
		};
		vm.runInNewContext(
			fs.readFileSync(path.join(__dirname, 'media', 'aitalk', 'extension.js'), 'utf8')
				.replace(/^import .*;$/gm, '')
				.replace('export function', 'function'),
			{
				...render,
				...rules,
				...presence,
				createTalkController,
				setInterval() {},
				window: {
					focusTeamMember: (id) => focused.push(id),
					askawayPostMessage: (action) => sent.push(action),
					addEventListener: (name, fn) => {
						handlers['window-' + name] = fn;
					},
				},
				document: {
					querySelector: (selector) => ({
						click() {
							sent.push({ type: 'navigate', selector });
						},
					}),
					getElementById: () => host,
					addEventListener(name, fn, capture) {
						if (name === 'error') assert.equal(capture, true);
						(handlers[name] ||= []).push(fn);
					},
				},
			}
		);
		const image = { tagName: 'IMG', dataset: { fallbackSrc: 'fallback.svg' }, src: 'broken.png', getAttribute() { return this.src; }, setAttribute(_name, value) { this.src = value; } };
		assert.equal(handlers.error.length, 1);
		handlers.error[0]({ target: image });
		assert.equal(image.src, 'fallback.svg');
		image.src = 'failed-fallback.svg';
		handlers.error[0]({ target: image });
		assert.equal(image.src, 'failed-fallback.svg', 'fallback error must not loop');
		handlers['window-message']({
			data: {
				type: 'aitalkState',
				data: {
					members: roster,
					messages: [{ id: 'm1', author: 'bhaskar', text: 'Paging @Priya now' }],
				},
			},
		});

		// Click on [data-member-id="priya"]
		for (const handler of handlers.click) {
			handler({
				target: {
					closest: (selector) =>
						selector === '[data-member-id], .talk-mention, [data-member]'
							? { dataset: { memberId: 'priya' }, classList: { contains: () => false } }
							: null,
				},
			});
		}
		assert.ok(focused.includes('priya'), 'clicking [data-member-id] calls window.focusTeamMember("priya")');
		assert.ok(
			sent.some((e) => e.type === 'navigate' && e.selector === '.widget-tab[data-tab="team"]'),
			'clicking [data-member-id] navigates to Team tab (.widget-tab[data-tab="team"])'
		);

		// Click on .talk-mention
		focused.length = 0;
		for (const handler of handlers.click) {
			handler({
				target: {
					closest: (selector) =>
						selector === '[data-member-id], .talk-mention, [data-member]'
							? { dataset: {}, textContent: '@Bhaskar', classList: { contains: (c) => c === 'talk-mention' } }
							: null,
				},
			});
		}
		assert.ok(focused.includes('bhaskar'), 'clicking .talk-mention calls window.focusTeamMember("bhaskar")');
	}

	// 6. decorateTalkHtml in storybook/prototypes/team.js is a pass-through (production renders directly)
	{
		const rawSample = '<div class="talk-subtitle"><span class="aitalk-roster">sample</span></div>';
		assert.equal(teamProto.decorateTalkHtml(rawSample), rawSample, 'decorateTalkHtml must return production HTML unchanged');
		const teamProtoSrc = fs.readFileSync(path.join(__dirname, 'storybook', 'prototypes', 'team.js'), 'utf8');
		const fnMatch = /export function decorateTalkHtml\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(teamProtoSrc);
		assert.ok(fnMatch, 'decorateTalkHtml export must exist in storybook/prototypes/team.js');
		assert.ok(!fnMatch[1].includes('.replace('), 'decorateTalkHtml must not rewrite production HTML with .replace()');
	}

	console.log('PASS EV-AITALK-TEAM');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
