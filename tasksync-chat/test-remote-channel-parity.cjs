const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const ts = require('typescript');
const { fixture, failure } = require('./test-webex-remote-adapter.cjs');
(async () => {
    const f = fixture();
    const telegram = new f.api.TelegramService();
    try {
        const webex = await f.create();
        const fixtureFetch = global.fetch;
        global.fetch = async (url, options = {}) => {
            if (String(url).includes('api.telegram.org') && (options.body instanceof FormData || Buffer.isBuffer(options.body))) {
                f.calls.push({ channel: 'telegram', method: options.method || 'POST', url: new URL(String(url)), body: options.body });
                return Response.json({ ok: true, result: { message_id: 1000 } });
            }
            return fixtureFetch(url, options);
        };
        const providerBytes = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
        assert.ok(!/(?<!\r)\n/.test(providerBytes), 'provider must retain CRLF');
        const method = providerBytes.slice(providerBytes.indexOf('    public async getTurnMetricsSnapshot()'), providerBytes.indexOf('    private _stabilizeObservabilityMetrics'));
        const totalsBuild = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/workers/turnBudget.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
        const totalsModule = { exports: {} }; new Function('require', 'module', 'exports', totalsBuild.outputFiles[0].text)(require, totalsModule, totalsModule.exports);
        const providerModule = { exports: {} };
        new Function('turnTotals', 'module', 'exports', ts.transpileModule(`export class Provider { ${method} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(totalsModule.exports.turnTotals, providerModule, providerModule.exports);
        const provider = new providerModule.exports.Provider();
        Object.assign(provider, { _broadcastObservabilityMetrics: async () => {}, _turnRequests: [{ inputTokens: 12500 }], _deriveLastRequest: () => ({ requestCount: 20, nanoAiu: 100000000000, inputTokens: 20000, outputTokens: 2000, cachedTokens: 10000 }), _workerSpend: () => ({ requests: 8, dollars: 0.95, runs: 4, workers: 3, workerIds: ['worker-a', 'worker-b', 'worker-c'], inputTokens: 5000, outputTokens: 750, cachedTokens: 2500 }) });
        const metrics = await provider.getTurnMetricsSnapshot();
        assert.equal(metrics.requests, 28, 'production provider must pass combined requests');
        assert.equal(metrics.workers, 3); assert.equal(metrics.workerDollars, 0.95); assert.equal(metrics.cacheHitPct, 50);
        assert.equal(metrics.efficiencyScore, 0, 'efficiency must use canonical cost/cache/context formula');
        assert.deepEqual(metrics.workerIds, ['worker-a', 'worker-b', 'worker-c']); assert.equal(metrics.turnOutputTokens, 2750);
        const status = 'Running · 28 requests · 3 workers · $1.95 · 12.5K input · 2.75K output · 50% cache · efficiency 88';
        const final = f.api.telegramHandoffUpdate({ handoff: 'Impact: delivered.\nNext: Continue?', details: 'Not in text' }, metrics);
        for (const [name, service] of [['telegram', telegram], ['webex', webex]]) {
            const id = await service.sendText(status, status); assert.ok(id);
            assert.equal(await service.editLive(id, status + ' · stuck'), true);
            assert.equal(await service.finishLive(id, '', final, 'handoff:parity'), true);
            const sent = f.calls.filter(c => c.channel === name && c.body && !(c.body instanceof FormData));
            for (const field of ['28 requests', '3 workers', '$1.95', '12.5K', '2.75K', '50%', '88', 'stuck']) assert.ok(sent.some(c => JSON.stringify(c.body).includes(field)), `${name} loses status field ${field}`);
            const text = sent.map(c => c.body.markdown || c.body.text || '').find(text => text.includes('Impact: delivered.'));
            assert.ok(text && text.includes('$1.95') && text.includes('12.5K') && text.includes('2.75K'), `${name} loses final cost/tokens`);
            for (const field of ['28 requests', '3 workers', '$0.95 workers', 'worker-a', 'worker-b', 'worker-c', '50% cache', `efficiency ${metrics.efficiencyScore ?? '–'}`]) assert.ok(text.includes(field), `${name} loses final worker metric ${field}`);
            assert.ok(text.indexOf('$1.95') < text.indexOf('Impact:'), 'banner must precede handoff'); assert.ok(!text.includes('Not in text'));
        }
        const relayBundle = esbuild.buildSync({ stdin: { contents: "export * from './src/commentary/telegramLive'; export * from './src/services/responsePdf';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
        const relayModule = { exports: {} }; let pdf = true;
        new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', relayBundle.outputFiles[0].text)(id => id === 'vscode' ? {} : id === 'child_process' ? { execFile: (command, args, options, callback) => { assert.equal(options.env.MD_PDF_LAYOUT, 'mobile'); if (pdf) fs.writeFileSync(args[1], '%PDF\n' + fs.readFileSync(args[0])); callback(pdf ? null : new Error('conversion unavailable')); } } : require(id), relayModule, relayModule.exports, () => ({}), () => {});
        const m = relayModule.exports;
        const converter = path.join(f.root, 'fake-converter'); fs.writeFileSync(converter, 'fake');
        for (const [name, service] of [['telegram', telegram], ['webex', webex]]) {
            service.resolveHandoffs();
            let now = Date.now(); const start = now;
            const relay = new m.TelegramLiveCommentary(() => name === 'webex' ? m.webexLivePoster(service, 'Fixture') : service, 'Fixture', { minEditMs: 0, now: () => now, activity: () => ({ lastActivityAt: start, requests: metrics.requests, dollars: 1.95, workers: 3, lastIn: 12500, turnOut: 2750 }) });
            const view = (at, prompt, items = []) => ({ turnStarts: [at], currentPrompt: prompt, items });
            try {
                const before = f.calls.length;
                await relay.update(view(start, 'New turn'));
                await relay.update(view(start, 'New turn', [{ ts: start + 1, kind: 'update', text: 'Working commentary' }, { ts: start + 2, kind: 'heads-up', text: 'Need confirmation' }]));
                now += 120000; await relay.tick(); now += 240000; await relay.tick();
                await relay.update(view(now, 'Queued turn'));
                const sent = f.calls.slice(before).filter(c => c.channel === name);
                const text = sent.map(c => c.body?.markdown || c.body?.text || '').join('\n');
                for (const field of ['New turn', 'Working commentary', 'HEADS-UP', 'No activity', 'Queued turn', 'Continued', '28 requests', '3 workers']) assert.ok(text.includes(field), `${name} lifecycle loses ${field}`);
                assert.ok(sent.some(c => name === 'webex' ? c.method === 'PUT' : c.url.pathname.endsWith('editMessageText')), 'commentary/status must edit');
                const digest = m.remoteDigestPoster(() => ({ isConfigured: () => service.isConfigured(), sendLive: html => service.sendText(html, html) }));
                assert.equal(await digest(['PR: https://example.invalid/pr/1', 'Evidence: tests pass', 'Duration: 3m', 'Model: fixture', 'Blocker: none', 'Decision: review']), true);
                assert.ok((f.calls.at(-1).body.markdown || f.calls.at(-1).body.text).includes('Decision: review'));
                for (const kind of ['pdf', 'md']) {
                    pdf = kind === 'pdf';
                    const document = await m.renderResponseFile('Whole response\n## Response Handoff\nImpact: delivered.', { converter });
                    assert.equal(document.kind, kind);
                    try {
                        assert.equal(await service.finishLive(name === 'webex' ? 'live' : 1, '', final, `handoff:lifecycle-${kind}`), true);
                        assert.equal(await service.sendDocument(document.file, 'Full response'), true);
                        const upload = f.calls.at(-1).body;
                        const uploadedText = name === 'webex' ? await upload.get('files').text() : upload.toString();
                        assert.ok(uploadedText.includes('Whole response')); assert.ok(name === 'webex' ? upload.get('files').name.endsWith('.' + kind) : uploadedText.includes(`filename="response.${kind}"`));
                        assert.equal(service.getActiveTaskCount(), 1);
                        service.resolveHandoffs(); assert.equal(service.getActiveTaskCount(), 0, 'local/next turn stops polling');
                    } finally { document.cleanup(); }
                }
                const replies = []; service.onReply((task, text) => replies.push({ task, text }));
                await service.postQuestion('reply-parity', 'Continue?');
                f.respond(call => name === 'webex' && call.method === 'GET' ? Response.json({ items: [{ id: 'reply-lifecycle', text: 'Yes', personId: 'same-person', created: '2099-01-01T00:00:00Z' }] }) : name === 'telegram' && call.url.pathname.endsWith('getUpdates') ? Response.json({ ok: true, result: [{ update_id: 1, message: { message_id: 999, chat: { id: 'chat' }, from: { id: 2, first_name: 'Reviewer' }, text: 'Yes' } }] }) : undefined);
                await service._poll(); await service._poll(); assert.deepEqual(replies, [{ task: 'reply-parity', text: 'Yes' }]);
                f.respond(undefined);
            } finally { relay.dispose(); }
        }
        f.settings['telegram.enabled'] = false; telegram.reloadConfig(); const beforeDisabled = f.calls.length;
        assert.equal(await telegram.sendText('Disabled', 'Disabled'), undefined); assert.equal(f.calls.length, beforeDisabled);
        console.log('PASS EV-REMOTE-CHANNEL-PARITY matched=2 provider metrics; new/queued turns; commentary/heads-up; two-minute/stuck status; full final banner; PDF/Markdown; digest; once-only reply/local stop; disabled Telegram; CRLF');
    } finally { telegram.dispose(); f.close(); }
})().catch(failure);
