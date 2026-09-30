// 005 Foundational: per-spec run records are one file per run, never overwritten, summed on the card,
// and tolerant of malformed files. Run: node test-spec-run-records.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-run-records-'));
for (const name of ['stages', 'runRecords', 'staleness', 'specKitScanner']) {
    const source = fs.readFileSync(path.join(__dirname, 'src', 'specs', `${name}.ts`), 'utf8');
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(source,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const { appendRunRecord, readRunRecords, runRecordsDir } = require(path.join(buildDir, 'runRecords.js'));
const { scanSpecs } = require(path.join(buildDir, 'specKitScanner.js'));

const repo = makeSampleRepo();
const slug = '005-tasked';
const endedAt = '2026-09-30T22:00:00.000Z';

// Two runs finishing in the same millisecond → two files, neither lost.
const a = appendRunRecord(repo.root, slug, { kind: 'chat', command: '/sk.plan', endedAt, agentMs: 60000, cost: { nanoAiu: 2e9, requests: 3 }, branch: 'b1', pr: 'https://github.com/o/r/pull/1', stageAfter: 'plan' });
const b = appendRunRecord(repo.root, slug, { kind: 'worker', command: 'worker:build', endedAt, agentMs: 30000, cost: { nanoAiu: 5e8, requests: 1 }, prompt: 'SECRET PROMPT TEXT', token: 'ghp_x' });
assert.notEqual(a, b);
assert.equal(fs.readdirSync(runRecordsDir(repo.root, slug)).length, 2);
assert.ok(!fs.readFileSync(b, 'utf8').includes('SECRET'), 'fields outside the allow-list are not persisted');
assert.ok(!fs.readFileSync(b, 'utf8').includes('ghp_'), 'unknown fields are not persisted');

// Malformed file is skipped and counted.
fs.writeFileSync(path.join(runRecordsDir(repo.root, slug), 'broken.json'), '{ not json');
const { records, skipped } = readRunRecords(repo.root, slug);
assert.equal(records.length, 2);
assert.equal(skipped, 1);

// Card facts = sums over records; newest stage/branch/PR win.
const spec = scanSpecs(repo.root).specs.find(s => s.slug === slug);
assert.equal(spec.facts.runs, 2);
assert.equal(spec.facts.skippedRecords, 1);
assert.equal(spec.facts.costNanoAiu, 2.5e9);
assert.equal(spec.facts.requests, 4);
assert.equal(spec.facts.agentMs, 90000);
assert.equal(spec.facts.branch, 'b1');
assert.equal(spec.facts.pr, 'https://github.com/o/r/pull/1');
assert.equal(spec.facts.storedStage, 'plan');

// A slug that could escape the specs folder is refused.
assert.throws(() => appendRunRecord(repo.root, '../escape', { command: 'x' }), /invalid spec slug/);
assert.deepEqual(readRunRecords(repo.root, '../escape'), { records: [], skipped: 0 });

repo.cleanup();
fs.rmSync(buildDir, { recursive: true, force: true });
console.log('PASS test-spec-run-records: concurrent files, allow-list, skipped count, sums, slug guard');
