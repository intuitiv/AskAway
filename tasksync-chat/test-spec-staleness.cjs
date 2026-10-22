// 005 US1: an artifact is stale when an artifact it is generated from changed later by git commit order;
// uncommitted or untracked edits count as newest. Run: node test-spec-staleness.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-staleness-'));
for (const name of ['stages', 'runRecords', 'staleness', 'readiness', 'specKitScanner']) {
    const source = fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8');
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(source,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { scanSpecs } = require(path.join(buildDir, 'specKitScanner.js'));

const staleOf = (root) => {
    const result = scanSpecs(root);
    return { available: result.stalenessAvailable, bySlug: Object.fromEntries(result.specs.map(s => [s.slug, s.stale.map(e => `${e.artifact}<${e.upstream}:${e.reason}`)])) };
};

const repo = makeSampleRepo({ git: true });
let seen = staleOf(repo.root);
assert.equal(seen.available, true);
assert.ok(Object.values(seen.bySlug).every(list => list.length === 0), 'one commit for everything → nothing stale');

// Scenario 3: plan.md committed after tasks.md → tasks.md stale.
repo.write('specs/005-tasked/plan.md', '# Plan\n\nchanged\n');
repo.commit('plan changed');
seen = staleOf(repo.root);
assert.deepEqual(seen.bySlug['005-tasked'], ['tasks.md<plan.md:upstream-newer']);

// Committing tasks.md afterwards makes it fresh again.
repo.write('specs/005-tasked/tasks.md', fs.readFileSync(path.join(repo.spec('005-tasked'), 'tasks.md'), 'utf8') + '\n');
repo.commit('tasks refreshed');
assert.deepEqual(staleOf(repo.root).bySlug['005-tasked'], []);

// Scenario 4: uncommitted spec.md edit with committed plan.md → plan.md stale.
repo.write('specs/003-planned/spec.md', '# Feature Specification: Planned\n\nedited\n');
seen = staleOf(repo.root);
assert.deepEqual(seen.bySlug['003-planned'], ['plan.md<spec.md:upstream-dirty']);

// Both dirty → equal rank, not stale.
repo.write('specs/003-planned/plan.md', '# Plan\n\nedited too\n');
assert.deepEqual(staleOf(repo.root).bySlug['003-planned'], []);

// A never-committed artifact counts as newest, so its committed upstream does not make it stale.
repo.write('specs/001-specified/plan.md', '# Plan\n');
assert.deepEqual(staleOf(repo.root).bySlug['001-specified'], []);

// Checklists and contracts follow spec.md / plan.md.
repo.commit('all committed');
repo.write('specs/004-checklisted/spec.md', '# Feature Specification: Checklisted\n\nedited\n');
assert.deepEqual(staleOf(repo.root).bySlug['004-checklisted'].sort(), ['checklists/requirements.md<spec.md:upstream-dirty', 'plan.md<spec.md:upstream-dirty']);

// Outside git: staleness is unavailable, never reported as fresh.
const plain = makeSampleRepo();
assert.equal(staleOf(plain.root).available, false);

plain.cleanup();
repo.cleanup();
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('PASS test-spec-staleness: commit order, dirty upstream, equal ranks, untracked newest, checklists, no-git unavailable');
