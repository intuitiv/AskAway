// EV-VALIDATOR-STACK: one conversation stack per key, secrets dropped, capped, delta/full input, tolerant of garbage and two windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/conversationStack.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
const { ConversationStacks } = mod.exports;
process.umask(0);
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'validator-stack-'));
const add = (stacks, key, n) => { stacks.append(key, { role: 'user', text: `question ${n}`, turnId: `t${n}`, at: n }); stacks.append(key, { role: 'agent', text: `answer ${n}`, turnId: `t${n}`, at: n }); };

// 1. stacks never mix; file names never hold the key
{
    const dir = fresh(); const stacks = new ConversationStacks({ dir });
    stacks.append('conversation-alpha', { role: 'user', text: 'alpha one', turnId: 'a1', at: 1 });
    stacks.append('conversation-beta', { role: 'user', text: 'beta one', turnId: 'b1', at: 2 });
    stacks.append('conversation-alpha', { role: 'agent', text: 'alpha two', turnId: 'a1', at: 3 });
    assert.deepEqual(stacks.read('conversation-alpha').map(e => e.text), ['alpha one', 'alpha two']);
    assert.deepEqual(stacks.read('conversation-beta').map(e => e.text), ['beta one']);
    assert.deepEqual(stacks.read('conversation-gamma'), []);
    for (const file of fs.readdirSync(dir)) assert.ok(!/alpha|beta/.test(file), file);
    assert.ok(fs.readdirSync(dir).length >= 2);
}
// 2. a secret-looking text is dropped
{
    const stacks = new ConversationStacks({ dir: fresh() });
    stacks.append('k', { role: 'user', text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB', turnId: 't1', at: 1 });
    stacks.append('k', { role: 'user', text: 'plain', turnId: 't2', at: 2 });
    assert.deepEqual(stacks.read('k').map(e => e.text), ['plain']);
}
// 3. disk cap of 200 pairs keeps the newest
{
    const stacks = new ConversationStacks({ dir: fresh() });
    for (let n = 1; n <= 260; n++) add(stacks, 'k', n);
    const entries = stacks.read('k');
    assert.equal(entries.length, 400);
    assert.equal(entries[0].text, 'question 61');
    assert.equal(entries.at(-1).text, 'answer 260');
}
// 4. delta then nothing; full returns the last 50 pairs in order
{
    const stacks = new ConversationStacks({ dir: fresh() });
    add(stacks, 'k', 1);
    assert.match(stacks.buildInput('k', { sessionContinues: true }), /Reviewer: question 1[\s\S]*Agent: answer 1/);
    assert.match(stacks.buildInput('k', { sessionContinues: true }), /question 1/, 'building the input never advances the cursor');
    stacks.markDelivered('k', stacks.lastEntryId('k'));
    assert.equal(stacks.buildInput('k', { sessionContinues: true }), '');
    add(stacks, 'k', 2);
    const delta = stacks.buildInput('k', { sessionContinues: true });
    assert.match(delta, /question 2/); assert.doesNotMatch(delta, /question 1/);
    for (let n = 3; n <= 70; n++) add(stacks, 'k', n);
    const full = stacks.buildInput('k', { sessionContinues: false });
    assert.doesNotMatch(full, /question 20\b/);
    assert.match(full, /question 21\b/);
    assert.ok(full.indexOf('question 21') < full.indexOf('answer 21') && full.indexOf('answer 21') < full.indexOf('question 22'));
    assert.match(full, /\[21\] Reviewer: question 21/);
    assert.equal((full.match(/Reviewer:/g) || []).length, 50);
    stacks.markDelivered('k', stacks.lastEntryId('k'));
    assert.equal(stacks.buildInput('k', { sessionContinues: true }), '');
}
// 5. garbage lines are skipped
{
    const dir = fresh(); const stacks = new ConversationStacks({ dir });
    add(stacks, 'k', 1);
    const file = fs.readdirSync(dir).find(f => f.endsWith('.jsonl'));
    fs.appendFileSync(path.join(dir, file), '{"role":"user","te\nnot json\n');
    add(stacks, 'k', 2);
    assert.deepEqual(stacks.read('k').map(e => e.text), ['question 1', 'answer 1', 'question 2', 'answer 2']);
}
// 6. two instances on one dir lose nothing
{
    const dir = fresh(); const a = new ConversationStacks({ dir }); const b = new ConversationStacks({ dir });
    for (let n = 1; n <= 20; n++) { add(a, 'k', n); add(b, 'k', 100 + n); }
    assert.equal(a.read('k').length, 80);
    assert.equal(b.read('k').length, 80);
}
// 7. a truncated last line without a newline does not swallow the next entry
{
    const dir = fresh(); const stacks = new ConversationStacks({ dir });
    add(stacks, 'k', 1);
    const file = fs.readdirSync(dir).find(f => f.endsWith('.jsonl'));
    fs.appendFileSync(path.join(dir, file), '{"role":"user","te');
    add(stacks, 'k', 2);
    assert.deepEqual(stacks.read('k').map(e => e.text), ['question 1', 'answer 1', 'question 2', 'answer 2']);
}
// 8. the delivered cursor is bound to the session it was acknowledged for
{
    const stacks = new ConversationStacks({ dir: fresh() });
    add(stacks, 'k', 1);
    stacks.markDelivered('k', stacks.lastEntryId('k'), 'session-A');
    add(stacks, 'k', 2);
    const same = stacks.buildInput('k', { sessionContinues: true, session: 'session-A' });
    assert.match(same, /question 2/); assert.doesNotMatch(same, /question 1/);
    const other = stacks.buildInput('k', { sessionContinues: true, session: 'session-B' });
    assert.match(other, /question 1/, 'another session never gets a delta cursor it did not receive');
    assert.equal(stacks.lastEntryId('missing'), undefined);
}
// 9. a stable entry id is stored once; a replay adds nothing
{
    const stacks = new ConversationStacks({ dir: fresh() });
    stacks.append('k', { role: 'user', text: 'once', turnId: 't', at: 1, id: 'event-1' });
    stacks.append('k', { role: 'user', text: 'once', turnId: 't', at: 1, id: 'event-1' });
    assert.deepEqual(stacks.read('k').map(e => [e.id, e.text]), [['event-1', 'once']]);
}
// 10. permissions: directory 0700, stack, cursor and temp files 0600, also for files that already existed with wider modes
{
    const dir = fresh(); fs.chmodSync(dir, 0o755);
    const stacks = new ConversationStacks({ dir: path.join(dir, 'stacks') });
    add(stacks, 'k', 1); stacks.markDelivered('k', stacks.lastEntryId('k'));
    const mode = file => fs.statSync(file).mode & 0o777;
    assert.equal(mode(path.join(dir, 'stacks')), 0o700);
    for (const file of fs.readdirSync(path.join(dir, 'stacks'))) assert.equal(mode(path.join(dir, 'stacks', file)), 0o600, file);
    const wide = fresh(); const old = new ConversationStacks({ dir: wide }); fs.chmodSync(wide, 0o755);
    const file = path.join(wide, require('node:crypto').createHash('sha256').update('k').digest('hex') + '.jsonl');
    fs.writeFileSync(file, '', { mode: 0o644 }); fs.chmodSync(file, 0o644);
    add(old, 'k', 1);
    assert.equal(mode(wide), 0o700); assert.equal(mode(file), 0o600);
    for (let n = 2; n <= 260; n++) add(old, 'k', n);
    for (const name of fs.readdirSync(wide)) assert.equal(mode(path.join(wide, name)), 0o600, name);
}
console.log('PASS EV-VALIDATOR-STACK');
