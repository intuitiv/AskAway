const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const root = path.join(__dirname, 'build/webex-reply-poll-' + process.pid);
fs.mkdirSync(root, { recursive: true });
const timers = new Map();
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ 'webex.enabled': true, 'webex.roomId': 'workspace' })[key] ?? fallback }) } };
const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/services/webexService.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(id => id === 'vscode' ? vscode : require(id), loaded, loaded.exports,
    (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; }, id => timers.delete(id));
let sequence = 0;
const messages = [], requests = [], delivered = [];
const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1'); requests.push({ method: req.method, url });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST') {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const message = { id: 'post-' + ++sequence, roomId: body.roomId, text: body.text, personId: 'reviewer', created: new Date().toISOString() };
            messages.push(message); res.end(JSON.stringify(message));
        } else if (url.pathname.endsWith('/messages')) {
            const parent = url.searchParams.get('parentId');
            res.end(JSON.stringify({ items: messages.filter(m => parent ? m.parentId === parent : !m.parentId).slice(-500).reverse() }));
        } else { res.end('{}'); }
    });
});
let service;
async function tick() {
    assert.equal(timers.size, 1, 'one outbound poll timer');
    const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback();
}
function delay() { return timers.values().next().value?.delay; }
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const options = { baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
    const create = async () => {
        const instance = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture' }) }, path.join(root, 'absent'), options);
        await instance.reloadConfig(); instance.onReply((task, text) => delivered.push({ task, text })); return instance;
    };
    service = await create();
    await service.postQuestion('first', 'Question');
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(delay(), 60000);
    await service.sendText('Activity', 'Activity');
    assert.equal(delay(), 2000, 'post reschedules fast polling');
    await service.finishLive(messages.at(-1).id, 'Other', 'Pending', 'other');
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(delay(), 60000);
    messages.push({ id: 'reply-1', roomId: 'workspace', text: 'Answer', personId: 'reviewer', created: new Date().toISOString() });
    await tick();
    assert.deepEqual(delivered, [{ task: 'first', text: 'Answer' }]);
    assert.equal(delay(), 2000, 'reply reschedules fast polling for remaining task');
    service.resolveTask('other');
    assert.ok(requests.some(r => r.method === 'GET' && !r.url.searchParams.has('parentId') && r.url.searchParams.get('roomId') === 'workspace'));
    console.log('PASS workspace polling, same-person reply, no own-post echo and post/reply backoff reset');
    await service.postQuestion('second', 'Next');
    service.dispose(); service = await create();
    await tick();
    assert.equal(delivered.length, 1, 'reload must not replay own posts or processed reply');
    const parentId = messages.at(-1).id;
    messages.push({ id: 'reply-2', parentId, text: 'Thread answer', personId: 'reviewer', created: new Date().toISOString() });
    await tick(); assert.equal(delivered.length, 2);
    assert.deepEqual(delivered[1], { task: 'second', text: 'Thread answer' });
    console.log('PASS reload restores tracked posts and deduplication; threaded reply delivered once');
    for (let i = 0; i < 505; i++) await service.sendText('Bounded', 'Bounded');
    const ledger = JSON.parse(fs.readFileSync(path.join(root, '.askaway/webex-messages.json'), 'utf8'));
    assert.ok(ledger.posted.length <= 500 && ledger.processed.length <= 500 && ledger.tasks.length <= 500);
    assert.ok(ledger.posted.length > 0 && ledger.processed.includes('reply-2'));
    assert.ok(!JSON.stringify(ledger).includes('fixture'));
    await service.postQuestion('cancelled', 'Cancel'); service.resolveTask('cancelled');
    assert.equal(timers.size, 0);
    console.log('PASS bounded non-secret persisted ledger and turn cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { service?.dispose(); await new Promise(resolve => server.close(resolve)); });
