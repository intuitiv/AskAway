// EV-AITALK-HOOK-DELIVERY: a queued reviewer message reaches the main agent through any tool's PostToolUse hook, exactly once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'hook-delivery-home-'));
const workspace = path.join(home, 'workspace');
fs.mkdirSync(workspace);
function load(rel, requires) {
    const box = {};
    new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(box, id => requires[id] ?? require(id));
    return box;
}
const text = load('src/hooks/aitalkDeliveryText.ts', {});
const spool = load('src/hooks/aitalkSpool.ts', { './aitalkDeliveryText': text });
const script = path.join(home, 'timer.cjs');
fs.writeFileSync(script, load('src/hooks/subagentTimerScript.ts', {}).SUBAGENT_TIMER_INJECT_SCRIPT);
function fire(event, time, sid = 'main', tool = 'Bash', withCwd = true) {
    const out = cp.execFileSync(process.execPath, ['-e', `Date.now=()=>${time};require(${JSON.stringify(script)})`], {
        env: { ...process.env, HOME: home }, encoding: 'utf8', cwd: workspace,
        input: JSON.stringify({ hook_event_name: event, session_id: sid, ...(withCwd ? { cwd: workspace } : {}), tool_name: tool, tool_use_id: `${sid}-${time}` }),
    });
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
}
// A minimal room: one queued message for the main agent, delivery tracked like the real store.
const delivered = new Set();
const queue = [{ id: 'm1', from: 'Reviewer', text: 'please use the main branch' }];
const store = {
    agentId: () => 'agent',
    snapshot: () => ({ members: [{ id: 'agent', name: 'Bhaskar' }], messages: [] }),
    peekForTool: () => queue.filter(item => !delivered.has(item.id)),
    inReplyTo: () => undefined, nameOf: (_m, id) => id === 'agent' ? 'Bhaskar' : 'Reviewer',
    track: (_event, _recipient, ids) => ids.forEach(id => delivered.add(id)),
};
fire('UserPromptSubmit', 1000);
spool.syncAITalkSpool(workspace, store, home);
const dir = spool.aitalkSpoolDir(workspace, home);
assert.equal(fs.statSync(dir).mode & 0o777, 0o700, 'spool dir is private');
assert.equal(fs.statSync(path.join(dir, 'pending.json')).mode & 0o777, 0o600, 'spool file is private');
// A sub-agent session (bound to a running runSubagent) never claims the main agent's mail.
assert.equal(fire('PostToolUse', 2001, 'main-child'), '', 'a session that is not the main turn gets nothing');
const first = fire('PostToolUse', 3000);
assert.ok(first.includes(text.AITALK_QUEUE_LABEL), 'the shared label is delivered');
assert.ok(first.includes('You are Bhaskar, the main agent in the AITalk room; messages addressed @Bhaskar are for you.'), 'the agent is told its name');
assert.ok(first.includes('please use the main branch') && first.includes('"id":"m1"'), 'the message text and id are delivered');
assert.equal(fire('PostToolUse', 3100), '', 'a second tool call gets nothing');
// The extension sees the claim and marks the message delivered; it is never spooled again.
assert.ok(!delivered.has('m1'));
spool.syncAITalkSpool(workspace, store, home);
assert.ok(delivered.has('m1'), 'claim marks the message delivered');
spool.syncAITalkSpool(workspace, store, home);
assert.ok(!fs.existsSync(path.join(dir, 'pending.json')), 'nothing left to claim');
assert.equal(fire('PostToolUse', 3200), '', 'still nothing after the receipt');
assert.equal(fire('PostToolUse', 3300, 'unrelated'), '', 'unrelated sessions get nothing');
// A real sub-agent: runSubagent binds the child session; the child never claims, the main agent still does.
queue.push({ id: 'm2', from: 'Reviewer', text: 'second message for the parent' });
spool.syncAITalkSpool(workspace, store, home);
fire('PreToolUse', 4000, 'main', 'runSubagent');
assert.equal(fire('PostToolUse', 4001, 'kid'), '', 'a bound sub-agent session gets nothing');
assert.equal(fire('PostToolUse', 4002, 'kid'), '', 'and still nothing on its next call');
assert.ok(fs.existsSync(path.join(dir, 'pending.json')), 'the batch is untouched by the sub-agent');
assert.ok(fire('PostToolUse', 4003, 'main', 'runSubagent').includes('second message for the parent'), 'the main agent receives it');
spool.syncAITalkSpool(workspace, store, home);
// Crash after claiming: a claiming file older than 10 s goes back to pending and is delivered once.
queue.push({ id: 'm3', from: 'Reviewer', text: 'survives a hook crash' });
fs.writeFileSync(path.join(dir, 'claiming-999-1.json'), JSON.stringify({ ids: ['m3'], text: 'stale' }));
spool.syncAITalkSpool(workspace, store, home);
const afterCrash = fire('PostToolUse', 4100);
assert.ok(afterCrash.includes('survives a hook crash') || afterCrash.includes('stale'), 'a stale claim is delivered after the crash');
assert.equal(fire('PostToolUse', 4101), '', 'only once');
spool.syncAITalkSpool(workspace, store, home);
assert.ok(delivered.has('m3') && !fs.readdirSync(dir).some(name => name.startsWith('claim')), 'receipt settled, nothing left over');
// Double-delivery race: the hook is mid-print (claiming-*); the extension must not spool the same message again.
queue.push({ id: 'm4', from: 'Reviewer', text: 'race message' });
spool.syncAITalkSpool(workspace, store, home);
fs.renameSync(path.join(dir, 'pending.json'), path.join(dir, `claiming-4242-${Date.now()}.json`));
spool.syncAITalkSpool(workspace, store, home);
assert.ok(!fs.existsSync(path.join(dir, 'pending.json')), 'a message being printed is not spooled a second time');
const racing = fs.readdirSync(dir).find(name => name.startsWith('claiming-'));
fs.renameSync(path.join(dir, racing), path.join(dir, racing.replace('claiming-', 'claimed-')));
spool.syncAITalkSpool(workspace, store, home);
assert.ok(delivered.has('m4') && !fs.existsSync(path.join(dir, 'pending.json')), 'printed once, marked delivered, not spooled again');
// A hook payload with no cwd falls back to the hook's own working directory.
queue.push({ id: 'm5', from: 'Reviewer', text: 'no cwd payload' });
spool.syncAITalkSpool(workspace, store, home);
fire('UserPromptSubmit', 5000, 'nocwd', 'Bash', false);
assert.ok(fire('PostToolUse', 5001, 'nocwd', 'Bash', false).includes('no cwd payload'), 'delivered without a cwd in the payload');
// Status reminders thin out: after 5 posts in the turn the gap is 4 minutes, after 10 it is 6, never more than 8.
const progress = path.join(home, '.askaway', 'commentary', path.basename(dir) + '.progress.json');
fs.mkdirSync(path.dirname(progress), { recursive: true });
fire('UserPromptSubmit', 10000, 'esc');
for (const [posts, gap] of [[0, 2], [5, 4], [10, 6], [15, 8], [40, 8]]) {
    fs.writeFileSync(progress, JSON.stringify({ lastCommentaryAt: 20000, postAts: Array.from({ length: posts }, (_, i) => 11000 + i) }));
    const base = 20000 + gap * 60000;
    assert.equal(fire('PostToolUse', base - 1000 + posts, 'esc'), '', `no reminder before ${gap} minutes after ${posts} posts`);
    assert.ok(fire('PostToolUse', base + 1000 + posts, 'esc').includes(`Status update due (${gap}+ min`), `reminder at ${gap} minutes after ${posts} posts`);
}
fs.rmSync(home, { recursive: true, force: true });
console.log('PASS EV-AITALK-HOOK-DELIVERY');
