// Caller-view contract: generate artifacts before any git/GitHub write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('./node_modules/typescript');
const filename = path.join(__dirname, 'src/cloud/packet.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { buildPacket, buildComment } = compiled.exports;
const task = {
    taskId: 'T014', stage: 'implement',
    details: '- [ ] T014 [cloud] [US2] Build packet writer\n  - Keep every detail: # colon: and quotes "here"',
    allowedPaths: ['tasksync-chat/src/cloud/packet.ts', 'tasksync-chat/test-cloud-packet.cjs'],
    verify: ['cd tasksync-chat && npx tsc -p ./ --noEmit', 'node -e "console.log(\'a: # b\')"\nnode test-cloud-packet.cjs'],
    expect: 'test-cloud-packet: 9 passed, 0 failed', ceilingMinutes: 45,
};
const story = { story: 'US2', independentTest: 'Queue a task; see exactly one packet and comment.' };
const facts = { slug: '006-cloud-tasks', attempt: 2, base: '1234567890abcdef', knownValues: [] };
const packet = buildPacket(task, story, facts);
const ref = { slug: facts.slug, taskId: task.taskId, story: story.story, stage: task.stage,
    packetPath: packet.path, packetSha: 'abcdef0123456789', knownValues: [] };
let passed = 0;
function test(name, fn) { fn(); passed++; }
function scalar(text, field) { return JSON.parse(text.split('\n').find(line => line.startsWith(field + ': ')).slice(field.length + 2)); }
test('nine required fields and copied context', () => {
    for (const field of ['stage', 'story', 'task', 'base', 'allowedPaths', 'verify', 'stopCondition', 'reportFormat']) {
        assert.match(packet.text, new RegExp('^' + field + ':', 'm'));
    }
    assert.ok(packet.text.includes('## Task details\n' + task.details));
    assert.ok(packet.text.includes('## Story Independent Test\n' + story.independentTest));
    assert.ok(packet.text.includes('specs/006-cloud-tasks/spec.md, plan.md (Decision Register), data-model.md, contracts/'));
    assert.ok(packet.text.includes('AGENTS.md, .github/copilot-instructions.md'));
});
test('commands and allowed paths survive serialization exactly', () => {
    const verifyLines = packet.text.split('verify:\n')[1].split('\nexpect:')[0].split('\n');
    assert.deepEqual(verifyLines.map(line => JSON.parse(line.slice(4))), task.verify);
    const pathLines = packet.text.split('allowedPaths:\n')[1].split('\nverify:')[0].split('\n');
    assert.deepEqual(pathLines.map(line => JSON.parse(line.slice(4))), task.allowedPaths);
    assert.equal(scalar(packet.text, 'expect'), task.expect);
});
test('all draft stages', () => {
    for (const stage of ['specify', 'clarify', 'plan', 'tasks', 'implement', 'converge', 'readiness', 'accept']) {
        assert.ok(buildPacket({ ...task, stage }, story, facts).text.includes(`draft: ${['specify', 'clarify', 'plan', 'tasks'].includes(stage)}`));
    }
});
test('PR head base and attempt path', () => {
    assert.equal(scalar(packet.text, 'base'), facts.base);
    assert.equal(packet.path, '.askaway/specs/006-cloud-tasks/packets/T014-2.md');
    assert.throws(() => buildPacket(task, story, { ...facts, attempt: 0 }), /attempt/);
    assert.throws(() => buildPacket({ ...task, ceilingMinutes: 60 }, story, facts), /ceilingMinutes/);
});
test('commit prefix, gates and report format', () => {
    for (const text of ['`[T014]`', 'Never merge a PR', 'Do not change any `**Status**:` line', 'Report T014', '- Result: done | blocked', '- Commits: <sha list>', '- Verify output: <last line of each command>', '- Question (if blocked): <one question>']) assert.ok(packet.text.includes(text), text);
});
test('reference comment uses packet commit, not base, and repeats no context', () => {
    const comment = buildComment(ref);
    assert.equal(comment, `@copilot Please do T014 (US2, stage implement) of 006-cloud-tasks: follow ${packet.path} at abcdef0.\nWork on this PR's branch only; stay inside allowedPaths; run the packet's verify commands.\nStop and ask on anything undecided; reply using the packet's reportFormat.`);
    assert.ok(comment.split('\n').length <= 5);
    for (const text of [facts.base, task.details, story.independentTest, ...task.verify]) assert.ok(!comment.includes(text));
});
test('model default is read-only and reports self-reported', () => {
    assert.ok(packet.text.includes('Model: PR default (not independently observed)'));
    assert.ok(packet.text.includes('- Model: <self-reported name, or not observed: reason>'));
    assert.ok(!buildComment({ ...ref, modelHint: 'Please use another model' }).includes('Please use'));
});
test('each seeded gate pattern refused before caller writes', () => {
    const seeds = ['ghp_' + 'a'.repeat(24), 'AKIA' + 'ABCDEFGHIJKLMNOP', 'xoxb-' + '1234567890-abcdef', 'sk-' + 'a'.repeat(24), '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2'];
    let writes = 0;
    for (const seed of seeds) {
        assert.throws(() => { buildPacket({ ...task, details: seed }, story, facts); writes++; }, /secret detected in details/);
        assert.throws(() => { buildComment({ ...ref, packetPath: seed }); writes++; }, /secret detected in packetPath/);
    }
    assert.equal(writes, 0);
});
test('known credentials and non-body fields refused', () => {
    const knownValues = ['synthetic-credential-value'];
    assert.throws(() => buildPacket({ ...task, verify: knownValues }, story, { ...facts, knownValues }), /secret detected in verify/);
    assert.throws(() => buildPacket(task, { ...story, independentTest: knownValues[0] }, { ...facts, knownValues }), /secret detected in independentTest/);
    assert.throws(() => buildComment({ ...ref, packetSha: knownValues[0], knownValues }), /secret detected in packetSha/);
});
console.log(`test-cloud-packet: ${passed} passed, 0 failed`);
