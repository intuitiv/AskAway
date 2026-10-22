// EV-TEAM-RESTING-STATUS (R-TEAM-73): with no turn active every Team member shows one fixed resting status with a static dot;
// while a turn is active, working members show the glowing dot. Seen from the caller: the shared Team render block.
// Run: node test-team-resting-status.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = __dirname;
const css = fs.readFileSync(path.join(ROOT, 'media', 'team', 'team.css'), 'utf8');
const NOW = 1_700_000_000_000;
const member = (id, name, role, extra = {}) => ({
	id, name, role, kind: 'worker', profile: id, pinned: false, taskIds: [], turnCost: 0.05, monthCost: 0,
	model: 'github-copilot/gpt-6-luna', thinking: 'low', statusWorking: ['W1', 'W2', 'W3'], statusIdle: ['I1', 'I2', 'I3'], ...extra,
});
const MEMBERS = [
	member('priya', 'Priya', 'Product Owner', { kind: 'validator', pinned: true }),
	member('bhaskar', 'Bhaskar', 'Tech Lead', { kind: 'main', active: true }),
	member('tara', 'Tara', 'Test Engineer'),
	member('paolo', 'Paolo', 'Pipeline Expert'),
];
const state = (turnActive) => ({ generatedAt: NOW, members: MEMBERS, workers: [], turnWorkerIds: [], turnActive });
const rowOf = (html, id) => {
	const at = html.indexOf(`data-compact-row="${id}"`);
	assert.ok(at >= 0, `${id} has a row`);
	const start = html.lastIndexOf('<div class="team-member-row', at);
	const next = html.indexOf('<div class="team-member-row', at);
	return html.slice(start, next < 0 ? html.length : next);
};
const statusOf = (row) => {
	const m = row.match(/<div class="team-member-status team-compact-status (team-status-\w+)" data-status-state="(\w+)"[^>]*><span class="team-status-dot"[^>]*><\/span><span class="team-status-text">([^<]*)<\/span>/);
	assert.ok(m, 'status line found');
	return { cls: m[1], state: m[2], text: m[3] };
};

(async () => {
	const proto = await import(pathToFileURL(path.join(ROOT, 'storybook', 'prototypes', 'team.js')).href);
	const kit = proto.getWorkersKit();
	const render = (turnActive, now = NOW) => kit.renderWorkersHtml({ ...state(turnActive), generatedAt: now }, '', {}, {}, {});
	const ids = ['priya', 'bhaskar', 'tara', 'paolo'];

	// No turn: one fixed label, static dot, no phrases to rotate, nobody is "working".
	const idle = render(false);
	const labels = new Set();
	for (const id of ids) {
		const st = statusOf(rowOf(idle, id));
		assert.equal(st.cls, 'team-status-resting', `${id}: resting dot class`);
		assert.equal(st.state, 'resting');
		labels.add(st.text);
		assert.ok(!/is-working/.test(rowOf(idle, id).split('>')[0]), `${id}: no working row`);
	}
	assert.deepEqual([...labels], ['Offline'], 'one constant resting label for every member');
	assert.ok(!/team-status-working/.test(idle), 'no glowing dot without a turn');

	// Routine updates while idle (the clock moves, state re-polled): nothing changes.
	for (let t = 0; t < 120_000; t += 3_000) {
		const again = render(false, NOW + t);
		for (const id of ids) assert.deepEqual(statusOf(rowOf(again, id)), statusOf(rowOf(idle, id)), `${id} unchanged at +${t}ms`);
	}

	// Turn active: Bhaskar (working) glows; the others show their normal idle phrases.
	const live = render(true);
	const bhaskar = statusOf(rowOf(live, 'bhaskar'));
	assert.equal(bhaskar.cls, 'team-status-working');
	assert.ok(['W1', 'W2', 'W3'].includes(bhaskar.text), 'working phrase while the turn runs');
	const tara = statusOf(rowOf(live, 'tara'));
	assert.equal(tara.cls, 'team-status-idle');
	assert.ok(['I1', 'I2', 'I3'].includes(tara.text));

	// Turn ends: back to the resting status.
	const after = render(false);
	assert.equal(statusOf(rowOf(after, 'bhaskar')).text, 'Offline');
	assert.equal(statusOf(rowOf(after, 'bhaskar')).cls, 'team-status-resting');

	// CSS: only the working dot animates; the resting dot is static.
	assert.ok(/\.team-compact-status\.team-status-working \.team-status-dot \{[^}]*animation: team-dot-pulse/.test(css));
	assert.ok(/\.team-compact-status\.team-status-resting \.team-status-dot \{[^}]*animation: none/.test(css));

	// Production: the turn signal is the Metrics turn timer and a turn change repaints the Team tab.
	const web = fs.readFileSync(path.join(ROOT, 'media', 'webview.js'), 'utf8');
	assert.ok(/turnActive: workersTurnActive\(\)/.test(web) && /workersTurnActive\(\) !== workersPaintedTurnActive\) \{ paintWorkers\(\)/.test(web));
	console.log('PASS EV-TEAM-RESTING-STATUS');
})().catch((e) => { console.error(e); process.exit(1); });
