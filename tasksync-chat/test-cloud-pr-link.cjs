const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const entry = path.join(__dirname, 'src/cloud/cloudSpecs.ts');
const bundle = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const m = { exports: {} };
vm.runInNewContext(bundle, { module: m, exports: m.exports, require, console, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
const { CloudSpecsController, shouldPollCloud } = m.exports;
const commentaryBundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/commentary/commentary.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const cm = { exports: {} };
vm.runInNewContext(commentaryBundle, { module: cm, exports: cm.exports, require, console });
const fixture = require('./test-fixtures/cloud-signals-2026-10-07.json');
const root = path.join(__dirname, 'build/cloud-pr-link-' + process.pid);
fs.mkdirSync(root, { recursive: true });
const store = new cm.exports.CommentaryStore({ dir: path.join(root, 'commentary') });
const pr = `https://github.com/${fixture.repo}/pull/${fixture.pr}`;
const branch = 'askaway/cloud-proof-throwaway';
let snapshot, now = Date.parse(fixture.comments[0].at);
const file = path.join(root, 'runs.json');
const fresh = (attempt = 1) => ({ v: 1, slug: '006-cloud-tasks', taskId: 'PROOF-1', attempt,
    packetPath: 'packet.md', packetSha: fixture.base, pr, branch, commentId: fixture.comments[0].id,
    commentUrl: fixture.comments[0].url, model: 'PR default', state: 'Queued', queuedAt: fixture.comments[0].at, history: [],
    request: { root, slug: '006-cloud-tasks', pr, enabled: true, explicitRequest: true,
        task: { taskId: 'PROOF-1', tags: ['cloud'], stage: 'implement', details: '- [ ] PROOF-1', allowedPaths: ['proof.md'], verify: ['node proof.js'], expect: 'PASS' },
        story: { story: 'US1', independentTest: 'proof' } } });
const io = {
    async load() { return JSON.parse(fs.readFileSync(file, 'utf8')); },
    async save(_, runs) { fs.writeFileSync(file, JSON.stringify(runs)); },
    async git(args) { assert.fail('No git operation allowed: ' + args.join(' ')); },
    gh: { async text(args) { assert.fail('No GitHub writes allowed: ' + args.join(' ')); }, async json(args) {
        const endpoint = args.at(-1);
        if (endpoint.endsWith('/pulls/' + fixture.pr)) return { state: 'open', head: { ref: branch, sha: snapshot.commits.at(-1)?.sha ?? fixture.base } };
        if (endpoint.includes('/timeline')) return [snapshot.timeline];
        if (endpoint.includes('/reactions')) return [snapshot.reactions];
        if (endpoint.includes('/check-runs')) return snapshot.checkRuns;
        if (endpoint.includes('/commits')) return [snapshot.commits];
        if (endpoint.includes('/comments')) return [snapshot.comments];
        assert.fail(endpoint);
    } }
};
const controller = () => new CloudSpecsController(io, () => now, undefined, store);
const scan = { specs: [{ slug: '006-cloud-tasks', tasks: [{ id: 'PROOF-1' }], cycles: [] }] };
(async () => {
    await io.save(root, [fresh()]);
    for (const recorded of fixture.polls.slice(0, 2)) {
        snapshot = { ...structuredClone(recorded), reactions: recorded.reactions[0] };
        now = Date.parse(recorded.at);
        const runs = await io.load(); runs[0].nextPollAt = undefined; await io.save(root, runs);
        await controller().poll(root, true, ['Copilot']);
        if (runs[0].state === 'Queued') assert.equal(store.read(root).items.length, 0);
    }
    let runs = await io.load();
    assert.equal(runs[0].state, 'Needs review'); assert.ok(runs[0].sharedAt);
    assert.equal(store.read(root).items.length, 1);
    assert.ok(store.read(root).items[0].text.includes('PROOF-1'));
    assert.ok(store.read(root).items[0].text.includes(pr));
    assert.match(store.read(root).items[0].text, /review and merge it yourself/);
    await Promise.all([controller().poll(root, true, ['Copilot']), controller().refresh(root, scan)]);
    assert.equal(store.read(root).items.length, 1);
    const card = (await controller().refresh(root, scan)).specs[0].tasks[0].cloud;
    assert.ok(card.events[0].outputPreview.includes(pr));
    assert.equal(shouldPollCloud(true, await io.load()), false);
    console.log('PASS finished cloud task shares active PR once through Commentary and Specs; reload and re-poll do not repost');
    for (const state of ['Accepted', 'Returned']) {
        runs = await io.load(); const run = fresh(runs.length + 1); run.state = state; runs.push(run); await io.save(root, runs);
        await controller().refresh(root, scan); await controller().poll(root, true, ['Copilot']);
        assert.equal(store.read(root).items.length, runs.length);
        assert.ok((await io.load()).at(-1).sharedAt);
    }
    console.log('PASS already Accepted/Returned runs share once per attempt with persisted sharedAt');
    console.log('PASS completion handoff performs no git pull, fetch, merge, push or GitHub writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
