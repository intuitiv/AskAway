// EV-STATUS-NUDGE: execute the generated hook with isolated HOME and a controlled clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const build = path.join(__dirname, 'build');
fs.mkdirSync(build, { recursive: true });
const home = fs.mkdtempSync(path.join(build, 'status-home-'));
const workspace = path.join(home, 'workspace');
fs.mkdirSync(workspace);
const box = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/hooks/subagentTimerScript.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(box);
const script = path.join(home, 'timer.cjs');
fs.writeFileSync(script, box.SUBAGENT_TIMER_INJECT_SCRIPT);
function fire(event, time, sid = 'main', id = String(time), tool = 'read_file') {
    const out = cp.execFileSync(process.execPath, ['-e', `Date.now=()=>${time};require(${JSON.stringify(script)})`], {
        env: { ...process.env, HOME: home }, encoding: 'utf8',
        input: JSON.stringify({ hook_event_name: event, session_id: sid, cwd: workspace, tool_name: tool, tool_use_id: id }),
    });
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
}
const reminder = 'Status update due (2+ min since your last AITalk post): call the aitalk tool (action say) with one or two plain sentences: what you are doing now, what is done, and where you are blocked or what you are waiting for. This is a status line, not a report.';
fire('UserPromptSubmit', 1000);
assert.equal(fire('PostToolUse', 120000), '', 'no reminder at 119 seconds');
assert.equal(fire('PostToolUse', 122000), reminder, 'status reminder at 121 seconds');
assert.equal(fire('PostToolUse', 122001), '', 'next tool call does not repeat it');
assert.equal(fire('PostToolUse', 242000, 'main', '122000'), '', 'same tool result remains deduplicated after two minutes');
assert.equal(fire('PostToolUse', 242001), reminder, 'reminder again after another two minutes');
// Exercise the real commentary tool's progress-file write, not a fabricated reset.
const commentary = {};
new Function('require', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/commentary/commentary.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => id === 'os' ? { homedir: () => home } : require(id), commentary);
const host = {};
new Function('require', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/workerHost.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => id === 'os' ? { homedir: () => home } : id === '../commentary/commentary' ? commentary : id.startsWith('.') ? {} : require(id), host);
const now = Date.now;
try {
    Date.now = () => 300000;
    const tool = commentary.commentaryToolDefinitions(() => host.sharedCommentaryStore(), workspace)[0];
    assert.equal(tool.run({ kind: 'update', text: 'Checking the current changes before running the tests; no blockers so far.' }).status, 'POSTED');
} finally { Date.now = now; }
assert.equal(fire('PostToolUse', 419000), '', 'commentary resets the two-minute clock');
assert.equal(fire('PostToolUse', 420000), reminder, 'reminder resumes two minutes after commentary');
assert.equal(fire('PostToolUse', 600000, 'unrelated'), '', 'unrelated sessions are silent');
fire('PreToolUse', 600001, 'main', 'spawn', 'runSubagent');
fire('PostToolUse', 600002, 'child');
assert.ok(!fire('PostToolUse', 730000, 'child').includes('Status update due'), 'sub-agents never receive status reminders');
fire('Stop', 730001);
assert.equal(fire('PostToolUse', 900000), '', 'stopped main turn is silent');
assert.ok(JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).scripts['posttest:workers'].includes('node test-status-nudge.cjs'), 'registered in worker suite lifecycle');
console.log('PASS EV-STATUS-NUDGE');
