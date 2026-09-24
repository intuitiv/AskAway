// Spec cost ledger + Specs work-label behavior. Run: node test-spec-cost-ledger.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spec-cost-'));
fs.writeFileSync(
    path.join(buildDir, 'specCostLedger.js'),
    ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'specs', 'specCostLedger.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
);
const ledger = require(path.join(buildDir, 'specCostLedger.js'));

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-workspace-'));
fs.mkdirSync(path.join(workspace, '.specify'), { recursive: true });
fs.writeFileSync(
    path.join(workspace, '.specify', 'feature.json'),
    JSON.stringify({ feature_directory: 'specs/001-async-subagent-runner' })
);
assert.strictEqual(ledger.readActiveSpecSlug(workspace), '001-async-subagent-runner');

const file = path.join(buildDir, 'ledger.json');
const turn = (turnKey, day, requests, nanoAiu, specSlug) => ({
    specSlug: specSlug || '001-async-subagent-runner',
    turnKey, day, requests, inputTokens: 10, outputTokens: 5, nanoAiu,
});

ledger.recordSpecTurn(file, turn('t1', '2026-09-07', 3, 20000000000));
ledger.recordSpecTurn(file, turn('t2', '2026-09-08', 2, 10000000000));
ledger.recordSpecTurn(file, turn('t2', '2026-09-08', 4, 15000000000));
ledger.recordSpecTurn(file, turn('t3', '2026-09-08', 1, 5000000000, '003-worker-side-channel'));
ledger.recordSpecTurn(file, turn('t4', '2026-09-08', 0, 0));

let totals = ledger.readSpecCostTotals(file);
assert.strictEqual(totals['001-async-subagent-runner'].requests, 7);
assert.strictEqual(totals['001-async-subagent-runner'].nanoAiu, 35000000000);
assert.strictEqual(totals['001-async-subagent-runner'].turns, 2);
assert.strictEqual(totals['001-async-subagent-runner'].days, 2);
assert.strictEqual(totals['003-worker-side-channel'].requests, 1);
assert.ok(!totals['004-none'], 'zero-usage turns are not attributed');

// Recorded measurements are durable: later turns never drop earlier rows.
ledger.recordSpecTurn(file, turn('t5', '2026-09-09', 1, 1000000000));
totals = ledger.readSpecCostTotals(file);
assert.strictEqual(totals['001-async-subagent-runner'].turns, 3);
assert.strictEqual(totals['001-async-subagent-runner'].nanoAiu, 36000000000);
assert.strictEqual(totals['003-worker-side-channel'].requests, 1);

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const specWorkLabel = new Function(`${webview.match(/function specWorkLabel\([\s\S]*?\n    }/)[0]}; return specWorkLabel;`)();
assert.strictEqual(specWorkLabel(['Cycle CY-001: P0 Contract', 'Cycle CY-002: P1 Spike']), 'Cycles');
assert.strictEqual(specWorkLabel(['Phase 1: Setup', 'Phase 2: Runtime']), 'Phases');
assert.strictEqual(specWorkLabel([]), 'Phases');

const specCostFact = new Function(`${webview.match(/function specCostFact\([\s\S]*?\n    }/)[0]}; return specCostFact;`)();
assert.strictEqual(specCostFact({ cost: { nanoAiu: 35000000000, requests: 7 } }), '$0.35 · 7 reqs');
assert.strictEqual(specCostFact({}), 'No tracked cost');

fs.rmSync(buildDir, { recursive: true, force: true });
fs.rmSync(workspace, { recursive: true, force: true });
console.log('PASS spec cost ledger totals, durability, active slug, work label, cost fact');
