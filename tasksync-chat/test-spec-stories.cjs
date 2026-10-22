// 005 US2: stories are the phases — the Specs tab groups tasks by story with progress, Independent Test and the
// success criteria each story verifies; cycle-based specs still render. Run: node test-spec-stories.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-stories-'));
for (const name of ['stages', 'runRecords', 'staleness', 'readiness', 'specKitScanner']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { scanSpecs } = require(path.join(buildDir, 'specKitScanner.js'));

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const from = webview.indexOf('function formatSpecInline(text)');
const to = webview.indexOf('function renderSpecs()');
const ui = {
    specsShowDone: true,
    specsWorkExpanded: {},
    escapeHtml: (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
};
vm.createContext(ui);
vm.runInContext(webview.slice(from, to), ui);

const spec = [
    '# Feature Specification: Three stories',
    '## User Scenarios & Testing *(mandatory)*',
    '### User Story 1 - Alpha (Priority: P1)',
    'text',
    '**Independent Test**: Run alpha and see A.',
    '### User Story 2 - Beta (Priority: P2)',
    '**Independent Test**: Run beta and see B.',
    '### User Story 3 - Gamma (Priority: P3)',
    '**Independent Test**: Run gamma and see C.',
    '## Success Criteria *(mandatory)*',
    '- **SC-001**: A works. Verified by: US1.',
    '- **SC-002**: A and C agree. Verified by: US1, US3.'
].join('\n');
const tasks = [
    '# Tasks',
    '## Phase 1: Setup',
    '- [x] T001 Setup',
    '## Phase 2: Foundational',
    '- [x] T002 Base',
    '## Phase 3: User Story 1 - Alpha (Priority: P1) 🎯 MVP',
    ...['T003', 'T004', 'T005', 'T006'].map((id) => `- [x] ${id} [US1] done ${id}`),
    '- [ ] T007 [US1] open one',
    '- [ ] T008 open two',
    '## Phase 4: User Story 2 - Beta (Priority: P2)',
    '- [ ] T009 [P] [US2] beta',
    '## Phase 5: User Story 3 - Gamma (Priority: P3)',
    '- [ ] T010 [US3] gamma',
    '## Phase 6: Polish',
    '- [ ] T011 docs'
].join('\n');
const repo = makeSampleRepo({ specs: { '001-three': { 'spec.md': spec, 'tasks.md': tasks }, '002-legacy': { 'spec.md': '# Legacy\n', 'tasks.md': '# Tasks\n## Phase 1 — Foundation\n- [ ] T001 [CY-001] Build\n' } } });
const scanned = Object.fromEntries(scanSpecs(repo.root).specs.map((s) => [s.slug, s]));
const three = scanned['001-three'];

// Scenario 1: phases in order; each story carries its Independent Test.
assert.deepEqual(three.stories.map(story => story.title), ['Alpha', 'Beta', 'Gamma']);
assert.deepEqual(three.stories.map((s) => [s.id, s.priority, s.independentTest]), [
    ['US1', 'P1', 'Run alpha and see A.'], ['US2', 'P2', 'Run beta and see B.'], ['US3', 'P3', 'Run gamma and see C.']]);
// Scenario 2: US1 shows 4/6 (untagged T008 counts by its story phase) and its Independent Test.
assert.deepEqual([three.stories[0].done, three.stories[0].total], [4, 5]);
assert.deepEqual(three.stories[0].successCriteria, ['SC-001', 'SC-002']);
assert.deepEqual(three.stories[2].successCriteria, ['SC-002']);
const html = ui.renderSpecWork(three);
assert.match(html, /User Story 1 - Alpha[\s\S]*?4\/5 tasks<\/span><\/summary><div class="spec-story-test"><strong>Independent Test<\/strong> Run alpha and see A\.[\s\S]*?verifies SC-001, SC-002/);
assert.match(html, /User Story 3 - Gamma[\s\S]*?Run gamma and see C\./);
// Scenario 4: a cycle-based spec still renders.
assert.match(html, /Not linked to a story[\s\S]*?T008/);
const legacy = ui.renderSpecWork(scanned['002-legacy']);
assert.match(legacy, /Not linked to a story[\s\S]*?T001/);
assert.doesNotMatch(legacy, /CY-001|Phase 1/);
assert.match(ui.renderSpecWork({ slug: 'empty', tasks: [], stories: [{ id: 'US4', title: 'Empty', independentTest: 'Still show this.' }] }), /User Story 4 - Empty[\s\S]*?0\/0 tasks[\s\S]*?Still show this/);

repo.cleanup();
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('PASS test-spec-stories: stories in order, US1 4/5 + Independent Test + SCs, unlinked legacy tasks, empty story');
