// Copilot SDK session events (VS Code 1.140+ harness) become the main.jsonl lines Trace, credits and handoff read.
// Run: node test-copilot-sdk-log.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadModule(relative) {
    const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, relative)], bundle: true, external: ['vscode'],
        platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const module = { exports: {} };
    const stubbed = (id) => (id === 'vscode' ? new Proxy({}, { get: () => () => ({}) }) : require(id));
    vm.runInNewContext(output, { module, exports: module.exports, require: stubbed, __dirname, Buffer, console, process, setTimeout, clearTimeout });
    return module.exports;
}
const { convertEventLines, newConvertState, CopilotSdkLogBridge } = loadModule('src/observability/copilotSdkLog.ts');
const { findHandoff } = loadModule('src/services/handoffNotifier.ts');

const sid = 'sess-1';
const ev = (type, timestamp, data) => JSON.stringify({ type, data, id: `${type}-${timestamp}`, timestamp });
const events = [
    ev('session.start', '2026-10-17T11:00:00.000Z', { sessionId: sid, startTime: '2026-10-17T11:00:00.000Z', copilotVersion: '1.0.95', selectedModel: 'claude-sonnet-5.5', context: { cwd: '/ws/app' } }),
    ev('user.message', '2026-10-17T11:00:01.000Z', { messageId: 'm1', content: 'Fix the trace tab' }),
    ev('assistant.turn_start', '2026-10-17T11:00:01.100Z', { turnId: '0' }),
    ev('session.usage_record', '2026-10-17T11:00:05.000Z', { usage: { model: 'claude-sonnet-5.5', inputTokens: 1000, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 500, duration: 4000, timeToFirstTokenMs: 900.4, apiCallId: 'msg_a', providerCallId: 'p_a', interactionType: 'conversation-agent', copilotUsage: { totalNanoAiu: 8000000000 } } }),
    ev('tool.execution_start', '2026-10-17T11:00:05.100Z', { toolCallId: 't1', toolName: 'bash', arguments: { command: 'ls' } }),
    ev('tool.execution_complete', '2026-10-17T11:00:06.600Z', { toolCallId: 't1', success: true, result: { content: 'a\nb' } }),
    ev('tool.execution_start', '2026-10-17T11:00:06.700Z', { toolCallId: 't2', toolName: 'worker', arguments: { action: 'list' } }),
    ev('tool.execution_complete', '2026-10-17T11:00:07.000Z', { toolCallId: 't2', success: false, result: { content: 'refused' } }),
    ev('session.usage_record', '2026-10-17T11:00:09.000Z', { usage: { model: 'claude-sonnet-5.5', inputTokens: 1600, outputTokens: 80, cacheReadTokens: 900, duration: 2000, apiCallId: 'msg_b', copilotUsage: { totalNanoAiu: 2500000000 } } }),
    ev('assistant.message', '2026-10-17T11:00:09.100Z', { messageId: 'a1', content: 'Done.\n\n## Response Handoff\nImpact: x\nSummary: y\nNext: z?', toolRequests: [] }),
    ev('assistant.turn_end', '2026-10-17T11:00:09.200Z', { turnId: '0' }),
    '{ not json',
];
const lines = convertEventLines(events, newConvertState(sid)).map((line) => JSON.parse(line));
const byType = (type) => lines.filter((line) => line.type === type);

assert.equal(byType('session_start').length, 1);
assert.equal(byType('user_message').length, 1);
assert.equal(byType('user_message')[0].attrs.content, 'Fix the trace tab');
const llm = byType('llm_request');
assert.equal(llm.length, 2, 'one llm_request per usage record');
assert.equal(llm.reduce((sum, row) => sum + row.attrs.copilotUsageNanoAiu, 0), 10500000000, 'credits sum to the SDK totals');
assert.equal(llm[0].ts, Date.parse('2026-10-17T11:00:01.000Z'), 'ts is the request start, as in main.jsonl');
assert.equal(llm[0].attrs.cachedTokens, 400);
assert.equal(llm[0].attrs.inputTokens, 1000);
assert.equal(llm[0].attrs.ttft, 900);
const tools = byType('tool_call');
assert.equal(JSON.stringify(tools.map((row) => [row.name, row.status, row.dur])), JSON.stringify([['bash', 'ok', 1500], ['worker', 'error', 300]]));
assert.equal(tools[0].attrs.args, '{"command":"ls"}');
assert.equal(tools[0].attrs.result, 'a\nb');

// Readers match these exact substrings, so the JSON must be compact.
const raw = convertEventLines(events, newConvertState(sid));
assert.ok(raw.some((line) => line.includes('"type":"user_message"')) && raw.some((line) => line.includes('"type":"llm_request"')) && raw.some((line) => line.includes('"type":"tool_call"')));

// The handoff reader finds the final message.
const handoff = findHandoff(raw.join('\n'), 0);
assert.match(handoff.handoff, /Impact: x/);

(async () => {
    // Bridge: only this workspace's sessions, appended incrementally, never a partial line.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-sdk-log-'));
    const sessionStateDir = path.join(root, 'session-state');
    const debugRoot = path.join(root, 'debug-logs');
    const write = (name, rows, partial = '') => {
        fs.mkdirSync(path.join(sessionStateDir, name), { recursive: true });
        fs.writeFileSync(path.join(sessionStateDir, name, 'events.jsonl'), rows.join('\n') + '\n' + partial);
    };
    write(sid, events.slice(0, 4), '{"type":"session.usage_rec');
    write('other', [ev('session.start', '2026-10-17T11:00:00.000Z', { startTime: '2026-10-17T11:00:00.000Z', context: { cwd: '/elsewhere/app' } })]);
    const bridge = new CopilotSdkLogBridge({ sessionStateDir, debugRoot, workspaceRoots: () => ['/ws/app'] });
    await bridge.sync();
    const mainFile = path.join(debugRoot, sid, 'main.jsonl');
    assert.ok(fs.existsSync(mainFile), 'this workspace session is bridged');
    assert.ok(!fs.existsSync(path.join(debugRoot, 'other')), 'another workspace is never read');
    const first = fs.readFileSync(mainFile, 'utf8');
    assert.equal(first.split('\n').filter(Boolean).length, 4, 'session_start, user_message, turn_start, llm_request; the partial line waits');

    write(sid, events.slice(0, 11));
    await bridge.sync();
    const second = fs.readFileSync(mainFile, 'utf8');
    assert.ok(second.startsWith(first), 'appending keeps earlier bytes, so reader cursors stay valid');
    assert.equal(second, convertEventLines(events, newConvertState(sid)).join('\n') + '\n');

    // A restart rebuilds the same bytes without duplicating lines.
    const restarted = new CopilotSdkLogBridge({ sessionStateDir, debugRoot, workspaceRoots: () => ['/ws/app'] });
    await restarted.sync();
    assert.equal(fs.readFileSync(mainFile, 'utf8'), second, 'idempotent across restarts');

    // The real session log of this machine, when present, converts without losing a usage record.
    const real = path.join(os.homedir(), '.copilot', 'session-state', '586df4b9-2451-4290-a128-feecfcc4c19b', 'events.jsonl');
    let realNote = 'real=skipped';
    if (fs.existsSync(real)) {
        const realLines = fs.readFileSync(real, 'utf8').split('\n').filter(Boolean);
        const usage = realLines.filter((line) => line.startsWith('{"type":"session.usage_record"')).length;
        const converted = convertEventLines(realLines, newConvertState('real')).map((line) => JSON.parse(line));
        assert.equal(converted.filter((row) => row.type === 'llm_request').length, usage);
        assert.ok(converted.filter((row) => row.type === 'llm_request').every((row) => typeof row.attrs.copilotUsageNanoAiu === 'number'));
        realNote = `real=${usage}requests`;
    }
    fs.rmSync(root, { recursive: true, force: true });
    console.log(`PASS EV-COPILOT-SDK-LOG requests=2 credits=10.5AIU tools=2 incremental=true workspaceOnly=true restartIdempotent=true ${realNote}`);
})().catch((error) => { console.error(error); process.exit(1); });
