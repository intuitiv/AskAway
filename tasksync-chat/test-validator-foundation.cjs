// T003 foundation: validator Commentary kind via the internal postValidator only, cost source, read-only profile. Run: node test-validator-foundation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.validator-foundation-build');
fs.rmSync(buildDir, { recursive: true, force: true });
require('./tools/transpile-src.cjs').transpileSrc(buildDir);
for (const name of ['workers/workerProfiles', 'workers/workerRouter', 'workers/openCodeRuntime', 'workers/workersState', 'workers/workerTools',
    'commentary/commentary', 'specs/specCostLedger', 'validator/profile']) {
    const out = path.join(buildDir, `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const load = (name) => require(path.join(buildDir, `${name}.js`));
const { CommentaryStore, commentaryToolDefinitions, commentaryView, COMMENTARY_KINDS, buildOpener } = load('commentary/commentary');
const { registerToolDefinitions, invokeDefinition } = load('workers/workerTools');
const { recordSpecTurn, readSpecCostTotals, validatorTurnKey } = load('specs/specCostLedger');
const { validatorProfile } = load('validator/profile');
const { toOpenCodeAgent } = load('workers/workerProfiles');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-foundation-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-ws-')));
let clock = Date.UTC(2026, 9, 6, 10, 0);
const store = new CommentaryStore({ dir: path.join(home, 'commentary'), now: () => clock });

(async () => {
    try {
        // --- The agent can never post kind validator: MCP tool schema, tool call, and post() ---
        assert.deepEqual([...COMMENTARY_KINDS], ['update', 'heads-up']);
        const tools = new Map();
        registerToolDefinitions((name, config, handler) => tools.set(name, { config, handler }), commentaryToolDefinitions(() => store, ''));
        const schema = tools.get('commentary').config.inputSchema;
        assert.throws(() => schema.parse({ kind: 'validator', text: 'agent tries to post as the validator', workspacePath: workspace }), 'MCP schema refuses kind validator');
        const [definition] = commentaryToolDefinitions(() => store, workspace);
        assert.equal(JSON.parse(await invokeDefinition(definition, { kind: 'validator', text: 'agent tries to post as the validator' })).status, 'INVALID_INPUT');
        const viaPost = store.post(workspace, { kind: 'validator', text: 'agent tries to post as the validator' });
        assert.equal(viaPost.status, 'REJECTED');
        assert.match(viaPost.reason, /update, heads-up/);
        assert.equal(store.read(workspace).items.length, 0);

        // --- postValidator stores it with detail, after an update, and the tab sees it ---
        assert.equal(store.post(workspace, { kind: 'update', text: 'Running the build now to check the fix holds.' }).status, 'POSTED');
        clock += 1000;
        const longSummary = `Observed answer: ${Array(30).fill('word').join(' ')}`;
        const detail = { answer: 'Use the existing helper', sources: ['Rules.md'], usage: { cost: 0.01 } };
        assert.equal(store.postValidator(workspace, { text: longSummary, detail }).status, 'POSTED', 'the 20-word cap does not apply to validator text');
        const view = commentaryView(store.read(workspace));
        assert.deepEqual(view.items.map((item) => item.kind), ['update', 'validator'], 'validator item appears after the update, in time order');
        assert.deepEqual(view.items[1].detail, detail);
        assert.equal(store.postValidator(workspace, { text: 'key ghp_abcdefghijklmnopqrstuvwxyz0123 leaked' }).status, 'REJECTED', 'credential in text drops the item');
        assert.equal(store.postValidator(workspace, { text: 'fine summary', detail: { answer: 'sk-abcdefghijklmnopqrstuvwxyz0123' } }).status, 'REJECTED', 'credential in detail drops the item');
        assert.equal(commentaryView(store.read(workspace)).items.length, 2);

        // --- Beta isolation: nothing the validator wrote reaches the agent-facing feed or the carry-over opener ---
        const state = store.read(workspace);
        assert.deepEqual(state.items.map((item) => item.kind), ['update'], 'agent-facing items hold no validator item (the hook injects them)');
        assert.doesNotMatch(buildOpener(state), /Observed answer|validator/i);
        assert.doesNotMatch(JSON.stringify(state.items), /Use the existing helper/);

        // --- Cost: validator row is separate, counted once; old rows without source still total ---
        const file = path.join(home, 'spec-cost.json');
        recordSpecTurn(file, { specSlug: '007', turnKey: 'turn-1', day: '2026-10-06', requests: 2, inputTokens: 100, outputTokens: 10, nanoAiu: 500 });
        const row = { specSlug: '007', turnKey: validatorTurnKey('resp-1'), day: '2026-10-06', requests: 1, inputTokens: 40, outputTokens: 5, nanoAiu: 100,
            source: 'validator', reasoningTokens: 7, cacheReadTokens: 30, cacheWriteTokens: 3 };
        recordSpecTurn(file, row);
        recordSpecTurn(file, row);
        const rows = JSON.parse(fs.readFileSync(file, 'utf8')).rows;
        assert.equal(validatorTurnKey('resp-1'), 'validator:resp-1');
        assert.equal(rows.length, 2, 'observed row stays, validator row added once (upsert by turnKey)');
        assert.deepEqual(rows.find((r) => r.turnKey === 'turn-1').inputTokens, 100);
        assert.deepEqual([rows[1].source, rows[1].reasoningTokens, rows[1].cacheReadTokens, rows[1].cacheWriteTokens], ['validator', 7, 30, 3]);
        assert.deepEqual(readSpecCostTotals(file)['007'], { requests: 3, inputTokens: 140, outputTokens: 15, nanoAiu: 600, turns: 2, days: 1 });

        // --- The read-only validator profile has no send-to-agent tool ---
        const profile = validatorProfile();
        assert.equal(profile.name, 'validator');
        assert.deepEqual([profile.edit, profile.bash, profile.webfetch], ['deny', 'deny', 'deny']);
        assert.ok(profile.mcp.length > 0 && !profile.mcp.some((tool) => /send|respond|ask_user|worker|commentary|message/i.test(tool)), 'no tool that can send to the agent');
        assert.match(profile.prompt, /File scope: read-only/);
        assert.match(profile.prompt, /Stop condition/);
        assert.match(profile.prompt, /Evidence contract/);
        assert.match(toOpenCodeAgent(profile), /edit: deny/);

        console.log('PASS EV-VALIDATOR-FOUNDATION');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(workspace, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exit(1); });
