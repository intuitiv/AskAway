const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;

async function loadRuntime() {
    const build = await esbuild.build({
        stdin: {
            contents: [
                "export { TelegramService } from './src/services/telegramService';",
                "export { HandoffNotifier, createHandoffTargets, telegramHandoffUpdate } from './src/services/handoffNotifier';",
                "export { TelegramLiveCommentary } from './src/commentary/telegramLive';"
            ].join('\n'),
            resolveDir: root,
            sourcefile: 'telegram-delivery-entry.ts',
            loader: 'ts'
        },
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        plugins: [{
            name: 'vscode-stub',
            setup(builder) {
                builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'test' }));
                builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                    contents: `module.exports = {
                        workspace: {
                            name: 'TaskSync',
                            workspaceFolders: [],
                            getConfiguration() {
                                return { get(key, fallback) {
                                    const values = { 'telegram.enabled': true, 'telegram.botToken': 'test-token', 'telegram.chatId': 'test-chat', 'telegram.notifyOnTurnEnd': true };
                                    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
                                } };
                            }
                        },
                        commands: { async executeCommand() {} },
                        window: { showErrorMessage() {}, showWarningMessage() {} },
                        Uri: { file(value) { return { fsPath: value }; } }
                    };`,
                    loader: 'js'
                }));
            }
        }]
    });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, loaded, loaded.exports);
    return loaded.exports;
}

/** A fake Telegram Bot API on a real local HTTP port; `script(call)` may answer a request, otherwise it succeeds. */
function startFakeTelegram() {
    const calls = [];
    let script = () => undefined;
    let nextId = 100;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const method = req.url.split('/').pop().split('?')[0];
            const isJson = String(req.headers['content-type']).includes('json');
            const call = { method, raw, at: Date.now(), json: isJson && raw.length ? JSON.parse(raw.toString('utf8')) : undefined };
            const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
            if (method === 'getChat') { reply(200, { ok: true, result: { is_forum: true } }); return; }
            if (method === 'createForumTopic') { reply(200, { ok: true, result: { message_thread_id: 77 } }); return; }
            if (method === 'getUpdates' || method === 'getMe') { reply(200, { ok: true, result: method === 'getMe' ? { id: 9 } : [] }); return; }
            calls.push(call);
            const scripted = script(call);
            if (scripted) { reply(scripted.status, scripted.body); return; }
            reply(200, { ok: true, result: { message_id: ++nextId } });
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        port: server.address().port,
        calls,
        sends: () => calls.filter(c => c.method === 'sendMessage'),
        script: fn => { script = fn; },
        reset: () => { calls.length = 0; script = () => undefined; },
        close: () => new Promise(done => server.close(done))
    })));
}

function assertBalancedHtml(html) {
    assert.ok(!/<[^>]*$/.test(html), `HTML ends inside a tag: ...${html.slice(-40)}`);
    assert.ok(!/&[a-z#0-9]*$/i.test(html), `HTML ends inside an entity: ...${html.slice(-40)}`);
    for (const tag of ['b', 'i', 'code', 'pre', 'u']) {
        const opens = (html.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'g')) || []).length;
        const closes = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        assert.equal(opens, closes, `unbalanced <${tag}> in ${html.length}-char message`);
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const runtime = await loadRuntime();
    const fake = await startFakeTelegram();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-delivery-test-'));
    const responseTmp = path.join(tmp, 'tmp');
    fs.mkdirSync(responseTmp);
    process.env.TMPDIR = responseTmp;

    // Converters: one "converts" by copying the markdown, one fails like a broken install.
    const okConverter = path.join(tmp, 'md-to-pdf-ok');
    fs.writeFileSync(okConverter, `#!/bin/sh\necho "$MD_PDF_LAYOUT" > "${tmp}/layout.txt"\ncp "$1" "$2"\n`, { mode: 0o755 });
    const badConverter = path.join(tmp, 'md-to-pdf-bad');
    fs.writeFileSync(badConverter, '#!/bin/sh\nexit 3\n', { mode: 0o755 });

    const realFetch = global.fetch;
    global.fetch = (url, init) => realFetch(String(url).replace('https://api.telegram.org', `http://127.0.0.1:${fake.port}`), init);

    const service = new runtime.TelegramService();
    try {
        // A(1) Oversized HTML: the markdown is cut before converting, so no tag or entity is ever split.
        const big = Array.from({ length: 400 }, (_, i) => `- **item ${i}** uses \`code ${i}\` & <angle> text`).join('\n');
        fake.script(call => call.json?.parse_mode === 'HTML' && call.json.text.length > 4096
            ? { status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: message is too long' } } : undefined);
        assert.equal(await service.postText(big, 'fallback'), true);
        assert.equal(fake.sends().length, 1, 'a bounded message needs exactly one attempt');
        assert.equal(fake.sends()[0].json.parse_mode, 'HTML');
        assert.ok(fake.sends()[0].json.text.length <= 4000);
        assertBalancedHtml(fake.sends()[0].json.text);

        // A(2) Entity parse error: one retry without parse_mode, tags stripped.
        fake.reset();
        fake.script(call => call.json?.parse_mode ? { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" } } : undefined);
        const liveId = await service.sendLive('<b>bad &amp; broken');
        assert.equal(typeof liveId, 'number', 'live send must survive a parse error');
        assert.equal(fake.sends().length, 2);
        assert.equal(fake.sends()[1].json.parse_mode, undefined);
        assert.equal(fake.sends()[1].json.text, 'bad & broken');

        // A(3) 429: wait retry_after then succeed.
        fake.reset();
        let limited = false;
        fake.script(() => { if (limited) { return undefined; } limited = true; return { status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } } }; });
        assert.equal(await service.postText('rate limited', 'fb'), true);
        const [first, second] = fake.sends();
        assert.ok(second.at - first.at >= 900, `retry_after must be honoured, waited ${second.at - first.at}ms`);

        // Edit edge cases: "not modified" is success; "not found" becomes a new message.
        fake.reset();
        fake.script(() => ({ status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' } }));
        assert.equal(await service.editLive(5, 'same'), true);
        fake.reset();
        fake.script(call => call.method === 'editMessageText' ? { status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' } } : undefined);
        assert.equal(await service.editLive(5, 'gone'), true);
        assert.deepEqual(fake.calls.map(c => c.method), ['editMessageText', 'sendMessage']);
        assert.equal(fake.calls[1].json.message_id, undefined);

        // A(4) A failed live edit is retried, so the final update is not dropped.
        fake.reset();
        let failEdits = 1;
        fake.script(call => call.method === 'editMessageText' && failEdits-- > 0 ? { status: 500, body: { ok: false, error_code: 500, description: 'Internal Server Error' } } : undefined);
        const live = new runtime.TelegramLiveCommentary(() => service, 'TaskSync', { minEditMs: 0, retryMs: 20 });
        const view = items => ({ items, turnStarts: [1000], currentPrompt: 'do it' });
        await live.update(view([{ ts: 1500, kind: 'progress', text: 'first line' }]));
        await live.update(view([{ ts: 1500, kind: 'progress', text: 'first line' }, { ts: 1600, kind: 'progress', text: 'FINAL LINE' }]));
        await sleep(200);
        const edits = fake.calls.filter(c => c.method === 'editMessageText');
        assert.equal(edits.length, 2, 'the failed edit must be re-sent');
        assert.match(edits[1].json.text, /FINAL LINE/);
        live.dispose();

        // B: text carries only the handoff; the full response travels as one PDF document.
        const targets = runtime.createHandoffTargets(() => undefined, () => service);
        const notifier = new runtime.HandoffNotifier(targets, undefined, () => {});
        let stamp = 10;
        let turn = { details: 'DETAILS-ONLY-IN-PDF long analysis.', handoff: 'Impact: delivered.\nSummary: done.\nNext: ship?' };
        notifier._readStamp = () => stamp;
        notifier._findHandoff = () => turn;

        fake.reset();
        process.env.ASKAWAY_MD_TO_PDF = okConverter;
        await notifier._onTurnEnd();
        assert.equal(fake.sends().length, 1);
        assert.match(fake.sends()[0].json.text, /Impact: delivered/);
        assert.doesNotMatch(fake.sends()[0].json.text, /DETAILS-ONLY-IN-PDF/);
        let docs = fake.calls.filter(c => c.method === 'sendDocument');
        assert.equal(docs.length, 1, 'exactly one document per turn');
        const docText = docs[0].raw.toString('utf8');
        assert.match(docText, /filename="response\.pdf"/);
        assert.match(docText, /name="message_thread_id"\r\n\r\n77/);
        assert.doesNotMatch(docText, /reply_to_message_id/);
        assert.match(docText, /DETAILS-ONLY-IN-PDF/);
        assert.match(docText, /Response Handoff/);
        assert.equal(fs.readFileSync(path.join(tmp, 'layout.txt'), 'utf8').trim(), 'mobile');
        assert.deepEqual(fs.readdirSync(responseTmp), [], 'temp files are deleted after sending');

        // B: converter failure falls back to the markdown file.
        fake.reset();
        stamp = 11;
        turn = { details: 'SECOND-DETAILS body.', handoff: 'Impact: again.\nSummary: ok.\nNext: more?' };
        process.env.ASKAWAY_MD_TO_PDF = badConverter;
        await notifier._onTurnEnd();
        docs = fake.calls.filter(c => c.method === 'sendDocument');
        assert.equal(docs.length, 1);
        assert.match(docs[0].raw.toString('utf8'), /filename="response\.md"/);
        assert.match(docs[0].raw.toString('utf8'), /SECOND-DETAILS/);
        assert.deepEqual(fs.readdirSync(responseTmp), []);

        service.stopPolling();
        console.log('EV-TELEGRAM-DELIVERY: PASS html=bounded-before-convert parse-retry=plain 429=retry_after live-edit=rescheduled handoff=text-only+pdf fallback=md');
    } finally {
        service.stopPolling();
        global.fetch = realFetch;
        await fake.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
});
