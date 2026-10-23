// EV-MAIN-PROGRESS-CADENCE (reviewer, 2026-10-22): the PostToolUse status reminder fires at 120 s, is not cleared by being shown,
// repeats until a main-agent AITalk say or post succeeds, and then resets; say and post advance the same per-workspace clock.
// Drives the real hook script (a process with a fake Date.now) and the real aitalk tool (fake AITalk room, fake store clock).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');

const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'cadence-home-'));
const workspace = path.join(home, 'workspace');
fs.mkdirSync(workspace);
const load = (file, req, exportsBox) => new Function('require', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'),
	{ compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(req, exportsBox);

const hookBox = {};
load('src/hooks/subagentTimerScript.ts', require, hookBox);
const script = path.join(home, 'timer.cjs');
fs.writeFileSync(script, hookBox.SUBAGENT_TIMER_INJECT_SCRIPT);
let toolUse = 0;
const fire = (event, time) => cp.execFileSync(process.execPath, ['-e', `Date.now=()=>${time};require(${JSON.stringify(script)})`], {
	env: { ...process.env, HOME: home }, encoding: 'utf8',
	input: JSON.stringify({ hook_event_name: event, session_id: 'main', cwd: workspace, tool_name: 'read_file', tool_use_id: `u${++toolUse}` }),
});
const due = (time) => /Status update due/.test(fire('PostToolUse', time));

const commentary = {};
load('src/commentary/commentary.ts', (id) => (id === 'os' ? { homedir: () => home } : require(id)), commentary);
let clock = 0;
const store = new commentary.CommentaryStore({ dir: path.join(home, '.askaway', 'commentary'), now: () => clock });
let talkResult = { id: 'm1' };
commentary.setCommentaryAITalkMirror(() => talkResult);
const tool = commentary.commentaryToolDefinitions(() => store, workspace)[0];
const say = (kind = 'update') => tool.run({ action: 'say', kind, text: 'Running the tests now; the build passed and nothing is blocked.' });
const post = () => tool.run({ kind: 'update', text: 'Running the tests now; the build passed and nothing is blocked.' });

fire('UserPromptSubmit', 1000);
assert.equal(due(120000), false, 'no reminder before two minutes');
assert.equal(due(121000), true, 'reminder at 120 s');
assert.equal(due(122000), true, 'an unanswered reminder is not cleared by being shown: it repeats on the next tool result');
assert.equal(due(200000), true, 'and keeps repeating');

// A refused say does not reset the clock.
clock = 210000; talkResult = { status: 'REJECTED', reason: 'no' };
assert.equal(say().status, 'REJECTED');
assert.equal(due(211000), true, 'a refused post leaves the reminder due');

// A successful say advances the clock exactly like a post.
clock = 220000; talkResult = { id: 'm2' };
assert.equal(say().id, 'm2');
assert.equal(due(339999), false, 'a say resets the clock');
assert.equal(due(340000), true, 'reminder again two minutes after the say');
clock = 345000;
assert.equal(post().status, 'POSTED');
assert.equal(due(464999), false, 'a feed post resets the same clock');
assert.equal(due(465000), true);
clock = 470000; talkResult = { id: 'm3' };
assert.equal(say('heads-up').id, 'm3');
assert.equal(due(589999), false, 'any successful say kind advances the clock');

const pkg = fs.readFileSync(path.join(__dirname, 'src', 'agents', 'askawayBuildAgent.ts'), 'utf8');
assert.ok(/about every two minutes for as long as the turn runs, with no cap/.test(pkg) && /its own aitalk call/.test(pkg) && /any decision you took/.test(pkg), 'the Build agent instructions state the cadence, with decisions and no cap');
const timerSrc = fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'subagentTimerScript.ts'), 'utf8');
assert.ok(/any decision you took/.test(timerSrc), 'the reminder asks for decisions as well');
assert.ok(/additionalContext: text, hookSpecificOutput/.test(timerSrc), 'the reminder is emitted in both hook output shapes (VS Code chat and the Copilot harness)');
assert.ok(/10-20 plain words/.test(pkg), 'the word rule is unchanged');
console.log('PASS EV-MAIN-PROGRESS-CADENCE');
