// EV-TEAM-COMPACT: the compact Team row prototype (opt-in, default off), round 2 (reviewer, 2026-10-21), seen from the caller:
// Storybook's Team tab HTML, the production render blocks sliced from media/webview.js (also driven through the production
// mini DOM: clicks, keys, repaints and posted messages), and the roster data. Production Team stays unchanged when compact is off.
// Run: node test-team-compact.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');

const ROOT = __dirname;
const webviewSrc = fs.readFileSync(path.join(ROOT, 'media', 'webview.js'), 'utf8');
const providerSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'media', 'team', 'team.css'), 'utf8');
const compactCss = css.slice(css.indexOf('Compact member row'));

const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&#8599;/g, '↗').replace(/\s+/g, ' ').trim();
const between = (src, start, end) => {
	const i = src.indexOf(start);
	const j = src.indexOf(end, i + start.length);
	assert.ok(i >= 0 && j > i, `slice not found: ${start} .. ${end}`);
	return src.slice(i, j);
};
const rowOf = (html, id) => {
	const at = html.indexOf(`data-compact-row="${id}"`);
	assert.ok(at >= 0, `${id} has a compact row`);
	const start = html.lastIndexOf('<div class="team-member-row', at);
	const next = html.indexOf('<div class="team-member-row', at);
	return html.slice(start, next < 0 ? html.length : next);
};
// The collapsed part of a card: everything before the tasks tray and the Edit panel.
const collapsed = (row) => row.slice(0, row.search(/<div class="team-member-tasks-panel|<div class="team-member-edit-form"/));
const editPanelOf = (row) => row.slice(row.indexOf('<div class="team-member-edit-form"'));
const memberIds = (html) => [...html.matchAll(/data-member-row="([^"]+)"/g)].map((m) => m[1]);
const cssRule = (selector) => {
	const i = compactCss.indexOf(selector + ' {');
	assert.ok(i >= 0, `css rule ${selector}`);
	return compactCss.slice(i, compactCss.indexOf('}', i));
};

function loadTsModule(filePath) {
	const out = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filePath }).outputText;
	const mod = { exports: {} };
	const req = (id) => {
		const tsFile = path.resolve(path.dirname(filePath), id + '.ts');
		return id.startsWith('.') && fs.existsSync(tsFile) ? loadTsModule(tsFile) : require(id);
	};
	vm.runInThisContext(`(function (exports, require, module) { ${out}\n})`)(mod.exports, req, mod);
	return mod.exports;
}

// The production webview.js on the production mini DOM (same harness as test-team-reviewer-2026-10-16.cjs), with focus().
const testSrc = fs.readFileSync(path.join(ROOT, 'test-team-production-render.cjs'), 'utf8');
const createMiniDom = new Function('assert', `${between(testSrc, 'function createMiniDom()', 'function createHarness()')}; return createMiniDom;`)(assert);
const teamPanelHtml = between(providerSrc, '<div class="tab-panel" id="panel-team">', '<!-- End panel-team -->').replace(/\r?\n\s*/g, '');
function createHarness() {
	const { doc, root, MiniElement } = createMiniDom();
	const elementInner = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
	Object.defineProperty(MiniElement.prototype, 'innerHTML', {
		configurable: true, set: elementInner.set,
		get() { return this.children.map((c) => (c.tagName ? c.outerHTML : c.textContent)).join(''); },
	});
	MiniElement.prototype.focus = function () { doc.activeElement = this; };
	root.innerHTML = '<div class="widget-tabs"><button class="widget-tab" data-tab="team">Team <span id="tab-badge-team" class="hidden">0</span></button></div>' + teamPanelHtml + '</div>';
	const textProto = Object.getPrototypeOf(root.querySelector('.widget-tab').children[0]);
	Object.defineProperty(textProto, 'outerHTML', { configurable: true, get() { return undefined; } });
	const messages = [];
	const timers = [];
	const vscode = { postMessage(msg) { messages.push(msg); } };
	const traceCase = between(webviewSrc, "            case 'workerTrace':", '                break;');
	const api = new Function('document', 'window', 'vscode', 'setInterval', 'setTimeout', `
		var currentTab = 'chat';
		var observabilityMetrics = { turnStartedAt: Date.now(), lastRequestTs: Date.now() };
		function escapeHtml(v) { return String(v == null ? '' : v); }
		function switchTab(tab) { currentTab = tab; }
		${between(webviewSrc, '// ── Usage banner', '// ── end Usage banner ──')}
		${between(webviewSrc, '// ── Turn trace rows', '// ── end Turn trace rows ──')}
		${between(webviewSrc, '// ── Workers tab: pure render', '// ── end Workers pure render ──')}
		${between(webviewSrc, '    var workersState = null;', '    function initSpecsTab()')}
		function onHostMessage(message) { switch (message.type) { ${traceCase} break; } }
		return { applyWorkersState: applyWorkersState, initWorkersTab: initWorkersTab, renderWorkersHtml: renderWorkersHtml,
			tickTeamAges: tickTeamAges, tickTeamStatus: tickTeamStatus, teamStatusText: teamStatusText };
	`)(doc, {}, vscode, () => 0, (callback) => timers.push(callback));
	api.initWorkersTab();
	const fire = (el, type, extra = {}) => el.dispatchEvent({ type, target: el, ...extra });
	return { api, doc, messages, timers, click: (el) => fire(el, 'click'), key: (el, key) => fire(el, 'keydown', { key }),
		pointerClick: (el) => { fire(el, 'pointerdown'); fire(el, 'pointerup'); fire(el, 'click'); } };
}

const NOW = 1_700_000_000_000;
const HEALTH = { opencode: { enabled: true, ok: true }, agy: { enabled: true, ok: false, signIn: true }, claude: { enabled: false, ok: false } };
const prodMember = (id, name, role, extra = {}) => ({
	id, name, role, kind: 'worker', profile: id, pinned: false, taskIds: [], turnCost: 0, monthCost: 0, agentFile: `.github/agents/${id}.agent.md`,
	model: 'github-copilot/gpt-6-luna', thinking: 'low', defaultModel: 'github-copilot/gpt-6-luna', defaultThinking: 'low',
	statusWorking: ['W1', 'W2', 'W3'], statusIdle: ['I1', 'I2', 'I3'], ...extra,
});
const PROD_MEMBERS = [
	prodMember('priya', 'Priya', 'Product Owner', { kind: 'validator', pinned: true, turnCost: 0.01 }),
	prodMember('bhaskar', 'Bhaskar', 'Tech Lead', { kind: 'main', turnCost: 0.08, model: 'github-copilot/claude-opus-5.5', thinking: 'high' }),
	prodMember('anika', 'Anika', 'Architect', { turnCost: 0.02, monthCost: 3.1, model: 'github-copilot/claude-sonnet-5.5', thinking: 'high', defaultModel: 'github-copilot/claude-sonnet-5.5', defaultThinking: 'high', profile: 'build' }),
	prodMember('diego', 'Diego', 'Developer', { turnCost: 0 }),
	prodMember('tara', 'Tara', 'Test Engineer', { turnCost: 0.05 }),
	prodMember('paolo', 'Paolo', 'Pipeline Expert', { turnCost: 0.05 }),
	prodMember('pavel', 'Pavel', 'Performance Analyst', { turnCost: 0, model: 'agy/gemini-4-argon-high', thinking: 'high' }),
];
const prodState = (extra = {}) => ({ generatedAt: NOW, members: PROD_MEMBERS, workers: [], turnWorkerIds: [], ...extra });

(async () => {
	const proto = await import(pathToFileURL(path.join(ROOT, 'storybook', 'prototypes', 'team.js')).href);
	const stories = await import(pathToFileURL(path.join(ROOT, 'storybook', 'stories', 'Team.stories.js')).href);
	const kit = proto.getWorkersKit();
	const tabHtml = (scenario, extra = {}) => proto.renderTeamTabHtml(proto.createTeamController({ scenario, ...extra }).state);
	const rosterMod = loadTsModule(path.join(ROOT, 'src', 'team', 'roster.ts'));
	const workersStateMod = loadTsModule(path.join(ROOT, 'src', 'workers', 'workersState.ts'));

	const compact = tabHtml('compact');
	const showAll = tabHtml('show-all');

	// ── (1) Status text is hard-coded and rotates per member (7-13 s); no knowledge/profile line; production data carries the phrases ──
	const projected = workersStateMod.projectTeamMembers([], rosterMod.TEAM_ROSTER);
	assert.equal(projected.length, 9, 'every non-main roster member is projected');
	for (const entry of [...rosterMod.TEAM_ROSTER, ...Object.values(rosterMod.MAIN_AGENT_PERSONAS)]) {
		for (const [classic, list] of [[entry.workingStatus, entry.statusWorking], [entry.idleStatus, entry.statusIdle]]) {
			assert.ok(list.length >= 3 && list.length <= 4, `${entry.name} has 3 to 4 phrases (${list.length})`);
			assert.equal(list[0], classic, `${entry.name}: the existing phrase stays first`);
			assert.equal(new Set(list).size, list.length, `${entry.name}: phrases are distinct`);
		}
	}
	for (const m of projected) {
		const entry = rosterMod.TEAM_ROSTER.find((e) => e.id === m.id);
		assert.deepEqual(m.statusWorking, entry.statusWorking, `${m.name}: statusWorking reaches the webview`);
		assert.deepEqual(m.statusIdle, entry.statusIdle, `${m.name}: statusIdle reaches the webview`);
	}
	// teamStatusText: every member flips on its own clock (period 7-13 s, hashed offset); deterministic for a given
	// time; a flip always changes the phrase (never the same phrase twice in a row with 2+ phrases).
	const members = projected.map((p) => kit.normalizeTeamMember(p));
	const flipsOf = (m, working) => {
		const flips = [];
		let prev = kit.teamStatusText(m, working, 0);
		for (let t = 100; t <= 60000; t += 100) {
			const now = kit.teamStatusText(m, working, t);
			assert.equal(now, kit.teamStatusText(m, working, t), `${m.name}: same time, same phrase`);
			if (now !== prev) flips.push(t);
			prev = now;
		}
		return flips;
	};
	for (const m of members) {
		for (const working of [true, false]) {
			const flips = flipsOf(m, working);
			assert.ok(flips.length >= 4 && flips.length <= 9, `${m.name}: flips every 7-13 s (${flips.length} in 60 s)`);
			assert.ok(flips[0] <= 13100, `${m.name}: first flip within one period`);
			for (let i = 1; i < flips.length; i++) assert.ok(flips[i] - flips[i - 1] >= 6900 && flips[i] - flips[i - 1] <= 13100, `${m.name}: period between 7 and 13 s`);
			const list = working ? m.statusWorking : m.statusIdle;
			for (const t of [0, 5000, 20000, 41000]) assert.ok(list.includes(kit.teamStatusText(m, working, t)));
		}
	}
	const five = members.slice(0, 5);
	assert.equal(five.length, 5);
	const firstFlips = new Set(five.map((m) => flipsOf(m, false)[0]));
	assert.ok(firstFlips.size >= 3, `at least 3 of 5 members flip at different moments (${[...firstFlips].join(', ')})`);
	assert.equal(kit.teamStatusText({ statusWorking: [], statusIdle: [], creativeStatus: 'Fallback line' }, false, NOW), 'Fallback line', 'a member without phrases keeps its single line');
	// The compact row: no knowledge/profile status line; the text is the rotating phrase and follows the clock.
	const tara = rowOf(compact, 'tara');
	const taraStatus = between(tara, 'class="team-member-status team-compact-status', '</div>');
	assert.ok(/data-status-state="idle"/.test(taraStatus) && !/Profile:|Chat agent:/.test(collapsed(tara)), 'idle card: rotating idle phrase, no profile line');
	const taraPhrases = JSON.parse(taraStatus.match(/data-status-phrases="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
	assert.deepEqual(taraPhrases, rosterMod.TEAM_ROSTER.find((e) => e.id === 'tara').statusIdle);
	const anika = rowOf(compact, 'anika');
	assert.ok(/data-status-state="working"/.test(anika) && !/Sketching the collapsed row/.test(collapsed(anika)), 'a running task shows working phrases, not its objective text (knowledge line dropped)');
	assert.ok(!/\d+m\d+s/.test(text(between(anika, 'class="team-member-status team-compact-status', '</div>'))), 'no elapsed time in the status');
	const ctl = proto.createTeamController({ scenario: 'compact' });
	const phraseNow = () => rowOf(proto.renderTeamTabHtml(ctl.state), 'tara').match(/class="team-status-text">([^<]*)</)[1];
	const first = phraseNow();
	ctl.advanceClock(7000);
	const second = phraseNow();
	ctl.advanceClock(1000 + 13000 * 3);
	assert.notEqual(first, second, 'the Storybook clock moves the status across a member boundary');
	assert.ok(taraPhrases.includes(first) && taraPhrases.includes(second));

	// Production tick: the visible text changes in place, the card is not re-rendered (same nodes).
	{
		const { api, doc } = createHarness();
		api.applyWorkersState(prodState({ runtimeHealth: HEALTH }));
		const list = doc.getElementById('workers-list');
		const card = list.querySelector('[data-member-row="diego"]');
		assert.equal(card, null, 'passive Diego is not listed while Show all is off');
		const taraCard = list.querySelector('[data-member-row="tara"]');
		const label = taraCard.querySelector('.team-status-text');
		const seen = new Set();
		for (let slot = 0; slot < 3; slot++) { api.tickTeamStatus(list, slot * 13000); seen.add(label.textContent); assert.equal(taraCard.querySelector('.team-status-text'), label, 'same text node owner: no re-render'); }
		assert.deepEqual([...seen].sort(), ['I1', 'I2', 'I3'], 'the tick walks the idle phrases');
		assert.equal(taraCard.querySelector('.team-compact-status').getAttribute('title'), label.textContent, 'the title follows too');
		api.tickTeamAges();
		assert.ok(['I1', 'I2', 'I3'].includes(taraCard.querySelector('.team-status-text').textContent), 'the 1 s tick (tickTeamAges) updates the status');
	}
	assert.ok(/function tickTeamAges\(\)[\s\S]*?tickTeamStatus\(list, now\)/.test(webviewSrc), 'the production 1 s tick calls tickTeamStatus');

	// ── (2) Not in the edit card: no status field; the save message and the roster ignore a status ──
	{
		const { api, doc, messages, click } = createHarness();
		api.applyWorkersState(prodState());
		const form = doc.querySelector('[data-member-edit-form="anika"]');
		const fields = form.querySelectorAll('[data-member-edit-field]').map((f) => f.getAttribute('data-member-edit-field'));
		assert.deepEqual(fields, ['name', 'role'], 'the Edit form keeps name and role (picture button stays)');
		assert.ok(form.querySelector('[data-member-pick-picture="anika"]'), 'picture stays');
		assert.ok(!/Status line/i.test(form.textContent), 'no status line label');
		click(doc.querySelector('[data-edit-member="anika"]'));
		form.querySelector('[data-member-edit-field="name"]').value = 'Ana';
		click(form.querySelector('[data-member-edit-save="anika"]'));
		assert.deepEqual(Object.keys(messages.filter((m) => m.type === 'saveMemberProfile').at(-1)).sort(), ['memberId', 'name', 'role', 'type'], 'saveMemberProfile carries name and role only');
	}
	{
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-compact-'));
		const file = path.join(dir, 'members.json');
		fs.writeFileSync(file, JSON.stringify({ diego: { name: 'Dee', status: 'Old stored line' } }));
		const diego = rosterMod.TEAM_ROSTER.find((e) => e.id === 'diego');
		const applied = rosterMod.applyMemberOverride(diego, rosterMod.readMemberOverrides(file));
		assert.equal(applied.name, 'Dee');
		assert.deepEqual([applied.workingStatus, applied.idleStatus, applied.statusWorking, applied.statusIdle], [diego.workingStatus, diego.idleStatus, diego.statusWorking, diego.statusIdle], 'a stored status is ignored');
		const saved = rosterMod.saveMemberProfile('diego', { name: 'Dee', role: 'Dev', status: 'Typed line' }, file, path.join(dir, 'av'));
		assert.ok(!('status' in saved) && !('status' in rosterMod.readMemberOverrides(file).diego), 'saveMemberProfile drops any status, stored or sent');
		assert.equal(rosterMod.applyMemberOverride(diego, { diego: { status: 'x', model: 'github-copilot/gpt-6-luna', thinking: 'low' } }).defaultModel, diego.model, 'the roster default model survives a dropdown choice');
		fs.rmSync(dir, { recursive: true, force: true });
	}
	{
		const body = between(providerSrc, 'private _saveMemberProfile(', 'private _setMemberModel(');
		assert.ok(!/status/.test(body) && !/status\?: string/.test(providerSrc.match(/\{ type: 'saveMemberProfile'[^\r\n]*/)[0]), 'the provider save path has no status');
		assert.ok(!/[^\r]\n/.test(providerSrc), 'webviewProvider.ts keeps its CRLF line endings');
	}

	// ── (3) Vibrant and informative: accent colours, runtime chips, Turn weight, share bars, pulsing dot, stacked bar ──
	{
		const accents = [...showAll.matchAll(/data-compact-row="([^"]+)"[^>]*data-accent="(\d+)"/g)].map((m) => [m[1], m[2]]);
		assert.equal(accents.length, 10);
		assert.equal(new Set(accents.map((a) => a[1])).size, 10, 'every member has its own accent');
		assert.deepEqual([...tabHtml('show-all').matchAll(/data-compact-row="([^"]+)"[^>]*data-accent="(\d+)"/g)].map((m) => [m[1], m[2]]), accents, 'the accent is stable by member id');
		for (let n = 0; n < 12; n++) {
			assert.ok(new RegExp(`--team-accent-${n}:`).test(css), `--team-accent-${n} is defined`);
			assert.ok(new RegExp(`\\[data-accent="${n}"\\]\\s*\\{\\s*--member-accent: var\\(--team-accent-${n}\\)`).test(css), `data-accent ${n} maps to its variable`);
		}
		const light = css.slice(css.indexOf('body.vscode-light #panel-team,\n.team-storybook-shell[data-theme="light"]'));
		assert.ok(/--team-accent-0: hsl\(330 72% 44%\)/.test(light) && /--team-runtime-claude/.test(light), 'a darker palette for light themes');
		for (const use of [/\.team-member-row\.team-compact-row \{[^}]*border-left: 4px solid var\(--member-accent/, /\.team-portrait-56 \{[^}]*box-shadow: 0 0 0 2px var\(--member-accent/, /\.team-share-fill \{[^}]*background: var\(--member-accent/, /\.team-status-dot \{[^}]*background: var\(--member-accent/]) {
			assert.ok(use.test(compactCss), `accent used: ${use}`);
		}
		// Model chip by runtime, thinking as a second chip.
		assert.ok(/team-chip-model team-runtime-opencode/.test(rowOf(showAll, 'tara')) && /team-chip-thinking" title="Thinking effort">low</.test(rowOf(showAll, 'tara')));
		assert.ok(/team-chip-model team-runtime-agy/.test(rowOf(showAll, 'pavel')), 'agy chip');
		const claudeMember = kit.normalizeTeamMember({ id: 'cl', name: 'Cleo', role: 'Writer', model: 'claude/sonnet', thinking: 'high' });
		assert.ok(/team-chip-model team-runtime-claude/.test(kit.teamCompactRowHtml(claudeMember, [], { generatedAt: NOW }, {}, {}, {})), 'Claude chip');
		for (const rt of ['opencode', 'agy', 'claude']) assert.ok(new RegExp(`\\.team-chip-model\\.team-runtime-${rt} \\{ --chip-runtime: var\\(--team-runtime-${rt}\\)`).test(compactCss));
		// Turn weight, pulsing dot only while working, reduced motion.
		assert.ok(/\.team-compact-cost \.team-cost-turn \{[^}]*font-size: 15px;[^}]*font-weight: 700/.test(compactCss), 'Turn $ has visual weight');
		assert.ok(/@keyframes team-dot-pulse/.test(compactCss) && /\.team-compact-status\.team-status-working \.team-status-dot \{[^}]*animation: team-dot-pulse/.test(compactCss) && !/^\.team-status-dot \{[^}]*animation/m.test(compactCss), 'the dot pulses only while working');
		assert.ok(/prefers-reduced-motion: reduce\) \{\s*\.team-compact-status\.team-status-working \.team-status-dot \{\s*animation: none/.test(compactCss), 'no animation under prefers-reduced-motion');
		assert.ok(/team-status-dot/.test(between(anika, 'team-compact-status', '</div>')) && /team-status-working/.test(anika), 'a working card has the pulsing dot');
		// Share bar per member: Turn as a share of the total Turn.
		assert.equal(rowOf(compact, 'anika').match(/class="team-share" role="img" data-share="(\d+)"/)[1], '46', 'Anika spent 0.12 of 0.26');
		assert.equal(rowOf(compact, 'priya').match(/data-share="(\d+)"/)[1], '4');
		assert.ok(/team-share-fill" style="width:46\.15%"/.test(rowOf(compact, 'anika')));
		// ONE stacked bar for the whole turn, segments in the member's colour, titles "Name $x (y%)".
		assert.equal((compact.match(/data-team-share-bar/g) || []).length, 1, 'one stacked bar');
		const segs = [...compact.matchAll(/<span class="team-share-seg" data-accent="(\d+)" data-share-member="([^"]+)" style="width:([\d.]+)%" title="([^"]+)"/g)];
		assert.deepEqual(segs.map((s) => s[2]), ['priya', 'bhaskar', 'anika', 'tara', 'paolo'], 'segments in card order');
		assert.deepEqual(segs.map((s) => s[4]), ['Priya $0.01 (4%)', 'Bhaskar $0.08 (31%)', 'Anika $0.12 (46%)', 'Tara $0.04 (15%)', 'Paolo $0.01 (4%)']);
		for (const s of segs) assert.equal(s[1], rowOf(compact, s[2]).match(/data-accent="(\d+)"/)[1], `${s[2]} segment uses the member's colour`);
		assert.ok(Math.abs(segs.reduce((n, s) => n + Number(s[3]), 0) - 100) < 0.2, 'widths add up to 100%');
		assert.ok(Math.abs(segs.reduce((n, s) => n + Number(s[4].match(/\((\d+)%\)/)[1]), 0) - 100) <= segs.length / 2, 'percentages add up to 100 within rounding');
		assert.ok(compact.indexOf('data-team-share-bar') < compact.indexOf('class="workers-summary"') && compact.indexOf('class="workers-summary"') < compact.indexOf('data-team-health'), 'bar, then the counts line, then the health strip');
		assert.ok(!/gradient/.test(compactCss), 'no gradients');
	}

	// ── (4) Collapsed card: avatar, name, FULL role, model chip + thinking chip, Turn $, tasks button, status in 3 short lines ──
	{
		const row = rowOf(compact, 'anika');
		const head = collapsed(row);
		assert.equal((head.match(/class="team-compact-line/g) || []).length, 2, 'two content lines plus the status line = 3 lines');
		const t = text(head);
		for (const part of ['Anika', 'Architect', 'Claude Sonnet 5.5', 'high', 'Turn $0.12', '1 task']) assert.ok(t.includes(part), `collapsed card shows "${part}": ${t}`);
		assert.ok(/team-portrait-56/.test(head) && /class="team-member-status team-compact-status/.test(head), 'avatar and status line');
		assert.ok(!/<select|<br|team-member-edit-form/.test(head), 'no controls in the collapsed card');
		// Reviewer 2026-10-21: "images look very small": a 56px circular portrait in a left column spanning the three lines.
		assert.ok(/team-compact-body">\s*<div class="team-member-portrait team-compact-portrait"/.test(head) && head.indexOf('team-compact-content') > head.indexOf('team-portrait-56') && /class="team-compact-line team-compact-top"/.test(head.slice(head.indexOf('team-compact-content'))) && /class="team-member-status team-compact-status/.test(head.slice(head.indexOf('team-compact-content'))), 'portrait left, the three lines in the right column');
		assert.ok(!/team-portrait-28/.test(webviewSrc + css) && /teamPortraitHtml\(member, state, 56\)/.test(webviewSrc), 'no 28px portrait left');
		assert.ok(/width: 56px;/.test(cssRule('.team-compact-portrait')) && /flex: 0 0 56px/.test(cssRule('.team-compact-portrait')), 'portrait column is 56px');
		assert.ok(/width: 56px;[^}]*height: 56px;[^}]*border-radius: 50%;[^}]*box-shadow: 0 0 0 2px var\(--member-accent/.test(cssRule('.team-portrait-56')), 'circular with the member accent ring');
		assert.ok(/font-size: 20px/.test(cssRule('.team-portrait-56 .team-avatar-initials')), 'initials fallback sized to match');
		for (const sel of ['.team-compact-body', '.team-compact-content', '.team-compact-portrait', '.team-portrait-56']) assert.ok(!/overflow|white-space: nowrap|text-overflow/.test(cssRule(sel)), `${sel}: no overflow styles`);
		assert.ok(/min-width: 0/.test(cssRule('.team-compact-content')) && /min-width: 0/.test(cssRule('.team-compact-body')), 'the right column can shrink inside 420px');
		assert.ok(/team-compact-line team-compact-meta">/.test(head) && !/padding-left: 34px/.test(compactCss), 'the meta line no longer reserves the old 28px avatar indent');
		assert.ok(text(collapsed(rowOf(compact, 'priya'))).includes('Trace ('), "Priya's button is Trace (n)");
		const longRole = 'Senior Distributed Systems Reliability Engineer';
		const longMember = kit.normalizeTeamMember({ id: 'lo', name: 'Longrole', role: longRole, model: 'agy/gemini-4-argon-high', thinking: 'high', turnCost: 0.0042 });
		const longRow = kit.teamCompactRowHtml(longMember, [], { generatedAt: NOW }, {}, {}, {});
		assert.ok(text(collapsed(longRow)).includes(longRole + ' '), 'the full role is in the markup (wrapped by css, never cut)');
		assert.ok(text(collapsed(longRow)).includes('Gemini 4 Argon') && text(collapsed(longRow)).includes('Turn $0.0042'));
		// css: role wraps, model and Turn never ellipsize; only the status text does; nothing can overflow sideways.
		assert.ok(/white-space: normal;/.test(cssRule('.team-compact-identity')) && /overflow-wrap: anywhere/.test(cssRule('.team-compact-identity')) && !/text-overflow/.test(cssRule('.team-compact-identity')), 'role wraps, never ellipsis');
		for (const sel of ['.team-chip', '.team-chip-model', '.team-compact-line .team-compact-cost', '.team-compact-line .team-compact-cost .team-cost-turn']) assert.ok(!/text-overflow|overflow: hidden/.test(cssRule(sel)), `${sel} never ellipsizes`);
		assert.ok(/text-overflow: ellipsis/.test(cssRule('.team-compact-status .team-status-text')), 'only the status text ellipsizes');
		assert.ok(/flex-wrap: wrap/.test(cssRule('.team-compact-line')) && /min-width: 0/.test(cssRule('.team-member-row.team-compact-row')), 'lines wrap instead of overflowing');
		assert.ok(!/text-overflow: ellipsis/.test(compactCss.replace(cssRule('.team-compact-status .team-status-text'), '')), 'ellipsis appears only on the status text');
	}

	// ── (5) Month $ is a muted second line under Turn $ on every collapsed card; the cost hooks stay ──
	{
		const row = rowOf(compact, 'anika');
		const head = collapsed(row);
		assert.ok(/Turn \$0\.12 Month \$3\.10/.test(text(head)), `Month sits right under Turn on the collapsed card: ${text(head)}`);
		assert.equal((row.match(/data-member-cost="anika" data-turn-cost="\$0\.12" data-month-cost="\$3\.10"/g) || []).length, 1, 'cost hooks kept (turn, month)');
		assert.ok(/class="team-cost-turn">\$0\.12</.test(row) && /<span class="team-cost-month-line">Month <strong class="team-cost-month">\$3\.10<\/strong><\/span><\/span>/.test(row), 'Month is the second line inside the same cost span');
		assert.ok(head.indexOf('team-cost-turn') < head.indexOf('team-cost-month-line') && head.indexOf('team-cost-month-line') < head.indexOf('team-chip-model'), 'Month follows Turn, above the model chip line');
		assert.ok(!/Month/.test(text(editPanelOf(row))), 'Month is no longer in the expanded area');
		assert.ok(/\.team-compact-cost \{[^}]*display: block;[^}]*text-align: right/.test(compactCss) && /\.team-compact-cost \.team-cost-month-line \{[^}]*display: block/.test(compactCss) && /\.team-compact-cost \.team-cost-month-line \{[^}]*var\(--vscode-descriptionForeground\)/.test(compactCss), 'right-aligned, muted second line');
		// Every card, also a member with no spend: Month is there; agy members show $0.00 (never blank or a dash).
		for (const id of ['priya', 'bhaskar', 'tara', 'paolo']) assert.ok(/Turn \$[\d.]+ Month \$[\d.]+/.test(text(collapsed(rowOf(compact, id)))), `${id} shows Turn and Month`);
		const pavel = text(collapsed(rowOf(showAll, 'pavel')));
		assert.ok(/Gemini/.test(pavel) && /Turn \$0\.00 Month \$0\.00/.test(pavel), `agy member shows $0.00 for Turn and Month: ${pavel}`);
		assert.ok(!/[—–]/.test(pavel.replace(/Product|Pipeline/g, '')), 'no dash placeholder');
		const agyWorker = kit.teamCompactRowHtml(kit.normalizeTeamMember(prodMember('ag', 'Agy', 'Reviewer', { model: 'agy/gemini-4-argon-high', turnCost: 0, monthCost: 0 })), [{ workerId: 'w', adapter: 'agy', usage: { cost: 7 } }], { generatedAt: NOW }, {}, {}, {});
		assert.ok(/Turn \$0\.00 Month \$0\.00/.test(text(collapsed(agyWorker))), 'agy worker usage never turns into money');
		// Visibility rule stays: hidden at Turn $0 unless Show all.
		assert.ok(!compact.includes('data-compact-row="pavel"') && showAll.includes('data-compact-row="pavel"'), 'Turn $0 members only with Show all');
	}

	// ── (6) Order by weight, one function for production and Storybook ──
	assert.deepEqual(memberIds(compact), ['priya', 'bhaskar', 'anika', 'tara', 'paolo'], 'Storybook: Priya, main agent, then Turn descending');
	assert.deepEqual(memberIds(showAll), ['priya', 'bhaskar', 'anika', 'tara', 'paolo', 'diego', 'pavel', 'sana', 'shreya', 'cathy'], 'passive members last, in roster order');
	{
		const html = kit.renderWorkersHtml(prodState(), '', {}, {}, {});
		assert.deepEqual(memberIds(html), ['priya', 'bhaskar', 'tara', 'paolo', 'anika'], 'production: Turn descending, ties in roster order (Tara before Paolo)');
		const groups = PROD_MEMBERS.map((m) => ({ member: kit.normalizeTeamMember(m), workers: [] }));
		assert.deepEqual(kit.teamVisibleGroups(groups, true).map((g) => g.member.id), ['priya', 'bhaskar', 'tara', 'paolo', 'anika', 'diego', 'pavel']);
		assert.deepEqual(kit.teamVisibleGroups(groups, false).map((g) => g.member.id), ['priya', 'bhaskar', 'tara', 'paolo', 'anika']);
		// R-TEAM-72: an agy member that worked this turn is $0.00 but still shown, ranked with the members that spent.
		const withAgy = PROD_MEMBERS.map((m) => ({ member: kit.normalizeTeamMember(m.id === 'pavel' ? { ...m, turnActive: true } : m), workers: [] }));
		assert.deepEqual(kit.teamVisibleGroups(withAgy, false).map((g) => g.member.id), ['priya', 'bhaskar', 'tara', 'paolo', 'anika', 'pavel'], 'agy member active this turn shows at $0.00');
		assert.ok(/teamVisibleGroups\(groups, Boolean\(state && state\.showAll\)\)/.test(webviewSrc) && /teamVisibleGroups\(groups, Boolean\(state\.showAll\)\)/.test(fs.readFileSync(path.join(ROOT, 'storybook', 'prototypes', 'team.js'), 'utf8')), 'both call the one ordering function');
	}

	// ── (7) Show all members: one toggle, off by default, passive members quiet and editable ──
	{
		assert.equal((compact.match(/role="switch"/g) || []).length, 1, 'exactly one toggle in the header');
		assert.ok(/<div class="specs-toggle team-show-all"[^>]*><span>Show all members<\/span><div class="toggle-switch specs-toggle-switch" role="switch" tabindex="0" aria-checked="false"/.test(compact), 'existing toggle-switch / specs-toggle markup, off by default');
		assert.ok(/class="toggle-switch specs-toggle-switch active" role="switch" tabindex="0" aria-checked="true"/.test(showAll), 'on in ShowAll');
		for (const id of ['diego', 'pavel', 'sana', 'shreya', 'cathy']) {
			const row = rowOf(showAll, id);
			assert.ok(/team-compact-row[^"]* is-passive/.test(row) && /data-passive="true"/.test(row), `${id} is styled passive`);
			assert.ok(/data-status-state="idle"/.test(row) && /Turn \$0\.00/.test(text(collapsed(row))), `${id}: idle status, Turn $0.00`);
			assert.ok(/data-member-edit-form="[^"]+" hidden/.test(row), `${id} is collapsed`);
			for (const hook of ['data-member-model=', 'data-member-thinking=', 'data-edit-member=', 'data-member-edit-field="name"', 'data-member-edit-field="role"', 'data-member-pick-picture=']) assert.ok(row.includes(hook), `${id} can be edited: ${hook}`);
		}
		assert.ok(!/is-passive/.test(compact) && !/data-passive/.test(compact), 'off: no passive member');
		const ctrl = proto.createTeamController({ scenario: 'compact' });
		ctrl.setShowAll(true);
		assert.deepEqual(memberIds(proto.renderTeamTabHtml(ctrl.state)), memberIds(showAll), 'the Storybook controller drives it');
		ctrl.setShowAll(false);
		assert.deepEqual(memberIds(proto.renderTeamTabHtml(ctrl.state)), memberIds(compact));
		assert.ok(/message\.type === 'teamShowAll'\) controller\.setShowAll/.test(fs.readFileSync(path.join(ROOT, 'storybook', 'prototypes', 'team.js'), 'utf8')), 'mountTeamStory routes the toggle');
		// Production: opt-in; the toggle repaints with the passive members; the full rows ignore it.
		const { api, doc, messages, timers, pointerClick, key } = createHarness();
		api.applyWorkersState(prodState({ members: PROD_MEMBERS.map((m) => ({ ...m, avatarSrc: `vscode-resource:/media/team/avatars/${m.id}.png` })) }));
		assert.deepEqual(doc.querySelectorAll('[data-member-row]').map((r) => r.getAttribute('data-member-row')), ['priya', 'bhaskar', 'tara', 'paolo', 'anika']);
		const portraits = doc.querySelectorAll('.team-avatar-img');
		const beforeMessages = messages.slice();
		const sw = doc.querySelector('[data-team-show-all]');
		assert.equal(sw.getAttribute('aria-checked'), 'false');
		pointerClick(sw);
		assert.equal(timers.length, 1, 'pointerup cleanup is still queued: no timer or host push has run');
		assert.deepEqual(doc.querySelectorAll('[data-member-row]').map((r) => r.getAttribute('data-member-row')), ['priya', 'bhaskar', 'tara', 'paolo', 'anika', 'diego', 'pavel'], 'pointer click synchronously adds passive members in the same tick');
		assert.equal(doc.querySelector('[data-team-show-all]').getAttribute('aria-checked'), 'true');
		portraits.forEach((img, i) => assert.equal(doc.querySelectorAll('.team-avatar-img')[i], img, 'showing all preserves existing portrait elements'));
		pointerClick(doc.querySelector('[data-team-show-all]'));
		assert.equal(doc.querySelectorAll('[data-member-row]').length, 5, 'pointer click synchronously hides passive members in the same tick');
		assert.equal(doc.querySelector('[data-team-show-all]').getAttribute('aria-checked'), 'false');
		portraits.forEach((img, i) => assert.equal(doc.querySelectorAll('.team-avatar-img')[i], img, 'hiding passive members preserves existing portrait elements'));
		assert.deepEqual(messages, beforeMessages, 'toggle clicks send no host messages or trace requests');
		pointerClick(doc.querySelector('[data-team-show-all]'));
		api.applyWorkersState(prodState());
		assert.equal(doc.querySelectorAll('[data-member-row]').length, 7, 'the toggle survives a repaint (workersShowAll)');
		key(doc.querySelector('[data-team-show-all]'), ' ');
		assert.equal(doc.querySelectorAll('[data-member-row]').length, 5, 'Space toggles it off again');
		key(doc.querySelector('[data-team-show-all]'), 'Enter');
		assert.equal(doc.querySelectorAll('[data-member-row]').length, 7, 'Enter toggles it on');
		assert.equal(doc.querySelectorAll('[role="switch"]').filter((s) => s.hasAttribute('data-team-show-all')).length, 1);
	}

	// ── (8) ONE Edit button per card: no chevron, no ⋯ menu; one inline panel holds everything editable ──
	{
		const row = rowOf(compact, 'anika');
		assert.ok(!/chevron|data-member-row-toggle|data-member-detail|team-more|data-team-more|data-team-menu|aria-haspopup|\u22ef/.test(compact + showAll), 'no chevron and no ⋯ menu in any card');
		assert.equal(compact.match(/data-edit-member="/g).length, 5, 'exactly one Edit button per card (5 cards)');
		for (const id of ['priya', 'bhaskar', 'anika', 'tara', 'paolo']) assert.equal((rowOf(compact, id).match(/data-edit-member="/g) || []).length, 1, `${id}: one Edit button`);
		assert.ok(/<button type="button" class="team-edit-member-btn team-compact-edit" data-edit-member="anika" aria-expanded="false" aria-label="Edit Anika" title="Edit Anika">/.test(row), 'a pencil button with aria-label and title "Edit <name>"');
		assert.ok(collapsed(row).includes('data-edit-member="anika"'), 'the Edit button sits in the collapsed card header');
		const panel = editPanelOf(row);
		assert.ok(/data-member-edit-form="anika" hidden/.test(panel), 'the panel is closed by default');
		for (const hook of ['data-member-edit-field="name"', 'data-member-edit-field="role"', 'data-member-pick-picture="anika"', 'data-member-model="anika"', 'data-member-thinking="anika"', 'data-open-agent-file=', 'data-member-reset-model="anika"', 'data-member-edit-save="anika"', 'data-member-edit-cancel="anika"']) assert.ok(panel.includes(hook), `the one panel holds ${hook}`);
		assert.ok(text(panel).includes('Profile:') && text(panel).includes('Agent file') && text(panel).includes('Reset model to default'), 'Profile line, Agent file link, Reset button');
		assert.ok(/data-member-reset-model="anika"[^>]*data-default-model="github-copilot\/claude-sonnet-5\.5" data-default-thinking="high"/.test(panel), 'Reset carries the roster default');
		assert.ok(!/data-member-reset-model/.test(rowOf(compact, 'bhaskar')) && /Chat agent:/.test(editPanelOf(rowOf(compact, 'bhaskar'))) && /data-member-kind="main"/.test(editPanelOf(rowOf(compact, 'bhaskar'))), 'the main agent keeps its chat-agent link and has no Reset');
		const open = rowOf(tabHtml('edit-open'), 'anika');
		assert.ok(!/data-member-edit-form="anika" hidden/.test(open) && /data-edit-member="anika" aria-expanded="true"/.test(open), 'EditOpen: the panel is open');
		// Reset uses the roster default even after a dropdown choice.
		const ctrl = proto.createTeamController({ scenario: 'compact' });
		ctrl.setMemberModel('anika', 'github-copilot/gpt-6-luna');
		assert.ok(/data-default-model="github-copilot\/claude-sonnet-5\.5"/.test(rowOf(proto.renderTeamTabHtml(ctrl.state), 'anika')), 'defaultModel stays the roster model');

		const { api, doc, messages, click } = createHarness();
		api.applyWorkersState(prodState({ memberSettings: { anika: { model: 'github-copilot/gpt-6-luna', thinking: 'low' } } }));
		const btn = () => doc.querySelector('[data-edit-member="anika"]');
		const form = () => doc.querySelector('[data-member-edit-form="anika"]');
		assert.equal(btn().tagName, 'BUTTON', 'a real button: Enter and Space activate it natively');
		assert.equal(doc.querySelectorAll('[data-edit-member]').length, 5, 'production: one Edit button per card');
		assert.ok(!doc.querySelector('[data-member-row-toggle]') && !doc.querySelector('[data-team-more]'), 'production: no chevron, no ⋯');
		assert.ok(form().hasAttribute('hidden'));
		click(btn());
		assert.ok(!form().hasAttribute('hidden') && btn().getAttribute('aria-expanded') === 'true', 'click opens the single panel');
		for (const sel of ['[data-member-edit-field="name"]', '[data-member-edit-field="role"]', '[data-member-pick-picture]', '[data-member-model]', '[data-member-thinking]', '[data-open-agent-file]', '[data-member-reset-model]']) assert.ok(form().querySelector(sel), `inside the panel: ${sel}`);
		api.applyWorkersState(prodState());
		assert.ok(!form().hasAttribute('hidden'), 'an open panel survives a repaint');
		// Model and Thinking keep working live (member-level) from inside the panel.
		const modelSelect = form().querySelector('[data-member-model]');
		modelSelect.value = 'github-copilot/claude-sonnet-5.5';
		modelSelect.dispatchEvent({ type: 'change', target: modelSelect });
		assert.equal(messages.filter((m) => m.type === 'setMemberModel').at(-1).memberId, 'anika', 'the Model select posts setMemberModel');
		const thinkingSelect = form().querySelector('[data-member-thinking]');
		thinkingSelect.dispatchEvent({ type: 'change', target: thinkingSelect });
		assert.equal(messages.filter((m) => m.type === 'setMemberModel').at(-1).thinking !== undefined, true, 'the Thinking select posts setMemberModel');
		click(form().querySelector('[data-open-agent-file]'));
		assert.equal(messages.at(-1).type, 'openAgentFile');
		click(form().querySelector('[data-member-reset-model]'));
		assert.deepEqual(messages.at(-1), { type: 'setMemberModel', memberId: 'anika', profile: 'build', model: 'github-copilot/claude-sonnet-5.5', thinking: 'high' }, 'Reset posts setMemberModel with the roster default');
		click(form().querySelector('[data-member-edit-cancel]'));
		assert.ok(form().hasAttribute('hidden') && btn().getAttribute('aria-expanded') === 'false', 'Cancel closes the panel');
		click(btn());
		click(btn());
		assert.ok(form().hasAttribute('hidden'), 'the Edit button toggles');
		assert.ok(!messages.some((m) => m.type === 'requestWorkerTrace'), 'panel state never asks for a worker trace');
	}

	// ── (9) Health strip ──
	{
		const state = (health) => kit.teamHealthHtml(health);
		const chips = (html) => Object.fromEntries([...html.matchAll(/data-runtime-chip="([^"]+)" data-health-state="([^"]+)" title="([^"]+)"/g)].map((m) => [m[1], [m[2], m[3]]]));
		const mixed = chips(state({ opencode: { enabled: true, ok: true }, agy: { enabled: true, ok: false }, claude: { enabled: true, ok: false, signIn: true } }));
		assert.deepEqual(mixed, { opencode: ['ok', 'OpenCode: working'], agy: ['bad', 'agy: not working'], claude: ['signin', 'Claude: sign in required'] });
		assert.deepEqual(chips(state({ opencode: { enabled: false, ok: false }, agy: { enabled: false }, claude: { enabled: false } })), { opencode: ['off', 'OpenCode: off'], agy: ['off', 'agy: off'], claude: ['off', 'Claude: off'] });
		assert.ok(/team-health-ok/.test(state(HEALTH)) && /team-health-signin/.test(state(HEALTH)) && /team-health-off/.test(state(HEALTH)));
		assert.ok(/agy[^<]*<\/span>/.test(state(HEALTH)) && text(state(HEALTH)).includes('agy · sign in'), 'amber chip says sign in');
		assert.ok(!/<button|data-[a-z-]*action|onclick/.test(state(HEALTH)), 'title text only: no click action');
		assert.equal(state(null), '');
		for (const [cls, token] of [['ok', 'ok'], ['bad', 'bad'], ['signin', 'signin'], ['off', 'off']]) assert.ok(new RegExp(`\\.team-health-${cls} \\{ --chip-health: var\\(--team-health-${token}\\)`).test(compactCss));
		assert.deepEqual(chips(compact), { opencode: ['ok', 'OpenCode: working'], agy: ['signin', 'agy: sign in required'], claude: ['off', 'Claude: off'] }, 'Storybook shows the strip under the counts');
		// The health chips and the R-TEAM-36 runtime warning sentence both show in production (no flag).
		const off = { opencode: { enabled: false }, agy: { enabled: false }, claude: { enabled: false } };
		const prodHtml = kit.renderWorkersHtml(prodState({ runtimeHealth: off }), '', {}, {}, {});
		assert.ok(/data-team-health/.test(prodHtml) && /data-runtime-warning>Workers unavailable: turn on an integration in Settings/.test(prodHtml), 'chips and the warning sentence');
	}

	// ── (10) Empty state ──
	{
		const empty = tabHtml('empty-turn');
		assert.deepEqual(memberIds(empty), ['priya', 'bhaskar']);
		assert.ok(text(empty).includes('No workers have spent this turn.') && empty.indexOf('No workers have spent this turn.') > empty.lastIndexOf('data-compact-row='), 'the empty line sits under the rows');
		assert.ok(!compact.includes('No workers have spent this turn.') && !showAll.includes('No workers have spent this turn.'));
		assert.ok(kit.renderWorkersHtml(prodState({ members: PROD_MEMBERS.slice(0, 2) }), '', {}, {}, {}).includes('No workers have spent this turn.'));
	}

	// ── The compact Team is the only layout: no flag, no legacy rows ──
	{
		const html = kit.renderWorkersHtml(prodState({ runtimeHealth: HEALTH }), '', {}, {}, {});
		assert.equal(kit.renderWorkersHtml(prodState({ compact: false, runtimeHealth: HEALTH }), '', {}, {}, {}), html, 'no compact flag: the compact cards always render');
		assert.ok(/data-team-header/.test(html) && /team-compact-row/.test(html) && /data-team-share-bar/.test(html) && /data-team-health/.test(html) && /data-edit-member="anika"/.test(html), 'header toggle, cards, share bar, health chips, Edit');
		assert.ok(!/team-portrait-72|team-member-row-main|data-member-tasks-toggle="diego"|team-member-headline/.test(html), 'no legacy 72px rows');
		assert.ok(!/state\.compact|teamMemberRowHtml|teamMemberActionsHtml/.test(webviewSrc) && !('teamMemberRowHtml' in kit), 'legacy row code is deleted');
		assert.ok(!/data-diego|data-member-row="diego"/.test(html) && !html.includes('data-member-row="pavel"'), 'Turn $0 members stay hidden without Show all');
		// Show all state is local to the webview: a fresh webview starts off.
		const fresh = createHarness();
		fresh.api.applyWorkersState(prodState());
		assert.equal(fresh.doc.querySelector('[data-team-show-all]').getAttribute('aria-checked'), 'false', 'Show all resets to off on reload');
		const full = kit.teamCompactRowHtml(kit.normalizeTeamMember(PROD_MEMBERS[2]), [], { generatedAt: 1, memberSettings: {} }, {}, {}, {});
		assert.ok(/data-member-cost="anika" data-turn-cost="\$0\.02" data-month-cost="\$3\.10">Turn <strong class="team-cost-turn">\$0\.02<\/strong><span class="team-cost-month-line">Month/.test(full), 'Turn with Month beneath');
	}

	// ── Portraits (R-TEAM-68): the image when avatarSrc is set, initials otherwise; the face files ship ──
	{
		const card = (extra) => kit.teamCompactRowHtml(kit.normalizeTeamMember({ id: 'anika', name: 'Anika', role: 'Architect', model: 'github-copilot/gpt-6-luna', thinking: 'low', ...extra }), [], { generatedAt: 1, memberSettings: {} }, {}, {}, {});
		const withFace = card({ avatarSrc: 'vscode-resource:/media/team/avatars/anika.png' });
		assert.ok(/<img class="team-avatar-img" src="vscode-resource:\/media\/team\/avatars\/anika\.png"[^>]*alt="Anika \(Architect\) portrait"/.test(withFace) && /has-image/.test(withFace), 'avatarSrc renders an <img> in the compact card');
		const noFace = card({});
		assert.ok(!/<img/.test(noFace) && /has-initials[^>]*data-initials="AN"/.test(noFace) && />AN</.test(noFace), 'no avatarSrc renders the initials');
		const vscodeIgnore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
		assert.ok(/^!media\/team\/avatars\/\*\.png$/m.test(vscodeIgnore), 'the portraits ship in the VSIX');
		assert.ok(/import\.meta\.glob\('\.\.\/\.\.\/media\/team\/avatars\/\*\.png'/.test(fs.readFileSync(path.join(ROOT, 'storybook', 'prototypes', 'team.js'), 'utf8')), 'Storybook loads the same portraits');
	}

	// ── Stories, styles, registration ──
	for (const name of ['Compact', 'EditOpen', 'EmptyTurn', 'CompactLight', 'ShowAll']) assert.equal(typeof stories[name].render, 'function', `story ${name}`);
	assert.ok(stories.Compact.render().innerHTML.includes('team-compact-row'));
	assert.ok(stories.ShowAll.render().innerHTML.includes('is-passive'));
	assert.ok(/aria-expanded="true"/.test(stories.EditOpen.render().innerHTML) && !('MenuOpen' in stories) && !('CompactExpanded' in stories), 'EditOpen replaces CompactExpanded and MenuOpen');
	assert.ok(stories.EmptyTurn.render().innerHTML.includes('No workers have spent this turn.'));
	assert.ok(stories.CompactLight.render().innerHTML.includes('data-theme="light"'), 'light variant');
	assert.ok(/\.team-compact-edit:focus-visible/.test(compactCss) && !/chevron|team-more/.test(compactCss), 'keyboard focus is visible; no chevron or menu css left');
	assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(compactCss), 'compact styles use hsl palette variables and theme variables only');
	const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['test:workers'];
	assert.ok(scripts.includes('node test-team-model-selection.cjs && node test-team-compact.cjs && '), 'registered right after test-team-model-selection.cjs');
	console.log('PASS EV-TEAM-COMPACT');
})().catch((error) => { console.error(error); process.exit(1); });
