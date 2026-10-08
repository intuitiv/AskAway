const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, 'build/workers-server-status-' + process.pid);
fs.mkdirSync(root, { recursive: true });
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function load(file, imports) {
    const exports = {};
    vm.runInNewContext(compile(file), { exports, require: id => imports[id] ?? require(id), process, setTimeout, console, URL });
    return exports;
}
const shared = load('workers/sharedServer.ts', {});
let probes = 0, spawns = 0;
shared.defaultServerDeps.probe = url => { probes++; return shared.probeHttp(url); };
shared.defaultServerDeps.spawn = () => { spawns++; throw new Error('must not spawn for an existing server or view'); };
const runtime = { serverEndpoint: '', list: () => [], setServerEndpoint(endpoint) { this.serverEndpoint = endpoint; }, rehydrate() {} };
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: () => false }) } };
const host = load('workers/workerHost.ts', {
    vscode, './sharedServer': shared, './openCodeRuntime': { OpenCodeWorkerRuntime: class { constructor() { return runtime; } } },
    './workerProfiles': { loadWorkerProfiles: () => [] }, './keepWarm': { startKeepWarmTimer: () => () => {} },
    '../commentary/commentary': {}, '../observability/cacheClock': {}
});
const source = fs.readFileSync(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8');
const imports = {};
for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) imports[match[1]] = {};
imports.vscode = vscode;
imports['../workers/workerHost'] = host;
const projection = load('workers/workersState.ts', { './openCodeRuntime': {}, './workerRouter': {} });
imports['../workers/workersState'] = projection;
imports['../workers/evalScoreboard'] = { loadEvalScoreboard: () => ({}) };
const { McpServerManager } = load('mcp/mcpServer.ts', imports);
const providerText = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const start = providerText.indexOf('    private _refreshWorkersState(): void {');
const end = providerText.indexOf('\n    }', start) + 6;
const output = {};
vm.runInNewContext('out.Provider = class {' + providerText.slice(start, end).replace('private _refreshWorkersState(): void', '_refreshWorkersState()') + '};', { out: output, vscode, ...host, ...projection, console });
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const ui = {}, icon = { className: '' }, button = { querySelector: () => icon }, list = { innerHTML: '', querySelectorAll: () => [] };
const blocks = [['// ── Usage banner', '// ── end Usage banner ──'], ['// ── Turn trace rows: pure render', '// ── end Turn trace rows ──'], ['// ── Workers tab: pure render', '// ── end Workers pure render ──']];
vm.runInNewContext(blocks.map(([from, to]) => webview.slice(webview.indexOf(from), webview.indexOf(to))).join('\n') + webview.slice(webview.indexOf('    var workersState = null;'), webview.indexOf('    function initWorkersTab()')) + '\nout.apply = applyWorkersState;', {
    out: ui, document: { getElementById: id => id === 'workers-server-btn' ? button : id === 'workers-list' ? list : null }, traceOpenIds: () => ({})
});
const pushed = [];
const provider = new output.Provider();
provider._workerSpend = () => ({ workerIds: [] });
provider._broadcast = message => { pushed.push(message.data); ui.apply(message.data); };
provider.refreshWorkersState = () => provider._refreshWorkersState();
provider.setWorkersStateSource = source => { provider._workersStateSource = source; };
for (const name of ['setWorkerTraceSource', 'setWorkerCancelSource', 'setWorkerArchiveSource', 'setServerRestartSource']) provider[name] = () => {};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5)); };
const server = http.createServer((req, res) => { assert.equal(req.url, '/config'); res.end('{}'); });
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    process.env.ASKAWAY_OPENCODE_SERVER_URL = endpoint;
    // The sidebar is ready before deferred MCP initialization (which can wait for remote setup prompts).
    provider._refreshWorkersState();
    await settle();
    assert.equal(icon.className, 'codicon codicon-debug-restart', 'reachable server must render restart before MCP initialization');
    assert.equal(pushed.at(-1)?.server.state, 'ATTACHED', 'activation probe must republish without manual refresh');
    assert.equal(pushed.at(-1).server.endpoint, endpoint);
    assert.equal(host.sharedServerStatus().state, 'ATTACHED');
    assert.equal(probes, 1); assert.equal(spawns, 0);
    console.log('PASS activation discovers pre-existing server and republishes its port without spawning');
    new McpServerManager(provider);
    await settle();
    provider._refreshWorkersState(); await settle();
    assert.equal(probes, 3, 'one probe on MCP initialization and tab refresh, none during republish');
    assert.equal(pushed.at(-1).server.state, 'ATTACHED');
    assert.equal(icon.className, 'codicon codicon-debug-restart');
    const before = pushed.length;
    await host.sharedWorkerRuntimeReady(root); await settle();
    assert.ok(pushed.length > before, 'worker attach publishes without manual refresh');
    assert.equal(pushed.at(-1).server.state, 'ATTACHED');
    assert.equal(probes, 4, 'one attach probe, no republish loop');
    console.log('PASS worker attach publishes attached; exactly one probe per trigger');
    await new Promise(resolve => server.close(resolve));
    provider._refreshWorkersState(); await settle();
    assert.equal(pushed.at(-1).server.state, 'NOT_ATTACHED');
    assert.equal(icon.className, 'codicon codicon-play', 'unanswered server must render play');
    assert.equal(host.sharedServerStatus().state, 'NOT_ATTACHED');
    assert.equal(probes, 5); assert.equal(spawns, 0);
    console.log('PASS unanswered server publishes not started with one probe and no loop');
    await new Promise(resolve => server.listen(Number(new URL(endpoint).port), '127.0.0.1', resolve));
    provider._refreshWorkersState(); await settle();
    assert.equal(icon.className, 'codicon codicon-debug-restart', 'server started by another window must render restart');
    console.log('PASS webview boundary: reachable shared server renders codicon-debug-restart; unanswered renders codicon-play; another-window startup restores restart');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.close(); delete process.env.ASKAWAY_OPENCODE_SERVER_URL; });
