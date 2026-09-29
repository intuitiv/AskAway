// Tool waits are budgeted from the provider's cache clock (the last model request's START), not from the tool's own start.
// Real gradle engine with a fake gradlew, real worker tool with a fake runtime, real cache clock. Run: node test-cache-clock-waits.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-cache-clock-'));
process.env.HOME = home;

(async () => {
    const build = await esbuild.build({
        stdin: {
            contents: [
                "export { noteRequestStart, cacheSafeWaitMs, cacheClockFile } from './src/observability/cacheClock';",
                "export { dispatchGradle } from './src/gradle/gradleEngine';",
                "export { workerTool } from './src/workers/workerTools';",
            ].join('\n'),
            resolveDir: __dirname, sourcefile: 'cache-clock-entry.ts', loader: 'ts',
        },
        bundle: true, format: 'cjs', platform: 'node', write: false, external: ['zod'],
    });
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const m = mod.exports;

    // The request that issued the tool call started 100s ago: the model spent that long answering.
    const started = Date.now() - 100_000;
    m.noteRequestStart(started, 'chat-1');
    const budget = m.cacheSafeWaitMs(240_000);
    assert.ok(budget <= 170_000 && budget >= 165_000, `300s TTL - 100s already gone - 30s margin, got ${budget}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(m.cacheClockFile(), 'utf8')).sessions, { 'chat-1': started }, 'hooks can read the per-session start');
    assert.equal(m.cacheSafeWaitMs(240_000, started + 400_000), 240_000, 'a cache already cold gains nothing from a shorter wait');
    assert.equal(m.cacheSafeWaitMs(240_000, started + 290_000), 5_000, 'near the edge it still waits a moment');

    // Worker wait through the VS Code tool: the runtime is asked for the cache-safe seconds, not the requested 240.
    const asked = [];
    const runtime = { wait: async (runId, seconds) => { asked.push(seconds); return { status: 'STILL_RUNNING', runId, waitedSeconds: seconds }; } };
    const lmWorker = m.workerTool(() => runtime, home, { waitBudgetMs: (ms) => m.cacheSafeWaitMs(ms) });
    const lmReply = await lmWorker.run({ action: 'wait', runId: 'run-1', timeoutSeconds: 240 });
    assert.equal(lmReply.status, 'STILL_RUNNING');
    assert.ok(asked[0] >= 165 && asked[0] <= 170, `worker wait capped by the cache clock, got ${asked[0]}s`);
    const mcpWorker = m.workerTool(() => runtime, home);
    await mcpWorker.run({ action: 'wait', runId: 'run-1', timeoutSeconds: 240 });
    assert.equal(asked[1], 240, 'MCP callers keep their own cache, so no budget is applied');

    // Gradle wait through the real engine: a build that runs 30s returns at the budget with a note to poll again.
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-fake-gradle-'));
    fs.writeFileSync(path.join(project, 'gradlew'), '#!/bin/sh\nsleep 30\n');
    fs.chmodSync(path.join(project, 'gradlew'), 0o755);
    const start = await m.dispatchGradle({ action: 'start', tasks: ['test'], optimize: false }, project);
    assert.ok(start.buildId, JSON.stringify(start));
    const t0 = Date.now();
    const waited = await m.dispatchGradle({ action: 'wait', buildId: start.buildId, timeoutMs: 60_000 }, project, { waitBudgetMs: () => 1_500 });
    const tookMs = Date.now() - t0;
    assert.equal(waited.state, 'RUNNING');
    assert.ok(tookMs < 5_000, `returned at the cache budget, took ${tookMs}ms`);
    assert.equal(waited.waitCapped, true);
    assert.match(waited.note, /capped at 2s to preserve prompt cache/);
    await m.dispatchGradle({ action: 'stop', buildId: start.buildId }, project);

    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    console.log(`EV-CACHE-CLOCK WaitsFromRequestStart: PASS budget=${Math.round(budget / 1000)}s workerWait=${asked[0]}s mcpUnbudgeted=true gradleCapped=true hookFile=true`);
    process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
