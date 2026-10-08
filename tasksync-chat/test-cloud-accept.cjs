const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/cloud/cloudSpecs.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
const m = { exports: {} }; vm.runInNewContext(bundle, { module: m, exports: m.exports, require, console, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
const { CloudSpecsController } = m.exports;
const build = path.join(__dirname, 'build'); fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'cloud-accept-test-'));
const remote = path.join(home, 'remote.git'), root = path.join(home, 'clone'), producer = path.join(home, 'producer');
const git = (args, cwd = home) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '--bare', '--initial-branch=active', remote]); git(['clone', remote, producer]);
git(['config', 'user.name', 'Fixture'], producer); git(['config', 'user.email', 'fixture@example.invalid'], producer);
fs.writeFileSync(path.join(producer, 'proof.txt'), 'base\n'); fs.writeFileSync(path.join(producer, 'tasks.md'), '- [ ] T014\n');
fs.mkdirSync(path.join(producer, 'specs/fixture'), { recursive: true });
for (const name of ['spec', 'plan']) fs.writeFileSync(path.join(producer, 'specs/fixture', name + '.md'), '**Status**: Draft\n');
git(['add', '.'], producer); git(['commit', '-m', 'base'], producer); git(['push', 'origin', 'active'], producer);
let packetBase = git(['rev-parse', 'HEAD'], producer);
const packetText = allowed => '---\nbase: "' + packetBase + '"\nallowedPaths:\n' + allowed.map(file => '  - ' + JSON.stringify(file)).join('\n') + '\nverify:\n  - "node exact-verification.cjs --first"\n---\n';
fs.writeFileSync(path.join(producer, 'packet.md'), packetText(['proof.txt']));
git(['add', '.'], producer); git(['commit', '-m', 'packet\n\nAskAway-Commit: packet'], producer); git(['push', 'origin', 'active'], producer);
git(['clone', remote, root]);
const base = git(['rev-parse', 'HEAD'], root);
let packetSha = base;
git(['config', 'user.name', 'copilot-swe-agent[bot]'], producer);
fs.writeFileSync(path.join(producer, 'proof.txt'), 'cloud head\n'); git(['add', '.'], producer); git(['commit', '-m', '[T014] cloud changes'], producer); git(['push', 'origin', 'active'], producer);
let head = git(['rev-parse', 'HEAD'], producer);
const pr = 'https://github.com/o/r/pull/1';
let stored, results, observed = 0;
const commands = ['node exact-verification.cjs --first', 'node exact-verification.cjs --second'];
const fresh = () => ({ v: 1, slug: '006-cloud-tasks', taskId: 'T014', attempt: 1, packetPath: 'packet.md', packetSha,
    pr, branch: 'active', commentId: '1', commentUrl: pr + '#issuecomment-1', model: 'self-reported: fixture', state: 'Needs review', queuedAt: new Date().toISOString(), history: [],
    report: { result: 'done', verifyOutput: 'PASS', url: pr + '#issuecomment-2', commands, model: 'self-reported: fixture', question: '' },
    request: { root, slug: '006-cloud-tasks', pr, explicitRequest: true, enabled: true,
        task: { taskId: 'T014', tags: ['cloud'], stage: 'implement', details: '- [ ] T014', verify: commands, allowedPaths: ['proof.txt'], expect: 'PASS', ceilingMinutes: 50 }, story: { story: 'US4', independentTest: 'acceptance' } } });
const gitCalls = [];
const io = { gh: { async json() { return { state: 'open', head: { ref: 'active', sha: head, repo: { clone_url: remote } } }; }, async text() { throw new Error('No gh writes allowed'); } },
    async git(args, cwd) { gitCalls.push(args); return git(args, cwd); },
    async load() { return structuredClone(stored); }, async save(_, runs) { stored = structuredClone(runs); },
    async cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); } };
const runner = async packet => {
    observed++; assert.deepEqual(Array.from(packet.commands), commands); assert.equal(packet.head, head);
    assert.ok(packet.cwd.startsWith(path.join(root, 'build'))); assert.equal(git(['rev-parse', 'HEAD'], packet.cwd), head);
    assert.equal(fs.readFileSync(path.join(packet.cwd, 'proof.txt'), 'utf8'), 'cloud head\n');
    assert.equal(fs.readFileSync(path.join(packet.cwd, 'tasks.md'), 'utf8'), '- [ ] T014\n');
    return results;
};
const controller = new CloudSpecsController(io, Date.now, runner);
const cleanupProof = () => { assert.equal(git(['worktree', 'list', '--porcelain'], root).split('worktree ').length - 1, 1); assert.equal(fs.readdirSync(path.join(root, 'build')).length, 0); assert.equal(git(['rev-parse', 'HEAD'], root), base); assert.equal(fs.readFileSync(path.join(root, 'tasks.md'), 'utf8'), '- [ ] T014\n'); };
(async () => {
    stored = [fresh()]; results = commands.map(command => ({ command, exitCode: 0, output: 'LOCAL PASS' }));
    await controller.poll(root, true, ['Copilot']); assert.equal(stored[0].state, 'Accepted'); assert.equal(stored[0].acceptance.head, head);
    assert.ok(stored[0].acceptance.evidence.includes(commands[0])); assert.ok(stored[0].acceptance.evidence.includes('LOCAL PASS')); cleanupProof();
    console.log('PASS current PR head verified in local worktree; Accepted with exact local command evidence');
    stored = [fresh()]; results = commands.map((command, index) => ({ command, exitCode: index ? 1 : 0, output: index ? 'LOCAL FAIL' : 'LOCAL PASS' }));
    await controller.poll(root, true, ['Copilot']); assert.equal(stored[0].state, 'Returned'); assert.ok(stored[0].acceptance.evidence.includes('exit 1: LOCAL FAIL')); cleanupProof();
    console.log('PASS failed command Returned with evidence and checkbox unticked');
    stored = [fresh()]; results = []; await controller.poll(root, true, ['Copilot']); assert.equal(stored[0].state, 'Returned'); cleanupProof();
    assert.match(stored[0].decisionNeeded, /missing exact command evidence/); assert.equal(observed, 3);
    assert.ok(!gitCalls.some(args => ['push', 'commit'].includes(args[0])));
    console.log('PASS agent report alone never passes; worktrees removed and no commits or pushes');
    results = commands.map(command => ({ command, exitCode: 0, output: 'LOCAL PASS' }));
    const scenario = async (allowed, edits, expected, offending) => {
        packetBase = git(['rev-parse', 'HEAD'], producer);
        fs.writeFileSync(path.join(producer, 'packet.md'), packetText(allowed));
        git(['add', '.'], producer); git(['commit', '-m', 'packet\n\nAskAway-Commit: packet'], producer);
        packetSha = git(['rev-parse', 'HEAD'], producer);
        for (const [file, text] of Object.entries(edits)) {
            fs.mkdirSync(path.dirname(path.join(producer, file)), { recursive: true }); fs.writeFileSync(path.join(producer, file), text);
        }
        git(['add', '.'], producer); git(['commit', '-m', '[T014] fixture change'], producer); git(['push', 'origin', 'active'], producer);
        head = git(['rev-parse', 'HEAD'], producer); stored = [fresh()];
        await controller.poll(root, true, ['Copilot']); assert.equal(stored[0].state, expected);
        assert.ok(stored[0].acceptance.evidence.includes('LOCAL PASS'));
        assert.deepEqual(Array.from(stored[0].acceptance.outOfScope), offending);
        for (const file of offending) assert.ok(stored[0].acceptance.evidence.includes(file));
        cleanupProof();
    };
    await scenario(['proof.txt'], { 'forbidden.txt': 'outside scope\n' }, 'Returned', ['forbidden.txt']);
    console.log('PASS forbidden path Returned with offending path despite passing verify; checkbox unchanged');
    for (const name of ['spec', 'plan']) {
        const file = 'specs/fixture/' + name + '.md';
        await scenario(['specs/**'], { [file]: '**Status**: Approved\n' }, 'Returned', [file]);
    }
    console.log('PASS spec and plan Status edits Returned with offending paths despite passing verify; checkbox unchanged');
    await scenario(['specs/**'], { 'specs/fixture/spec.md': '**Status**: Approved\n\nIn-scope body change\n' }, 'Accepted', []);
    console.log('PASS clean in-scope body change Accepted; unchanged Status line does not trigger gate');
})().catch(error => { console.error(error); process.exitCode = 1; });
