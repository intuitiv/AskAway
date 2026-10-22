#!/usr/bin/env node
/**
 * Reviewer 2026-10-16 (screenshot of the deployed Team tab), items 1-6, 9, 10.
 * Caller view: the production #panel-team HTML from webviewProvider.ts, the production Team JS from media/webview.js
 * (render + keyed patch + wiring + the host 'workerTrace' message case) on a fake DOM whose text nodes behave like a
 * browser's (no outerHTML), the provider's main-agent row and openAgentFile contract, and workersState's projection.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = __dirname;
const webviewSrc = fs.readFileSync(path.join(ROOT, 'media', 'webview.js'), 'utf8');
const providerSrc = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
const mainCss = fs.readFileSync(path.join(ROOT, 'media', 'main.css'), 'utf8');
const teamCss = fs.readFileSync(path.join(ROOT, 'media', 'team', 'team.css'), 'utf8');

function between(src, start, end) {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i + start.length);
    assert(i >= 0 && j > i, `slice not found: ${start} .. ${end}`);
    return src.slice(i, j);
}

function loadTsModule(filePath, mocks = {}) {
    const out = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filePath }).outputText;
    const mod = { exports: {} };
    const req = (id) => {
        if (id in mocks) return mocks[id];
        const tsFile = path.resolve(path.dirname(filePath), id + '.ts');
        return id.startsWith('.') && fs.existsSync(tsFile) ? loadTsModule(tsFile, mocks) : require(id);
    };
    vm.runInThisContext(`(function (exports, require, module) { ${out}\n})`)(mod.exports, req, mod);
    return mod.exports;
}

// The fake DOM of the production render test, with browser-faithful text nodes: a Text node has no outerHTML.
const testSrc = fs.readFileSync(path.join(ROOT, 'test-team-production-render.cjs'), 'utf8');
const createMiniDom = new Function('assert', `${between(testSrc, 'function createMiniDom()', 'function createHarness()')}; return createMiniDom;`)(assert);

const teamPanelHtml = between(providerSrc, '<div class="tab-panel" id="panel-team">', '<!-- End panel-team -->').replace(/\r?\n\s*/g, '');

function createHarness() {
    const { doc, root, MiniElement } = createMiniDom();
    const elementInner = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
    Object.defineProperty(MiniElement.prototype, 'innerHTML', {
        configurable: true, set: elementInner.set,
        get() { return this.children.map(c => (c.tagName ? c.outerHTML : c.textContent)).join(''); },
    });
    root.innerHTML = '<div class="widget-tabs"><button class="widget-tab" data-tab="team">Team <span id="tab-badge-team" class="hidden">0</span></button></div>' + teamPanelHtml + '</div>';
    const textProto = Object.getPrototypeOf(root.querySelector('.widget-tab').children[0]);
    Object.defineProperty(textProto, 'outerHTML', { configurable: true, get() { return undefined; } });
    const messages = [];
    const vscode = { postMessage(msg) { messages.push(msg); } };
    const traceCase = between(webviewSrc, "            case 'workerTrace':", '                break;');
    const api = new Function('document', 'window', 'vscode', 'setInterval', `
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
            onHostMessage: onHostMessage, traceRowsHtml: traceRowsHtml, tab: function () { return currentTab; } };
    `)(doc, {}, vscode, () => 0);
    api.initWorkersTab();
    return { api, doc, messages, click: (el) => el.dispatchEvent({ type: 'click', target: el }) };
}

const now = Date.now();
function task(workerId, profile, state, extra = {}) {
    return {
        workerId, profile, state, adapter: 'opencode', model: 'github-copilot/gpt-6-luna', thinking: 'low', expired: false,
        cacheExpiresAt: now + 120_000, lastUpdateAt: now - 1000, usage: { cost: 1, steps: 1 }, turnCost: 0.1,
        banner: { requests: 1, dollars: 0.1, lastIn: 1000, lastCached: 900, turnOut: 10, lastActivityAt: now - 1000 },
        runs: [{ runId: 'run-' + workerId, state: state === 'RETIRED' ? 'COMPLETED' : state, queuePosition: 0, dispatchTurnId: 't', elapsedMs: 1000, usage: { cost: 0.1, steps: 1 } }],
        ...extra,
    };
}
const PRIYA = { id: 'priya', name: 'Priya', role: 'Product Owner', kind: 'validator', pinned: true, profile: 'validator', taskIds: [], turnCost: 0, monthCost: 0 };
const BHASKAR = { id: 'bhaskar', name: 'Bhaskar', role: 'Tech Lead', kind: 'main', active: false, profile: 'AskAway Build', agentFile: '/u/prompts/askaway-build.agent.md', model: 'github-copilot/claude-opus-5.5', taskIds: [], turnCost: 0.08, monthCost: 6.8 };
// A worker member that spent this turn (a $0 member is hidden, R-TEAM-52).
const worker = (id, name, role, profile) => ({ id, name, role, kind: 'worker', profile, taskIds: [], turnCost: 0.05, monthCost: 0 });
const ANIKA = worker('anika', 'Anika', 'Architect', 'build');
const visibleText = (el) => el.textContent.replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();
const rows = (doc) => doc.querySelectorAll('[data-member-row]').map(r => r.getAttribute('data-member-row'));
const results = [];

// 1. "Do we need filter now?" — no filter input or JS; and (2026-10-21) no header row: Show completed, Archive and Refresh are gone.
{
    assert(!/workers-filter/.test(teamPanelHtml), 'the provider Team panel has no filter input');
    assert(!/getElementById\('workers-filter'\)|workersFilterText/.test(webviewSrc), 'webview.js has no Team filter JS');
    const { api, doc, messages, click } = createHarness();
    assert(!/workers-header|workers-show-expired|workers-archive-btn|workers-refresh-btn|Show completed/.test(teamPanelHtml), 'the Team panel has no Show completed, Archive or Refresh controls');
    assert(!/workers-show-expired|workers-archive-btn|workers-refresh-btn|archiveWorkers|workersShowExpired|showExpired/.test(webviewSrc), 'webview.js has no code for the removed Team controls');
    assert(!/archiveWorkers|_archiveWorkers|setWorkerArchiveSource/.test(providerSrc), 'the provider has no archive handler');
    // The compact opt-in path (2026-10-21) may carry a header with exactly ONE toggle, "Show all members"; the production panel markup has none.
    const headerFn = webviewSrc.slice(webviewSrc.indexOf('function teamHeaderHtml('), webviewSrc.indexOf('function teamShareBarHtml('));
    assert.equal((headerFn.match(/role="switch"/g) || []).length, 1, 'the compact header has exactly one toggle');
    assert(/Show all members/.test(headerFn) && !/Show completed|archive|reload|refresh/i.test(headerFn), 'the one toggle is Show all members; Show completed, archive and reload stay forbidden');
    assert(!/data-team-header|data-team-show-all/.test(teamPanelHtml), 'the production panel markup stays without the compact header');
    // A worker badge in the Trace tab now focuses the owning member instead of filling a filter.
    api.applyWorkersState({ generatedAt: now, members: [PRIYA, ANIKA], workers: [task('worker-b1', 'build', 'RUNNING')], turnWorkerIds: ['worker-b1'] });
    const badge = doc.createElement('span'); badge.setAttribute('data-worker-ref', 'worker-b1'); doc.body.appendChild(badge);
    click(badge);
    assert.equal(api.tab(), 'team');
    assert.equal(doc.querySelector('[data-member-row="anika"]').getAttribute('data-highlighted'), 'true');
    assert.equal(doc.querySelector('[data-member-tray="anika"]').hasAttribute('hidden'), false, 'its tasks open');
    results.push('1 filter removed: test-team-reviewer-2026-10-16.cjs EV-TEAM-NO-FILTER');
}

// 2. "Turn count is incorrect." — turn cost from the ledger since the turn started; summary + member Turn from the displayed list.
{
    const rosterMod = loadTsModule(path.join(ROOT, 'src', 'team', 'roster.ts'));
    const { projectWorkersState } = loadTsModule(path.join(ROOT, 'src', 'workers', 'workersState.ts'), { '../team/roster': rosterMod });
    const turnStart = now - 60_000;
    const usage = (cost) => ({ input: 10, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost, steps: 1 });
    const run = (workerId, startedAt, profile = 'build') => ({ workerId, runId: 'run-' + workerId, startedAt, updatedAt: startedAt, endedAt: startedAt + 10, elapsedMs: 10, state: 'COMPLETED', queuePosition: 0,
        dispatchTurnId: 't', profile, model: 'github-copilot/claude-opus-5.5', thinking: 'high', usage: usage(0), sessionId: 'ses_' + workerId.replace(/-/g, '_'), sessionOpenAction: 'open',
        nextInputTokens: 0, lastPromptTokens: 0, lastCachedTokens: 0 });
    const runs = ['w1', 'w2', 'w3', 'w4', 'w5'].map(id => run('worker-' + id, turnStart + 1000));
    runs[0].usage = usage(59.5);
    const facts = [
        { type: 'checkpoint', ts: turnStart - 5000, workerId: 'worker-w1', runId: 'run-worker-w1', model: 'm', usage: usage(59.2) },
        { type: 'checkpoint', ts: turnStart + 2000, workerId: 'worker-w1', runId: 'run-worker-w1', model: 'm', usage: usage(0.3) },
    ];
    const runtime = { list: () => runs, facts: () => facts, serverEndpoint: '', router: { worker: () => ({ state: 'IDLE' }), cacheExpiresAt: () => now + 60_000 } };
    const projected = projectWorkersState(runtime, '/ws', () => now, turnStart);
    assert.equal(projected.workers.find(w => w.workerId === 'worker-w1').turnCost.toFixed(2), '0.30', 'turn cost counts only checkpoints since the turn started');
    assert(!projected.members.some(m => m.id === 'bhaskar'), 'no worker task lands on the main agent');
    const state = { ...projected, turnWorkerIds: runs.map(r => r.workerId), members: [...projected.members, BHASKAR] };
    const { api, doc, click } = createHarness();
    api.applyWorkersState({ generatedAt: now, members: [PRIYA, ANIKA], workers: [], turnWorkerIds: [] });
    const summary = doc.querySelector('.workers-summary');
    assert(visibleText(summary).startsWith('0 tasks this turn'));
    api.applyWorkersState(state);
    assert.equal(doc.querySelector('.workers-summary'), summary, 'summary patched in place (no flicker)');
    assert.equal(visibleText(summary), '5 tasks this turn · 0 running · 0 queued · 5 warm · 5 completed · $0.38 this turn', 'summary = main agent $0.08 + the worker member $0.30, equal to the rows shown');
    const anika = projected.members.find(m => m.taskIds.includes('worker-w1')).id;
    click(doc.querySelector(`[data-member-tasks-toggle="${anika}"]`));
    assert.equal(doc.querySelector(`[data-member-tray="${anika}"]`).querySelectorAll('.worker-card').length, 5, 'summary count equals the cards shown');
    assert.equal(doc.querySelector(`[data-member-cost="${anika}"]`).getAttribute('data-turn-cost'), '$0.30', 'member Turn is this turn, not the $59.50 lifetime');
    results.push('2 turn counts: test-team-reviewer-2026-10-16.cjs EV-TEAM-TURN-COUNTS');
}

// 3. "There is no scrollbar in Team tab." — panel → shell → list flex chain with min-height:0 and a scrolling list.
{
    const rule = (css, sel) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
    assert(/min-height:\s*0/.test(rule(mainCss, '.tab-panel')) && /overflow:\s*hidden/.test(rule(mainCss, '.tab-panel')));
    assert(/flex:\s*1/.test(rule(mainCss, '.workers-shell')) && /min-height:\s*0/.test(rule(mainCss, '.workers-shell')), 'the shell fills the panel');
    const list = rule(mainCss, '.workers-list');
    assert(/flex:\s*1/.test(list) && /min-height:\s*0/.test(list) && /overflow-y:\s*auto/.test(list), 'the list scrolls');
    assert(/workers-shell/.test(teamPanelHtml) && /workers-list/.test(teamPanelHtml));
    results.push('3 scrollbar: test-team-reviewer-2026-10-16.cjs EV-TEAM-SCROLL');
}

// 4. "Save cost component in Team tab is not needed." — no tips block, even with a cheaper scoreboard model and bloated context.
{
    const { api, doc } = createHarness();
    api.applyWorkersState({ generatedAt: now, members: [PRIYA, ANIKA], turnWorkerIds: ['worker-b1'], workers: [task('worker-b1', 'build', 'RUNNING', { nextInputTokens: 300000 })],
        scoreboard: [{ mode: 'build', model: 'gpt-6-luna', runs: 3, passed: 2, avgCost: 0.01, avgMs: 1 }, { mode: 'build', model: 'cheap', runs: 4, passed: 4, avgCost: 0.001, avgMs: 1 }] });
    const html = doc.getElementById('workers-list').innerHTML;
    assert(!/workers-tips|Save cost/i.test(html) && !/Save cost/.test(webviewSrc));
    results.push('4 Save cost removed: test-team-reviewer-2026-10-16.cjs EV-TEAM-NO-TIPS');
}

// 5. "i want all members to be vsible in team but the are not" (supersedes "hide members who are not actively working"):
//    (2026-10-21 supersedes: "instead of showing all members, can we show members whose Turn is non Zero? And Validator will be
//    shown always." and "Main agent and Validator should be shown always, but main agent will never be 0, so you can hide all
//    0$."): Priya and the main agent always, then only members with Turn spend above zero, in roster order. Cold, retired and
//    finished tasks never show; pill count = cards.
{
    const { api, doc } = createHarness();
    const TARA = worker('tara', 'Tara', 'Test Engineer', 'verify');
    const members = [PRIYA, ANIKA, TARA, worker('sana', 'Sana', 'Researcher', 'explore'), worker('paolo', 'Paolo', 'Pipeline Expert', 'gradle'), BHASKAR];
    const workers = [
        task('worker-cold', 'build', 'COMPLETED', { expired: true, cacheExpiresAt: now - 1 }),
        task('worker-run', 'verify', 'RUNNING'),
        task('worker-retired', 'gradle', 'RETIRED', { expired: true }),
        task('worker-queued', 'explore', 'STARTING', { runs: [{ runId: 'q', state: 'STARTING', queuePosition: 1, usage: {} }] }),
        task('worker-other-turn', 'build', 'RUNNING'),
    ];
    const state = { generatedAt: now, members, workers, turnWorkerIds: ['worker-cold', 'worker-run', 'worker-retired', 'worker-queued'] };
    api.applyWorkersState(state);
    assert.deepEqual(rows(doc), ['priya', 'bhaskar', 'anika', 'tara', 'sana', 'paolo'], 'every member that spent shows: Priya, the (idle) main agent, then roster order');
    assert(/^Trace \(\d+\)/.test(doc.querySelector('[data-member-tasks-toggle="priya"]').textContent), 'Priya keeps her Trace button');
    const pills = () => ['anika', 'tara', 'sana', 'paolo'].map(id => doc.querySelector(`[data-member-tasks-toggle="${id}"]`).textContent);
    const cards = () => ['anika', 'tara', 'sana', 'paolo'].map(id => doc.querySelector(`[data-member-tray="${id}"]`).querySelectorAll('.worker-card').length);
    assert.deepEqual(pills(), ['0 tasks \u25b8', '1 task \u25b8', '1 task \u25b8', '0 tasks \u25b8'], 'cold and retired tasks stay hidden; other-turn tasks never show');
    assert.deepEqual(cards(), [0, 1, 1, 0], 'pill count equals the visible cards');
    const shown = doc.querySelector('[data-member-row="paolo"]');
    assert(shown.querySelector('select[data-member-model]') && shown.querySelector('select[data-member-thinking]') && shown.querySelector('[data-open-agent-file]'), 'a shown row has its model, thinking and agent file');
    assert.equal(shown.querySelector('[data-status-state]').getAttribute('data-status-state'), 'idle');
    // $0 members hide, even with a running task; Priya and the main agent stay at $0.
    const free = (m) => ({ ...m, turnCost: 0 });
    api.applyWorkersState({ ...state, members: [free(PRIYA), free(ANIKA), TARA, free(members[3]), free(members[4]), free(BHASKAR)] });
    assert.deepEqual(rows(doc), ['priya', 'bhaskar', 'tara'], 'only Priya, the main agent and the members with Turn spend above zero');
    results.push('5 members by Turn spend, tasks filtered: test-team-reviewer-2026-10-16.cjs EV-TEAM-ALL-MEMBERS');
}

// 6. "Trace button is also not working." — Priya's Trace loads her validator task traces and expands shared trace rows inline.
{
    const { api, doc, messages, click } = createHarness();
    api.applyWorkersState({ generatedAt: now, members: [PRIYA], workers: [], turnWorkerIds: [] });
    const pill = doc.querySelector('[data-member-tasks-toggle="priya"]');
    assert.equal(pill.textContent, 'Trace (0) \u25b8', 'Trace (0) when there really are none');
    click(pill);
    assert.equal(doc.querySelector('[data-member-tray="priya"]').hasAttribute('hidden'), false);
    assert.equal(visibleText(doc.querySelector('[data-member-tray="priya"]')), 'No Validator trace this turn.');
    const val = task('worker-val', 'validator', 'COMPLETED', { track: 'validator' });
    api.applyWorkersState({ generatedAt: now, members: [PRIYA], workers: [val], turnWorkerIds: ['worker-val'] });
    assert.deepEqual(messages.filter(m => m.type === 'requestWorkerTrace').map(m => m.workerId), ['worker-val'], 'her task trace is requested');
    const events = [{ kind: 'request', id: 'REQV1', ts: now - 500, model: 'gpt-6-luna', inputTokens: 900, outputTokens: 20, cachedTokens: 800, dollars: 0.01 },
        { kind: 'tool', id: 'TOOLV', ts: now - 400, tool: 'askaway_memory', durMs: 30, status: 'ok', inputTokens: 1, outputTokens: 2, inputPreview: '', outputPreview: '' }];
    api.onHostMessage({ type: 'workerTrace', data: { workerId: 'worker-val', source: 'opencode', reason: '', runs: { 'run-worker-val': events } } });
    assert.equal(pill.textContent, 'Trace (2) \u25be', 'count updates in place to the loaded events');
    const table = doc.querySelector('[data-member-tray="priya"] table.team-validator-trace.obs-timeline-table');
    assert(table && table.textContent.includes('REQV1') && table.textContent.includes('askaway_memory'), 'shared traceRowsHtml rows inline');
    assert(api.traceRowsHtml(events, { openIds: {}, now }).includes('REQV1'));
    results.push('6 Priya Trace: test-team-reviewer-2026-10-16.cjs EV-TEAM-PRIYA-TRACE');
}

// 9. Task pill count equals the cards; collapsing hides them; counts update without re-creating the row.
{
    const { api, doc, click } = createHarness();
    const one = [task('worker-a1', 'build', 'COMPLETED')];
    api.applyWorkersState({ generatedAt: now, members: [PRIYA, ANIKA], workers: one, turnWorkerIds: ['worker-a1'] });
    const pill = doc.querySelector('[data-member-tasks-toggle="anika"]');
    assert.equal(pill.textContent, '1 task \u25b8');
    const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map(id => task('worker-' + id, 'build', 'COMPLETED'));
    api.applyWorkersState({ generatedAt: now, members: [PRIYA, ANIKA], workers: five, turnWorkerIds: five.map(w => w.workerId) });
    assert.equal(doc.querySelector('[data-member-tasks-toggle="anika"]'), pill, 'same pill node');
    assert.equal(pill.textContent, '5 tasks \u25b8', 'pill count follows the tasks (browser text nodes are patched)');
    const tray = doc.querySelector('[data-member-tray="anika"]');
    assert.equal(tray.querySelectorAll('.worker-card').length, 5, 'pill count equals the cards inside');
    assert(tray.hasAttribute('hidden'), 'collapsed by default');
    click(pill); assert(!tray.hasAttribute('hidden'));
    click(pill); assert(tray.hasAttribute('hidden'), 'collapse hides the cards');
    assert(/\.team-member-tasks-panel\[hidden\]\s*\{\s*display:\s*none/.test(teamCss), 'the drawer display rule does not override [hidden]');
    results.push('9 pill count + collapse: test-team-reviewer-2026-10-16.cjs EV-TEAM-PILL-COUNT');
}

// 10. Bhaskar is the main agent (AskAway Build chat mode + its .agent.md + chat model); build worker tasks belong to Anika.
{
    const rosterMod = loadTsModule(path.join(ROOT, 'src', 'team', 'roster.ts'));
    const { projectTeamMembers } = loadTsModule(path.join(ROOT, 'src', 'workers', 'workersState.ts'), { '../team/roster': rosterMod });
    const members = projectTeamMembers([{ ...task('worker-b9', 'build', 'RUNNING'), track: '' }], rosterMod.TEAM_ROSTER);
    assert.deepEqual(members.map(m => [m.id, m.taskIds.join()]), [['priya', ''], ['anika', 'worker-b9'], ['diego', ''], ['tara', ''], ['pavel', ''], ['paolo', ''], ['sana', ''], ['shreya', ''], ['cathy', '']],
        'every worker roster member is projected (idle ones too); the build worker profile maps to Anika');
    // Provider: the main agent row of the selected chat agent.
    const methods = between(providerSrc, "    /** VS Code's user prompts folder", '    public async getTurnMetricsSnapshot');
    const Provider = vm.runInNewContext(ts.transpileModule(`class P {\n${methods}\n}; P`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
        path, fs: { existsSync: f => f === '/home/u/Code/User/prompts/askaway-build.agent.md' },
        applyMemberOverride: rosterMod.applyMemberOverride, readMemberOverrides: () => ({}), initialsOf: rosterMod.initialsOf, AIU_PER_DOLLAR: 100,
        roomFor: () => ({ mainAgentIdentity: () => rosterMod.resolveMainAgentIdentity('AskAway Build'), snapshot: () => ({ members: [{ kind: 'agent', presence: 'joined' }] }) }),
    });
    const provider = Object.assign(new Provider(), {
        _context: { globalStorageUri: { fsPath: '/home/u/Code/User/globalStorage/askaway' } },
        _turnRequests: [{ model: 'claude-opus-5.5', nanoAiu: 4e9 }, { model: 'gpt-6-luna', nanoAiu: 1e9, subagent: 'explore' }],
        // The main agent's Turn is the accumulated turn scope (sub-agents included), the number turn_budget counts as main spend.
        _deriveLastRequest: () => ({ nanoAiu: 4e9 }),
        _observabilityCache: { monthCredits: { aiu: 680 } },
    });
    const main = provider._mainAgentMember('/ws');
    assert.deepEqual([main.id, main.kind, main.active, main.profile, main.agentFile, main.model, main.turnCost.toFixed(2), main.monthCost.toFixed(2)],
        ['bhaskar', 'main', true, 'AskAway Build', '/home/u/Code/User/prompts/askaway-build.agent.md', 'claude-opus-5.5', '0.04', '6.80']);
    assert.equal(rosterMod.resolveMainAgentIdentity('AA.Orchestrator').agentFile, '.github/agents/AA.Orchestrator.agent.md');
    const { api, doc, messages, click } = createHarness();
    api.applyWorkersState({ generatedAt: now, members: [...members, main], workers: [task('worker-b9', 'build', 'RUNNING')], turnWorkerIds: ['worker-b9'] });
    const row = doc.querySelector('[data-member-row="bhaskar"]');
    assert.equal(row.getAttribute('data-main-agent'), 'true');
    assert.equal(row.querySelector('select'), null, 'no worker model/thinking dropdowns on the main agent');
    assert.equal(row.querySelector('[data-member-tray]'), null, 'no worker tasks under the main agent');
    assert(visibleText(row).includes('Chat agent: AskAway Build') && visibleText(row).includes('Model: claude-opus-5.5'));
    click(row.querySelector('[data-open-agent-file]'));
    assert.deepEqual(messages.at(-1), { type: 'openAgentFile', memberId: 'bhaskar', profile: '', path: main.agentFile, agentFile: main.agentFile });
    assert(doc.querySelector('[data-member-tray="anika"]').innerHTML.includes('data-worker-id="worker-b9"'), 'the build task is Anika\'s');
    results.push('10 main agent separated (build → Anika): test-team-reviewer-2026-10-16.cjs EV-TEAM-MAIN-AGENT');
}

// 11. "Rules dev is more specific to authoring mcp of pega. So, it should be only in my user workspace, not part of
//     extension." — no Rules/authoring/Pega member or profile ships; the user's own profile files add Team members.
{
    const rosterMod = loadTsModule(path.join(ROOT, 'src', 'team', 'roster.ts'));
    const shipped = /\brhea\b|rules expert|\bpega\b|\bauthoring\b|\bdevx\b/i;
    assert(!rosterMod.TEAM_ROSTER.some(m => shipped.test([m.id, m.name, m.role, ...m.profiles].join(' '))), 'no Rules/authoring member in roster.ts');
    assert(!Object.keys(rosterMod.CREATIVE_ROLE_STATUSES).includes('rhea'));
    for (const file of fs.readdirSync(path.join(ROOT, 'worker-profiles'))) {
        assert(!shipped.test(file + fs.readFileSync(path.join(ROOT, 'worker-profiles', file), 'utf8')), `bundled worker profile ${file} has no Rules/authoring content`);
    }
    // package.json's worker-mode description is generated from src/workers/workerTools.ts (LM manifest); it still names
    // authoring/devx as user-level modes. It ships no profile file or roster member for them (checked above).
    // The reviewer's own ~/.askaway/worker-profiles: `member:` + `role:` frontmatter adds Rhea; two profiles, one member.
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-user-profiles-'));
    const profile = (name, extra) => `---\nname: ${name}\ntier: mid\nmodel: github-copilot/gpt-6-luna\nthinking: low\nmodels: [github-copilot/gpt-6-luna]\nthinkingOptions: [low]\n${extra}---\nprompt\n`;
    fs.writeFileSync(path.join(dir, 'review.md'), profile('review', 'member: Rhea\nrole: Rules Expert\n'));
    fs.writeFileSync(path.join(dir, 'quality.md'), profile('quality', 'member: Rhea\nrole: Rules Expert\n'));
    fs.writeFileSync(path.join(dir, 'explore.md'), profile('explore', ''));
    const user = rosterMod.userRosterEntries(dir);
    assert.deepEqual(user.map(m => [m.id, m.name, m.role, m.profiles.join()]), [['rhea', 'Rhea', 'Rules Expert', 'quality,review']], 'a profile without member: adds nobody');
    assert.deepEqual(rosterMod.userRosterEntries(path.join(dir, 'missing')), [], 'no user folder, no extra members');
    const { projectTeamMembers } = loadTsModule(path.join(ROOT, 'src', 'workers', 'workersState.ts'), { '../team/roster': rosterMod });
    const projected = projectTeamMembers([{ ...task('worker-r1', 'review', 'RUNNING'), track: '' }], rosterMod.teamRoster(dir));
    assert.equal(projected.at(-1).id, 'rhea', 'user members follow the extension roster');
    assert.deepEqual(projected.find(m => m.id === 'rhea').taskIds, ['worker-r1'], 'a review task belongs to the user-level Rhea');
    const { api, doc } = createHarness();
    api.applyWorkersState({ generatedAt: now, members: projected, workers: [task('worker-r1', 'review', 'RUNNING')], turnWorkerIds: ['worker-r1'] });
    assert(visibleText(doc.querySelector('[data-member-row="rhea"]')).includes('Rhea · Rules Expert'), 'Rhea renders in the reviewer\'s Team');
    assert.equal(doc.querySelector('[data-member-row="rhea"] [data-open-agent-file]').getAttribute('data-open-agent-file'), path.join(dir, 'quality.md'), 'her agent file is her (first) user profile');
    fs.rmSync(dir, { recursive: true, force: true });
    results.push('11 Rhea user-level only: test-team-reviewer-2026-10-16.cjs EV-TEAM-USER-MEMBERS');
}

// 12. Storybook screenshot review: panes visible, 420px wide, header icons, one money format.
{
    // a) No id selector hides the panes: `.active` must outrank the hidden default.
    assert(!/team-storybook-shell[^{}]*#panel-/.test(teamCss) && !/\.team-storybook-shell\s*\{\s*\.team-pane/.test(teamCss), 'no nested/id rule hides the Storybook panes');
    assert(/\.team-storybook-shell \.team-pane\s*\{[^}]*display:\s*none/.test(teamCss));
    assert(/\.team-storybook-shell \.team-pane\.active[^{]*\{[^}]*display:\s*flex/.test(teamCss), 'the active pane rule has higher specificity than the hidden default');
    // b) 420px: the width variable has the sidebar fallback, and Storybook passes it on the patched root.
    assert(!/width:\s*var\(--team-widget-width\)/.test(teamCss) && /width:\s*var\(--team-widget-width, 420px\)/.test(teamCss), 'every widget width falls back to 420px');
    const teamProto = fs.readFileSync(path.join(ROOT, 'storybook', 'prototypes', 'team.js'), 'utf8');
    assert(/patchTeamHtml\(contentEl, `<div style="--team-widget-width:\$\{TEAM_WIDGET_WIDTH\}">/.test(teamProto), 'the width rides on the patched root, not a style the patch removes');
    // c) The Team header row is gone in production and Storybook alike.
    assert(!/workers-header/.test(teamProto), 'Storybook has no header row either');
    // d) One money formatter: $0.00 for zero, 4 decimals under a cent, never a bare $0.
    const money = createHarness();
    money.api.applyWorkersState({ generatedAt: now, members: [{ ...PRIYA, turnCost: 0, monthCost: 0 }, BHASKAR, { ...ANIKA, turnCost: 0.003, monthCost: 0.004 }], workers: [], turnWorkerIds: [] });
    const costs = money.doc.querySelectorAll('[data-member-cost]').map(el => [el.getAttribute('data-member-cost'), el.getAttribute('data-turn-cost'), el.getAttribute('data-month-cost')]);
    assert.deepEqual(costs, [['priya', '$0.00', '$0.00'], ['bhaskar', '$0.08', '$6.80'], ['anika', '$0.0030', '$0.0040']]);
    assert(/teamMoney\(dollars\)/.test(webviewSrc), 'the summary uses the same formatter');
    assert(!/'\$0'/.test(webviewSrc.slice(webviewSrc.indexOf('// ── Workers tab: pure render'), webviewSrc.indexOf('// ── end Workers pure render ──'))), 'no second "$0" format in the Team render');
    results.push('12 Storybook panes/width/icons/money: test-team-reviewer-2026-10-16.cjs EV-TEAM-STORYBOOK-REVIEW');
}

// webviewProvider.ts stays CRLF-only.
assert.equal((providerSrc.match(/(^|[^\r])\n/g) || []).length, 0, 'webviewProvider.ts is CRLF-only');
console.log(results.join('\n'));
console.log('PASS test-team-reviewer-2026-10-16 (EV-TEAM-NO-FILTER, EV-TEAM-TURN-COUNTS, EV-TEAM-SCROLL, EV-TEAM-NO-TIPS, EV-TEAM-ALL-MEMBERS, EV-TEAM-PRIYA-TRACE, EV-TEAM-PILL-COUNT, EV-TEAM-MAIN-AGENT, EV-TEAM-USER-MEMBERS, EV-TEAM-STORYBOOK-REVIEW)');
