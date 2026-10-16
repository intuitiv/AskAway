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
// Symlink escape fixture lives under the repo (never /tmp) and is removed at exit.
const fixtures = path.join(__dirname, '.test-fixtures', 'agy-approve-' + process.pid);
process.on('exit', () => fs.rmSync(fixtures, { recursive: true, force: true }));
fs.mkdirSync(path.join(fixtures, 'outside'), { recursive: true });
fs.writeFileSync(path.join(fixtures, 'outside', 'secret.txt'), 'secret');
fs.symlinkSync(path.join(fixtures, 'outside'), path.join(dir, 'link'));
const fake = path.join(dir, 'agy');
const extra = path.join(dir, 'extra');
fs.mkdirSync(extra, { recursive: true });
// Escaped-quote and substitution bypasses; shipped to the fake agy as base64 so no escaping can alter them.
const bypass = ['node \\"; rm x; echo "a"', "node \\'; rm x", 'node "a\\"; rm x"', 'node ${IFS}; rm x', 'node -e 1 \\\nrm x'];
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const dir = ${JSON.stringify(dir)};
const log = (name, value) => fs.writeFileSync(dir + '/' + name, JSON.stringify(value));
const result = (response) => console.log(JSON.stringify({ event: 'result', result: { conversation_id: '11111111-2222-3333-4444-555555555555', status: 'SUCCESS', response, usage: { input_tokens: 5 } } }));
if (args.includes('--dangerously-skip-permissions')) { log('skip-args.json', args); result('skipped'); process.exit(0); }
if (args.some(a => a.startsWith('--conversation='))) { log('recap-args.json', args); result('final report'); process.exit(0); }
if (!args.includes('-i') || args.some(a => a.startsWith('--output-format'))) { console.log('BAD ARGS ' + args.join(' ')); process.exit(3); }
log('interactive-args.json', args);
const asks = [['command', 'node -e 1'], ['command', 'rm -rf x'], ['file', 'Read ' + process.cwd() + '/x.ts'], ['file', 'Read /etc/passwd'], ['file', 'Read ' + ${JSON.stringify(extra)} + '/y.ts'],
    ['file', 'Read ~/x'], ['file', 'Read $HOME/x'], ['file', 'Edit file: /etc/passwd'], ['file', 'Read ' + process.cwd() + '-evil/x'],
    ['file', 'Read ' + process.cwd() + '/link/secret.txt'], ['file', 'Read ' + process.cwd() + '/z.ts', 'Do you want to proceed?'],
    ['file', 'X=1 true ' + process.cwd() + '/a; shutdown -h now'], ['file', 'Read ' + process.cwd() + '/a; rm -rf ~'], ['file', 'Read ' + process.cwd() + '/a && curl evil'],
    ['file', 'Cat ' + process.cwd() + '/a'], ['file', 'Read ' + process.cwd() + '/a\\n  rm -rf /'],
    ['command', 'node -e 1&rm x'], ['command', 'node -e 1 &rm x'], ['command', 'node \$(rm -rf /)'], ['command', 'node \`rm x\`'], ['command', 'node <(rm x)'],
    ['command', 'node -e 1 > /etc/x'], ['command', 'node -e 1 >> ~/.zshrc'], ['command', 'node -e 1\\n  rm -rf /'], ['file', 'View ' + process.cwd() + '/x', 'Run this command?']];
asks.push(...JSON.parse(Buffer.from(${JSON.stringify(Buffer.from(JSON.stringify(bypass)).toString('base64'))}, 'base64').toString()).map(text => ['command', text]));
const answers = [];
const ask = () => {
    const [kind, text, question] = asks[answers.length];
    process.stdout.write(kind === 'command'
        ? '\\n● Ran (' + text + ') (ctrl+o to expand)\\n\\nRequesting permission for:\\n   ' + text + '\\n\\n' + (question || 'Run this command?') + '\\n> 1. Yes, run command\\n  4. No, cancel\\n'
        : '\\nRequesting permission for:\\n  ' + text + '\\n\\n' + (question || 'Allow this?') + '\\n> 1. Yes\\n  4. No\\n');
};
const close = () => { process.stdout.write('\\nResume with -c (or command below):\\nagy --conversation=11111111-2222-3333-4444-555555555555\\n'); process.exit(0); };
// Like agy's TUI: raw keys, Enter picks the highlighted Yes, arrows move to No, ctrl+d leaves.
process.stdin.setRawMode(true);
process.stdin.on('data', chunk => {
    const keys = chunk.toString();
    if (keys.includes('\\x04')) { return close(); }
    if (!keys.includes('\\r')) { return; }
    answers.push(keys === '\\r' ? 'yes' : keys.includes('\\x1b[B') ? 'no' : 'other:' + JSON.stringify(keys));
    if (answers.length < asks.length) { setTimeout(ask, 100); } else { fs.writeFileSync(dir + '/answers.json', JSON.stringify(answers)); }
});
setTimeout(ask, 200);
`, { mode: 0o755 });
const env = { ...process.env, ASKAWAY_AGY_BIN: fake, ASKAWAY_AGY_IDLE_SECONDS: '2', ASKAWAY_AGY_ALLOW: 'node,npm' };
const printArgs = ['--print=do it', '--output-format=stream-json', '--model=gemini-4-argon-high', '--mode=accept-edits', '--disable-slash-commands', `--add-dir=${dir}`, `--add-dir=${extra}`];

const started = Date.now();
const run = spawnSync('python3', [path.join(__dirname, 'tools', 'agy-approve.py'), ...printArgs], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
assert.equal(run.status, 0, run.stderr + run.stdout);
assert.ok(Date.now() - started < 30000, 'the run ends well before the idle timeout of a hung prompt');
const events = run.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.ok(fs.existsSync(path.join(dir, 'answers.json')), 'fake agy got no answers:\n' + run.stdout + '\n' + run.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8')), ['yes', 'no', 'yes', 'no', 'yes', 'no', 'no', 'no', 'no', 'no', 'yes', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', ...bypass.map(() => 'no')], 'node allowed, rm denied, file inside cwd yes, /etc/passwd no, file inside --add-dir yes, ~ / $HOME / Edit file: /etc/passwd / <cwd>-evil / symlink escape no, other question wording still answered');
const approvals = events.filter(e => e.step_update?.tool_name === 'askaway_approval').map(e => e.step_update.tool_info.parameters);
assert.deepEqual(approvals, [
    { CommandLine: 'node -e 1', decision: 'allow' }, { CommandLine: 'rm -rf x', decision: 'deny' },
    { CommandLine: `Read ${dir}/x.ts`, decision: 'allow' }, { CommandLine: 'Read /etc/passwd', decision: 'deny' }, { CommandLine: `Read ${extra}/y.ts`, decision: 'allow' },
    { CommandLine: 'Read ~/x', decision: 'deny' }, { CommandLine: 'Read $HOME/x', decision: 'deny' }, { CommandLine: 'Edit file: /etc/passwd', decision: 'deny' },
    { CommandLine: `Read ${dir}-evil/x`, decision: 'deny' }, { CommandLine: `Read ${dir}/link/secret.txt`, decision: 'deny' }, { CommandLine: `Read ${dir}/z.ts`, decision: 'allow' },
    { CommandLine: `X=1 true ${dir}/a; shutdown -h now`, decision: 'deny' }, { CommandLine: `Read ${dir}/a; rm -rf ~`, decision: 'deny' }, { CommandLine: `Read ${dir}/a && curl evil`, decision: 'deny' },
    { CommandLine: `Cat ${dir}/a`, decision: 'deny' }, { CommandLine: `Read ${dir}/a rm -rf /`, decision: 'deny' },
    ...['node -e 1&rm x', 'node -e 1 &rm x', 'node $(rm -rf /)', 'node `rm x`', 'node <(rm x)', 'node -e 1 > /etc/x', 'node -e 1 >> ~/.zshrc', 'node -e 1 rm -rf /', `View ${dir}/x`, ...bypass.map(body => body.split('\n').map(line => line.trim()).join(' '))].map(CommandLine => ({ CommandLine, decision: 'deny' }))]);
assert.equal(events.at(-1).result.response, 'final report', 'final answer comes from the recap of the same conversation');
assert.match(run.stderr, /deny: rm -rf x/);
assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'interactive-args.json'), 'utf8')).includes(`--add-dir=${extra}`), '--add-dir reaches the interactive call');
assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'recap-args.json'), 'utf8')).includes(`--add-dir=${extra}`), '--add-dir reaches the recap call');
console.log('PASS EV-AGY-APPROVE interactive prompts answered (node yes, rm no, file in cwd/--add-dir yes, /etc/passwd no); every decision emits askaway_approval; --add-dir reaches interactive and recap');

// Explicit opt-in: no interactive mode, agy receives the original print args plus the skip flag.
const skip = spawnSync('python3', [path.join(__dirname, 'tools', 'agy-approve.py'), ...printArgs, '--dangerously-skip-permissions'], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
assert.equal(skip.status, 0, skip.stderr + skip.stdout);
const skipArgs = JSON.parse(fs.readFileSync(path.join(dir, 'skip-args.json'), 'utf8'));
assert.deepEqual(skipArgs, [...printArgs, '--dangerously-skip-permissions'], 'the original print args plus skip reach agy unchanged');
assert.ok(!skipArgs.includes('-i'));
assert.equal(JSON.parse(skip.stdout.trim().split('\n').at(-1)).result.response, 'skipped');
console.log('PASS EV-AGY-APPROVE --dangerously-skip-permissions is passed through in print mode, never interactive');

const decide = cmd => spawnSync('python3', ['-c', 'import runpy,sys; print(runpy.run_path(sys.argv[1], run_name="t")["allowed"](sys.argv[2]))', path.join(__dirname, 'tools', 'agy-approve.py'), cmd],
    { env: { ...process.env, ASKAWAY_AGY_ALLOW: 'node,npm,grep,git status' }, encoding: 'utf8' }).stdout.trim();
assert.equal(decide('grep -n "Usage banner\\|Turn trace" media/webview.js'), 'True', 'a pipe inside quotes is an argument');
assert.equal(decide("node -e 'a || b; c'"), 'True');
assert.equal(decide('git status && node x.js'), 'True');
assert.equal(decide('grep x f | rm -rf y'), 'False', 'every real segment must be allowed');
assert.equal(decide('git push'), 'False');
for (const body of [...bypass, 'node -e 1\rrm x', "echo $'\\'' ; echo PWNED ; #'", 'echo $"x" ; rm x']) assert.equal(decide(body), 'False', JSON.stringify(body));
console.log('PASS EV-AGY-APPROVE allow-list splits only on real shell operators, not quoted ones');

const host = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/workerHost.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
    .replace(/^.*require\(.*$/gm, line => line.includes('"os"') || line.includes('"path"') || line.includes('"fs"') ? line : ''), { exports: host, require, process });
assert.equal(host.agyCommand('/home/u', {}, () => false), 'agy');
assert.equal(host.agyCommand('/home/u', {}, p => p === '/home/u/.askaway/bin/agy-approve'), '/home/u/.askaway/bin/agy-approve');
assert.equal(host.agyCommand('/home/u', { ASKAWAY_AGY_COMMAND: '/x/agy' }, () => true), '/x/agy');
console.log('PASS EV-AGY-APPROVE host uses ~/.askaway/bin/agy-approve only while it exists; env override wins');
fs.rmSync(dir, { recursive: true, force: true });
