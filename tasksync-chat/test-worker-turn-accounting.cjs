const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const loaded = { exports: {} };
vm.runInNewContext(esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/workers/openCodeRuntime.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
    { module: loaded, exports: loaded.exports, require, process, Buffer, console, setTimeout, clearTimeout });
const root = fs.mkdtempSync(path.join(__dirname, '.worker-turn-accounting-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const workspace = fs.realpathSync(root);
const key = workspace.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
const usage = { input: 10, output: 2, reasoning: 0, cacheRead: 4, cacheWrite: 0, cost: 0.125, steps: 1 };
const rows = [
    { ts: 90, type: 'start', runId: 'old-run', workerId: 'carry-over' },
    { ts: 100, type: 'checkpoint', runId: 'old-run', workerId: 'carry-over', usage },
    { ts: 101, type: 'checkpoint', runId: 'old-run', workerId: 'carry-over', usage },
    { ts: 80, type: 'start', runId: 'ping-run', workerId: 'warm-only' },
    { ts: 102, type: 'checkpoint', runId: 'ping-run', workerId: 'warm-only', usage, ping: true },
    { ts: 99, type: 'checkpoint', runId: 'excluded', workerId: 'before-turn', usage },
];
fs.writeFileSync(path.join(root, `${key}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const runtime = new loaded.exports.OpenCodeWorkerRuntime([], { ledgerDir: root });
const total = runtime.usageSince(workspace, 100);
assert.equal(total.requests, 3);
assert.equal(total.dollars, 0.375);
assert.equal(total.runs, 1, 'pings do not alter run counting');
assert.deepEqual(Array.from(total.workerIds).sort(), ['carry-over', 'warm-only']);
assert.equal(total.workers, 2);
const pingOnly = runtime.usageSince(workspace, 102);
assert.equal(pingOnly.requests, 1);
assert.equal(pingOnly.runs, 0);
assert.deepEqual(Array.from(pingOnly.workerIds), ['warm-only']);
assert.equal(pingOnly.workers, 1);
console.log('PASS EV-WORKER-TURN-ACCOUNTING: carry-over and ping request workers counted; runs unchanged');
