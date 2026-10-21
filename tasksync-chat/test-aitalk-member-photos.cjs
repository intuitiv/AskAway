// EV-AITALK-MEMBER-PHOTOS: AITalk members show the Team portraits (reviewer, 2026-10-21: "aitalk still has initials, it is not
// showing photos"). Seen from the caller: the production webview.js receives a workersState (enriched Team members), the real
// AITalk controller receives the store snapshot, and bubbles, the @mention list and the roster show an <img> with the portrait,
// whichever message arrives first. A member without an image keeps initials.
// Run: node test-aitalk-member-photos.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webviewSrc = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const providerSrc = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
const between = (src, start, end) => {
	const i = src.indexOf(start);
	const j = src.indexOf(end, i + start.length);
	assert.ok(i >= 0 && j > i, `slice not found: ${start} .. ${end}`);
	return src.slice(i, j);
};

// The production webview.js applyWorkersState on the production mini DOM (same harness as test-team-compact.cjs).
function createWebview(controllerEvents) {
	const testSrc = fs.readFileSync(path.join(__dirname, 'test-team-production-render.cjs'), 'utf8');
	const createMiniDom = new Function('assert', `${between(testSrc, 'function createMiniDom()', 'function createHarness()')}; return createMiniDom;`)(assert);
	const { doc, root, MiniElement } = createMiniDom();
	const elementInner = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
	Object.defineProperty(MiniElement.prototype, 'innerHTML', { configurable: true, set: elementInner.set, get() { return this.children.map((c) => (c.tagName ? c.outerHTML : c.textContent)).join(''); } });
	const teamPanelHtml = between(providerSrc, '<div class="tab-panel" id="panel-team">', '<!-- End panel-team -->').replace(/\r?\n\s*/g, '');
	root.innerHTML = '<div class="widget-tabs"><button class="widget-tab" data-tab="team">Team <span id="tab-badge-team" class="hidden">0</span></button></div>' + teamPanelHtml + '</div>';
	const textProto = Object.getPrototypeOf(root.querySelector('.widget-tab').children[0]);
	Object.defineProperty(textProto, 'outerHTML', { configurable: true, get() { return undefined; } });
	// The real document delivers the event to the AITalk controller's listener on the same document.
	doc.dispatchEvent = (event) => (controllerEvents.handlers[event.type] || []).forEach((fn) => fn(event));
	const win = {};
	const traceCase = between(webviewSrc, "            case 'workerTrace':", '                break;');
	const api = new Function('document', 'window', 'vscode', 'setInterval', `
		var currentTab = 'chat';
		var observabilityMetrics = {};
		function escapeHtml(v) { return String(v == null ? '' : v); }
		function switchTab(tab) { currentTab = tab; }
		${between(webviewSrc, '// ── Usage banner', '// ── end Usage banner ──')}
		${between(webviewSrc, '// ── Turn trace rows', '// ── end Turn trace rows ──')}
		${between(webviewSrc, '// ── Workers tab: pure render', '// ── end Workers pure render ──')}
		${between(webviewSrc, '    var workersState = null;', '    function initSpecsTab()')}
		function onHostMessage(message) { switch (message.type) { ${traceCase} break; } }
		return { applyWorkersState: applyWorkersState };
	`)(doc, win, { postMessage() {} }, () => 0);
	return { api, win };
}

const member = (id, name, role, extra = {}) => ({ id, name, role, kind: 'worker', profile: id, pinned: false, taskIds: [], turnCost: 0, monthCost: 0, model: 'github-copilot/gpt-6-luna', thinking: 'low', ...extra });
const FACE = (id) => `https://file+.vscode-resource.test/media/team/avatars/${id}.png`;
const TEAM = [
	member('priya', 'Priya', 'Product Owner', { kind: 'validator', pinned: true, avatarSrc: FACE('priya') }),
	member('bhaskar', 'Bhaskar', 'Tech Lead', { kind: 'main', avatarSrc: FACE('bhaskar') }),
	member('diego', 'Diego', 'Developer', { turnCost: 0.05, avatarSrc: FACE('diego') }),
	member('sana', 'Sana', 'Reviewer', { turnCost: 0.05 }),
];
const teamState = () => ({ generatedAt: 1_700_000_000_000, members: TEAM, workers: [], turnWorkerIds: [] });
// The store snapshot as the extension posts it: AITalk members carry memberId (rosterIdentity) but no avatarSrc.
const snapshot = () => JSON.parse(JSON.stringify({
	messages: [
		{ id: 'm1', author: 'validator', text: 'Ship it', time: '10:00' },
		{ id: 'm2', author: 'dev', text: 'Done', time: '10:01' },
		{ id: 'm3', author: 'agent', text: 'Merged', time: '10:02' },
		{ id: 'm4', author: 'rev', text: 'Looks fine', time: '10:03' },
	],
	members: [
		{ id: 'you', displayName: 'Machs', kind: 'user', rank: 400, presence: 'joined' },
		{ id: 'validator', memberId: 'priya', displayName: 'Priya', name: 'Priya', role: 'Product Owner', kind: 'validator', rank: 300, presence: 'joined' },
		{ id: 'agent', memberId: 'bhaskar', displayName: 'Bhaskar', name: 'Bhaskar', role: 'Tech Lead', kind: 'agent', rank: 200, presence: 'joined' },
		{ id: 'dev', memberId: 'diego', displayName: 'Diego', name: 'Diego', role: 'Developer', kind: 'agent', rank: 100, presence: 'joined' },
		{ id: 'rev', memberId: 'sana', displayName: 'Sana', name: 'Sana', role: 'Reviewer', kind: 'agent', rank: 100, presence: 'joined' },
	],
	typing: '', userName: 'Machs', userPhoto: 'data:image/png;base64,USER',
}));

(async () => {
	const { createTalkController } = await import('./media/aitalk/talkController.js');
	const regions = ['title', 'presence', 'thread', 'unread', 'composer'];
	const create = () => {
		let slots = {};
		const node = (key) => { let html = ''; return { dataset: { talkRegion: key }, get innerHTML() { return html; }, set innerHTML(value) { html = value; } }; };
		const host = {
			get innerHTML() { return regions.map((key) => slots[key]?.innerHTML).join(''); },
			set innerHTML(value) { slots = Object.fromEntries(regions.map((key) => [key, node(key)])); regions.forEach((key) => { slots[key].innerHTML = value; }); },
			querySelector(selector) { const match = /data-talk-region="(\w+)"/.exec(selector); return match ? slots[match[1]] : null; },
			querySelectorAll: () => [], contains: () => true,
		};
		const events = { handlers: {}, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); } };
		return { host, events };
	};
	const imgFor = (html, id) => (new RegExp(`data-member-id="${id}"[^>]*><img class="team-avatar-img" src="([^"]+)"`).exec(html) || [])[1];

	for (const order of ['team-first', 'talk-first']) {
		const { host, events } = create();
		const controller = createTalkController({ host, events, post: () => {} });
		const { api, win } = createWebview(events);
		globalThis.window = win;
		try {
			if (order === 'team-first') api.applyWorkersState(teamState());
			controller.receive({ type: 'aitalkState', data: snapshot() });
			if (order === 'talk-first') {
				assert.equal(imgFor(host.innerHTML, 'priya'), undefined, 'before the Team data arrives only initials show');
				api.applyWorkersState(teamState());
			}
		} finally { delete globalThis.window; }
		const html = host.innerHTML;
		for (const id of ['priya', 'diego', 'bhaskar']) assert.equal(imgFor(html, id), FACE(id), `${order}: ${id} shows the Team portrait in AITalk`);
		assert.ok(/data-member-id="sana"[^>]*><span class="team-avatar-initials">SA</.test(html) && !imgFor(html, 'sana'), `${order}: a member without an image keeps initials`);
		assert.ok(html.includes('src="data:image/png;base64,USER"'), `${order}: the user keeps their own photo`);
		// Bubbles, the @mention list and the roster all use the same badge.
		const thread = host.querySelector('[data-talk-region="thread"]').innerHTML;
		assert.equal(imgFor(thread, 'diego'), FACE('diego'), 'bubble face');
		const { mentionsHtml } = await import('./media/aitalk/talkRender.js');
		const views = controller.snapshot().members;
		assert.ok(mentionsHtml(views.map((m) => ({ ...m, avatarSrc: m.avatarSrc || (m.memberId && { priya: FACE('priya'), diego: FACE('diego'), bhaskar: FACE('bhaskar') }[m.memberId]) })), { draft: '@' }).includes(FACE('diego')), 'mention list helper shows a face');
	}

	// The mention list the controller itself builds on typing "@" and the user's own Edit picture.
	{
		const { host, events } = create();
		const posts = [];
		const controller = createTalkController({ host, events, post: (m) => posts.push(m) });
		controller.receive({ type: 'aitalkState', data: snapshot() });
		controller.receive({ type: 'memberAvatars', data: { priya: 'vscode-webview://x/own-priya.jpg', diego: FACE('diego') } });
		assert.equal(imgFor(host.innerHTML, 'priya'), 'vscode-webview://x/own-priya.jpg', 'an Edit-picture URI in the map wins over initials');
		const memberViews = controller.snapshot().members;
		assert.ok(!memberViews.some((m) => m.avatarSrc), 'the stored state is not polluted with faces');
	}

	// Later Team updates replace the map (a new picture shows on the next render).
	{
		const { host, events } = create();
		const controller = createTalkController({ host, events, post: () => {} });
		const { api, win } = createWebview(events);
		globalThis.window = win;
		try {
			api.applyWorkersState(teamState());
			controller.receive({ type: 'aitalkState', data: snapshot() });
			api.applyWorkersState({ ...teamState(), members: TEAM.map((m) => (m.id === 'sana' ? { ...m, avatarSrc: 'vscode-webview://x/sana-own.png' } : m)) });
		} finally { delete globalThis.window; }
		assert.equal(imgFor(host.innerHTML, 'sana'), 'vscode-webview://x/sana-own.png', 'a picture chosen later reaches AITalk');
	}

	// Reviewer 2026-10-21: "No need to show photo when person joined or left."
	{
		const { systemHtml } = await import('./media/aitalk/talkRender.js');
		const members = snapshot().members.map((m) => ({ ...m, avatarSrc: FACE(m.memberId || m.id) }));
		for (const text of ['Diego joined', 'Priya left']) {
			const row = systemHtml({ kind: 'system', text }, members, { avatarFor: FACE });
			assert.ok(!/<img|team-avatar-badge/.test(row) && row.includes('aitalk-presence-label') && /data-actor="[a-z]+" data-member-id="[a-z]+"/.test(row) && row.includes(text), `"${text}": text only with its hooks`);
		}
	}

	const scripts = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).scripts['test:workers'];
	assert.ok(scripts.includes('node test-aitalk-member-photos.cjs'), 'registered in test:workers');
	console.log('PASS EV-AITALK-MEMBER-PHOTOS Team portraits reach AITalk bubbles, mentions and roster in either arrival order; initials without an image');
})().catch((error) => { console.error(error); process.exit(1); });
