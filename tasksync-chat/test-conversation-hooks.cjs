// Spec-context injection and compact-chat capture hooks, run as real processes. Run: node test-conversation-hooks.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-hook-home-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-hook-ws-'));
const run = (script, input) => childProcess.execFileSync(process.execPath, [path.join(__dirname, 'hooks', script)], {
    input: JSON.stringify(input), env: { ...process.env, HOME: home }, encoding: 'utf8',
});

// --- Goal/Rules injection ---
fs.mkdirSync(path.join(workspace, '.specify'), { recursive: true });
fs.mkdirSync(path.join(workspace, 'specs', '001-demo'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/001-demo' }));
fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'Goal.md'), 'Ship the async worker runner.');
fs.writeFileSync(path.join(workspace, 'specs', '001-demo', 'Rules.md'), 'Root cause first.');

const first = JSON.parse(run('spec-context-inject.cjs', { session_id: 'conv-1', cwd: workspace }));
const context = first.hookSpecificOutput.additionalContext;
assert.equal(first.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
assert.match(context, /Ship the async worker runner\./);
assert.match(context, /Root cause first\./);
assert.match(context, /Active spec: 001-demo/);

assert.equal(run('spec-context-inject.cjs', { session_id: 'conv-1', cwd: workspace }), '', 'second prompt in same conversation injects nothing');
assert.match(run('spec-context-inject.cjs', { session_id: 'conv-2', cwd: workspace }), /Root cause first/, 'a new conversation gets it again');
const noSpec = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-hook-nospec-'));
assert.equal(run('spec-context-inject.cjs', { session_id: 'conv-3', cwd: noSpec }), '', 'no active spec, no injection');

// --- Every prompt marks a turn start, which the Commentary tab uses to fold the lines so far ---
const turnsFile = (cwd) => path.join(home, '.askaway', 'commentary', `${fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}.turns.json`);
const starts = JSON.parse(fs.readFileSync(turnsFile(workspace), 'utf8')).starts;
assert.equal(starts.length, 3, 'three prompts in this workspace, three turn starts (even when nothing is injected)');
assert.ok(starts.every((ts, i) => i === 0 || ts >= starts[i - 1]), 'in order');
assert.equal(JSON.parse(fs.readFileSync(turnsFile(noSpec), 'utf8')).starts.length, 1, 'per workspace');

// --- Compact chat capture ---
const transcript = path.join(workspace, 'transcript.jsonl');
const records = (answer) => [
    { type: 'session.start', id: 's0' },
    { type: 'user.message', id: 'u1', timestamp: 't1', data: { content: 'first question' } },
    { type: 'assistant.message', id: 'a1', data: { content: 'first answer' } },
    { type: 'user.message', id: 'u2', timestamp: 't2', data: { content: 'second question' } },
    { type: 'assistant.message', id: 'a2', data: { content: 'Checking the files now.', toolRequests: [{ name: 'read' }] } },
    { type: 'tool.execution_complete', id: 't', data: {} },
    'not json',
    { type: 'assistant.message', id: 'a3', data: { content: answer } },
];
const writeTranscript = (answer) => fs.writeFileSync(transcript,
    records(answer).map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'));

writeTranscript('final draft');
const stop = { session_id: 'conv-1', transcript_path: transcript, cwd: workspace };
assert.equal(run('compact-chat-capture.cjs', stop), '', 'capture emits no output');
writeTranscript('final answer');
run('compact-chat-capture.cjs', stop);

const chatDir = path.join(home, '.askaway', 'compact-chats');
const [workspaceDir] = fs.readdirSync(chatDir);
const rows = fs.readFileSync(path.join(chatDir, workspaceDir, 'conv-1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(rows.length, 1, 'a repeated Stop upserts the same turn');
assert.equal(rows[0].user, 'second question');
assert.equal(rows[0].assistant, 'final answer', 'keeps the FINAL assistant message, not intermediate narration');
assert.doesNotMatch(JSON.stringify(rows[0]), /Checking the files now|toolRequests/);

for (const dir of [home, workspace, noSpec]) { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('EV-HOOKS ConversationContext: PASS injectOnce=true reinjectNewConversation=true turnStartPerPrompt=true captureFinalOnly=true upsertPerTurn=true');
