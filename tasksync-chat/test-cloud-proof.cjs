// 006 US1: the live-proof tool's dry run shows exactly what would be committed and posted — a packet with the
// required fields and two short comments — without touching git or GitHub. Run: node test-cloud-proof.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tool = path.join(__dirname, 'tools', 'cloud-proof.cjs');
const run = (args, env = {}) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', ...env } });

const usage = run([]);
assert.equal(usage.status, 2);
assert.match(usage.stderr, /usage: node tools\/cloud-proof\.cjs --pr/);

const dry = run(['--pr', '12', '--dry-run']);
assert.equal(dry.status, 0, dry.stderr);
for (const field of ['stage: implement', 'story: US1', 'task: PROOF-1', 'base: ', 'allowedPaths:', 'verify:', 'stopCondition:', 'reportFormat:', '## Task details']) {
    assert.ok(dry.stdout.includes(field), `packet has ${field}`);
}
const comments = dry.stdout.split(/--- comment \d[^\n]*\n/).slice(1).map((c) => c.trim());
assert.equal(comments.length, 2, 'two comments: the task and the concurrency probe');
for (const comment of comments) {
    assert.ok(comment.startsWith('@copilot Please do PROOF-1'), comment);
    assert.match(comment.split('\n')[0], /^@copilot Please do PROOF-1\S* \(US1, stage implement\) of 006-cloud-tasks: follow /, 'first line states task, story and stage');
    assert.ok(comment.split('\n').length <= 5, 'comment is at most 5 lines');
    assert.ok(comment.includes('.askaway/specs/006-cloud-tasks/packets/'), 'comment references the packet by path');
}
assert.match(comments[0], /Claude Sonnet 5\.5/, 'first comment asks for a model so the proof can record whether it was honoured');

const leaked = run(['--pr', '12', '--task', 'ghp_abcdefghijklmnopqrstuvwxyz12', '--dry-run']);
assert.equal(leaked.status, 3, 'a secret in the packet is refused');
assert.match(leaked.stderr, /REFUSED: secret detected in packet \(github-token\)/);
console.log('PASS test-cloud-proof: dry-run packet fields, two <=5-line comments referencing the packet, model request, secret refusal, no gh/git used');
