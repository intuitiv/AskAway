// 005 Foundational: every spec reports its Spec Kit stage, next step and stage button; a stored stage that
// contradicts the artifacts is flagged; task tags ([P] [US1] [cloud] [local: …]) reach the caller.
// Run: node test-spec-stages.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spec-stages-'));
for (const name of ['stages', 'runRecords', 'specKitScanner']) {
    const source = fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8');
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(source,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { scanSpecs } = require(path.join(buildDir, 'specKitScanner.js'));
const { appendRunRecord } = require(path.join(buildDir, 'runRecords.js'));

const repo = makeSampleRepo();
const bySlug = () => Object.fromEntries(scanSpecs(repo.root).specs.map(spec => [spec.slug, spec]));

let specs = bySlug();
const expected = {
    '001-specified': ['specify', '/sk.check (clarify)', 'Plan'],
    '002-clarified': ['clarify', '/sk.plan', 'Plan'],
    '003-planned': ['plan', '/sk.check (checklist)', 'Tasks'],
    '004-checklisted': ['checklist', '/sk.tasks', 'Tasks'],
    '005-tasked': ['tasks', '/sk.check (analyze)', 'Implement'],
    '006-implementing': ['implement', '/sk.implement', 'Implement'],
    '007-legacy-cycles': ['implement', '/sk.implement', 'Implement']
};
for (const [slug, [stage, next, button]] of Object.entries(expected)) {
    const spec = specs[slug];
    assert.equal(spec.specKitStage, stage, `${slug} stage`);
    assert.equal(spec.stageSource, 'artifacts', `${slug} source`);
    assert.equal(spec.nextStep, next, `${slug} next step`);
    assert.equal(spec.stageButton, button, `${slug} button`);
    assert.equal(spec.mismatch, null, `${slug} mismatch`);
}
assert.equal(specs['007-legacy-cycles'].cycles.length, 1, 'legacy cycle spec still groups its cycle');

const tasks = Object.fromEntries(specs['005-tasked'].tasks.map(task => [task.id, task]));
assert.deepEqual(tasks.T003.tags, ['P', 'US1']);
assert.equal(tasks.T003.story, 'US1');
assert.deepEqual(tasks.T004.tags, ['US1', 'cloud']);
assert.deepEqual(tasks.T005.tags, ['local: needs mesh']);
assert.equal(tasks.T005.text, 'Docs');
assert.equal(tasks.T004.text, 'Test first');

// US1 scenario 2: stored "tasks" but no tasks.md → mismatch naming both stages.
appendRunRecord(repo.root, '003-planned', { command: '/sk.tasks', stageBefore: 'checklist', stageAfter: 'tasks', endedAt: '2026-09-30T10:00:00.000Z' });
// A stored stage consistent with the artifacts is not a mismatch.
appendRunRecord(repo.root, '005-tasked', { command: '/sk.check', stageBefore: 'tasks', stageAfter: 'analyze', endedAt: '2026-09-30T10:00:00.000Z' });
specs = bySlug();
const planned = specs['003-planned'];
assert.equal(planned.specKitStage, 'tasks');
assert.equal(planned.stageSource, 'records');
assert.equal(planned.impliedStage, 'plan');
assert.deepEqual([planned.mismatch.stored, planned.mismatch.implied], ['tasks', 'plan']);
assert.match(planned.mismatch.reason, /tasks\.md/);
assert.equal(specs['005-tasked'].specKitStage, 'analyze');
assert.equal(specs['005-tasked'].nextStep, '/sk.implement');
assert.equal(specs['005-tasked'].mismatch, null);

repo.cleanup();
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('PASS test-spec-stages: 7 fixture stages, tags, stored-stage mismatch');
