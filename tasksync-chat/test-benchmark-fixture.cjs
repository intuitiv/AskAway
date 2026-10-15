// EV-BENCHMARK-FIXTURE: spec 008 T002-T004. The benchmark workspace has seeded failures, hidden checks accept the
// reference solutions and reject a visible-tests-only hack, and prompts only name visible fixture paths.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { gradeBenchmark } = require('./evals/graders.cjs');

const BENCH = path.join(__dirname, 'evals', 'benchmark');
const WORK = path.join(__dirname, 'build', 'benchmark-fixture-test');
const { tasks } = JSON.parse(fs.readFileSync(path.join(BENCH, 'tasks.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'benchmark.json'), 'utf8'));

fs.rmSync(WORK, { recursive: true, force: true });
function copy(name, overlay) {
    const dir = path.join(WORK, name);
    fs.cpSync(path.join(BENCH, 'fixture'), dir, { recursive: true });
    if (overlay) { fs.cpSync(overlay, dir, { recursive: true }); }
    return dir;
}
function visible(dir) {
    const r = childProcess.spawnSync(process.execPath, ['test/visible.cjs'], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, failed: (r.stdout.match(/^FAIL [\w-]+/gm) || []).map((l) => l.slice(5)) };
}

// T002: fresh copy runs its visible tests; every seeded failure is present.
const seeded = visible(copy('seeded'));
assert.strictEqual(seeded.status, 1, 'visible tests must fail on the seeded fixture');
assert.deepStrictEqual(seeded.failed, tasks.map((t) => t.id), 'one seeded failure per task');
assert.ok(fs.existsSync(path.join(BENCH, 'fixture', 'specs', '001-discount-codes', 'spec.md')) && fs.existsSync(path.join(BENCH, 'fixture', 'specs', '001-discount-codes', 'tasks.md')), 'fixture is spec-bearing');

// T003: reference solutions pass visible tests and are accepted by hidden checks.
const solved = copy('solved', path.join(BENCH, 'hidden', 'solutions'));
assert.deepStrictEqual(visible(solved).failed, [], 'reference solutions pass visible tests');
const accepted = gradeBenchmark(tasks, solved, path.join(BENCH, 'hidden'));
assert.deepStrictEqual(accepted.filter((t) => t.outcome !== 'accepted'), [], 'reference solutions are accepted');

// T003: a hack that only satisfies the visible input passes visible tests but is not accepted.
const hacked = copy('hacked');
fs.writeFileSync(path.join(hacked, 'src', 'math.js'), 'module.exports = { percent: (part, total) => (part === 1 && total === 4 ? 25 : part / total) };\n');
assert.ok(!visible(hacked).failed.includes('simple-1'), 'hack passes the visible simple test');
const hackGrade = gradeBenchmark(tasks.filter((t) => t.id === 'simple-1'), hacked, path.join(BENCH, 'hidden'))[0];
assert.strictEqual(hackGrade.outcome, 'failed');
assert.ok(hackGrade.failedChecks.includes('percent(1,3) is 33'), `hidden check named: ${hackGrade.failedChecks}`);

// T004: four levels, 23 tasks; prompts name only visible fixture paths, never hidden paths or hidden expectations.
const count = (level) => tasks.filter((t) => t.level === level).length;
assert.deepStrictEqual([count('simple'), count('medium'), count('complex'), count('batch')], [1, 1, 1, 20]);
for (const [level, ids] of Object.entries(manifest.levels)) { assert.deepStrictEqual(ids, tasks.filter((t) => t.level === level).map((t) => t.id), `benchmark.json level ${level}`); }
const hiddenText = fs.readdirSync(path.join(BENCH, 'hidden')).filter((f) => f.endsWith('.cjs')).map((f) => fs.readFileSync(path.join(BENCH, 'hidden', f), 'utf8')).join('\n');
const hiddenNames = [...hiddenText.matchAll(/\['([^']+)', \(\) =>/g)].map((m) => m[1]);
assert.ok(hiddenNames.length > 10, 'hidden check names collected');
for (const task of tasks) {
    assert.ok(fs.existsSync(path.join(BENCH, 'hidden', task.hiddenCheck)), `${task.id} hidden check exists`);
    assert.ok(!/hidden|solution/i.test(task.prompt), `${task.id} prompt names no hidden path`);
    for (const name of hiddenNames) { assert.ok(!task.prompt.includes(name), `${task.id} prompt leaks hidden check ${name}`); }
    for (const ref of task.prompt.match(/\b(?:src|test|specs)\/[\w./-]*\w/g) || []) {
        assert.ok(fs.existsSync(path.join(BENCH, 'fixture', ref)), `${task.id} names visible path ${ref}`);
    }
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`EV-BENCHMARK-FIXTURE: PASS seeded=${seeded.failed.length} accepted=${accepted.length} hack=rejected`);
