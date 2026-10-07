const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const output = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/memoryServer.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
function caller() {
    const loaded = { exports: {} };
    vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require, process,
        fetch, URL, AbortSignal, Date });
    return loaded.exports.ensureMemoryServer;
}
(async () => {
    const spawns = [], requests = [];
    let listening = false, unrefs = 0;
    const ports = {
        executable: '/local/agentmemory', config: '/local/iii-config.yaml',
        env: { PATH: '/bin', HOME: '/fixture', OPENAI_API_KEY: 'fixture', ANTHROPIC_API_KEY: 'fixture',
            GEMINI_API_KEY: 'fixture', GOOGLE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture',
            MINIMAX_API_KEY: 'fixture', VOYAGE_API_KEY: 'fixture', COHERE_API_KEY: 'fixture',
            FUTURE_PROVIDER_TOKEN: 'fixture', NODE_OPTIONS: '--require unsafe',
            AUTO_FORGET_ENABLED: 'true', CONSOLIDATION_ENABLED: 'true', EMBEDDING_PROVIDER: 'openai',
            AGENTMEMORY_III_CONFIG: '/unsafe/non-loopback.yaml' },
        spawn(command, args, options) {
            spawns.push({ command, args, options }); listening = true;
            return { unref() { unrefs++; } };
        },
        async fetch(url, options) {
            requests.push({ url, options });
            if (!listening) throw new Error('connection refused');
            return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
        },
    };
    const first = await caller()(ports);
    const second = await caller()(ports); // Separate module/window, no shared JS state.
    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.equal(second.state, 'ATTACHED');
    assert.equal(spawns.length, 1);
    assert.equal(unrefs, 1);
    const { args, options } = spawns[0];
    assert.deepEqual(Array.from(args), ['--port', '3111']);
    assert.equal(options.detached, true);
    assert.equal(options.stdio, 'ignore');
    assert.equal(options.env.PATH, '/bin');
    for (const key of Object.keys(ports.env).filter(k => /KEY|TOKEN|NODE_OPTIONS/.test(k))) {
        assert.equal(options.env[key], undefined, `must not inherit ${key}`);
    }
    assert.equal(options.env.CI, '1');
    assert.equal(options.env.EMBEDDING_PROVIDER, 'local');
    assert.equal(options.env.AUTO_FORGET_ENABLED, 'false');
    assert.equal(options.env.CONSOLIDATION_ENABLED, 'false');
    assert.equal(options.env.AGENTMEMORY_ALLOW_AGENT_SDK, 'false');
    assert.equal(options.env.AGENTMEMORY_AUTO_COMPRESS, 'false');
    assert.equal(options.env.AGENTMEMORY_III_CONFIG, ports.config);
    for (const request of requests) {
        assert.equal(new URL(request.url).hostname, '127.0.0.1');
        assert.equal(new URL(request.url).pathname, '/agentmemory/health');
        assert.equal(request.options.redirect, 'error');
    }
    for (const response of [ { ok: false, status: 503 }, { ok: false, status: 401 },
        { ok: true, status: 200, json: async () => ({ status: 'unhealthy' }) },
        { ok: true, status: 200, json: async () => ({ foreign: true }) } ]) {
        await assert.rejects(caller()({ ...ports, fetch: async () => response }), /agentmemory \/health (failed \(HTTP \d+\)|returned an unhealthy or foreign server); memory server unavailable/);
    }
    await assert.rejects(caller()({ ...ports, fetch: async () => { throw new Error('private fixture'); } }),
        error => /agentmemory \/health.*memory server unavailable/.test(error.message) && !error.message.includes('private fixture'));
    assert.equal(spawns.length, 2); // Only the unavailable-port case attempted startup again.
    assert.match(require('./package.json').scripts['test:workers'], /test-memory-server-lifecycle\.cjs/);
    console.log('PASS EV-MEMORY-SERVER-LIFECYCLE: single spawn, second-window attach, scrubbed env, flags off, loopback, visible health failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
