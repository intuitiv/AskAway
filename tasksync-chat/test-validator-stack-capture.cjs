// EV-VALIDATOR-STACK-CAPTURE: the real UserPromptSubmit hook spools the reviewer's prompt; StackCapture drains it into one stack per session.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const bundle = file => { const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text; const m = { exports: {} }; new Function('require', 'module', 'exports', code)(require, m, m.exports); return m.exports; };
const { ConversationStacks } = bundle('src/validator/conversationStack.ts');
const { StackCapture, stackKey } = bundle('src/validator/stackCapture.ts');
process.umask(0);
const tmp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const hook = path.join(__dirname, 'hooks', 'spec-context-inject.cjs');
const run = (home, payload) => spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
const withGoal = (home, cwd) => {
    const key = cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    fs.mkdirSync(path.join(home, '.askaway', 'commentary'), { recursive: true });
    fs.writeFileSync(path.join(home, '.askaway', 'commentary', `${key}.json`), JSON.stringify({ goal: 'Ship it', items: [] }));
};
const spoolOf = home => { const dir = path.join(home, '.askaway', 'validator-spool'); try { return fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(n => path.join(dir, n)); } catch { return []; } };

// 1. the hook writes one 0600 spool event; a missing session id still writes
const home = tmp('stack-home-'); const workspace = tmp('stack-ws-');
withGoal(home, workspace);
const normal = run(home, { session_id: 's1', cwd: workspace, prompt: 'first question' });
assert.equal(normal.status, 0);
let files = spoolOf(home);
assert.equal(files.length, 1);
assert.equal(fs.statSync(files[0]).mode & 0o777, 0o600);
assert.equal(fs.statSync(path.dirname(files[0])).mode & 0o777, 0o700);
const event = JSON.parse(fs.readFileSync(files[0], 'utf8'));
assert.deepEqual({ kind: event.kind, sessionId: event.sessionId, cwd: event.cwd, text: event.text }, { kind: 'user', sessionId: 's1', cwd: workspace, text: 'first question' });
assert.equal(typeof event.at, 'number');
run(home, { cwd: workspace, prompt: 'no session' });
assert.equal(JSON.parse(fs.readFileSync(spoolOf(home).at(-1), 'utf8')).sessionId, '');

// 2. a secret-looking prompt writes nothing
const secretHome = tmp('stack-secret-'); withGoal(secretHome, workspace);
assert.equal(run(secretHome, { session_id: 's1', cwd: workspace, prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789AB please' }).status, 0);
assert.deepEqual(spoolOf(secretHome), []);

// 3. an unwritable spool changes neither stdout nor exit code
const blockedHome = tmp('stack-blocked-'); withGoal(blockedHome, workspace);
fs.writeFileSync(path.join(blockedHome, '.askaway', 'validator-spool'), 'a file, not a directory');
const blocked = run(blockedHome, { session_id: 's1', cwd: workspace, prompt: 'first question' });
assert.equal(blocked.status, normal.status);
assert.equal(blocked.stdout, normal.stdout);
assert.match(normal.stdout, /Ship it/);

// 4. drain: separate stacks per session, order kept, foreign workspace left then expired, malformed removed
const spoolDir = path.join(tmp('stack-drain-'), 'spool'); fs.mkdirSync(spoolDir);
const write = (name, value) => fs.writeFileSync(path.join(spoolDir, name), typeof value === 'string' ? value : JSON.stringify(value));
let clock = 1_000_000;
const other = tmp('stack-other-');
write('0001-a.json', { kind: 'user', sessionId: 'A', cwd: workspace, text: 'A first', at: clock });
write('0002-b.json', { kind: 'user', sessionId: 'B', cwd: path.join(workspace, 'sub'), text: 'B first', at: clock });
write('0003-a.json', { kind: 'user', sessionId: 'A', cwd: workspace, text: 'A second', at: clock });
write('0004-x.json', { kind: 'user', sessionId: 'X', cwd: other, text: 'elsewhere', at: clock });
write('0005-bad.json', '{"kind":"user","te');
const stacks = new ConversationStacks({ dir: path.join(spoolDir, '..', 'stacks') });
const capture = new StackCapture({ spoolDir, stacks, workspaceRoot: workspace, now: () => clock });
capture.drain();
assert.deepEqual(stacks.read(stackKey(workspace, 'A')).map(e => e.text), ['A first', 'A second']);
assert.deepEqual(stacks.read(stackKey(workspace, 'B')).map(e => e.text), ['B first']);
assert.deepEqual(stacks.read(stackKey(workspace, 'X')), []);
assert.deepEqual(fs.readdirSync(spoolDir), ['0004-x.json']);
clock += 11 * 60 * 1000;
capture.drain();
assert.deepEqual(fs.readdirSync(spoolDir), []);
capture.appendAgent({ sessionId: 'A', text: 'A reply', turnId: 't1', at: clock });
assert.deepEqual(stacks.read(stackKey(workspace, 'A')).map(e => e.role), ['user', 'user', 'agent']);
capture.stop();

// 5. an event with no session id is never captured: two unidentified prompts share no stack
{
    const spool = path.join(tmp('stack-nosession-'), 'spool'); fs.mkdirSync(spool);
    const dir = path.join(spool, '..', 'stacks');
    for (const n of ['1', '2']) fs.writeFileSync(path.join(spool, `000${n}-u.json`), JSON.stringify({ kind: 'user', sessionId: '', cwd: workspace, text: `unidentified ${n}`, at: Date.now() }));
    const seen = [];
    new StackCapture({ spoolDir: spool, stacks: new ConversationStacks({ dir }), workspaceRoot: workspace, onUser: i => seen.push(i) }).drain();
    assert.deepEqual(fs.readdirSync(spool), []);
    assert.equal(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, 0, 'no stack file is created for an empty session id');
    assert.deepEqual(seen, []);
}

// 6. two windows on one spool dir append each event exactly once (atomic claim by rename)
{
    const spool = path.join(tmp('stack-claim-'), 'spool'); fs.mkdirSync(spool);
    const dir = path.join(spool, '..', 'stacks');
    for (let n = 1; n <= 6; n++) fs.writeFileSync(path.join(spool, `000${n}-c.json`), JSON.stringify({ kind: 'user', sessionId: 'S', cwd: workspace, text: `claimed ${n}`, at: Date.now() }));
    const users = [];
    const real = new ConversationStacks({ dir });
    let other;
    // While window A holds its first claim, window B drains the same spool.
    const reentrant = { append: (key, entry) => { if (other) { const b = other; other = undefined; b.drain(); } return real.append(key, entry); }, read: k => real.read(k) };
    const a = new StackCapture({ spoolDir: spool, stacks: reentrant, workspaceRoot: workspace, onUser: i => users.push(['A', i.text]) });
    other = new StackCapture({ spoolDir: spool, stacks: real, workspaceRoot: workspace, onUser: i => users.push(['B', i.text]) });
    a.drain();
    const texts = real.read(stackKey(workspace, 'S')).map(e => e.text);
    assert.deepEqual([...texts].sort(), [1, 2, 3, 4, 5, 6].map(n => `claimed ${n}`), 'each event appended exactly once');
    assert.equal(users.length, 6);
    assert.deepEqual(fs.readdirSync(spool), []);
}

// 7. a replay after a crash never adds a second entry (the entry id is the spool file's stable name); a dead owner's claim is recovered
{
    const spool = path.join(tmp('stack-replay-'), 'spool'); fs.mkdirSync(spool);
    const stacks = new ConversationStacks({ dir: path.join(spool, '..', 'stacks') });
    const event = JSON.stringify({ kind: 'user', sessionId: 'S', cwd: workspace, text: 'crashy', at: Date.now() });
    stacks.append(stackKey(workspace, 'S'), { role: 'user', text: 'crashy', turnId: '0001-r', at: 1, id: '0001-r' });
    fs.writeFileSync(path.join(spool, '0001-r.json.claimed-2147483646'), event);
    new StackCapture({ spoolDir: spool, stacks, workspaceRoot: workspace }).drain();
    assert.deepEqual(stacks.read(stackKey(workspace, 'S')).map(e => e.text), ['crashy']);
    assert.deepEqual(fs.readdirSync(spool), []);
    // an old claim of a dead owner is removed
    fs.writeFileSync(path.join(spool, '0002-r.json.claimed-2147483646'), event);
    new StackCapture({ spoolDir: spool, stacks, workspaceRoot: workspace, now: () => Date.now() + 11 * 60 * 1000 }).drain();
    assert.deepEqual(fs.readdirSync(spool), []);
    assert.deepEqual(stacks.read(stackKey(workspace, 'S')).map(e => e.text), ['crashy']);
}

// 8. an event that fails to append stays for retry for 10 minutes, then is deleted; stale temp files are deleted
{
    const spool = path.join(tmp('stack-retry-'), 'spool'); fs.mkdirSync(spool);
    const at = Date.now();
    fs.writeFileSync(path.join(spool, '0001-f.json'), JSON.stringify({ kind: 'user', sessionId: 'S', cwd: workspace, text: 'will fail', at }));
    fs.writeFileSync(path.join(spool, '.0002-t.json.tmp'), '{');
    let fail = true; const real = new ConversationStacks({ dir: path.join(spool, '..', 'stacks') });
    const stacks = { append: (k, e) => { if (fail) throw new Error('disk full'); return real.append(k, e); }, read: k => real.read(k) };
    new StackCapture({ spoolDir: spool, stacks, workspaceRoot: workspace, now: () => at + 1000 }).drain();
    assert.deepEqual(fs.readdirSync(spool).sort(), ['.0002-t.json.tmp', '0001-f.json'], 'a failed append stays for retry; a fresh temp file is left alone');
    fail = false;
    new StackCapture({ spoolDir: spool, stacks, workspaceRoot: workspace, now: () => at + 2000 }).drain();
    assert.deepEqual(real.read(stackKey(workspace, 'S')).map(e => e.text), ['will fail'], 'the retry succeeds');
    fail = true;
    fs.writeFileSync(path.join(spool, '0003-f.json'), JSON.stringify({ kind: 'user', sessionId: 'S', cwd: workspace, text: 'never', at }));
    new StackCapture({ spoolDir: spool, stacks, workspaceRoot: workspace, now: () => at + 11 * 60 * 1000 }).drain();
    assert.deepEqual(fs.readdirSync(spool), [], 'after 10 minutes the failing event and the stale temp file are deleted');
}

// 9. the hook removes its own temp file when the rename fails
{
    const h = tmp('stack-renamefail-'); withGoal(h, workspace);
    const patch = path.join(h, 'patch.cjs');
    fs.writeFileSync(patch, "const fs = require('fs'); const rename = fs.renameSync; fs.renameSync = (a, b) => { if (String(b).includes('validator-spool')) throw new Error('rename failed'); return rename(a, b); };");
    const result = spawnSync(process.execPath, ['-r', patch, hook], { input: JSON.stringify({ session_id: 's1', cwd: workspace, prompt: 'hello' }), env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Ship it/);
    assert.deepEqual(fs.readdirSync(path.join(h, '.askaway', 'validator-spool')), [], 'no temp file is left behind');
}
console.log('PASS EV-VALIDATOR-STACK-CAPTURE');
