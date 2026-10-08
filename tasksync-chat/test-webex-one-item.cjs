const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const root = path.join(__dirname, 'build', 'webex-one-item-' + process.pid);
fs.mkdirSync(path.join(root, '.askaway'), { recursive: true });
fs.writeFileSync(path.join(root, '.askaway/webex-spaces.json'), JSON.stringify({ self: { workspaceRoomId: 'workspace' } }));
const timers = new Map(), calls = [], messages = [], waits = [];
let service, visible = true, reads = 0, pdf = true;
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: root } }], getConfiguration: () => ({ get: (key, fallback) => ({ 'webex.enabled': true, 'webex.roomId': 'workspace', 'webex.notifyOnTurnEnd': true })[key] ?? fallback }) } };
const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/services/webexService'; export * from './src/services/webexIncomingWebhook'; export * from './src/services/handoffNotifier';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', bundle.outputFiles[0].text)(id => id === 'vscode' ? vscode : id === 'child_process' ? { execFile: (file, args, options, callback) => { if (pdf) fs.writeFileSync(args[1], '%PDF-fixture'); callback(pdf ? null : new Error('unavailable')); } } : require(id), loaded, loaded.exports, (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; }, id => timers.delete(id));
const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, url: req.url, raw, auth: req.headers.authorization });
    if (req.url.startsWith('/incoming/')) {
        messages.push({ id: 'summary-' + messages.length, markdown: JSON.parse(raw).markdown, personEmail: 'incoming-webhooks@webex.bot', created: new Date().toISOString() });
        res.writeHead(204); res.end();
    } else { res.setHeader('Content-Type', 'application/json'); if (req.method === 'GET') reads++; res.end(JSON.stringify(req.method === 'GET' ? { items: visible && reads >= 2 ? messages : [] } : { id: 'file-' + calls.length })); }
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const hook = new loaded.exports.WebexIncomingWebhook({ get: async () => 'https://webexapis.com/v1/webhooks/incoming/fixture' }, undefined, 'linux', base + '/incoming');
    service = new loaded.exports.WebexService(undefined, { tokens: async () => ({ accessToken: 'fixture-token' }) }, path.join(root, 'absent'), { baseUrl: base + '/v1', wait: async ms => waits.push(ms) }, hook);
    await service.reloadConfig();
    const converter = path.join(root, 'converter'); fs.writeFileSync(converter, 'fixture'); process.env.ASKAWAY_MD_TO_PDF = converter;
    try {
        for (const [index, kind] of ['pdf', 'md', 'fallback'].entries()) {
            pdf = kind === 'pdf'; visible = kind !== 'fallback'; reads = 0;
            const notifier = new loaded.exports.HandoffNotifier(loaded.exports.createHandoffTargets(() => service, () => undefined), undefined, () => {});
            notifier._readStamp = () => 100 + index; notifier._findHandoff = () => ({ details: 'Whole response', handoff: 'Next: ' + kind });
            const before = calls.length; await notifier._onTurnEnd();
            const sent = calls.slice(before).filter(call => call.method === 'POST'); assert.equal(sent.length, 2);
            assert.ok(sent[1].url.startsWith('/incoming/')); assert.equal(sent[1].auth, undefined);
            assert.equal(sent[0].auth, 'Bearer fixture-token'); assert.ok(sent[0].raw.includes('name="files"'));
            assert.ok(sent[0].raw.includes('name="markdown"') && sent[0].raw.includes('Next: ' + kind));
            if (visible) { assert.ok(reads >= 2, 'retry until finish alert appears'); }
            else { assert.equal(reads, 5, 'unresolved finish alert retains synthetic tracking after bounded retries'); }
            assert.ok(sent[0].raw.includes(`filename="response.${pdf ? 'pdf' : 'md'}"`));
            let status = service.getTokenStatus(); assert.equal(status.isPolling, true); assert.equal(status.lastPollAt, null); assert.ok(status.nextPollAt >= Date.now());
            const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback();
            status = service.getTokenStatus(); assert.ok(status.lastPollAt <= Date.now() && status.lastPollAt > 0); assert.ok(status.nextPollAt > status.lastPollAt);
            service.resolveTask('handoff:' + (100 + index)); status = service.getTokenStatus(); assert.equal(status.lastPollAt, null); assert.equal(status.nextPollAt, null);
        }
        assert.ok(waits.every(ms => ms > 0 && ms <= 1000));
        console.log('PASS Webex combined final: PDF/MD with handoff markdown, no-ID finish alert, bounded ID lookup, lastPollAt/nextPollAt while polling and null when stopped');
    } finally { service.dispose(); delete process.env.ASKAWAY_MD_TO_PDF; await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error('FAIL Webex one item:', error.message); process.exitCode = 1; });
