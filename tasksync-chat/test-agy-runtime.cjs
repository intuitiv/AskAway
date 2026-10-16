// EV-WORKER-AGY: agy is an alternate worker runtime any profile selects (`runtime: 'agy'` + an agy model). Driven through the
// one `worker` tool against a fake agy CLI (real stream-json shapes: tool_name/tool_info, call_mcp_tool, step usage + summed
// result usage, denied_actions) on the real default spawner: start/status/wait/logs/list, submit and resume in the same
// conversation, cancel, error, cwd, raw token usage counted once, cost unreported (never $0), permission denial is an
// actionable FAILED (no auto-resume loop), explicit per-run permission opt-in, profile instructions, reload without the
// OpenCode server, no duplicate resume while the old process lives, Workers-tab projection. OpenCode stays the default.
// Run: node test-agy-runtime.cjs   (add --live for one real gemini-4-argon-medium worker through this runtime)
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
let buildDir = path.join(__dirname, '.agy-runtime-test-build');
try { fs.rmSync(buildDir, { recursive: true, force: true }); fs.mkdirSync(buildDir); }
catch { buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-runtime-test-build-')); }
for (const name of ['agyRuntime', 'workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { parseWorkerProfile } = require(path.join(buildDir, 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workerTools.js'));
const { projectWorkersState, loadWorkerTrace } = require(path.join(buildDir, 'workersState.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-agy-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'ws-')));
const callsFile = path.join(tmp, 'calls.jsonl');
// The fake agy: records argv + cwd, then streams agy's real stream-json shapes. The prompt picks the scenario.
const fakeAgy = path.join(tmp, 'agy');
fs.writeFileSync(fakeAgy, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\\n');
const prompt = (args.find((a) => a.startsWith('--print=')) || '').slice(8);
const resumed = (args.find((a) => a.startsWith('--conversation=')) || '').slice(15);
const skip = args.includes('--dangerously-skip-permissions');
const conv = resumed || 'conv-1';
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
const step = (s) => out({ event: 'step_update', step_update: { conversation_id: conv, ...s } });
out({ event: 'init', conversation_id: conv, init: { model: 'x', cwd: process.cwd(), permission_mode: 'request-review' } });
if (/SLEEP/.test(prompt)) { setInterval(() => {}, 1000); return; }
if (/BREAK/.test(prompt) && !resumed) { out({ event: 'result', result: { conversation_id: conv, status: 'ERROR', error: { message: 'quota exhausted' } } }); process.exit(1); }
step({ step_index: 0, state: 'DONE', step_type: 'user_input' });
step({ step_index: 1, state: 'DONE', step_type: 'agent_response', usage: { input_tokens: 15000, output_tokens: 40, thinking_tokens: 12, cache_read_tokens: 0, total_tokens: 15040 } });
if (/DENY/.test(prompt) && !skip) {
    step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'rtk npm test' } } });
    step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'rtk npm test' } } });
    out({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: '', usage: { input_tokens: 15000, output_tokens: 40, thinking_tokens: 12, cache_read_tokens: 0, total_tokens: 15040 }, denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } });
    process.stderr.write('jetski: no output produced — a tool required the "command" permission\\n');
    process.exit(0);
}
const mcp = { name: 'call_mcp_tool', parameters: { ServerName: 'askaway', ToolName: 'askaway_memory', Arguments: { action: 'search', query: 'agy' } } };
if (/MCPDENY/.test(prompt)) {
    // Live agy: even with --dangerously-skip-permissions a headless MCP call is denied.
    step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: mcp });
    step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: mcp });
    out({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: '', denied_actions: [{ action: 'mcp', display_name: 'CallMcpTool' }] } });
    process.exit(0);
}
step({ step_index: 2, state: 'DONE', step_type: 'system_message' });
step({ step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: mcp });
step({ step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool', duration_seconds: 0.5, tool_info: { ...mcp, output: '3 results' } });
step({ step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Result: PASS\\n' });
// cache_read > input with total = input + output: agy input excludes the cache; result.usage is the step sum.
step({ step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: 'Evidence: ok\\nKnowledge: knows the fixture',
    usage: { input_tokens: 2910, output_tokens: 6, thinking_tokens: 0, cache_read_tokens: 13130, total_tokens: 2916 } });
out({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response: 'Result: PASS\\nEvidence: ok\\nKnowledge: knows the fixture' + (resumed ? ' (resumed)' : ''),
    usage: { input_tokens: 17910, output_tokens: 46, thinking_tokens: 12, cache_read_tokens: 13130, total_tokens: 17956 } } });
`);
fs.chmodSync(fakeAgy, 0o755);

const profile = parseWorkerProfile('---\nname: build\ndescription: "b"\ntier: mid\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: allow\nbash: allow\nmcp: [askaway_askaway_memory]\n---\nBUILD-PROFILE-BODY.\n');
const readOnly = parseWorkerProfile('---\nname: explore\ndescription: "e"\ntier: light\nmodel: github-copilot/gpt-5.6-luna\nthinking: medium\nmodels: [github-copilot/gpt-5.6-luna]\nthinkingOptions: [medium]\nedit: deny\nmcp: [askaway_askaway_memory]\n---\nExplore.\n');
const ledgerDir = path.join(tmp, 'ledger');
const runtime = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir, agyCommand: fakeAgy });
const toolOf = (rt) => {
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => rt, workspace);
    return async (action, args) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
};
const call = toolOf(runtime);
const packet = { profile: 'build', runtime: 'agy', model: 'gemini-4-argon-medium', dispatchTurnId: 'turn-1', baseRevision: 'abc',
    objective: 'Write the fixture', allowedFiles: ['fixture.txt'], acceptance: 'a', expected: 'e', command: 'true' };
const calls = () => fs.readFileSync(callsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const prompt = (c) => (c.args.find((a) => a.startsWith('--print=')) || '').slice(8);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

(async () => {
    // start: the profile's own model list has no agy model, yet the profile runs Argon through agy.
    const started = await call('start', packet);
    assert.equal(started.model, 'agy/gemini-4-argon-medium', JSON.stringify(started));
    const done = await call('wait', { runId: started.runId, timeoutSeconds: 20 });
    assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
    assert.ok(done.evidence.includes('Result: PASS'));

    const first = calls()[0];
    assert.equal(first.cwd, workspace, 'agy runs in the authorized workspace');
    assert.ok(first.args.includes('--model=gemini-4-argon-medium') && first.args.includes('--output-format=stream-json'));
    assert.ok(first.args.includes(`--add-dir=${workspace}`), 'the first call gives agy the run directory: ' + JSON.stringify(first.args));
    assert.ok(!first.args.includes('--dangerously-skip-permissions'), 'review mode is the default: no hidden permission bypass');
    assert.ok(!first.args.some((a) => a.startsWith('--effort')), 'a model named with its effort keeps it');
    assert.match(prompt(first), /BUILD-PROFILE-BODY[\s\S]*Worker basics[\s\S]*Objective: Write the fixture/, 'a fresh agy conversation gets the profile instructions');

    const status = await call('status', { runId: started.runId });
    assert.equal(status.sessionId, 'conv-1');
    assert.equal(status.costStatus, 'unreported', 'agy cost is unknown, never an invented actual 0');
    // Raw counts, per request, once: result.usage (the step sum) is not added again.
    assert.deepEqual({ ...status.usage }, { input: 17910, output: 46, reasoning: 12, cacheRead: 13130, cacheWrite: 0, cost: 0, steps: 2 });
    assert.equal(status.lastPromptTokens, 2910 + 13130);
    assert.equal(status.knowledge, 'knows the fixture');

    const logs = await call('logs', { runId: started.runId });
    const types = logs.map((fact) => fact.type);
    for (const type of ['start', 'before_tool', 'after_tool', 'checkpoint', 'message_update', 'stop']) { assert.ok(types.includes(type), `${type} in ${types}`); }
    assert.equal(logs.find((fact) => fact.type === 'after_tool').tool, 'askaway_askaway_memory', 'an MCP call is named by server and tool');
    assert.ok(!logs.some((fact) => fact.tool === 'system_message'), 'only agy tool steps are tools');
    assert.equal(logs.find((fact) => fact.type === 'checkpoint').costStatus, 'unreported');
    const spend = runtime.usageSince(workspace, 0);
    assert.equal(spend.unreportedCostRequests, 2, 'turn totals say how many requests have no billed cost');

    const listed = await call('list', {});
    const worker = listed.find((w) => w.workerId === started.workerId);
    assert.equal(worker.cost, 'unreported');
    assert.equal(worker.sessionOpenAction, '', 'no OpenCode viewer is claimed for an agy conversation');
    assert.deepEqual(runtime.keepWarmWorkers(workspace), [], 'agy workers are never pinged through OpenCode');
    const row = projectWorkersState(runtime, workspace).workers.find((w) => w.workerId === started.workerId);
    assert.equal(row.adapter, 'agy');
    assert.equal(row.cacheExpiresAt, 0, 'agy worker carries no prompt-cache TTL');
    assert.equal(row.lastPingAt, 0, 'agy worker carries no keep-warm ping timestamp');
    assert.equal(row.banner.dollars, null, 'the Workers card shows cost unreported, not $0');
    let fetched = false;
    const trace = await loadWorkerTrace(runtime, workspace, started.workerId, async () => { fetched = true; return []; });
    assert.equal(fetched, false, 'an agy trace never asks the OpenCode server');
    assert.equal(trace.source, 'ledger');
    assert.match(trace.reason, /agy conversation/);
    assert.ok(Object.values(trace.runs).flat().some((event) => event.tool === 'askaway_askaway_memory'));

    // submit continues the same agy conversation, without re-sending the profile instructions.
    const submitted = await call('submit', { ...packet, workerId: started.workerId, objective: 'Read the fixture' });
    assert.equal((await call('wait', { runId: submitted.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    assert.ok(calls()[1].args.includes('--conversation=conv-1'), JSON.stringify(calls()[1].args));
    assert.ok(calls()[1].args.includes(`--add-dir=${workspace}`), 'a resumed call still passes --add-dir');
    assert.doesNotMatch(prompt(calls()[1]), /BUILD-PROFILE-BODY/);

    // error: a failed agy turn is FAILED with its reason; resume continues the same conversation and completes.
    const broken = await call('start', { ...packet, model: 'gemini-4-argon-low', objective: 'BREAK once' });
    const failed = await call('wait', { runId: broken.runId, timeoutSeconds: 20 });
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.reason, /quota exhausted/);
    assert.equal((await call('resume', { runId: broken.runId })).state, 'STARTING');
    const after = await call('wait', { runId: broken.runId, timeoutSeconds: 20 });
    assert.equal(after.status, 'COMPLETED', JSON.stringify(after));
    assert.ok(calls().at(-1).args.includes('--conversation=conv-1'));

    // EV-AGY-CONTINUE: behind askaway.workers.agyVerifyLoop (default true), a soft-denied command no longer fails the run;
    // the runtime resumes the same conversation once with the file-tools instruction and then runs the packet check.
    const before = calls().length;
    const denied = await call('start', { ...packet, model: 'gemini-4-argon-high', objective: 'DENY a shell command' });
    const deniedDone = await call('wait', { runId: denied.runId, timeoutSeconds: 20 });
    assert.equal(deniedDone.status, 'COMPLETED', JSON.stringify(deniedDone));
    assert.equal(calls().length, before + 2, 'soft-denied command resumes the same conversation once');
    assert.ok(calls()[before + 1].args.includes('--conversation=conv-1'));
    assert.equal(prompt(calls()[before + 1]), 'Terminal commands are blocked for you by company policy. Continue with file tools only. The supervisor runs `true` after you finish and sends you the output.');
    const deniedLogs = await call('logs', { runId: denied.runId });
    assert.ok(deniedLogs.some((fact) => fact.type === 'approval'));
    assert.equal(deniedLogs.filter((fact) => fact.type === 'denied_continue').length, 1);
    console.log('PASS EV-AGY-CONTINUE denied->resumedOnceWithFileToolsMessage->COMPLETED');

    // Explicit per-run opt-in: only agy, only a profile that allows edits and shell; visible on the run.
    assert.equal((await call('start', { ...packet, profile: 'explore', agyPermissions: 'skip' })).status, 'INELIGIBLE');
    assert.equal((await call('start', { ...packet, runtime: undefined, model: undefined, agyPermissions: 'skip' })).status, 'INELIGIBLE');
    const skipped = await call('start', { ...packet, model: 'gemini-flash', objective: 'DENY unless skipped', agyPermissions: 'skip' });
    assert.equal(skipped.agyPermissions, 'skip');
    assert.equal((await call('wait', { runId: skipped.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    assert.ok(calls().at(-1).args.includes('--dangerously-skip-permissions'));
    assert.ok(calls().at(-1).args.includes('--effort=medium'), 'a model without an effort suffix gets the profile thinking');
    assert.ok(runtime.logs(skipped.runId).some((fact) => fact.type === 'start' && /agyPermissions: skip/.test(fact.reason ?? '')));
    // An MCP denial survives the opt-in: the reason names the settings rule and never suggests skipping again.
    const mcpDenied = await call('start', { ...packet, model: 'gemini-flash-lite', objective: 'MCPDENY read memory', agyPermissions: 'skip' });
    const mcpDone = await call('wait', { runId: mcpDenied.runId, timeoutSeconds: 20 });
    assert.equal(mcpDone.status, 'FAILED');
    assert.match(mcpDone.reason, /agy auto-denied mcp[\s\S]*mcp\(<server>\); skipping permissions does not grant MCP/);
    assert.doesNotMatch(mcpDone.reason, /re-dispatch with agyPermissions/);

    // cancel: a running agy process is stopped.
    const slow = await call('start', { ...packet, model: 'gemini-pro', objective: 'SLEEP forever' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal((await call('cancel', { runId: slow.runId })).status, 'CANCELLATION_REQUESTED');
    assert.equal((await call('wait', { runId: slow.runId, timeoutSeconds: 20 })).status, 'CANCELLED');

    // Reload: a new host rehydrates agy workers without any OpenCode server, and resume never runs a conversation twice.
    const hanging = await call('start', { ...packet, model: 'gemini-4-argon-medium-x', objective: 'SLEEP until reload' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const oldPid = calls().at(-1).pid;
    const reloaded = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir, agyCommand: fakeAgy });
    const restored = reloaded.rehydrate(workspace, false);
    assert.ok(restored.reconnected.includes(started.workerId), JSON.stringify(restored));
    assert.ok(!restored.orphaned.some((o) => o.workerId === started.workerId), 'no OpenCode server needed for agy');
    const reloadedCall = toolOf(reloaded);
    const twice = await reloadedCall('resume', { runId: hanging.runId });
    assert.equal(twice.status, 'FRESH_SUBMISSION_REQUIRED');
    assert.match(twice.reason, new RegExp(`agy process ${oldPid} .*still running`));
    const spawnsBefore = calls().length;
    runtime.cancel(hanging.runId);
    for (let i = 0; i < 50 && alive(oldPid); i++) { await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(calls().length, spawnsBefore, 'no second process while the first one lived');
    const recovered = await reloadedCall('resume', { runId: hanging.runId });
    assert.equal(recovered.state, 'STARTING', JSON.stringify(recovered));
    for (let i = 0; i < 50 && calls().length === spawnsBefore; i++) { await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(calls().length, spawnsBefore + 1, 'exactly one recovery process');
    assert.ok(calls().at(-1).args.includes('--conversation=conv-1'), 'recovery resumes the same conversation');
    assert.ok(!calls().at(-1).args.includes('--dangerously-skip-permissions'));
    await reloadedCall('cancel', { runId: hanging.runId });
    await reloadedCall('wait', { runId: hanging.runId, timeoutSeconds: 20 });

    // EV-AGY-RESUME-GUARD: a conversation whose start fact has no addDir (older ledger rows) was created without a workspace;
    // the next submit starts a fresh conversation instead of resuming it.
    const guardLedger = path.join(tmp, 'ledger-guard');
    const guardRuntime = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: guardLedger, agyCommand: fakeAgy });
    const guardCall = toolOf(guardRuntime);
    const guardStart = await guardCall('start', { ...packet, model: 'gemini-4-argon-low', objective: 'Legacy conversation' });
    assert.equal((await guardCall('wait', { runId: guardStart.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    for (const file of fs.readdirSync(guardLedger)) {
        const rows = fs.readFileSync(path.join(guardLedger, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        fs.writeFileSync(path.join(guardLedger, file), rows.map((row) => { delete row.addDir; return JSON.stringify(row); }).join('\n') + '\n');
    }
    const guardReloaded = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: guardLedger, agyCommand: fakeAgy });
    guardReloaded.rehydrate(workspace, false);
    const guardReloadedCall = toolOf(guardReloaded);
    const beforeGuard = calls().length;
    const guardSubmit = await guardReloadedCall('submit', { ...packet, workerId: guardStart.workerId, model: 'gemini-4-argon-low', objective: 'Continue the legacy work' });
    assert.equal((await guardReloadedCall('wait', { runId: guardSubmit.runId, timeoutSeconds: 20 })).status, 'COMPLETED', JSON.stringify(guardSubmit));
    const guardCalls = calls().slice(beforeGuard);
    assert.ok(!guardCalls[0].args.some((a) => a.startsWith('--conversation=')), 'a legacy conversation is not resumed: ' + JSON.stringify(guardCalls[0].args));
    assert.ok(guardCalls[0].args.includes(`--add-dir=${workspace}`));
    assert.match(prompt(guardCalls[0]), /BUILD-PROFILE-BODY/, 'the fresh conversation gets the profile instructions again');
    const guardNext = await guardReloadedCall('submit', { ...packet, workerId: guardStart.workerId, model: 'gemini-4-argon-low', objective: 'Second after the guard' });
    await guardReloadedCall('wait', { runId: guardNext.runId, timeoutSeconds: 20 });
    assert.ok(calls().at(-1).args.includes('--conversation=conv-1'), 'the fresh conversation (created with --add-dir) resumes normally');
    console.log('PASS EV-AGY-RESUME-GUARD legacy agy conversation (no addDir) => fresh conversation, then resumes normally');

    // Explicit runtime needs a model; runtime opencode refuses an agy model; no runtime keeps OpenCode the default.
    assert.equal((await call('start', { ...packet, model: undefined })).status, 'INELIGIBLE');
    assert.equal((await call('start', { ...packet, runtime: 'opencode', model: 'agy/gemini-4-argon-medium' })).status, 'INELIGIBLE');
    const spawned = [];
    const openCode = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(tmp, 'ledger2'), spawner: (args, options) => {
        spawned.push({ args, options });
        return { stdout: null, on() {}, kill() { return true; } };
    } });
    openCode.start({ ...packet, runtime: undefined, model: undefined, workspacePath: workspace });
    assert.equal(spawned[0].args[0], 'run');
    assert.equal(spawned[0].options, undefined, 'OpenCode launches keep the old spawner call');
    assert.ok(!spawned[0].args.some((a) => /BUILD-PROFILE-BODY/.test(a)), 'OpenCode reads instructions from its agent file');
    assert.equal(projectWorkersState(openCode, workspace).workers[0].adapter, 'opencode');

    // EV-AGY-VERIFY-LOOP: fail->resume->pass ends COMPLETED; 3 failures end FAILED; OpenCode path untouched; setting false restores today's behaviour.
    const checkStateFile = path.join(tmp, 'check-state.json');
    const fakeCheck = path.join(tmp, 'check.cjs');
    fs.writeFileSync(fakeCheck, [
        'const fs = require("fs");',
        'const mode = process.argv[2];',
        `const stateFile = ${JSON.stringify(checkStateFile)};`,
        'const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { count: 0 };',
        'state.count += 1;',
        'state.lastCwd = process.cwd();',
        'state.lastArg = process.argv[3] || "";',
        'fs.writeFileSync(stateFile, JSON.stringify(state));',
        // Call 1 is the baseline run before agy starts; calls 2 fails with new lines, call 3 passes.
        'if (mode === "fail-then-pass" && state.count <= 2) {',
        '  process.stdout.write("X".repeat(4500) + "\\nFAIL-ROUND-" + state.count + "-TAIL\\n");',
        '  process.exit(1);',
        '}',
        'if (mode === "same-fail") {',
        '  process.stdout.write("FAIL same.test.js\\n    at /repo/same.test.js:10:2\\n");',
        '  process.exit(1);',
        '}',
        'if (mode === "always-fail") {',
        '  process.stderr.write("ALWAYS-FAIL-ROUND-" + state.count + "\\n");',
        '  process.exit(2);',
        '}',
        'process.stdout.write("PASS-ROUND-" + state.count + "-TAIL\\n");',
        'process.exit(0);',
    ].join('\n'));
    const verifyRuntime = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: path.join(tmp, 'ledger-verify'), agyCommand: fakeAgy });
    const verifyCall = toolOf(verifyRuntime);
    const beforeVerifyPass = calls().length;
    const verifyPass = await verifyCall('start', {
        ...packet, model: 'gemini-4-argon-low', objective: 'Verify loop fail then pass',
        command: `"${process.execPath}" "${fakeCheck}" fail-then-pass "quoted arg"`,
    });
    const verifyPassDone = await verifyCall('wait', { runId: verifyPass.runId, timeoutSeconds: 20 });
    assert.equal(verifyPassDone.status, 'COMPLETED', JSON.stringify(verifyPassDone));
    assert.ok(verifyPassDone.evidence.some((line) => line.includes('PASS-ROUND-3-TAIL')), JSON.stringify(verifyPassDone.evidence));
    const checkState = JSON.parse(fs.readFileSync(checkStateFile, 'utf8'));
    assert.equal(checkState.count, 3, 'one baseline run before agy plus two verify rounds');
    assert.equal(checkState.lastCwd, workspace, 'verify command runs in the task workspace');
    assert.equal(checkState.lastArg, 'quoted arg', 'verify command splits argv with quotes respected and no shell');
    assert.equal(calls().length, beforeVerifyPass + 2, 'failed verify round resumes the conversation once');
    assert.ok(calls()[beforeVerifyPass + 1].args.includes('--conversation=conv-1'));
    const verifyResumePrompt = prompt(calls()[beforeVerifyPass + 1]);
    assert.match(verifyResumePrompt, /FAIL-ROUND-2-TAIL[\s\S]*This check failed; fix it with file tools and report\./);
    assert.ok(verifyResumePrompt.length <= 4100, `verify prompt tail bounded (~4000 chars): got ${verifyResumePrompt.length}`);
    const verifyPassRounds = (await verifyCall('logs', { runId: verifyPass.runId })).filter((fact) => fact.type === 'verify_round');
    assert.equal(verifyPassRounds.length, 2);
    assert.equal(verifyPassRounds[0].round, 1);
    assert.equal(verifyPassRounds[0].exitCode, 1);
    assert.ok(verifyPassRounds[0].tail.length <= 1500 && verifyPassRounds[0].tail.includes('FAIL-ROUND-2-TAIL'));
    assert.equal(verifyPassRounds[1].round, 2);
    assert.equal(verifyPassRounds[1].exitCode, 0);
    assert.match(verifyPassRounds[1].tail, /PASS-ROUND-3-TAIL/);

    // 3 failures end FAILED with the last output tail.
    fs.rmSync(checkStateFile, { force: true });
    const beforeVerifyFail = calls().length;
    const verifyFail = await verifyCall('start', {
        ...packet, model: 'gemini-4-argon-high', objective: 'Verify loop 3 failures',
        command: `"${process.execPath}" "${fakeCheck}" always-fail`,
    });
    const verifyFailDone = await verifyCall('wait', { runId: verifyFail.runId, timeoutSeconds: 20 });
    assert.equal(verifyFailDone.status, 'FAILED', JSON.stringify(verifyFailDone));
    assert.match(verifyFailDone.reason, /ALWAYS-FAIL-ROUND-4/);
    assert.equal(calls().length, beforeVerifyFail + 3, '3 agy rounds for 3 verify rounds');
    const verifyFailRounds = (await verifyCall('logs', { runId: verifyFail.runId })).filter((fact) => fact.type === 'verify_round');
    assert.deepEqual(verifyFailRounds.map((fact) => [fact.round, fact.exitCode]), [[1, 2], [2, 2], [3, 2]]);

    // EV-AGY-PRE-EXISTING: a check failing identically before and after the worker is not the worker's doing.
    fs.rmSync(checkStateFile, { force: true });
    const beforeSame = calls().length;
    const sameFail = await verifyCall('start', { ...packet, model: 'gemini-flash', objective: 'Verify loop pre-existing failure', command: `"${process.execPath}" "${fakeCheck}" same-fail` });
    const sameDone = await verifyCall('wait', { runId: sameFail.runId, timeoutSeconds: 20 });
    assert.equal(sameDone.status, 'FAILED', JSON.stringify(sameDone));
    assert.match(sameDone.reason, /^pre-existing failure:/);
    assert.equal(calls().length, beforeSame + 1, 'a pre-existing failure never resumes the worker');
    assert.equal((await verifyCall('logs', { runId: sameFail.runId })).filter((fact) => fact.type === 'verify_round').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(checkStateFile, 'utf8')).count, 2, 'baseline before agy plus one verify round');
    console.log('PASS EV-AGY-PRE-EXISTING identical failing lines before/after => one verify round, no resume, reason pre-existing');

    // OpenCode path untouched: never runs verify_round even when command would fail.
    fs.rmSync(checkStateFile, { force: true });
    const ocRuntime = new OpenCodeWorkerRuntime([profile], { ledgerDir: path.join(tmp, 'ledger-oc'), spawner: () => {
        const { PassThrough } = require('node:stream');
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        let exitCb;
        setImmediate(() => {
            stdout.write(JSON.stringify({ sessionID: 'ses-oc-1', type: 'text', part: { text: 'Result: PASS\nEvidence: oc\nNot done: none' } }) + '\n');
            if (exitCb) { exitCb(0, null); }
        });
        return { pid: process.pid, stdout, stderr, on(ev, cb) { if (ev === 'exit') { exitCb = cb; } }, kill() { return true; } };
    } });
    const ocCall = toolOf(ocRuntime);
    const ocStarted = await ocCall('start', { ...packet, runtime: undefined, model: undefined, command: `"${process.execPath}" "${fakeCheck}" always-fail` });
    const ocDone = await ocCall('wait', { runId: ocStarted.runId, timeoutSeconds: 20 });
    assert.equal(ocDone.status, 'COMPLETED', JSON.stringify(ocDone));
    assert.equal(fs.existsSync(checkStateFile), false, 'OpenCode run never executes agy verify loop');
    assert.ok(!(await ocCall('logs', { runId: ocStarted.runId })).some((fact) => fact.type === 'verify_round' || fact.type === 'denied_continue'));

    // Setting askaway.workers.agyVerifyLoop = false restores today's behaviour (denial fails immediately, no verify loop).
    const legacyRuntime = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: path.join(tmp, 'ledger-legacy'), agyCommand: fakeAgy, agyVerifyLoop: false });
    const legacyCall = toolOf(legacyRuntime);
    const beforeLegacy = calls().length;
    const legacyDenied = await legacyCall('start', {
        ...packet, model: 'gemini-4-argon-high', objective: 'DENY a shell command',
        command: `"${process.execPath}" "${fakeCheck}" always-fail`,
    });
    const legacyDeniedDone = await legacyCall('wait', { runId: legacyDenied.runId, timeoutSeconds: 20 });
    assert.equal(legacyDeniedDone.status, 'FAILED', JSON.stringify(legacyDeniedDone));
    assert.match(legacyDeniedDone.reason, /agy auto-denied command[\s\S]*permissions\.allow[\s\S]*agyPermissions: skip/);
    assert.equal(calls().length, beforeLegacy + 1, 'setting false does not auto-resume a denial');
    const legacyLogs = await legacyCall('logs', { runId: legacyDenied.runId });
    assert.ok(!legacyLogs.some((fact) => fact.type === 'denied_continue' || fact.type === 'verify_round'));
    const legacyPass = await legacyCall('start', {
        ...packet, model: 'gemini-4-argon-medium', objective: 'Legacy pass without verify loop',
        command: `"${process.execPath}" "${fakeCheck}" always-fail`,
    });
    assert.equal((await legacyCall('wait', { runId: legacyPass.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    assert.equal(fs.existsSync(checkStateFile), false, 'setting false does not run the packet verify command');
    console.log('PASS EV-AGY-VERIFY-LOOP fail->resume->pass=COMPLETED 3xFail=FAILED opencode=untouched settingFalse=legacy');

    // EV-AGY-READONLY-MODE: read-only profile (edit: deny) omits --mode=accept-edits on start and when resumed after reload.
    const { agyArgs, runVerifyCommand } = require(path.join(buildDir, 'agyRuntime.js'));
    assert.ok(!agyArgs({ model: 'agy/gemini-4-argon-medium', thinking: 'medium', message: 'ro', edit: 'deny' }).some((arg) => arg.includes('accept-edits')));
    assert.ok(agyArgs({ model: 'agy/gemini-4-argon-medium', thinking: 'medium', message: 'rw', edit: 'allow' }).includes('--mode=accept-edits'));
    const roBefore = calls().length;
    const roStarted = await legacyCall('start', {
        ...packet, profile: 'explore', allowedFiles: [],
        objective: 'BREAK read-only explore under agy', command: 'none: read-only check',
    });
    assert.equal((await legacyCall('wait', { runId: roStarted.runId, timeoutSeconds: 20 })).status, 'FAILED');
    const roCall = calls()[roBefore];
    assert.ok(!roCall.args.some((arg) => arg.includes('accept-edits')), `read-only profile args must not contain accept-edits: ${JSON.stringify(roCall.args)}`);
    assert.ok(first.args.includes('--mode=accept-edits'), 'edit-allowed profile still gets --mode=accept-edits');
    const roReloaded = new OpenCodeWorkerRuntime([profile, readOnly], { ledgerDir: path.join(tmp, 'ledger-legacy'), agyCommand: fakeAgy, agyVerifyLoop: false });
    roReloaded.rehydrate(workspace, false);
    const roReloadedCall = toolOf(roReloaded);
    assert.equal((await roReloadedCall('resume', { runId: roStarted.runId })).state, 'STARTING');
    assert.equal((await roReloadedCall('wait', { runId: roStarted.runId, timeoutSeconds: 20 })).status, 'COMPLETED');
    const roResumedCall = calls().at(-1);
    assert.ok(roResumedCall.args.includes('--conversation=conv-1'), JSON.stringify(roResumedCall.args));
    assert.ok(!roResumedCall.args.some((arg) => arg.includes('accept-edits')), `resumed read-only args must not contain accept-edits: ${JSON.stringify(roResumedCall.args)}`);

    // Throwing spawner / spawn in runVerifyCommand ends the run FAILED with a reason for both agy and OpenCode.
    const throwRuntime = new OpenCodeWorkerRuntime([profile, readOnly], {
        ledgerDir: path.join(tmp, 'ledger-throw'),
        agyCommand: fakeAgy,
        spawner: () => { throw new Error('spawn ENOENT fake-agy'); },
    });
    const throwCall = toolOf(throwRuntime);
    const throwStarted = await throwCall('start', { ...packet, objective: 'Spawner throws synchronously' });
    const throwDone = await throwCall('wait', { runId: throwStarted.runId, timeoutSeconds: 20 });
    assert.equal(throwDone.status, 'FAILED', JSON.stringify(throwDone));
    assert.match(throwDone.reason, /spawn ENOENT fake-agy/);
    const throwOcStarted = await throwCall('start', { ...packet, runtime: undefined, model: undefined, objective: 'OpenCode spawner throws synchronously' });
    const throwOcDone = await throwCall('wait', { runId: throwOcStarted.runId, timeoutSeconds: 20 });
    assert.equal(throwOcDone.status, 'FAILED', JSON.stringify(throwOcDone));
    assert.match(throwOcDone.reason, /spawn ENOENT fake-agy/);

    const origSpawn = cp.spawn;
    cp.spawn = () => { throw new Error('verify spawn sync throw'); };
    try {
        const verifyThrown = await runVerifyCommand('node -e "process.exit(0)"', tmp);
        assert.equal(verifyThrown.exitCode, 1);
        assert.match(verifyThrown.output, /verify spawn sync throw/);
    } finally {
        cp.spawn = origSpawn;
    }
    console.log('PASS EV-AGY-READONLY-MODE readOnly=noAcceptEdits editAllow=acceptEdits spawnThrow=FAILED+noReferenceError');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS EV-WORKER-AGY fake-cli start/status/wait/logs/list/submit/resume/cancel deny=FAILED+noLoop optIn=explicit instructions=fresh reload=noServer+noDuplicate usage=raw+once cost=unreported viewer=none');
    if (process.argv.includes('--live')) { await live(); }
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log('test-agy-runtime: PASS');
    process.exit(0);
})().catch((error) => { console.error(error); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(buildDir, { recursive: true, force: true }); process.exit(1); });

/**
 * `--live`: real gemini-4-argon-medium workers through this runtime and the real agy CLI, in the repo: (1) review mode
 * denies a shell command -> FAILED with the reason; (2) an explicit `agyPermissions: skip` run writes a fixture test and
 * runs it through the shell; (3) a read-only AskAway MCP call: COMPLETED when an mcp(...) allow-rule exists, else FAILED
 * naming the rule (headless agy denies MCP even with skip); (4) submit + cancel + resume stay in one conversation.
 */
async function live() {
    const repo = fs.realpathSync(path.join(__dirname, '..'));
    const fixture = path.join(repo, 'tasksync-chat', '.agy-live-fixture.cjs');
    const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-agy-live-'));
    const real = new OpenCodeWorkerRuntime([profile], { ledgerDir: ledger });
    const base = { ...packet, workspacePath: repo, acceptance: 'stated in the objective', expected: 'Result: PASS' };
    const facts = (runId) => real.logs(runId).map((fact) => fact.type + (fact.tool ? `:${fact.tool}` : '')).join(',');
    const waitFor = async (runId) => { const done = await real.wait(runId, 240); if (done.status === 'STILL_RUNNING') { real.cancel(runId); } return done; };
    try {
        const deny = real.start({ ...base, allowedFiles: [], objective: 'Run exactly one shell command: rtk ls tasksync-chat/package.json and report its output.', command: 'rtk ls tasksync-chat/package.json' });
        const denied = await waitFor(deny.runId);
        console.log(`LIVE deny ${denied.status} reason=${String(denied.reason).slice(0, 48)}... spawns=${real.logs(deny.runId).filter((f) => f.type === 'start').length}`);
        assert.equal(denied.status, 'FAILED', JSON.stringify(denied));
        assert.match(denied.reason, /agy auto-denied command/);

        const run = real.start({ ...base, agyPermissions: 'skip', allowedFiles: ['tasksync-chat/.agy-live-fixture.cjs'],
            objective: 'Step 1: create tasksync-chat/.agy-live-fixture.cjs containing exactly: require("assert").equal(1 + 1, 2); console.log("agy-live-ok"); '
                + 'Step 2: run the shell command rtk node tasksync-chat/.agy-live-fixture.cjs and report its output line. Do nothing else.',
            command: 'rtk node tasksync-chat/.agy-live-fixture.cjs' });
        const done = await waitFor(run.runId);
        const status = real.status(run.runId);
        console.log(`LIVE work ${done.status} model=${status.model} conversation=${status.sessionId} usage=${JSON.stringify(status.usage)} cost=${status.costStatus} facts=${facts(run.runId)}`);
        assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
        assert.ok(real.logs(run.runId).some((fact) => fact.type === 'after_tool' && fact.tool === 'run_command'), 'a shell command ran');
        assert.ok(fs.existsSync(fixture));
        console.log(`LIVE evidence: ${done.evidence.filter((line) => /Result:|Evidence:/.test(line)).join(' | ')}`);

        const mcp = real.start({ ...base, agyPermissions: 'skip', model: 'agy/gemini-4-argon-low', allowedFiles: [],
            objective: 'Call the MCP tool askaway_memory on server askaway with arguments {"action":"search","query":"agy"} (read-only) and report how many results it returned. Do nothing else.',
            command: 'none: one read-only MCP call' });
        const mcpDone = await waitFor(mcp.runId);
        console.log(`LIVE mcp ${mcpDone.status} called=${real.logs(mcp.runId).some((f) => f.type === 'after_tool' && f.tool === 'askaway_askaway_memory')} reason=${String(mcpDone.reason ?? '').slice(0, 110)}`);
        assert.ok(real.logs(mcp.runId).some((fact) => fact.type === 'after_tool' && fact.tool === 'askaway_askaway_memory'), 'agy reached the AskAway MCP tool');
        if (mcpDone.status !== 'COMPLETED') { assert.match(mcpDone.reason, /agy auto-denied mcp[\s\S]*mcp\(<server>\)/); }

        // The permission opt-in is per run: this packet names it again (agents may still verify with a command).
        const next = real.submit(run.workerId, { ...base, agyPermissions: 'skip', allowedFiles: [], objective: 'Report the first line of tasksync-chat/.agy-live-fixture.cjs using your file viewer.', command: 'none: file viewer only' });
        const cancelled = real.cancel(next.runId);
        await waitFor(next.runId);
        const resumed = real.resume(next.runId);
        assert.equal(cancelled.status, 'CANCELLATION_REQUESTED');
        assert.equal(resumed.state, 'STARTING', JSON.stringify(resumed));
        const resumedDone = await waitFor(next.runId);
        const nextStatus = real.status(next.runId);
        console.log(`LIVE submit+cancel+resume ${resumedDone.status} sameConversation=${nextStatus.sessionId === status.sessionId} facts=${facts(next.runId)}`);
        assert.equal(resumedDone.status, 'COMPLETED', JSON.stringify(resumedDone));
        assert.equal(nextStatus.sessionId, status.sessionId);
    } finally {
        fs.rmSync(fixture, { force: true });
        fs.rmSync(ledger, { recursive: true, force: true });
        console.log(`LIVE cleanup fixtureRemoved=${!fs.existsSync(fixture)}`);
    }
}
