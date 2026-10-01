// 005 US3 (EV-SPEC-FACTS-CLI): tools/spec-facts.cjs prints the same facts the Specs tab shows, from the same scanner.
// Spawns the CLI against the sample repo (test-fixtures/specs-sample.cjs). Run: node test-spec-facts-cli.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeSampleRepo } = require('./test-fixtures/specs-sample.cjs');

const cli = path.join(__dirname, 'tools', 'spec-facts.cjs');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const record = (repo, slug, name, rec) => repo.write(`.askaway/specs/${slug}/runs/${name}.json`, JSON.stringify({ v: 1, kind: 'chat', ...rec }));

const repo = makeSampleRepo({ git: true });
repo.write('specs/005-tasked/spec.md', [
    '# Feature Specification: Tasked', '', '## User Scenarios', '',
    '### User Story 1 - First (Priority: P1)', '', '**Independent Test**: run the first thing', ''
].join('\n'));
repo.write('specs/005-tasked/plan.md', '# Plan\n\nrefreshed\n');
repo.write('specs/005-tasked/tasks.md', fs.readFileSync(path.join(repo.spec('005-tasked'), 'tasks.md'), 'utf8') + '\n');
repo.commit('story added');
// plan.md committed after tasks.md → tasks.md is stale.
repo.write('specs/005-tasked/plan.md', '# Plan\n\nchanged\n');
repo.commit('plan changed');

record(repo, '005-tasked', '2026-09-30T10-00-00-000Z-aaaaaa', {
    slug: '005-tasked', command: '/sk.check', stageBefore: 'tasks', stageAfter: 'analyze', branch: '005-us1-first',
    pr: 'https://github.com/o/r/pull/12', endedAt: '2026-09-30T10:00:00.000Z', agentMs: 83 * 60000, cost: { nanoAiu: 12.4e9, requests: 3 }
});
record(repo, '005-tasked', '2026-09-30T11-00-00-000Z-bbbbbb', {
    slug: '005-tasked', kind: 'checkpoint', command: '/sk.verify', story: 'US1', endedAt: '2026-09-30T11:00:00.000Z',
    checkpoint: { result: 'PASS', independentTest: 'run the first thing', scs: [{ id: 'SC-001', result: 'PASS', evidence: 'x' }] }
});
repo.write('.askaway/specs/005-tasked/runs/broken.json', '{ not json');
// Stored stage "tasks" but no tasks.md → mismatch.
record(repo, '003-planned', '2026-09-30T10-00-00-000Z-cccccc', {
    slug: '003-planned', command: '/sk.tasks', stageBefore: 'checklist', stageAfter: 'tasks', endedAt: '2026-09-30T10:00:00.000Z'
});

try {
    // --json for a stored-stage spec with stale artifact, records, PR, stories.
    let result = run(repo.root, '005-tasked', '--json');
    assert.equal(result.status, 0, result.stderr);
    const facts = JSON.parse(result.stdout);
    assert.equal(facts.slug, '005-tasked');
    assert.equal(facts.storedStage, 'analyze');
    assert.equal(facts.stageSource, 'records');
    assert.equal(facts.impliedStage, 'tasks');
    assert.equal(facts.mismatch, null);
    assert.equal(facts.nextStep, '/sk.implement');
    assert.equal(facts.stageButton, 'Implement');
    assert.deepEqual(facts.stale, [{ artifact: 'tasks.md', upstream: 'plan.md', reason: 'upstream-newer' }]);
    assert.equal(facts.branch, '005-us1-first');
    assert.equal(facts.activePr, 'https://github.com/o/r/pull/12');
    assert.equal(facts.costAiu, 12.4);
    assert.equal(facts.agentMinutes, 83);
    assert.equal(facts.runs, 2);
    assert.equal(facts.skippedRecords, 1);
    assert.equal(facts.readiness, null);
    assert.equal(facts.stories.length, 1);
    assert.deepEqual([facts.stories[0].id, facts.stories[0].done, facts.stories[0].total, facts.stories[0].independentTest],
        ['US1', 0, 2, 'run the first thing']);
    assert.deepEqual(facts.stories[0].checkpoint, { result: 'PASS', scs: [{ id: 'SC-001', result: 'PASS' }] });
    assert.ok(!result.stdout.includes('"evidence"'), 'no evidence text in output');

    // Numeric argument resolves like the slug; text output is the one-line summary plus stale lines.
    result = run(repo.root, '5');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
        '005-tasked · stage analyze · next /sk.implement',
        'stale: tasks.md older than plan.md (upstream-newer)'
    ]);

    // Stored stage contradicting artifacts is printed as a mismatch line, in text and JSON.
    result = run(repo.root, '003-planned');
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines[0], '003-planned · stage tasks · next /sk.check (analyze)');
    assert.match(lines[1], /^mismatch: stored tasks, implied plan — .*tasks\.md/);
    const mismatch = JSON.parse(run(repo.root, '003-planned', '--json').stdout);
    assert.deepEqual([mismatch.mismatch.stored, mismatch.mismatch.implied], ['tasks', 'plan']);

    // No stored records: stage comes from artifacts; --root works from another directory.
    result = run(__dirname, '002-clarified', '--json', '--root', repo.root);
    assert.equal(result.status, 0, result.stderr);
    const clarified = JSON.parse(result.stdout);
    assert.deepEqual([clarified.storedStage, clarified.stageSource, clarified.nextStep, clarified.branch, clarified.activePr, clarified.runs],
        ['clarify', 'artifacts', '/sk.plan', null, null, 0]);

    // No slug and no active feature → exit 2.
    result = run(repo.root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no active feature; pass a slug/);

    // No slug → the active feature from .specify/feature.json.
    repo.write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/003-planned' }));
    result = run(repo.root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^003-planned · stage tasks/);

    // Unknown slug → exit 2.
    result = run(repo.root, '099-nope');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown spec: 099-nope/);

    // Read-only: the CLI wrote nothing.
    assert.equal(repo.git('status', '--porcelain').split('\n').filter(l => l && !/\.askaway|\.specify/.test(l)).length, 0);
    console.log('PASS EV-SPEC-FACTS-CLI');
} finally {
    repo.cleanup();
}
