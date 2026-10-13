const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./node_modules/typescript');
const cache = {};
function load(name) {
    if (cache[name]) return cache[name].exports;
    const filename = path.join(__dirname, 'src/cloud', name + '.ts');
    const m = cache[name] = new Module(filename, module);
    m.paths = module.paths;
    m.require = id => id.startsWith('./') ? load(id.slice(2)) : require(id);
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return m.exports;
}
const { queueTask, releaseHeld } = load('cloudQueue');
const { createGh } = load('gh');
const request = { root: '/fixture/other-checkout', slug: '006-cloud-tasks', pr: 'https://github.com/target/project/pull/1608', explicitRequest: true, enabled: true,
    task: { taskId: 'T008', stage: 'implement', details: '- [ ] T008 [cloud] queue', tags: ['cloud'], allowedPaths: ['src/a.ts'], verify: ['node test.cjs'], expect: 'PASS', ceilingMinutes: 45 },
    story: { story: 'US2', independentTest: 'Queue once' } };
function fixture(options = {}) {
    const calls = [], files = new Map(); let runs = []; let posts = 0;
    const io = {
        gh: createGh(async args => {
            calls.push(['gh', ...args]);
            if (args[0] === 'auth') return { code: options.auth ? 1 : 0, stderr: 'not logged in', stdout: '' };
            if (args[0] === 'api') return { code: 0, stderr: '', stdout: JSON.stringify(args[1].includes('/pulls/') ? {
                state: options.closed ? 'closed' : 'open', head: { ref: 'active-pr', sha: '1234567890abcdef', repo: { full_name: 'target/project', clone_url: 'https://github.com/target/project.git' } },
            } : { permissions: { push: !options.denied } }) };
            assert.deepEqual(args.slice(0, 5), ['pr', 'comment', request.pr, '--repo', 'target/project']);
            posts++;
            return { code: 0, stderr: '', stdout: request.pr + '#issuecomment-' + posts };
        }),
        async git(args, cwd) { calls.push(['git', ...args, cwd]); return args[0] === 'rev-parse' ? 'abcdef0123456789' : ''; },
        async load() { return structuredClone(runs); }, async save(root, value) { runs = structuredClone(value); },
        async write(file, text) { files.set(file, text); }, async temporary() { return '/fixture/tmp'; }, async cleanup() {}, knownValues() { return []; },
    };
    return { io, calls, files, get runs() { return runs; }, get posts() { return posts; }, transition(state) { runs[0].state = state; } };
}
const writes = f => f.calls.filter(c => c[0] === 'git' || c[0] === 'gh' && c[1] === 'pr');
(async () => {
    let passed = 0;
    const f = fixture();
    const first = await queueTask(request, f.io);
    assert.equal(first.run.state, 'Queued');
    assert.equal(first.run.branch, 'active-pr');
    assert.equal(first.run.commentId, '1');
    assert.equal(f.posts, 1);
    const git = f.calls.filter(c => c[0] === 'git');
    assert.deepEqual(git.map(c => c[1]), ['fetch', 'worktree', 'add', 'commit', 'rev-parse', 'push', 'worktree']);
    assert.ok(git.find(c => c[1] === 'add').includes('-f'));
    assert.ok(git.find(c => c[1] === 'commit').includes('[T008] cloud packet\n\nAskAway-Commit: packet'));
    assert.ok(git.find(c => c[1] === 'push').includes('HEAD:refs/heads/active-pr'));
    assert.ok(!git.some(c => c.includes('origin')));
    assert.ok([...f.files.values()].some(text => text.includes('base: "1234567890abcdef"')));
    assert.ok([...f.files.values()].some(text => text.includes(' at abcdef0.')));
    assert.ok(f.calls.findIndex(c => c[1] === 'push') < f.calls.findIndex(c => c[1] === 'pr'));
    passed++;
    const count = writes(f).length;
    assert.match((await queueTask(request, f.io)).refusal, /already queued/);
    assert.equal(writes(f).length, count); passed++;
    for (const [options, change, reason] of [
        [{}, { explicitRequest: false }, /explicit reviewer/], [{}, { enabled: false }, /disabled/],
        [{ auth: true }, {}, /gh not authenticated/], [{ closed: true }, {}, /no active PR/],
        [{ denied: true }, {}, /no push permission/], [{}, { task: { ...request.task, tags: ['local: local service'] } }, /local service/],
        [{}, { task: { ...request.task, details: 'ghp_' + 'a'.repeat(24) } }, /secret detected in details/],
    ]) {
        const refused = fixture(options);
        assert.match((await queueTask({ ...request, ...change }, refused.io)).refusal, reason);
        assert.equal(writes(refused).length, 0); assert.equal(refused.files.size, 0); assert.equal(refused.runs.length, 0);
        passed++;
    }
    const concurrent = fixture();
    const secondRequest = { ...request, slug: 'another-spec', task: { ...request.task, taskId: 'T009' } };
    const results = await Promise.all([queueTask(request, concurrent.io), queueTask(secondRequest, concurrent.io)]);
    assert.deepEqual(results.map(r => r.run.state), ['Queued', 'Held']); assert.equal(concurrent.posts, 1);
    assert.deepEqual(results[1].run.overlapPaths, ['src/a.ts']);
    assert.match(results[1].run.decisionNeeded, /Held overlapping paths: src\/a.ts/);
    assert.equal([...concurrent.files.keys()].filter(file => file.includes('/packets/')).length, 1);
    assert.equal(await releaseHeld(request.root, request.pr, concurrent.io), undefined);
    passed++;
    for (const state of ['Working', 'Pushed', 'Checks passed', 'Checks failed', 'Checks waiting for approval']) {
        concurrent.transition(state); assert.equal(await releaseHeld(request.root, request.pr, concurrent.io), undefined);
    }
    concurrent.transition('Needs review');
    assert.equal((await releaseHeld(request.root, request.pr, concurrent.io)).taskId, 'T009');
    assert.equal(concurrent.runs[1].decisionNeeded, undefined);
    assert.equal(concurrent.posts, 2);
    assert.equal(await releaseHeld(request.root, request.pr, concurrent.io), undefined);
    assert.equal(concurrent.posts, 2); passed++;
    const fresh = fixture(); assert.equal(await releaseHeld(request.root, request.pr, fresh.io), undefined); assert.equal(fresh.calls.length, 0); passed++;
    const retry = fixture(); await queueTask(request, retry.io); retry.transition('Timed out');
    assert.equal((await queueTask(request, retry.io)).run.attempt, 2); passed++;
    const settings = require('./package.json').contributes.configuration.properties;
    assert.equal(settings['askaway.cloud.enabled'].default, false);
    assert.equal(settings['askaway.cloud.pollMinutes'].default, 1);
    assert.deepEqual(settings['askaway.cloud.agentLogins'].default, ['Copilot']); passed++;
    const disjoint = fixture(); await queueTask(request, disjoint.io);
    const separate = await queueTask({ ...secondRequest, task: { ...secondRequest.task, allowedPaths: ['src/b.ts'] } }, disjoint.io);
    assert.equal(separate.run.state, 'Held'); assert.deepEqual(separate.run.overlapPaths, []); assert.equal(disjoint.posts, 1);
    disjoint.transition('Needs review'); await releaseHeld(request.root, request.pr, disjoint.io); assert.equal(disjoint.posts, 2);
    const defaultCap = fixture();
    await queueTask({ ...request, task: { ...request.task, ceilingMinutes: undefined } }, defaultCap.io);
    assert.ok([...defaultCap.files.values()].some(text => text.includes('ceilingMinutes: 50')));
    for (const ceilingMinutes of [0, 60, 50.5]) {
        const invalidCap = fixture();
        assert.match((await queueTask({ ...request, task: { ...request.task, ceilingMinutes } }, invalidCap.io)).refusal, /between 1 and 59/);
        assert.equal(invalidCap.calls.length, 0); assert.equal(invalidCap.files.size, 0);
    }
    console.log('PASS EV-CLOUD-SAFETY-QUEUE overlap/disjoint Held; Needs review release; default50; invalid cap refused before GitHub/git writes');
    console.log(`test-cloud-queue: ${passed} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
