// EV-AGY-APPROVE: the agy approval wrapper answers agy's interactive command prompts from the allow-list,
// prints stream-json the runtime reads, and the host uses it only while ~/.askaway/bin/agy-approve exists.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const vm = require('node:vm');

const dir = path.join(__dirname, 'build', 'agy-approve-' + process.pid);
fs.mkdirSync(dir, { recursive: true });
const fake = path.join(dir, 'agy');
fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.some(a => a.startsWith('--conversation='))) {
    console.log(JSON.stringify({ event: 'result', result: { conversation_id: '11111111-2222-3333-4444-555555555555', status: 'SUCCESS', response: 'final report', usage: { input_tokens: 5 } } }));
    process.exit(0);
}
if (!args.includes('-i') || args.some(a => a.startsWith('--output-format') || a === '--dangerously-skip-permissions')) { console.log('BAD ARGS ' + args.join(' ')); process.exit(3); }
const asks = ['node -e 1', 'rm -rf x'];
const answers = [];
const ask = () => process.stdout.write('\\n● Ran (' + asks[answers.length] + ') (ctrl+o to expand)\\n\\nRequesting permission for:\\n   ' + asks[answers.length] + '\\n\\nRun this command?\\n> 1. Yes, run command\\n  4. No, cancel\\n');
const close = () => { process.stdout.write('\\nResume with -c (or command below):\\nagy --conversation=11111111-2222-3333-4444-555555555555\\n'); process.exit(0); };
// Like agy's TUI: raw keys, Enter picks the highlighted Yes, arrows move to No, ctrl+d leaves.
process.stdin.setRawMode(true);
process.stdin.on('data', chunk => {
    const keys = chunk.toString();
    if (keys.includes('\\x04')) { return close(); }
    if (!keys.includes('\\r')) { return; }
    answers.push(keys === '\\r' ? 'yes' : keys.includes('\\x1b[B') ? 'no' : 'other:' + JSON.stringify(keys));
    if (answers.length < asks.length) { setTimeout(ask, 100); } else { require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'answers.json'))}, JSON.stringify(answers)); }
});
setTimeout(ask, 200);
`, { mode: 0o755 });

const run = spawnSync('python3', [path.join(__dirname, 'tools', 'agy-approve.py'), '--print=do it', '--output-format=stream-json', '--model=gemini-4-argon-high',
    '--mode=accept-edits', '--disable-slash-commands', '--dangerously-skip-permissions'], {
    env: { ...process.env, ASKAWAY_AGY_BIN: fake, ASKAWAY_AGY_IDLE_SECONDS: '2', ASKAWAY_AGY_ALLOW: 'node,npm' }, encoding: 'utf8', timeout: 60000,
});
assert.equal(run.status, 0, run.stderr + run.stdout);
const events = run.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.ok(fs.existsSync(path.join(dir, 'answers.json')), 'fake agy got no answers:\n' + run.stdout + '\n' + run.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')), ['yes', 'no'], 'node allowed, rm denied');
const approvals = events.filter(e => e.step_update?.tool_name === 'askaway_approval').map(e => e.step_update.tool_info.parameters);
assert.deepEqual(approvals, [{ CommandLine: 'node -e 1', decision: 'allow' }, { CommandLine: 'rm -rf x', decision: 'deny' }]);
assert.equal(events.at(-1).result.response, 'final report', 'final answer comes from the recap of the same conversation');
assert.match(run.stderr, /deny: rm -rf x/);
console.log('PASS EV-AGY-APPROVE interactive prompts answered from the allow-list (node yes, rm no); stream-json approvals and final result');

const decide = cmd => spawnSync('python3', ['-c', 'import runpy,sys; print(runpy.run_path(sys.argv[1], run_name="t")["allowed"](sys.argv[2]))', path.join(__dirname, 'tools', 'agy-approve.py'), cmd],
    { env: { ...process.env, ASKAWAY_AGY_ALLOW: 'node,npm,grep,git status' }, encoding: 'utf8' }).stdout.trim();
assert.equal(decide('grep -n "Usage banner\\|Turn trace" media/webview.js'), 'True', 'a pipe inside quotes is an argument');
assert.equal(decide("node -e 'a || b; c'"), 'True');
assert.equal(decide('git status && node x.js'), 'True');
assert.equal(decide('grep x f | rm -rf y'), 'False', 'every real segment must be allowed');
assert.equal(decide('git push'), 'False');
console.log('PASS EV-AGY-APPROVE allow-list splits only on real shell operators, not quoted ones');

const host = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/workerHost.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    .replace(/^.*require\(.*$/gm, line => line.includes('"os"') || line.includes('"path"') || line.includes('"fs"') ? line : ''), { exports: host, require, process });
assert.equal(host.agyCommand('/home/u', {}, () => false), 'agy');
assert.equal(host.agyCommand('/home/u', {}, p => p === '/home/u/.askaway/bin/agy-approve'), '/home/u/.askaway/bin/agy-approve');
assert.equal(host.agyCommand('/home/u', { ASKAWAY_AGY_COMMAND: '/x/agy' }, () => true), '/x/agy');
console.log('PASS EV-AGY-APPROVE host uses ~/.askaway/bin/agy-approve only while it exists; env override wins');
fs.rmSync(dir, { recursive: true, force: true });
