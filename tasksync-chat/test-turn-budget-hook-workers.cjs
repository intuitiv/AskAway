const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const ts = require('./node_modules/typescript');
const home = path.join(__dirname, 'test-fixtures/turn-budget-hook');
const workspace = fs.realpathSync(home);
const cfg = path.join(home, '.askaway');
fs.mkdirSync(path.join(cfg, 'worker-ledger'), { recursive: true });
fs.mkdirSync(path.join(cfg, 'turn-totals'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'turn-budget-aiu'), '100');
fs.writeFileSync(path.join(cfg, 'workspace-storage-root'), path.join(home, 'storage'));
fs.writeFileSync(path.join(home, 'storage/workspace/workspace.json'), JSON.stringify({ folder: new URL('file://' + workspace).href }));
const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
fs.writeFileSync(path.join(cfg, 'worker-ledger', key + '.jsonl'), fs.readFileSync(path.join(home, 'worker.jsonl')));
const source = fs.readFileSync(path.join(__dirname, 'src/extension.ts'), 'utf8');
const start = source.indexOf('const BUDGET_INJECT_SCRIPT =');
const end = source.indexOf('\n`;', start) + 3;
assert.ok(start > 0 && end > start);
const box = {};
vm.runInNewContext(source.slice(start, end) + '\nbox.script = BUDGET_INJECT_SCRIPT;', { box });
const moduleBox = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src/workers/turnBudget.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { require: name => name === 'os' ? { homedir: () => home } : require(name), exports: moduleBox.exports, module: moduleBox });
const { turnTotals, persistTurnTotals } = moduleBox.exports;
const run = () => {
    const output = cp.execFileSync(process.execPath, ['-e', box.script], { cwd: workspace, env: { ...process.env, HOME: home, ASKAWAY_WORKSPACE_PATH: workspace }, encoding: 'utf8' });
    return JSON.parse(output).hookSpecificOutput.additionalContext;
};
// Poison the snapshot with another turn: fallback must still sum main + child + worker/ping.
persistTurnTotals(workspace, 9999, turnTotals({ requestCount: 1, nanoAiu: 999e9 }, { requests: 0, dollars: 0, runs: 0 }));
assert.equal(run(), 'Turn budget: 100 AIU · last turn 60 (60%)');
// A matching provider snapshot wins over the scan; this represents more recently observed worker spend.
persistTurnTotals(workspace, 10000, turnTotals({ requestCount: 2, nanoAiu: 30e9 }, { requests: 3, dollars: .4, runs: 2 }));
assert.equal(run(), 'Turn budget: 100 AIU · last turn 70 (70%)');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cfg, 'turn-totals', key + '.json'))), { turnStartedAt: 10000, spentAiu: 70, requests: 5 });
fs.writeFileSync(path.join(cfg, 'turn-totals', key + '.json'), 'malformed');
assert.equal(run(), 'Turn budget: 100 AIU · last turn 60 (60%)');
console.log('PASS EV-TURN-BUDGET-HOOK-WORKERS matchingSnapshot=70AIU staleOrMalformedFallback=60AIU main+child+workers+ping');
