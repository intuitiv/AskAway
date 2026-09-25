// A window that lost the MCP port to a reloading host takes it over once it frees. Run: node test-mcp-port-reclaim.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ts = require(path.join(__dirname, 'node_modules', 'typescript'));

const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-port-reclaim-'));
fs.writeFileSync(path.join(buildDir, 'sharedPort.js'), ts.transpileModule(fs.readFileSync(path.join(__dirname, 'src', 'mcp', 'sharedPort.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { listenWhenFree } = require(path.join(buildDir, 'sharedPort.js'));

const get = (port) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve(body)); })
        .on('error', () => resolve('REFUSED'));
});
const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));

(async () => {
    const oldHost = http.createServer((_req, res) => res.end('old-host'));
    await listen(oldHost, 0);
    const port = oldHost.address().port;

    let claimedAt = 0;
    const stop = listenWhenFree(port, (_req, res) => res.end('this-window'), () => { claimedAt = Date.now(); }, 20);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await get(port), 'old-host', 'the port stays with its holder while it is alive');
    assert.equal(claimedAt, 0);

    const released = Date.now();
    await close(oldHost);
    for (let i = 0; i < 50 && !claimedAt; i++) { await new Promise((r) => setTimeout(r, 20)); }
    assert.ok(claimedAt, 'the window claims the port after the old host lets go');
    assert.equal(await get(port), 'this-window', 'workers wired to the fixed port now reach this window');

    stop();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await get(port), 'REFUSED', 'stopping releases the port for the next window');

    const neverFree = http.createServer((_req, res) => res.end('holder'));
    await listen(neverFree, 0);
    let claimed = false;
    const stopWaiting = listenWhenFree(neverFree.address().port, (_req, res) => res.end('x'), () => { claimed = true; }, 10);
    await new Promise((r) => setTimeout(r, 50));
    stopWaiting();
    await close(neverFree);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(claimed, false, 'a stopped waiter never claims the port later');

    console.log(`EV-MCP-PORT PortReclaim: PASS holderKeepsPort=true claimAfterRelease=${claimedAt - released}ms servesWindow=true stopReleases=true stoppedNeverClaims=true`);
})().catch((error) => { console.error(error); process.exit(1); });
