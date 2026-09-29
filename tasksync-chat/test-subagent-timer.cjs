// The sub-agent timer hook as Copilot runs it: one process per tool event. Run: node test-subagent-timer.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-timer-home-'));
const moduleText = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'hooks', 'subagentTimerScript.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsBox = {};
new Function('exports', moduleText)(exportsBox);
const script = path.join(home, 'subagent-timer.js');
fs.writeFileSync(script, exportsBox.SUBAGENT_TIMER_INJECT_SCRIPT);
const stateFile = path.join(home, '.askaway', 'subagent-inflight.json');

// Date.now is shifted per call so the test controls elapsed time without waiting.
function fire(event, tool, sid, offsetMs = 0, useId = '') {
    const out = childProcess.execFileSync(process.execPath, ['-e', `Date.now = ((n) => () => n + ${offsetMs})(Date.now()); require(${JSON.stringify(script)})`], {
        input: JSON.stringify({ hook_event_name: event, tool_name: tool, session_id: sid, tool_use_id: useId }), env: { ...process.env, HOME: home }, encoding: 'utf8',
    });
    return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
}
const MIN = 60_000;

// The parent spawns a child; the child is timed, the parent never is.
fire('PostToolUse', 'read_file', 'parent', 0);
fire('PreToolUse', 'runSubagent', 'parent', 0, 'use-1');
assert.equal(fire('PostToolUse', 'read_file', 'child', 1 * MIN), '');
assert.match(fire('PostToolUse', 'read_file', 'child', 3 * MIN), /^Elapsed 3m0\ds of your 4m sub-agent budget/);
assert.match(fire('PostToolUse', 'read_file', 'child', 5 * MIN), /^CACHE WINDOW EXPIRED \(5m0\ds/);
assert.equal(fire('PostToolUse', 'read_file', 'parent', 5 * MIN), '', 'the parent is never timed while its child runs');

// Another conversation (another window) that was active before the spawn is never bound to it.
fire('PostToolUse', 'read_file', 'other-window', -10 * MIN);
assert.equal(fire('PostToolUse', 'read_file', 'other-window', 5 * MIN), '', 'an earlier-seen session is not the child');

// The child ends: its binding is released, and a later long turn in the parent gets no banner.
assert.match(fire('PostToolUse', 'runSubagent', 'parent', 6 * MIN, 'use-1'), /That sub-agent ran 6m0\ds/);
assert.equal(fire('PostToolUse', 'read_file', 'parent', 45 * MIN), '');
assert.equal(fire('PostToolUse', 'read_file', 'child', 45 * MIN), '', 'no stale binding survives the child');
assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).bySession, {});

// A child whose end event was lost goes stale after 15 minutes and stops producing banners.
fire('PreToolUse', 'runSubagent', 'parent', 50 * MIN, 'use-2');
assert.match(fire('PostToolUse', 'read_file', 'child-2', 55 * MIN), /CACHE WINDOW EXPIRED/);
assert.equal(fire('PostToolUse', 'read_file', 'child-2', 70 * MIN), '', 'a lost end event cannot keep timing forever');

// The parent's cache clock started at its last model request, 90s before the spawn (a slow response):
// the child's budget counts from there, not from the spawn.
fire('PostToolUse', 'read_file', 'parent-3', 79 * MIN);
fs.writeFileSync(path.join(home, '.askaway', 'cache-clock.json'), JSON.stringify({ sessions: { 'parent-3': Date.now() + 80 * MIN - 90_000 } }));
fire('PreToolUse', 'runSubagent', 'parent-3', 80 * MIN, 'use-3');
assert.match(fire('PostToolUse', 'read_file', 'child-3', 82 * MIN), /^Elapsed 3m3\ds of your 4m sub-agent budget/);
assert.match(fire('PostToolUse', 'read_file', 'child-3', 82 * MIN + 40_000), /^CACHE WINDOW EXPIRED \(4m1\ds/);
assert.match(fire('PostToolUse', 'runSubagent', 'parent-3', 83 * MIN, 'use-3'), /That sub-agent ran 3m0\ds \(4m3\ds since your last model request\)/);

fs.rmSync(home, { recursive: true, force: true });
console.log('EV-TIMER SubagentTimer: PASS childTimed=true parentNeverTimed=true otherWindowIgnored=true bindingReleased=true staleExpires=true fromParentRequestStart=true');
