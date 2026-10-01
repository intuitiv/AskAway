// EV-TURN-BUDGET-WORKERS: turn budget = main AIU + worker $ (x100); over budget the worker tool refuses start/submit. Run: node test-turn-budget-workers.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.turn-budget-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools', 'turnBudget']) {
    fs.writeFileSync(path.join(buildDir, `${name}.js`), ts.transpileModule(
        fs.readFileSync(path.join(__dirname, 'src', 'workers', `${name}.ts`), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { turnBudget } = require(path.join(buildDir, 'turnBudget.js'));
const { workerTool } = require(path.join(buildDir, 'workerTools.js'));

const packet = {
    profile: 'build', dispatchTurnId: 't', baseRevision: 'abc', objective: 'o', allowedFiles: [], acceptance: 'a', expected: 'e', command: 'rtk npm test',
};

(async () => {
    try {
        // Reviewer's case: main agent 1000 AIU, workers $9 = 900 AIU -> 1900.
        const over = turnBudget(1000e9, 9, 3, 1000);
        assert.equal(over.mainAiu, 1000);
        assert.equal(over.workerAiu, 900);
        assert.equal(over.workerRuns, 3);
        assert.equal(over.spentAiu, 1900, 'total includes workers');
        assert.equal(over.exceeded, true);
        const under = turnBudget(400e9, 1, 1, 1000);
        assert.equal(under.spentAiu, 500);
        assert.equal(under.exceeded, false);
        assert.equal(turnBudget(5000e9, 50, 9, 0).exceeded, false, 'limit 0 never exceeds');

        const calls = [];
        const runtime = {
            start: async (p) => { calls.push('start'); return { status: 'RUNNING', runId: 'r1', p }; },
            submitForking: async () => { calls.push('submit'); return { status: 'RUNNING', runId: 'r2' }; },
            status: async (id) => ({ status: 'RUNNING', runId: id }),
            cancel: async (id) => ({ status: 'CANCELLED', runId: id }),
            logs: () => [],
        };
        const toolFor = (budget) => workerTool(() => runtime, '/ws', { turnBudget: () => budget });

        const blocked = toolFor(over);
        for (const args of [{ action: 'start', ...packet }, { action: 'submit', workerId: 'w1', ...packet }]) {
            const reply = await blocked.run(args);
            assert.equal(reply.status, 'BUDGET_EXCEEDED', `${args.action} refused`);
            assert.equal(reply.spentAiu, 1900);
            assert.equal(reply.limitAiu, 1000);
            assert.match(reply.reason, /finish with what you have/);
        }
        assert.deepEqual(calls, [], 'nothing dispatched over budget');
        assert.equal((await blocked.run({ action: 'status', runId: 'r1' })).status, 'RUNNING', 'status still works');
        assert.equal((await blocked.run({ action: 'cancel', runId: 'r1' })).status, 'CANCELLED', 'cancel still works');

        assert.equal((await toolFor(under).run({ action: 'start', ...packet })).status, 'RUNNING', 'under budget dispatches');
        assert.equal((await toolFor(turnBudget(5000e9, 50, 9, 0)).run({ action: 'start', ...packet })).status, 'RUNNING', 'limit 0 never refuses');
        assert.deepEqual(calls, ['start', 'start']);

        console.log('PASS EV-TURN-BUDGET-WORKERS');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exit(1); });
