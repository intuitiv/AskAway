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
assert.match(provider, />Completed</);
assert.match(provider, /id="specs-show-all"/);
assert.match(provider, />All</);
assert.match(provider, /role="switch"/);
assert.match(webview, /Agent throughput/);
assert.match(webview, /completedWorkCount === 0/);
assert.match(provider, /specs-health-telegram-v9/);
assert.match(webview, /specs-health-telegram-v9/);
for (const selector of ['.conversation-health', '.spec-work-phase', '.spec-cycle-main', '.spec-task-run', '.spec-cycle-run']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.')), `Missing UI contract selector ${selector}`);
}

console.log('EV-SPECS-WEBVIEW-REGRESSION: PASS banner=last-input+turn-output hierarchy=phase>cycle>task actions=cycle+task');

// Regression (reviewer 2026-09-28, first fixed 2026-08-19): the active spec is never hidden by the Completed filter.
const specs = [
    { slug: '001-active', stage: 'done', active: true },
    { slug: '002-finished', stage: 'done', active: false },
    { slug: '003-open', stage: 'in-progress', active: false },
];
const slugs = (done, all) => hierarchyContext.visibleSpecs(specs, done, all).map((s) => s.slug);
assert.deepEqual(slugs(false, false), ['001-active'], 'default: only the active spec, even when it is done');
assert.deepEqual(slugs(false, true), ['001-active', '003-open'], 'All: other open specs; done ones still need Completed');
assert.deepEqual(slugs(true, true), ['001-active', '002-finished', '003-open'], 'All + Completed shows everything');
assert.deepEqual(slugs(true, false), ['001-active'], 'Completed alone does not reveal other specs');
assert.deepEqual(hierarchyContext.visibleSpecs([{ slug: 'x', stage: 'done' }, { slug: 'y', stage: 'planned' }], false, false).map((s) => s.slug), ['y'],
    'with no active spec, open specs show so the tab is never empty by accident');
assert.match(webview, /var specs = visibleSpecs\(all, specsShowDone, specsShowAll\);/, 'renderSpecs uses the rule');
console.log('EV-SPECS-ACTIVE-VISIBLE: PASS activeDoneShown=true othersNeedAll=true doneNeedsCompleted=true noActiveShowsOpen=true');
// 005 US1: every spec card shows its Spec Kit stage, next step, the stage's action and /sk.check, plus mismatch and
// staleness — fed by the real scanner on a sample repo (SC-001, SC-002).
{
    const os = require('node:os');
    const ts = require(path.join(root, 'node_modules', 'typescript'));
    const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-stage-bar-'));
    for (const name of ['stages', 'runRecords', 'staleness', 'specKitScanner']) {
        fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'specs', `${name}.ts`), 'utf8'),
            { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    }
    const { scanSpecs } = require(path.join(buildDir, 'specKitScanner.js'));
    const { appendRunRecord } = require(path.join(buildDir, 'runRecords.js'));
    const repo = makeSampleRepo({ git: true });
    appendRunRecord(repo.root, '003-planned', { command: '/sk.tasks', stageAfter: 'tasks' });
    repo.write('specs/005-tasked/spec.md', '# Feature Specification: Tasked\n\nedited\n');
    const scan = scanSpecs(repo.root);
    const bars = Object.fromEntries(scan.specs.map((s) => [s.slug, hierarchyContext.renderStageBar(s, scan.stalenessAvailable)]));
    for (const [slug, bar] of Object.entries(bars)) {
        assert.match(bar, /Stage <strong>[a-z]+<\/strong>/, `${slug} shows a stage`);
        assert.match(bar, /data-cmd="\/sk\.check"/, `${slug} always offers /sk.check`);
        assert.match(bar, /Next <code/, `${slug} suggests a next step`);
    }
    assert.match(bars['001-specified'], /Stage <strong>specify<\/strong>.*\/sk\.check \(clarify\).*data-cmd="\/sk\.plan"/s, 'scenario 1');
    assert.match(bars['003-planned'], /Stage mismatch: stored stage tasks needs tasks\.md/, 'scenario 2');
    assert.match(bars['005-tasked'], /plan\.md is stale: spec\.md has uncommitted edits/, 'dirty upstream shown');
    assert.match(bars['005-tasked'], /tasks\.md is stale: spec\.md has uncommitted edits/);
    assert.doesNotMatch(bars['001-specified'], /stale/);
    const plain = makeSampleRepo();
    const plainScan = scanSpecs(plain.root);
    assert.match(hierarchyContext.renderStageBar(plainScan.specs[0], plainScan.stalenessAvailable), /not a git repository/);
    assert.match(webview, /renderStageBar\(spec, specsState\.stalenessAvailable\)/, 'renderSpecs puts the stage bar on every card');
    assert.match(webview, /act === 'sk'/, 'stage buttons prefill their /sk.* command');
    assert.match(css, /\.spec-stage-bar/);

    // Scenario 5: ten specs, three completed → only the active one with both switches off.
    const ten = Array.from({ length: 10 }, (_, i) => ({ slug: `0${i}`, stage: i < 3 ? 'done' : 'implement', active: i === 5 }));
    assert.deepEqual(hierarchyContext.visibleSpecs(ten, false, false).map((s) => s.slug), ['05']);
    assert.equal(hierarchyContext.visibleSpecs(ten, false, true).length, 7);
    assert.equal(hierarchyContext.visibleSpecs(ten, true, true).length, 10);
    plain.cleanup();
    repo.cleanup();
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log('EV-SPECS-STAGE-BAR: PASS allCardsStage+next+check=true mismatch=true staleDirty=true noGit=unknown switches=1/7/10');
}
