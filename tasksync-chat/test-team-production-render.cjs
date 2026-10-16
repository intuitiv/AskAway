#!/usr/bin/env node
/**
 * Lane A caller-view tests for the production Team tab renderer in media/webview.js.
 * Slices the shared trace/banner and Workers/Team blocks out of media/webview.js
 * and verifies state.members rendering, prototype row structure, keyed DOM
 * reconciliation (patchTeam / paintWorkers) without flicker, and interactions.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webviewSrc = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');

function between(src, start, end) {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i);
    assert(i >= 0 && j > i, `slice not found: ${start} .. ${end}`);
    return src.slice(i, j);
}

// Minimal DOM implementation that preserves element identity across keyed patches
// while recreating child trees only when innerHTML is assigned.
function createMiniDom() {
    let activeElement = null;
    let htmlWrites = 0;

    class ClassList {
        constructor(el) {
            this._el = el;
        }
        _set() {
            const raw = this._el.getAttribute('class') || '';
            return new Set(raw.split(/\s+/).filter(Boolean));
        }
        _sync(set) {
            this._el._attrs['class'] = Array.from(set).join(' ');
        }
        add(...names) {
            const s = this._set();
            names.forEach(n => { if (n) s.add(n); });
            this._sync(s);
        }
        remove(...names) {
            const s = this._set();
            names.forEach(n => s.delete(n));
            this._sync(s);
        }
        contains(name) {
            return this._set().has(name);
        }
        toggle(name, force) {
            const s = this._set();
            const shouldAdd = force !== undefined ? Boolean(force) : !s.has(name);
            if (shouldAdd) s.add(name);
            else s.delete(name);
            this._sync(s);
            return shouldAdd;
        }
    }

    class MiniText {
        constructor(text) {
            this.tagName = '';
            this._text = String(text || '');
            this.children = [];
            this.parentNode = null;
        }
        get textContent() { return this._text; }
        set textContent(v) { this._text = String(v == null ? '' : v); }
        get outerHTML() { return this._text; }
        get innerHTML() { return this._text; }
        matches() { return false; }
        querySelector() { return null; }
        querySelectorAll() { return []; }
    }

    class MiniElement {
        constructor(tagName) {
            this.tagName = String(tagName || 'div').toUpperCase();
            this._attrs = {};
            this.children = [];
            this.parentNode = null;
            this._listeners = {};
            this._value = undefined;
            this.hidden = false;
            this.classList = new ClassList(this);
        }
        get id() { return this._attrs.id || ''; }
        set id(v) { this._attrs.id = String(v); }
        get className() { return this._attrs['class'] || ''; }
        set className(v) { this._attrs['class'] = String(v || ''); }
        get value() {
            if (this._value !== undefined) return this._value;
            if (this.tagName === 'SELECT') {
                const opts = this.children.filter(c => c.tagName === 'OPTION');
                const sel = opts.find(c => c.hasAttribute('selected')) || opts[0];
                return sel ? sel.getAttribute('value') || '' : '';
            }
            return this._attrs.value || '';
        }
        set value(v) {
            this._value = String(v);
        }
        get firstChild() {
            return this.children.find(c => c.tagName) || this.children[0] || null;
        }
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
        }
        setAttribute(name, val) {
            this._attrs[name] = String(val);
            if (name === 'hidden') this.hidden = true;
        }
        removeAttribute(name) {
            delete this._attrs[name];
            if (name === 'hidden') this.hidden = false;
        }
        hasAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this._attrs, name);
        }
        appendChild(child) {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = this;
            this.children.push(child);
            return child;
        }
        insertBefore(child, reference) {
            if (!reference) return this.appendChild(child);
            if (child === reference) return child;
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = this;
            this.children.splice(this.children.indexOf(reference), 0, child);
            return child;
        }
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx >= 0) {
                this.children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        }
        get textContent() {
            return this.children.map(c => c.textContent).join('');
        }
        set textContent(v) {
            const t = new MiniText(String(v == null ? '' : v));
            t.parentNode = this;
            this.children = [t];
        }
        get innerHTML() {
            return this.children.map(c => c.outerHTML).join('');
        }
        set innerHTML(html) {
            htmlWrites++;
            this.children = parseHtmlFragment(String(html || ''), this);
        }
        get outerHTML() {
            const attrs = Object.keys(this._attrs).map(k => {
                const v = this._attrs[k];
                return v === '' && k === 'hidden' ? 'hidden' : `${k}="${v}"`;
            }).join(' ');
            const open = `<${this.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
            if (VOID_TAGS.has(this.tagName.toLowerCase())) return open;
            return `${open}${this.innerHTML}</${this.tagName.toLowerCase()}>`;
        }
        matches(selector) {
            return selector.split(',').some(part => matchesChain(this, part.trim().split(/\s+/)));
        }
        closest(selector) {
            let cur = this;
            while (cur) {
                if (cur.matches && cur.matches(selector)) return cur;
                cur = cur.parentNode;
            }
            return null;
        }
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        }
        querySelectorAll(selector) {
            const parts = selector.trim().split(/\s+/);
            const results = [];
            function walk(node) {
                for (const child of node.children) {
                    if (!child.tagName) continue;
                    if (matchesChain(child, parts)) results.push(child);
                    walk(child);
                }
            }
            walk(this);
            return results;
        }
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
        dispatchEvent(evt) {
            evt.target = evt.target || this;
            evt.preventDefault = evt.preventDefault || function () {};
            let cur = this;
            while (cur) {
                const list = cur._listeners && cur._listeners[evt.type];
                if (list) list.slice().forEach(fn => fn.call(cur, evt));
                cur = cur.parentNode;
            }
        }
    }

    function matchSingleSelector(el, sel) {
        if (!el || !el.tagName) return false;
        let rest = sel.trim();
        const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
        if (tagMatch) {
            if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
            rest = rest.slice(tagMatch[0].length);
        }
        const withoutAttrs = rest.replace(/\[[^\]]*\]/g, '');
        const idMatch = withoutAttrs.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch && el.id !== idMatch[1]) return false;
        const classMatches = withoutAttrs.match(/\.([a-zA-Z0-9_-]+)/g) || [];
        for (const cm of classMatches) {
            if (!el.classList.contains(cm.slice(1))) return false;
        }
        const attrRegex = /\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g;
        let m;
        while ((m = attrRegex.exec(rest)) !== null) {
            if (!el.hasAttribute(m[1])) return false;
            if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
        }
        return true;
    }

    function matchesChain(el, parts) {
        if (!matchSingleSelector(el, parts[parts.length - 1])) return false;
        let cur = el.parentNode;
        for (let i = parts.length - 2; i >= 0; i--) {
            while (cur && !matchSingleSelector(cur, parts[i])) cur = cur.parentNode;
            if (!cur) return false;
            cur = cur.parentNode;
        }
        return true;
    }

    const VOID_TAGS = new Set(['img', 'br', 'hr', 'input']);
    function parseHtmlFragment(html, parent) {
        const root = { children: [] };
        const stack = [root];
        const tagRe = /<\/?([a-zA-Z0-9-]+)([^>]*?)\/?>|([^<]+)/g;
        let match;
        while ((match = tagRe.exec(html)) !== null) {
            const full = match[0];
            if (match[3] !== undefined) {
                const top = stack[stack.length - 1];
                const txt = new MiniText(match[3]);
                txt.parentNode = top === root ? parent : top;
                top.children.push(txt);
                continue;
            }
            const tag = match[1].toLowerCase();
            const attrStr = match[2] || '';
            if (full.startsWith('</')) {
                if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tag) {
                    stack.pop();
                }
                continue;
            }
            const el = new MiniElement(tag);
            const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
            let am;
            while ((am = attrRe.exec(attrStr)) !== null) {
                const name = am[1];
                const val = am[2] !== undefined ? am[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '';
                el.setAttribute(name, val);
            }
            const top = stack[stack.length - 1];
            el.parentNode = top === root ? parent : top;
            top.children.push(el);
            const selfClose = full.endsWith('/>') || VOID_TAGS.has(tag);
            if (!selfClose) stack.push(el);
        }
        return root.children;
    }

    const root = new MiniElement('body');
    const doc = {
        body: root,
        get activeElement() { return activeElement; },
        set activeElement(el) { activeElement = el; },
        createElement(tag) { return new MiniElement(tag); },
        getElementById(id) { return root.querySelector(`#${id}`); },
        querySelector(sel) { return root.querySelector(sel); },
        querySelectorAll(sel) { return root.querySelectorAll(sel); },
        addEventListener(type, fn) { root.addEventListener(type, fn); }
    };
    doc.htmlWrites = () => htmlWrites;
    return { doc, root, MiniElement };
}

function createHarness() {
    const { doc, root } = createMiniDom();
    root.innerHTML = [
        '<div class="widget-tabs">',
        '<button class="widget-tab" data-tab="team">Team <span id="tab-badge-team" class="hidden">0</span></button>',
        '<button class="widget-tab" data-tab="observability">Metrics</button>',
        '</div>',
        '<div id="panel-team" class="tab-panel active">',
        '<button id="workers-refresh-btn"></button>',
        '<button id="workers-archive-btn"></button>',
        '<button id="workers-server-btn"><span class="codicon"></span></button>',
        '<div id="workers-show-expired"></div>',
        '<div id="workers-list"></div>',
        '</div>'
    ].join('');

    const messages = [];
    const intervals = [];
    const vscode = { postMessage(msg) { messages.push(msg); } };
    const win = {};

    const banner = between(webviewSrc, '// ── Usage banner', '// ── end Usage banner ──');
    const trace = between(webviewSrc, '// ── Turn trace rows', '// ── end Turn trace rows ──');
    const workersPure = between(webviewSrc, '// ── Workers tab: pure render', '// ── end Workers pure render ──');
    const workersDom = between(webviewSrc, '    var workersState = null;', '    function initSpecsTab()');

    const factory = new Function(
        'document', 'window', 'vscode', 'setInterval',
        `var currentTab = 'chat';
         var observabilityMetrics = {};
         function escapeHtml(v) { return String(v == null ? '' : v); }
         function switchTab(tab) {
             currentTab = tab;
             var isTeam = tab === 'team' || tab === 'workers';
             document.querySelectorAll('.widget-tab').forEach(function(btn) {
                 var dt = btn.getAttribute('data-tab');
                 btn.classList.toggle('active', dt === tab || (isTeam && (dt === 'team' || dt === 'workers')));
             });
             document.querySelectorAll('.tab-panel').forEach(function(panel) {
                 panel.classList.toggle('active', panel.id === 'panel-' + tab || (isTeam && (panel.id === 'panel-team' || panel.id === 'panel-workers')));
             });
             if (isTeam) vscode.postMessage({ type: 'requestWorkersState' });
         }
         ${banner}
         ${trace}
         ${workersPure}
         ${workersDom}
         return {
              renderWorkersHtml: renderWorkersHtml,
              teamMemberRowHtml: teamMemberRowHtml,
              normalizeTeamMember: normalizeTeamMember,
              runtimeSettingsHtml: runtimeSettingsHtml,
              initRuntimeSettings: initRuntimeSettings,
              applyRuntimeHealth: applyRuntimeHealth,
             usageBannerHtml: usageBannerHtml,
             applyWorkersState: applyWorkersState,
             paintWorkers: paintWorkers,
             patchTeam: patchTeam,
             tickTeamAges: tickTeamAges,
             initWorkersTab: initWorkersTab,
             focusTeamMember: focusTeamMember,
             getCurrentTab: function() { return currentTab; }
         };`
    );

    const api = factory(doc, win, vscode, function (fn, ms) { intervals.push({ fn, ms }); return intervals.length; });
    api.initWorkersTab();
    return { api, doc, root, messages, intervals };
}

const now = 1_760_000_000_000;
const sampleState = {
    generatedAt: now,
    avatarBase: 'vscode-webview-resource://test/media/avatars',
    server: { state: 'ATTACHED', endpoint: 'http://127.0.0.1:4096' },
    members: [
        {
            id: 'priya',
            name: 'Priya',
            role: 'Validator',
            pinned: true,
            avatar: 'priya-validator.png',
            creativeStatus: 'Guardrails warm · reviewing spec compliance',
            agentFile: '.github/agents/validator.agent.md',
            defaultModel: 'github-copilot/claude-sonnet-4.6',
            defaultThinking: 'medium',
            turnCost: 0.14,
            monthCost: 4.82,
            workerIds: ['worker-validator-1']
        },
        {
            id: 'anika',
            name: 'Anika',
            role: 'Architect',
            pinned: false,
            avatar: 'anika-build.png',
            creativeStatus: 'Shipping packets · keeping tests green',
            agentFile: '.opencode/agent/askaway-code.md',
            defaultModel: 'agy/gemini-4-argon-high',
            defaultThinking: 'high',
            turnCost: 0.25,
            monthCost: 9.10,
            workerIds: ['worker-build-1']
        }
    ],
    workers: [
        {
            workerId: 'worker-validator-1',
            profile: 'validator',
            adapter: 'opencode',
            model: 'github-copilot/claude-sonnet-4.6',
            thinking: 'medium',
            state: 'IDLE',
            expired: false,
            track: 'A',
            cacheExpiresAt: now + 180_000,
            usage: { cost: 0.14, steps: 2 },
            banner: { requests: 2, dollars: 0.14, lastIn: 12000, turnOut: 400, lastActivityAt: now - 25_000 },
            runs: [{ runId: 'run-val-1', state: 'COMPLETED', queuePosition: 0, dispatchTurnId: 't1', elapsedMs: 4200, usage: { cost: 0.14, steps: 2, input: 3000, cacheRead: 9000 } }]
        },
        {
            workerId: 'worker-build-1',
            profile: 'build',
            adapter: 'agy',
            model: 'agy/gemini-4-argon-high',
            thinking: 'high',
            state: 'RUNNING',
            sessionId: 'ses_build_1',
            expired: false,
            track: 'B',
            usage: { cost: null, steps: 3 },
            banner: { requests: 3, dollars: null, lastIn: 18000, turnOut: 900, lastActivityAt: now - 10_000 },
            runs: [{ runId: 'run-bld-1', state: 'RUNNING', queuePosition: 0, dispatchTurnId: 't2', elapsedMs: 8100, usage: { cost: 0, steps: 3, input: 18000, cacheRead: 0 } }]
        }
    ],
    monthCredits: {
        categories: [
            { category: 'Build', dollars: 9.1, requests: 12 },
            { category: 'Explore', dollars: 1.2, requests: 4 }
        ]
    }
};

// 1. Pure render assertions: only state.members (Priya + Anika), no static roster, no category table, no Track lanes, no unreported.
{
    const { api } = createHarness();
    const html = api.renderWorkersHtml(sampleState, '', {}, false, {}, {});

    assert(html.includes('data-member-row="priya"'), 'renders Priya row');
    assert(html.includes('data-member-row="anika"'), 'renders Anika row');
    for (const ghost of ['Kavya', 'Arjun', 'Maya', 'Dev']) {
        assert(!html.includes(ghost), `must not render uninvited static roster member ${ghost}`);
    }
    assert(!html.includes('obs-cost-categories'), 'must not render #obs-cost-categories');
    assert(!html.includes('<th>Category</th>'), 'must not render Category cost table header');
    assert(!html.includes('workers-lane'), 'must not render workers-lane track headers');
    assert(!/unreported/i.test(html), 'must never emit unreported or cost unreported');
    assert(html.includes('$0'), 'null/0 agy cost renders as $0');

    // 2. Prototype member row structure assertions
    for (const cls of [
        'team-member-row-main',
        'team-member-portrait',
        'team-avatar-img',
        'team-member-tasks-col',
        'team-tasks-pill',
        'team-member-status',
        'team-control-field'
    ]) {
        assert(html.includes(cls), `member row must include prototype class .${cls}`);
    }
    assert(html.includes('aria-expanded="false"'), 'tasks pill starts with aria-expanded="false"');
    assert(!html.includes('data-member-tasks="anika"'), 'collapsed tasks container is not rendered, matching the approved Storybook');
    assert(html.includes('Agent file &#8599;'), 'member row includes Agent file &#8599; link');
    // Turn is the host's turn spend of the member (the same ledger records turn_budget sums), never the cards' sum.
    assert(html.includes('data-member-cost="priya" data-turn-cost="$0.14"') && html.includes('data-member-cost="anika" data-turn-cost="$0.25" data-month-cost="$9.10"'), 'renders host turn + month cost on member row (one money format)');
}

// 3 & 4. Keyed DOM reconciliation: applyWorkersState(s1), applyWorkersState(s2) and 3 timer ticks
// preserve <img> and <select> node identity (===), update cost in place, and do not overwrite focused <select>.value.
{
    const { api, doc, intervals } = createHarness();
    api.applyWorkersState(sampleState);

    const list = doc.getElementById('workers-list');
    const priyaImg1 = list.querySelector('[data-member-row="priya"] img');
    const anikaImg1 = list.querySelector('[data-member-row="anika"] img');
    const anikaModelSel1 = list.querySelector('[data-member-model="anika"]');
    const anikaThinkSel1 = list.querySelector('[data-member-thinking="anika"]');
    assert(priyaImg1 && anikaImg1 && anikaModelSel1 && anikaThinkSel1, 'initial DOM nodes exist');

    // Simulate user focusing Anika's model select and holding an in-progress selection
    doc.activeElement = anikaModelSel1;
    anikaModelSel1.value = 'github-copilot/claude-opus-4.6';

    const updatedState = JSON.parse(JSON.stringify(sampleState));
    updatedState.generatedAt = now + 5000;
    updatedState.members[0].turnCost = 0.75;
    updatedState.members[1].monthCost = 11.40;
    api.applyWorkersState(updatedState);

    // Run 3 timer ticks (1 s interval)
    assert(intervals.length > 0, '1s interval registered');
    intervals[0].fn();
    intervals[0].fn();
    intervals[0].fn();

    const priyaImg2 = list.querySelector('[data-member-row="priya"] img');
    const anikaImg2 = list.querySelector('[data-member-row="anika"] img');
    const anikaModelSel2 = list.querySelector('[data-member-model="anika"]');
    const anikaThinkSel2 = list.querySelector('[data-member-thinking="anika"]');

    assert.strictEqual(priyaImg1, priyaImg2, 'Priya <img> DOM node reference must be preserved (===)');
    assert.strictEqual(anikaImg1, anikaImg2, 'Anika <img> DOM node reference must be preserved (===)');
    assert.strictEqual(anikaModelSel1, anikaModelSel2, 'Anika model <select> DOM node reference must be preserved (===)');
    assert.strictEqual(anikaThinkSel1, anikaThinkSel2, 'Anika thinking <select> DOM node reference must be preserved (===)');

    const anikaCostEl = list.querySelector('[data-member-cost="anika"]');
    assert(list.querySelector('[data-member-cost="priya"]').textContent.includes('Turn $0.75'), 'updated turn cost in place');
    assert(anikaCostEl.textContent.includes('Month $11.40'), 'updated month cost in place');
    assert.strictEqual(
        anikaModelSel2.value,
        'github-copilot/claude-opus-4.6',
        'focused <select> value must not be overwritten by paintWorkers()'
    );
    doc.activeElement = null;
}

// 5, 6, 7, 8. Interactions: tasks pill toggle + repaint persistence, model change, openAgentFile, focusTeamMember('anika'), and host contract shape
{
    const { api, doc, messages } = createHarness();
    api.applyWorkersState(sampleState);
    const list = doc.getElementById('workers-list');

    // 5. Clicking [data-member-tasks-toggle="anika"]
    const pill = list.querySelector('[data-member-tasks-toggle="anika"]');
    let tasksBox = list.querySelector('[data-member-tasks="anika"]');
    assert.strictEqual(pill.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(tasksBox, null);
    const writesBeforeToggle = doc.htmlWrites();
    const messagesBeforeToggle = messages.length;
    pill.dispatchEvent({ type: 'click', target: pill });
    assert.equal(doc.htmlWrites(), writesBeforeToggle, 'task pill toggles mounted cards without rendering');
    assert.equal(messages.length, messagesBeforeToggle, 'task pill needs no host round-trip');
    tasksBox = list.querySelector('[data-member-tasks="anika"]');
    assert.strictEqual(pill.getAttribute('aria-expanded'), 'true', 'pill aria-expanded becomes true');
    assert.strictEqual(tasksBox.hasAttribute('hidden'), false, 'tasks container hidden attribute removed');
    assert(tasksBox.innerHTML.includes('data-worker-action="trace"'), 'shows worker Trace control');
    assert(tasksBox.innerHTML.includes('data-worker-action="remove"'), 'shows worker Remove control');

    // Repaint preserves aria-expanded="true"
    api.applyWorkersState(sampleState);
    assert.strictEqual(pill.getAttribute('aria-expanded'), 'true', 'pill aria-expanded stays true after repaint');
    assert.strictEqual(tasksBox.hasAttribute('hidden'), false, 'tasks container stays open after repaint');

    // 6. Changing [data-member-model="anika"]
    const modelSel = list.querySelector('[data-member-model="anika"]');
    modelSel.value = 'github-copilot/gpt-5.6-terra';
    modelSel.dispatchEvent({ type: 'change', target: modelSel });
    const setModelMsg = messages.find(m => m.type === 'setMemberModel' && m.memberId === 'anika');
    assert(setModelMsg, 'changing model select posts setMemberModel for anika');
    assert.strictEqual(setModelMsg.model, 'github-copilot/gpt-5.6-terra');

    // 7. Clicking [data-open-agent-file]
    const agentBtn = list.querySelector('[data-member-row="anika"] [data-open-agent-file]');
    agentBtn.dispatchEvent({ type: 'click', target: agentBtn });
    const openFileMsg = messages.find(m => m.type === 'openAgentFile' && m.memberId === 'anika');
    assert(openFileMsg, 'clicking agent file link posts openAgentFile');
    assert.strictEqual(openFileMsg.agentFile, '.opencode/agent/askaway-code.md');
    list.querySelector('[data-edit-member="anika"]').dispatchEvent({ type: 'click' });
    assert(!list.querySelector('[data-member-edit-form="anika"]').hasAttribute('hidden'), 'Edit opens the profile form (R-TEAM-48)');

    // 8. focusTeamMember('anika') switches to 'team' and highlights Anika's row
    api.focusTeamMember('anika');
    assert.strictEqual(api.getCurrentTab(), 'team', 'focusTeamMember switches to team tab');
    const anikaRow = list.querySelector('[data-member-row="anika"]');
    assert.strictEqual(anikaRow.getAttribute('data-highlighted'), 'true', 'focusTeamMember sets data-highlighted="true"');

    // Host TeamMemberState contract (avatarSrc: '' renders initials span, taskIds maps workers)
    const hostContractHtml = api.renderWorkersHtml({
        generatedAt: now,
        server: { state: 'NOT_ATTACHED', endpoint: '' },
        members: [{
            id: 'priya', name: 'Priya', role: 'Validator / Product Owner', profile: 'validator',
            pinned: true, initials: 'PR', avatarSrc: '', creativeStatus: 'Holding the requirement bar',
            agentFile: '.github/agents/validator.agent.md', model: 'github-copilot/claude-sonnet-4.6',
            thinking: 'medium', adapter: 'copilot', taskIds: [], turnCost: 0, monthCost: 0
        }],
        workers: []
    }, '', {}, false, {}, {});
    assert(hostContractHtml.includes('team-portrait-initials'), 'empty avatarSrc renders .team-portrait-initials');
    assert(hostContractHtml.includes('>PR<'), 'empty avatarSrc renders member initials');
}

// EV-TEAM-STABLE: identical refreshes do not even write detached innerHTML.
{
    const { api, doc } = createHarness();
    const state = { ...sampleState, validatorTrace: [{ kind: 'tool', id: 'VAL-T1', name: 'askaway_memory', elapsedMs: 140 }] };
    api.applyWorkersState(state);
    const row = doc.querySelector('[data-member-row="anika"]');
    const main = row.querySelector('.team-member-row-main');
    assert.deepEqual(main.children.filter(c => c.tagName).map(c => c.className), ['team-member-portrait', 'team-member-body', 'team-member-tasks-col'], '751e50d portrait/body/tasks column structure');
    const headline = row.querySelector('.team-member-headline');
    assert(headline.querySelector('.team-member-identity strong.team-member-name'));
    assert(headline.querySelector('.team-member-status'));
    assert(headline.querySelector('.team-member-cost strong.team-cost-month'));
    assert(row.querySelector('.team-member-controls .team-member-profile code'));
    assert(row.querySelector('a.team-agent-file-link[data-agent-file]'));
    assert(row.querySelector('.team-avatar-badge.team-portrait-72 img.team-avatar-img'));
    let priyaTray = doc.querySelector('[data-member-tasks="priya"]');
    assert.equal(priyaTray, null, 'Priya trace starts collapsed without a drawer');
    const pill = doc.querySelector('[data-member-tasks-toggle="priya"]');
    assert(pill.textContent.includes('Trace (1)'));
    pill.dispatchEvent({ type: 'click' });
    priyaTray = doc.querySelector('[data-member-tasks="priya"]');
    assert(!priyaTray.hasAttribute('hidden'), 'Priya trace expands in place');
    assert(priyaTray.querySelector('table.team-validator-trace'));
    api.applyWorkersState(state);
    assert(!priyaTray.hasAttribute('hidden'), 'Priya trace stays expanded on refresh');
}

{
    const { api, doc } = createHarness();
    api.applyWorkersState(sampleState);
    const writes = doc.htmlWrites();
    const image = doc.querySelector('[data-member-row="anika"] img');
    const select = doc.querySelector('[data-member-model="anika"]');
    api.applyWorkersState(sampleState);
    assert.equal(doc.htmlWrites(), writes, 'identical Team state performs zero innerHTML writes');
    assert.equal(doc.querySelector('[data-member-row="anika"] img'), image);
    assert.equal(doc.querySelector('[data-member-model="anika"]'), select);
    const member = api.normalizeTeamMember(sampleState.members[1]);
    assert(api.renderWorkersHtml(sampleState, '', {}, false, {}, {}).includes(api.teamMemberRowHtml(member, [sampleState.workers[1]], sampleState, {}, {}, {})), 'production contains shared row output');
}

// EV-TEAM-RUNTIME-SETTINGS (R-SETTINGS-15): every integration row has the same switch, one Refresh and "checked";
// no instruction text; health messages drive switches and the Team warning.
{
    const { api, doc, root, messages } = createHarness();
    const section = doc.createElement('div');
    section.innerHTML = api.runtimeSettingsHtml();
    root.appendChild(section);
    api.initRuntimeSettings(section);
    api.applyWorkersState(sampleState);
    for (const id of ['opencode', 'agy', 'claude']) {
        assert(doc.querySelector('[data-runtime-toggle="' + id + '"]'), id + ' switch');
        assert(doc.querySelector('[data-refresh-integration="' + id + '"]'), id + ' refresh');
        assert(doc.querySelector('[data-runtime-health="' + id + '"]'), id + ' checked line');
    }
    assert(!section.innerHTML.includes('data-runtime-recheck') && !section.innerHTML.includes('data-restart-opencode'), 'one Refresh per row, no extra buttons');
    const health = { opencode: { enabled: true, ok: true, checkedAt: now }, agy: { enabled: false, ok: false, checkedAt: now }, claude: { enabled: true, ok: false, checkedAt: 0 } };
    api.applyRuntimeHealth(health);
    assert(doc.querySelector('[data-runtime-warning]').textContent.includes('agy off: Anika'));
    assert.match(doc.querySelector('[data-runtime-health="opencode"]').textContent, /^Working · checked /);
    assert.match(doc.querySelector('[data-runtime-health="agy"]').textContent, /^Off · checked /);
    assert.equal(doc.querySelector('[data-runtime-health="claude"]').textContent, 'Not working · checked not yet');
    assert(!/sign in|run agy|login/i.test(section.textContent), 'no instruction text');
    doc.querySelector('[data-runtime-toggle="agy"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(messages.at(-1), { type: 'setRuntimeEnabled', runtime: 'agy', enabled: true });
    doc.querySelector('[data-runtime-toggle="opencode"]').dispatchEvent({ type: 'keydown', key: 'Enter' });
    assert.deepEqual(messages.at(-1), { type: 'setRuntimeEnabled', runtime: 'opencode', enabled: false });
    for (const id of ['opencode', 'agy', 'claude']) {
        doc.querySelector('[data-refresh-integration="' + id + '"]').dispatchEvent({ type: 'click' });
        assert.deepEqual(messages.at(-1), { type: 'refreshIntegration', runtime: id });
    }
    health.agy = { ...health.agy, enabled: true };
    api.applyRuntimeHealth(health);
    assert(doc.querySelector('[data-runtime-warning]').textContent.includes('agy not working: Anika'));
    for (const id of ['opencode', 'agy', 'claude']) health[id].enabled = false;
    api.applyRuntimeHealth(health);
    assert.equal(doc.querySelector('[data-runtime-warning]').textContent, 'Workers unavailable: turn on an integration in Settings');
    health.opencode = { ...health.opencode, enabled: true, ok: false };
    api.applyRuntimeHealth(health);
    assert(doc.querySelector('[data-runtime-warning]').textContent.includes('OpenCode not working: Priya'));
}

// EV-TEAM-EDIT-PROFILE: Edit opens the member's profile form (name, role, status, picture), never the prompt file.
{
    const { api, doc, messages } = createHarness();
    api.applyWorkersState(sampleState);
    const form = doc.querySelector('[data-member-edit-form="anika"]');
    assert(form && form.hasAttribute('hidden'), 'form starts closed');
    doc.querySelector('[data-edit-member="anika"]').dispatchEvent({ type: 'click' });
    assert(!doc.querySelector('[data-member-edit-form="anika"]').hasAttribute('hidden'), 'Edit opens the form');
    assert(!messages.some(m => m.type === 'openAgentFile' || m.type === 'editTeamMember'), 'Edit never opens a file');
    doc.querySelector('[data-member-pick-picture="anika"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(messages.at(-1), { type: 'pickMemberPicture', memberId: 'anika' });
    api.applyWorkersState(sampleState);
    assert(!doc.querySelector('[data-member-edit-form="anika"]').hasAttribute('hidden'), 'an open form survives a repaint');
    doc.querySelector('[data-member-edit-form="anika"] [data-member-edit-field="name"]').value = 'Ana';
    doc.querySelector('[data-member-edit-save="anika"]').dispatchEvent({ type: 'click' });
    const saved = messages.filter(m => m.type === 'saveMemberProfile').at(-1);
    assert.equal(saved.memberId, 'anika');
    assert.equal(saved.name, 'Ana');
    assert('role' in saved && 'status' in saved, 'role and status are sent');
    assert(doc.querySelector('[data-member-edit-form="anika"]').hasAttribute('hidden'), 'Save closes the form');
    doc.querySelector('[data-member-row="anika"] [data-open-agent-file]').dispatchEvent({ type: 'click' });
    assert.equal(messages.at(-1).type, 'openAgentFile', 'Agent file still opens the prompt');
}

// EV-TEAM-WHOLE-LIST: inserts, reorders and auxiliary sections reconcile together.
{
    const { api, doc } = createHarness();
    api.applyWorkersState(sampleState);
    const image = doc.querySelector('[data-member-row="anika"] img');
    const added = { ...sampleState.members[1], id: 'new-po', name: 'New PO', pinned: true, workerIds: [] };
    const state = { ...sampleState, members: [added, ...sampleState.members], scoreboard: [{ mode: 'build', model: 'Sol', runs: 1, passed: 1, avgCost: 0.01, avgMs: 10 }] };
    api.applyWorkersState(state);
    assert.deepEqual(doc.querySelectorAll('[data-member-row]').map(row => row.getAttribute('data-member-row')), ['new-po', 'priya', 'anika']);
    assert.equal(doc.querySelector('[data-member-row="anika"] img'), image, 'insertion preserves existing portrait');
    assert(doc.querySelector('.workers-scoreboard').textContent.includes('1/1'));
    api.applyWorkersState({ ...state, scoreboard: [{ ...state.scoreboard[0], runs: 2, passed: 1 }] });
    assert(doc.querySelector('.workers-scoreboard').textContent.includes('1/2'), 'scoreboard refreshes');
    api.applyWorkersState({ ...sampleState, scoreboard: [] });
    assert.equal(doc.querySelector('.workers-scoreboard'), null, 'removed scoreboard disappears');
}

// EV-TEAM-EFFECTIVE-MODEL: actual dispatch and explicit selections outrank profile defaults.
{
    const { api, doc } = createHarness();
    const health = { opencode: { enabled: true, ok: true }, agy: { enabled: false, ok: false } };
    const state = JSON.parse(JSON.stringify(sampleState));
    state.runtimeHealth = health;
    state.workers[1].model = 'github-copilot/gpt-6.1-sol';
    state.workers[1].adapter = 'opencode';
    state.workers[1].knowledge = 'worker remains worker; workers own this text';
    api.applyWorkersState(state);
    assert.equal(doc.querySelector('[data-member-model="anika"]').value, 'github-copilot/gpt-6.1-sol');
    assert.equal(doc.querySelector('[data-runtime-warning]').textContent, '');
    doc.querySelector('[data-member-tasks-toggle="anika"]').dispatchEvent({ type: 'click' });
    assert.equal(doc.querySelector('.worker-knowledge').textContent, state.workers[1].knowledge, 'task labels never rewrite authored text');
    state.memberSettings = { anika: { model: 'agy/gemini-4-argon-high' } };
    api.applyWorkersState(state);
    assert.equal(doc.querySelector('[data-member-model="anika"]').value, 'agy/gemini-4-argon-high');
    assert(doc.querySelector('[data-runtime-warning]').textContent.includes('agy off: Anika'));
    const idle = { ...state, workers: [], memberSettings: {} };
    const fresh = createHarness();
    fresh.api.applyWorkersState(idle);
    assert.equal(fresh.doc.querySelector('[data-member-model="anika"]').value, 'github-copilot/gpt-6.1-sol', 'an idle member stays visible (R-TEAM-45) with the omitted-model default');
    assert.equal(fresh.doc.querySelector('[data-member-model="priya"]').value, 'github-copilot/gpt-6.1-sol', 'omitted model uses Sol, not agy profile');
    assert.equal(fresh.doc.querySelector('[data-runtime-warning]').textContent, '');
}

{
    const { api, doc, root, messages } = createHarness();
    api.applyWorkersState({ ...sampleState, turnWorkerIds: ['worker-build-1'], members: [...sampleState.members, { id: 'idle', name: 'Idle', role: 'Developer', taskIds: [] }] });
    assert(doc.querySelector('[data-member-row="idle"]'), 'an idle member row is visible (R-TEAM-45)');
    const select = doc.querySelector('[data-member-model="anika"]');
    assert(select.textContent.includes('Claude Opus 5.5') && select.textContent.includes('Sol 6.1'));
    assert(!select.textContent.includes('github-copilot/'));
    assert(doc.querySelector('[data-edit-member="anika"]').classList.contains('form-btn'));
    assert(doc.querySelector('.team-member-profile code').classList.contains('worker-state'));
    assert(!doc.getElementById('workers-list').innerHTML.includes('Shared OpenCode server'));
    const css = fs.readFileSync(path.join(__dirname, 'media/team/team.css'), 'utf8');
    assert(/min-width:\s*220px/.test(css));
    assert(!/11\.5px|10\.5px|\.widget-tab\.tab-btn/.test(css));
    const story = fs.readFileSync(path.join(__dirname, 'storybook/prototypes/team.js'), 'utf8');
    assert(story.includes('getWorkersKit().wireTeamEvents(host'));
    assert(story.includes('getWorkersKit().patchTeamHtml(contentEl'));
    assert(story.includes('TEAM_WIDGET_WIDTH_PX = SIDEBAR_WIDTH'));
}
console.log('test-team-production-render: passed (EV-TEAM-STABLE, EV-TEAM-RUNTIME-SETTINGS, EV-TEAM-CONSISTENCY)');
