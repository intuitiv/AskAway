// Outside-in: spawn tools/command-patterns.cjs on a hand-made log and check the burst analysis. Run: node test-command-patterns.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cli = path.join(__dirname, 'tools', 'command-patterns.cjs');
const fixture = path.join(__dirname, 'test-fixtures', 'copilot-log-commands.jsonl');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

const report = JSON.parse(run('--json', fixture));
const file = report.files[0];
assert.equal(file.turns, 2);
assert.deepEqual(file.toolCalls, { run_in_terminal: 4, read_file: 1, worker: 1 });
assert.equal(file.terminalCommands, 4);
assert.deepEqual(file.families, { 'git status': 1, 'git diff': 1, 'git log': 1, 'npm/node': 1 });
assert.deepEqual(file.workerActions, { start: 1 });
assert.equal(file.bursts.length, 1, 'the lone npm command is not a burst');
const [burst] = file.bursts;
assert.equal(burst.length, 3);
assert.deepEqual(burst.commands, ['rtk git status', 'git diff --stat', 'rtk git log -3']);
assert.equal(burst.requestsBetween, 2);
assert.equal(burst.aiuBetween, 5);
assert.equal(burst.inputTokensBetween, 2500);
assert.deepEqual(report.summary, { burstCommands: 3, requestsBetween: 2, aiuBetween: 5, gitShare: 0.75, terminalCommands: 4, gitCommands: 3 });

const both = JSON.parse(run('--json', fixture, fixture));
assert.equal(both.total.terminalCommands, 8);
assert.equal(both.total.bursts.length, 2);
assert.match(run(fixture), /SUMMARY: 3 burst commands, 2 requests between them, 5\.0000 AIU, git share 75%/);

console.log('PASS EV-COMMAND-PATTERNS');
