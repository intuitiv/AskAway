// Worker spend within the current turn: reused worker, only checkpoints at/after the turn start count. Run: node test-worker-turn-spend.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = path.join(__dirname, '.worker-turn-spend-build');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(buildDir, 'workers'), { recursive: true });
fs.mkdirSync(path.join(buildDir, 'commentary'));
function transpile(rel) {
    const out = path.join(buildDir, rel.replace(/\.ts$/, '.js'));
    if (fs.existsSync(out)) return;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    fs.writeFileSync(out, js);
    for (const [, spec] of js.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
        const next = path.join(path.dirname(rel), spec);
        if (fs.existsSync(path.join(__dirname, 'src', `${next}.ts`))) transpile(`${next}.ts`);
        else if (fs.existsSync(path.join(__dirname, 'src', next, 'index.ts'))) transpile(path.join(next, 'index.ts'));
    }
}
const compile = (dir, name) => transpile(`${dir}/${name}.ts`);
for (const name of ['workerProfiles', 'workerRouter', 'openCodeRuntime', 'workersState', 'workerTools']) { compile('workers', name); }
for (const name of ['commentary', 'telegramLive']) { compile('commentary', name); }
const { OpenCodeWorkerRuntime } = require(path.join(buildDir, 'workers', 'openCodeRuntime.js'));
const { workerToolDefinitions, invokeDefinition } = require(path.join(buildDir, 'workers', 'workerTools.js'));
const { usageLine } = require(path.join(buildDir, 'commentary', 'telegramLive.js'));

(async () => {
    try {
        const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spend-ledger-'));
        const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-spend-ws-')));
        const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
        const usage = (cost) => ({ input: 100, output: 10, reasoning: 0, cacheRead: 50, cacheWrite: 0, cost, steps: 1 });
        const record = (ts, runId, type, cost) => JSON.stringify({
            ts, workspace, workerId: 'w1', runId, sessionId: 's1', dispatchTurnId: 't', source: 'github-copilot',
            profile: 'verify', model: 'github-copilot/x', thinking: 'low', type, ...(cost === undefined ? {} : { usage: usage(cost) }),
        });
        const turnStart = 10_000;
        const lines = [
            record(1_000, 'run-a', 'checkpoint', 1), record(2_000, 'run-a', 'checkpoint', 1), record(3_000, 'run-a', 'stop'),
            record(11_000, 'run-b', 'checkpoint', 0.5), record(12_000, 'run-b', 'checkpoint', 0.25), record(13_000, 'run-b', 'checkpoint', 0.25),
        ];
        fs.writeFileSync(path.join(ledgerDir, `${key}.jsonl`), `${lines.join('\n')}\n`);

        const runtime = new OpenCodeWorkerRuntime([], { ledgerDir });
        const spend = runtime.usageSince(workspace, turnStart);
        assert.equal(spend.requests, 3, 'only the later run\'s checkpoints count');
        assert.equal(spend.dollars, 1);
        assert.equal(spend.runs, 1);
        assert.equal(spend.inputTokens, 450);
        assert.equal(spend.outputTokens, 30);
        assert.equal(runtime.usageSince(workspace, 0).requests, 5, 'earlier run is counted only when the window includes it');

        const line = usageLine({ lastActivityAt: 0, requests: 34, workerRuns: 3, dollars: 1.95 });
        assert.match(line, /34 requests · 3 workers · <b>\$1\.95<\/b>/);
        assert.doesNotMatch(usageLine({ lastActivityAt: 0, requests: 3, dollars: 1 }), / workers? · /);

        const waitTool = workerToolDefinitions(() => ({
            wait: async (_id, seconds) => ({ status: 'STILL_RUNNING', seconds }),
        }), workspace).find((d) => d.name === 'worker_wait');
        const reply = JSON.parse(await invokeDefinition(waitTool, { runId: 'r', timeoutSeconds: 900 }));
        assert.notEqual(reply.status, 'INVALID_INPUT', 'a long wait is accepted, not rejected');
        assert.equal(reply.seconds, 240, 'and clamped to the ceiling');

        console.log('PASS EV-WORKER-TURN-SPEND');
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exit(1); });
