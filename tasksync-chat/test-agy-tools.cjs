// EV-AGY-TOOLS: agy receives every profile's allowed AskAway MCP tools, rtk command rule when bash is not deny,
// idempotent settings.json sync (permissions.allow union + mcpServers.askaway without tokens, preserving existing keys),
// profile instructions in the first prompt of a fresh agy conversation, and fails on out-of-policy askaway_X tool calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();

const fixturesRoot = path.join(__dirname, '.test-fixtures');
fs.mkdirSync(fixturesRoot, { recursive: true });
const tmp = fs.mkdtempSync(path.join(fixturesRoot, 'agy-tools-'));
const buildDir = path.join(tmp, 'build');
fs.mkdirSync(buildDir, { recursive: true });

const src = path.join(__dirname, 'src');
// Transpiles the modules reachable through relative requires, mirroring src/ so `../team/...` paths resolve.
function transpile(rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) { return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(src, rel), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(src, `${next}.ts`))) { transpile(`${next}.ts`); }
        else if (fs.existsSync(path.join(src, next, 'index.ts'))) { transpile(path.join(next, 'index.ts')); }
    }
}
for (const name of ['agyRuntime', 'workerProfiles', 'openCodeRuntime', 'workerTools']) { transpile(`workers/${name}.ts`); }

const { AGY_MCP_RULE_FORMAT, toAgyPermissions, agyEventNormalizer } = require(path.join(buildDir, 'workers', 'agyRuntime.js'));
const { parseWorkerProfile, syncAgyPermissions, workerInstructions } = require(path.join(buildDir, 'workers', 'workerProfiles.js'));
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));
const { registerWorkerTools } = require(path.join(buildDir, 'workers', 'workerTools.js'));

const implProfile = parseWorkerProfile(`---
name: implementer
description: Bounded code and test implementation
tier: light
model: github-copilot/gpt-5.4-mini
thinking: medium
models: [github-copilot/gpt-5.4-mini]
thinkingOptions: [low, medium, high]
edit: allow
bash: allow
webfetch: deny
mcp: [askaway_copilot_memory, askaway_code_nav, askaway_gradle, askaway_worker, askaway_commentary]
skills: []
steps: 35
---
You are Implementer. Follow the packet strictly.
`, 'implementer.md');

const exploreProfile = parseWorkerProfile(`---
name: explore
description: Read-only evidence collector
tier: light
model: github-copilot/gpt-5.4-mini
thinking: low
models: [github-copilot/gpt-5.4-mini]
thinkingOptions: [low, medium, high]
edit: deny
bash: deny
webfetch: deny
mcp: [askaway_copilot_memory, askaway_vscode_listCodeUsages, askaway_worker_start, askaway_commentary_post]
skills: []
steps: 25
---
You are Explore. Read-only evidence only.
`, 'explore.md');

// (a) toAgyPermissions maps askaway_<tool> to AGY_MCP_RULE_FORMAT, adds command(rtk) only when bash !== 'deny',
// and excludes worker and commentary tools.
assert.equal(AGY_MCP_RULE_FORMAT, 'mcp(askaway/<tool>)');
const implRules = toAgyPermissions(implProfile);
assert.deepEqual(implRules, [
    'mcp(askaway/copilot_memory)',
    'mcp(askaway/code_nav)',
    'mcp(askaway/gradle)',
    'command(rtk)',
]);
assert.ok(!implRules.some((r) => /worker|commentary/.test(r)), 'worker/commentary tools must never be emitted');

const exploreRules = toAgyPermissions(exploreProfile);
assert.deepEqual(exploreRules, [
    'mcp(askaway/copilot_memory)',
    'mcp(askaway/vscode_listCodeUsages)',
]);
assert.ok(!exploreRules.includes('command(rtk)'), 'bash: deny must not emit command(rtk)');
assert.ok(!exploreRules.some((r) => /worker|commentary/.test(r)), 'worker/commentary tools must never be emitted');

// (b) syncAgyPermissions preserves existing keys, merges union of rules into permissions.allow, does not write mcpServers, is idempotent, writes no tokens.
const settingsPath = path.join(tmp, 'settings.json');
fs.writeFileSync(settingsPath, JSON.stringify({
    gcp: { project: 'corp-proj', region: 'us-central1' },
    trustedWorkspaces: ['/Users/machs/PycharmProjects/TaskSync'],
    permissions: {
        allow: ['mcp(existing/tool)'],
        deny: ['command(rm)'],
    },
    mcpServers: {
        other: { url: 'http://localhost:9999/sse' },
    },
}, null, 2));

const firstSync = syncAgyPermissions([implProfile, exploreProfile], settingsPath);
assert.equal(firstSync, true, 'first syncAgyPermissions call should report changed=true');

const syncedText = fs.readFileSync(settingsPath, 'utf8');
const synced = JSON.parse(syncedText);
assert.deepEqual(synced.gcp, { project: 'corp-proj', region: 'us-central1' });
assert.deepEqual(synced.trustedWorkspaces, ['/Users/machs/PycharmProjects/TaskSync']);
assert.deepEqual(synced.permissions.deny, ['command(rm)']);
assert.deepEqual(synced.permissions.allow, [
    'mcp(existing/tool)',
    'mcp(askaway/copilot_memory)',
    'mcp(askaway/code_nav)',
    'mcp(askaway/gradle)',
    'command(rtk)',
    'mcp(askaway/vscode_listCodeUsages)',
]);
assert.deepEqual(synced.mcpServers, { other: { url: 'http://localhost:9999/sse' } }, 'must not write mcpServers.askaway into settings.json');
assert.ok(!/token|authorization|bearer|header/i.test(syncedText), 'must never write tokens or headers');

const secondSync = syncAgyPermissions([implProfile, exploreProfile], settingsPath);
assert.equal(secondSync, false, 'second syncAgyPermissions call should be idempotent and return false');
assert.equal(fs.readFileSync(settingsPath, 'utf8'), syncedText, 'file content must stay untouched on idempotent call');

// Missing settings.json inside an existing agy folder starts from {} and creates settings.json cleanly.
const existingFolder = path.join(tmp, 'existing-agy');
fs.mkdirSync(existingFolder, { recursive: true });
const freshSettingsPath = path.join(existingFolder, 'settings.json');
assert.equal(syncAgyPermissions([exploreProfile], freshSettingsPath), true);
const freshSynced = JSON.parse(fs.readFileSync(freshSettingsPath, 'utf8'));
assert.deepEqual(freshSynced.permissions.allow, ['mcp(askaway/copilot_memory)', 'mcp(askaway/vscode_listCodeUsages)']);
assert.equal(freshSynced.mcpServers, undefined);

// Missing agy settings folder -> do nothing and never create the folder.
const missingDir = path.join(tmp, 'missing-agy-folder');
const missingSettingsPath = path.join(missingDir, 'settings.json');
assert.equal(syncAgyPermissions([exploreProfile], missingSettingsPath), false);
assert.equal(fs.existsSync(missingDir), false, 'missing agy folder must not be created');

// Malformed settings.json -> skips without throwing, logs one warning line without file contents, leaves file unchanged.
const malformedPath = path.join(existingFolder, 'malformed-settings.json');
const malformedContent = '{"token": TOP_SECRET_VALUE}';
fs.writeFileSync(malformedPath, malformedContent, 'utf8');
const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
try {
    assert.equal(syncAgyPermissions([exploreProfile], malformedPath), false, 'malformed settings.json should return false');
} finally {
    console.warn = origWarn;
}
assert.equal(fs.readFileSync(malformedPath, 'utf8'), malformedContent, 'malformed settings.json must remain untouched');
assert.equal(warnings.length, 1, 'should log one warning line on malformed settings.json');
assert.ok(!warnings[0].includes('TOP_SECRET_VALUE'), 'warning log must not include file contents');

// Direct normalizer check for allowed vs out-of-policy askaway MCP tool calls, trailing wildcard *, and empty mcp list.
const norm = agyEventNormalizer([...exploreProfile.mcp, 'askaway_webex_*']);
const allowedEvents = norm({
    event: 'step_update',
    step_update: {
        conversation_id: 'conv-norm',
        step_index: 1,
        step_type: 'tool',
        state: 'DONE',
        tool_name: 'call_mcp_tool',
        tool_info: { parameters: { ServerName: 'askaway', ToolName: 'copilot_memory' }, output: 'ok' },
    },
});
assert.ok(!allowedEvents.some((e) => e.type === 'error'), 'in-policy MCP tool must not emit error');

const wildcardEvents = norm({
    event: 'step_update',
    step_update: {
        conversation_id: 'conv-norm',
        step_index: 2,
        step_type: 'tool',
        state: 'DONE',
        tool_name: 'call_mcp_tool',
        tool_info: { parameters: { ServerName: 'askaway', ToolName: 'webex_read' }, output: 'ok' },
    },
});
assert.ok(!wildcardEvents.some((e) => e.type === 'error'), 'trailing * MCP pattern must allow matching askaway tool');

const disallowedEvents = norm({
    event: 'step_update',
    step_update: {
        conversation_id: 'conv-norm',
        step_index: 3,
        step_type: 'tool',
        state: 'DONE',
        tool_name: 'call_mcp_tool',
        tool_info: { parameters: { ServerName: 'askaway', ToolName: 'gradle' }, output: 'nope' },
    },
});
assert.ok(disallowedEvents.some((e) => e.type === 'error' && e.outOfPolicy === true && /askaway_gradle/.test(e.error.message)), 'out-of-policy MCP tool must emit outOfPolicy error');

// The approval wrapper's own audit step (tool_name askaway_approval) never fails a run; a model calling an MCP tool of that name still does.
const wrapperEvents = norm({ event: 'step_update', step_update: { conversation_id: 'conv-norm', step_index: 4, step_type: 'tool', state: 'DONE', tool_name: 'askaway_approval', tool_info: { parameters: { CommandLine: 'node -e 1', decision: 'allow' }, output: '' } } });
assert.ok(!wrapperEvents.some((e) => e.type === 'error'), 'the approval wrapper audit step must not be out-of-policy');
const mcpApproval = norm({ event: 'step_update', step_update: { conversation_id: 'conv-norm', step_index: 5, step_type: 'tool', state: 'DONE', tool_name: 'call_mcp_tool', tool_info: { parameters: { ServerName: 'askaway', ToolName: 'approval' }, output: '' } } });
assert.ok(mcpApproval.some((e) => e.type === 'error' && e.outOfPolicy === true), 'an MCP tool named approval is still checked against the profile');

// (c) End-to-end agy run: receives profile instructions in its first prompt, fails on out-of-policy askaway_X tool call
// (including when a profile has no mcp list), and leaves OpenCode error + Result: PASS behavior unchanged.
const noMcpProfile = parseWorkerProfile(`---
name: nomcp
description: Profile without an mcp list
tier: light
model: github-copilot/gpt-5.4-mini
thinking: low
models: [github-copilot/gpt-5.4-mini]
thinkingOptions: [low, medium, high]
edit: deny
bash: deny
webfetch: deny
---
You have no MCP tools.
`, 'nomcp.md');

const workspace = fs.realpathSync(tmp);
const callsFile = path.join(tmp, 'calls.jsonl');
const fakeAgy = path.join(tmp, 'fake-agy');
fs.writeFileSync(fakeAgy, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args }) + '\\n');
const prompt = (args.find((a) => a.startsWith('--print=')) || '').slice(8);
const conv = 'conv-tools-1';
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
out({ event: 'init', conversation_id: conv, init: { model: 'x', cwd: process.cwd() } });
if (prompt.includes('OUT_OF_POLICY_TOOL')) {
    out({
        event: 'step_update',
        step_update: {
            conversation_id: conv,
            step_index: 1,
            step_type: 'tool',
            state: 'DONE',
            tool_name: 'call_mcp_tool',
            tool_info: { parameters: { ServerName: 'askaway', ToolName: 'gradle' }, output: 'ran gradle' },
        },
    });
} else {
    out({
        event: 'step_update',
        step_update: {
            conversation_id: conv,
            step_index: 1,
            step_type: 'tool',
            state: 'DONE',
            tool_name: 'call_mcp_tool',
            tool_info: { parameters: { ServerName: 'askaway', ToolName: 'copilot_memory' }, output: 'memory ok' },
        },
    });
}
const text = 'Result: PASS\\nEvidence: tool call completed\\nNot done: none\\nKnowledge: agy tools verified';
out({ event: 'step_update', step_update: { conversation_id: conv, step_index: 2, step_type: 'agent_response', state: 'DONE', text_delta: text } });
out({ event: 'result', conversation_id: conv, result: { conversation_id: conv, response: text, status: 'SUCCESS' } });
`, { mode: 0o755 });

(async () => {
    const runtime = new OpenCodeWorkerRuntime([implProfile, exploreProfile, noMcpProfile], {
        ledgerDir: path.join(tmp, 'ledger'),
        agyCommand: fakeAgy,
        agyVerifyLoop: false,
    });
    const tools = new Map();
    registerWorkerTools((name, config, handler) => tools.set(name, { config, handler }), () => runtime, workspace);
    const call = async (action, args = {}) => {
        const tool = tools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    const basePacket = {
        profile: 'explore',
        runtime: 'agy',
        model: 'gemini-4-argon-medium',
        dispatchTurnId: 'turn-1',
        baseRevision: 'HEAD',
        allowedFiles: [],
        acceptance: 'Allowed MCP tool succeeds',
        expected: 'PASS',
        command: 'none: read-only check',
    };

    const okStart = await call('start', {
        ...basePacket,
        objective: 'Check allowed MCP tool and instructions in first prompt',
    });
    const okDone = await call('wait', { runId: okStart.runId, timeoutSeconds: 15 });
    assert.equal(okDone.status, 'COMPLETED', JSON.stringify(okDone));

    const recordedCalls = fs.readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const firstPrintArg = recordedCalls[0].args.find((a) => a.startsWith('--print=')).slice(8);
    assert.ok(firstPrintArg.includes(workerInstructions(exploreProfile)), 'first prompt of fresh agy conversation must include workerInstructions(profile)');

    const badStart = await call('start', {
        ...basePacket,
        model: 'gemini-4-argon-light',
        objective: 'OUT_OF_POLICY_TOOL call askaway_gradle from explore',
    });
    const badDone = await call('wait', { runId: badStart.runId, timeoutSeconds: 15 });
    assert.equal(badDone.status, 'FAILED', `out-of-policy MCP tool must fail the run: ${JSON.stringify(badDone)}`);
    assert.match(badDone.reason, /out-of-policy MCP tool askaway_gradle/i);

    // Profile without an mcp list -> any askaway_* tool call fails.
    const noMcpStart = await call('start', {
        ...basePacket,
        profile: 'nomcp',
        model: 'gemini-4-argon-high',
        objective: 'Call askaway_copilot_memory from profile without mcp list',
    });
    const noMcpDone = await call('wait', { runId: noMcpStart.runId, timeoutSeconds: 15 });
    assert.equal(noMcpDone.status, 'FAILED', `profile without mcp list must fail on askaway_* call: ${JSON.stringify(noMcpDone)}`);
    assert.match(noMcpDone.reason, /out-of-policy MCP tool askaway_copilot_memory \(allowed: none\)/i);

    // OpenCode run with a type: 'error' event followed by Result: PASS lines still ends COMPLETED as before.
    const { PassThrough } = require('node:stream');
    const ocRuntime = new OpenCodeWorkerRuntime([exploreProfile], {
        ledgerDir: path.join(tmp, 'ledger-oc'),
        spawner: () => {
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            let exitCb;
            setImmediate(() => {
                stdout.write(JSON.stringify({ sessionID: 'ses-oc-err', type: 'error', error: { message: 'transient tool error' } }) + '\n');
                stdout.write(JSON.stringify({ sessionID: 'ses-oc-err', type: 'text', part: { text: 'Result: PASS\nEvidence: recovered after error\nNot done: none' } }) + '\n');
                if (exitCb) { exitCb(0, null); }
            });
            return { pid: process.pid, stdout, stderr, on(ev, cb) { if (ev === 'exit') { exitCb = cb; } }, kill() { return true; } };
        },
    });
    const ocTools = new Map();
    registerWorkerTools((name, config, handler) => ocTools.set(name, { config, handler }), () => ocRuntime, workspace);
    const ocCall = async (action, args = {}) => {
        const tool = ocTools.get('worker');
        return JSON.parse((await tool.handler(tool.config.inputSchema.parse({ action, ...args }))).content[0].text);
    };
    const ocStart = await ocCall('start', {
        ...basePacket,
        runtime: undefined,
        model: undefined,
        objective: 'OpenCode error event followed by Result: PASS',
    });
    const ocDone = await ocCall('wait', { runId: ocStart.runId, timeoutSeconds: 15 });
    assert.equal(ocDone.status, 'COMPLETED', `OpenCode error event followed by Result: PASS must still complete: ${JSON.stringify(ocDone)}`);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('PASS EV-AGY-TOOLS toAgyPermissions=mcp+rtk-worker-commentary syncAgyPermissions=merge+idempotent+noTokens instructions=firstPrompt outOfPolicyMcp=FAILED');
})().catch((err) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(err);
    process.exit(1);
});
