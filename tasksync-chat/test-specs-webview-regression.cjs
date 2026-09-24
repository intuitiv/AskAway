const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const webview = fs.readFileSync(path.join(root, 'media/webview.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'media/main.css'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'src/webview/webviewProvider.ts'), 'utf8');

function between(start, end) {
    const from = webview.indexOf(start);
    const to = webview.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Expected executable webview block ${start}`);
    return webview.slice(from, to);
}

function element() {
    return { innerHTML: '', textContent: '', className: '', title: '', classList: { toggle() {} } };
}

const elements = {
    'common-turn-summary': element(),
    'common-cache-age': element(),
    'cost-attribution-toggle': element()
};
const bannerContext = {
    document: { getElementById: id => elements[id] || null },
    observabilityMetrics: {
        lastRequest: {
            requestCount: 3,
            nanoAiu: 250_000_000_000,
            inputTokens: 22_500,
            outputTokens: 2_750,
            cachedTokens: 18_000
        },
        turnRequests: [
            { inputTokens: 18_500, outputTokens: 2_000, cachedTokens: 14_400 },
            { inputTokens: 4_000, outputTokens: 750, cachedTokens: 3_600 }
        ],
        lastRequestTs: Date.now() - 30_000
    },
    specsState: { specs: [{ active: true, id: '001', slug: '001-example' }] },
    soundEnabled: false,
    window: {},
    formatObservabilityCompact(value) {
        return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}K` : String(value);
    }
};
vm.createContext(bannerContext);
vm.runInContext(
    between('// ── Usage banner', 'function updateObservabilityUI()') +
    '\nrenderConversationHealth(); renderCacheAge();',
    bannerContext
);
assert.match(elements['common-turn-summary'].innerHTML, /3 req/);
assert.match(elements['common-turn-summary'].innerHTML, /\$2\.50/);
assert.match(elements['common-turn-summary'].innerHTML, /4K last in \/ 2\.75K turn out/, 'the real shared formatter, not a test double');
assert.match(elements['common-turn-summary'].innerHTML, /90% cache/);
assert.match(elements['common-cache-age'].textContent, /^Age: 0:3\d warm$/);
assert.equal(elements['cost-attribution-toggle'].textContent, 'Cost to: Spec 001');

const hierarchyContext = {
    specsShowDone: false,
    specsWorkExpanded: {},
    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }
};
vm.createContext(hierarchyContext);
vm.runInContext(between('function formatSpecInline(text)', 'function renderSpecs()'), hierarchyContext);
const spec = {
    id: '001',
    slug: '001-example',
    nextTaskId: 'T001',
    tasks: [],
    cycles: [{
        id: 'CY-001',
        phase: 'P0 Contract and Test Seam',
        title: 'Contract baseline',
        description: 'Create the portable worker contract.',
        total: 2,
        done: 0,
        state: 'ready',
        nextTaskId: 'T001',
        specCount: 1,
        tasks: [
            { id: 'T001', text: 'Define the worker contract', done: false, specId: '001', specSlug: '001-example' },
            { id: 'T002', text: 'Completed setup', done: true, specId: '001', specSlug: '001-example' }
        ]
    }]
};
const hierarchy = hierarchyContext.renderSpecWork(spec);
assert.match(hierarchy, /<details class="spec-work-phase"[^>]* open/);
assert.match(hierarchy, /<details class="spec-cycle"[^>]* open/);
assert.match(hierarchy, /data-ref="CY-001"/);
assert.match(hierarchy, /data-ref="T001"/);
assert.doesNotMatch(hierarchy, /T002/);

let prefilled = '';
const clickContext = {
    specsExpanded: {},
    renderSpecs() {},
    prefillChat(value) { prefilled = value; }
};
vm.createContext(clickContext);
vm.runInContext(between('function onSpecsListClick(e)', 'function prefillChat(text)'), clickContext);
const button = { getAttribute: name => ({ 'data-act': 'implement-ref', 'data-ref': 'T001' })[name] || null };
const card = { getAttribute: () => '' };
clickContext.onSpecsListClick({
    target: { closest: selector => selector === '[data-act]' ? button : card },
    preventDefault() {},
    stopPropagation() {}
});
assert.equal(prefilled, '/implement T001');

assert.match(provider, /class="conversation-health"/);
assert.match(provider, /id="common-turn-summary"/);
assert.match(provider, /0 last in \/ 0 turn out/);
assert.match(provider, /id="common-cache-age"/);
assert.match(provider, /id="cost-attribution-toggle"/);
assert.match(provider, /id="specs-workspace-velocity"/);
assert.match(provider, /id="specs-show-done"/);
assert.match(provider, />Show completed</);
assert.match(provider, /role="switch"/);
assert.match(webview, /Agent throughput/);
assert.match(webview, /completedWorkCount === 0/);
assert.match(provider, /specs-health-telegram-v9/);
assert.match(webview, /specs-health-telegram-v9/);
for (const selector of ['.conversation-health', '.spec-work-phase', '.spec-cycle-main', '.spec-task-run', '.spec-cycle-run']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')), `Missing UI contract selector ${selector}`);
}

console.log('EV-SPECS-WEBVIEW-REGRESSION: PASS banner=last-input+turn-output hierarchy=phase>cycle>task actions=cycle+task');