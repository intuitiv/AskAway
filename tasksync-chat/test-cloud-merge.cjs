const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
// 006 T016 (reviewer, 2026-10-13): an incoming cloud change is merged locally, tested, and pushed only when clean and green.
const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/cloud/cloudSpecs.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const m = { exports: {} }; vm.runInNewContext(bundle, { module: m, exports: m.exports, require, console, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
const { CloudSpecsController } = m.exports;
const build = path.join(__dirname, 'build'); fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'cloud-merge-test-'));
const remote = path.join(home, 'remote.git'), root = path.join(home, 'clone'), producer = path.join(home, 'producer');
const git = (args, cwd = home) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = dir => { git(['config', 'user.name', 'Fixture'], dir); git(['config', 'user.email', 'fixture@example.invalid'], dir); };
git(['init', '--bare', '--initial-branch=active', remote]); git(['clone', remote, producer]); identity(producer);
fs.writeFileSync(path.join(producer, 'proof.txt'), 'base\n'); fs.writeFileSync(path.join(producer, 'local.txt'), 'base\n');
git(['add', '.'], producer); git(['commit', '-m', 'base'], producer); git(['push', 'origin', 'active'], producer);
git(['clone', remote, root]); identity(root);
fs.writeFileSync(path.join(producer, 'proof.txt'), 'cloud\n'); git(['add', '.'], producer); git(['commit', '-m', '[T016] cloud change'], producer); git(['push', 'origin', 'active'], producer);
const head = git(['rev-parse', 'HEAD'], producer);
const commitLocal = (file, text) => { fs.writeFileSync(path.join(root, file), text); git(['commit', '-am', 'local ' + file], root); return git(['rev-parse', 'HEAD'], root); };
const pr = 'https://github.com/o/r/pull/1';
const commands = ['npm test'];
const accepted = () => ({ v: 1, slug: '006-cloud-tasks', taskId: 'T016', attempt: 1, packetPath: 'packet.md', packetSha: 'packet', pr, branch: 'active',
    commentId: '1', commentUrl: pr + '#issuecomment-1', model: 'fixture', state: 'Accepted', queuedAt: new Date().toISOString(), history: [],
    cost: { dollars: 0, at: new Date().toISOString(), workflowRuns: [], sessions: [] }, acceptance: { result: 'Accepted', head, evidence: 'PASS' },
    request: { root, slug: '006-cloud-tasks', pr, explicitRequest: true, enabled: true, task: { taskId: 'T016', tags: ['cloud'], verify: commands, allowedPaths: ['proof.txt'] } } });
let stored, exitCode, tested;
const gitCalls = [];
const io = { gh: { async json() { return { state: 'open', head: { ref: 'active', sha: head, repo: { clone_url: remote } } }; }, async text() { throw new Error('No gh writes allowed'); } },
    // Injected git: real local merges, but a push is recorded and never sent.
    async git(args, cwd) { gitCalls.push(args); return args[0] === 'push' ? '' : git(args, cwd); },
    async load() { return structuredClone(stored); }, async save(_, runs) { stored = structuredClone(runs); }, async cleanup() {} };
const acceptRunner = async () => { throw new Error('already accepted; acceptance must not rerun'); };
const testRunner = async packet => {
    tested = { cwd: packet.cwd, proof: fs.readFileSync(path.join(packet.cwd, 'proof.txt'), 'utf8'), local: fs.readFileSync(path.join(packet.cwd, 'local.txt'), 'utf8') };
    return packet.commands.map(command => ({ command, exitCode, output: exitCode ? 'FAIL' : 'PASS' }));
};
const controller = new CloudSpecsController(io, Date.now, acceptRunner, undefined, testRunner);
const pushes = () => gitCalls.filter(args => args[0] === 'push');
(async () => {
    let before = commitLocal('local.txt', 'local work\n');
    stored = [accepted()]; exitCode = 0;
    await controller.poll(root, true, ['Copilot']);
    assert.equal(stored[0].localMerge.result, 'Pushed');
    assert.deepEqual(tested, { cwd: root, proof: 'cloud\n', local: 'local work\n' }, 'tests run on the merged local branch');
    assert.deepEqual(git(['rev-list', '--parents', '-n', '1', 'HEAD'], root).split(' ').slice(1), [before, head]);
    assert.equal(pushes().length, 1); assert.deepEqual(Array.from(pushes()[0]), ['push', remote, 'HEAD:refs/heads/active']);
    await controller.poll(root, true, ['Copilot']); assert.equal(pushes().length, 1, 'same cloud head is merged once');
    console.log('PASS clean merge of the cloud change, tests pass on the merged branch, pushed once without force');

    git(['reset', '--hard', before], root); stored = [accepted()]; exitCode = 1; tested = undefined;
    await controller.poll(root, true, ['Copilot']);
    assert.equal(stored[0].localMerge.result, 'Tests failed'); assert.equal(tested.proof, 'cloud\n');
    assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(git(['status', '--porcelain'], root), '');
    assert.equal(pushes().length, 1); assert.match(stored[0].decisionNeeded, /not pushed \(Tests failed\)/); assert.ok(stored[0].localMerge.evidence.includes('npm test → exit 1'));
    console.log('PASS failing tests: no push, local branch reset to the pre-merge commit, reported on the task');

    before = commitLocal('proof.txt', 'local conflicting\n'); stored = [accepted()]; exitCode = 0; tested = undefined;
    await controller.poll(root, true, ['Copilot']);
    assert.equal(stored[0].localMerge.result, 'Conflict'); assert.equal(tested, undefined, 'conflict never runs tests');
    assert.equal(git(['rev-parse', 'HEAD'], root), before); assert.equal(git(['status', '--porcelain'], root), '');
    assert.equal(fs.readFileSync(path.join(root, 'proof.txt'), 'utf8'), 'local conflicting\n');
    assert.equal(pushes().length, 1); assert.match(stored[0].decisionNeeded, /not pushed \(Conflict\)/);
    assert.ok(!gitCalls.some(args => args.some(arg => /^(--force|-f|--force-with-lease)/.test(arg) || arg.startsWith('+'))), 'never force-push');
    console.log('PASS merge conflict: aborted, no tests, no push, local branch unchanged, reported on the task');
    console.log('PASS EV-CLOUD-MERGE');
})().catch(error => { console.error(error); process.exitCode = 1; });
