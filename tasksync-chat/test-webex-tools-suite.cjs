process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
async function main() {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/webexSuite'; export * from './src/services/webexDrafts';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { webexSuiteTools, registerWebexDraftHook, approveDraft } = mod.exports;
    let n = 0; const calls = [], drafts = [];
    registerWebexDraftHook(async draft => { drafts.push(draft); return `draft-${++n}`; });
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webex-suite-')); let modal = 'approved';
    const realCache = path.join(__dirname, '.webex-cache');
    const cacheBefore = await fs.readdir(realCache).catch(() => []);
    const contentsBefore = await Promise.all(cacheBefore.map(async name => [name, (await fs.readFile(path.join(realCache, name))).toString('base64')]));
    try {
    const tools = webexSuiteTools({ cacheDir, approve: async () => modal,
        request: async (method, endpoint, body) => {
            calls.push({ method, endpoint, body });
            const data = method === 'POST' ? { id: 'sent' } : endpoint.startsWith('/rooms') ? { items: [{ id: 'r', title: 'Build Team' }, { id: 'x', title: 'Other' }] } : endpoint.startsWith('/messages/') ? { roomId: 'r', files: ['txt','md','pdf','docx','png'].map(ext => `https://webexapis.com/v1/contents/${ext}`) } : { items: [{ id: 'old', created: '2026-10-10T00:00:00Z', parentId: 'root', personEmail: 'a@example.test' }, { id: 'new', text: 'ok', created: '2026-10-12T00:00:00Z', parentId: 'root', personEmail: 'a@example.test' }] };
            return { ok: true, json: async () => data };
        }, download: async url => ({ name: `file.${url.split('/').pop()}`, bytes: Buffer.from('attachment text') }), extract: async file => { if (file.endsWith('.docx')) throw Error('missing converter'); return 'PDF text'; } });
    const run = (name, args) => tools.find(tool => tool.name === name).run(args);
    for (const [name, args] of [['webex_send', { roomId: 'r', text: 'ok' }], ['webex_reply', { messageId: 'root', text: 'yes' }]]) {
        const out = await run(name, args); assert.equal(out.status, 'pending'); assert.equal(calls.filter(c => c.method === 'POST').length, n - 1);
        const results = await Promise.all([approveDraft(out.draftId), approveDraft(out.draftId)]);
        assert.equal(results.filter(r => r.status === 'sent').length, 1);
        if (name === 'webex_reply') assert.equal(calls.at(-1).body.parentId, 'root');
        console.log(`PASS ${name} pending draft; approval sends once`);
    }
    assert.equal((await run('webex_find_space', { name: 'build' })).items.length, 1);
    for (const recipient of [{ roomId: 'r' }, { personEmail: 'a@example.test' }]) assert.equal((await run('webex_read', recipient)).status, 'ok');
    assert.match(calls.at(-1).endpoint, /personEmail=a%40example.test/);
    assert.equal((await run('webex_thread', { roomId: 'r', parentId: 'root' })).items.length, 2);
    assert.deepEqual((await run('webex_wait_reply', { roomId: 'r', parentId: 'root', since: '2026-10-11T00:00:00Z', fromEmail: 'a@example.test' })).items.map(r => r.id), ['new']);
    console.log('PASS webex_find_space webex_read webex_thread webex_wait_reply');
    const attachments = await run('webex_attachments', { messageId: 'root' }); assert.equal(attachments.items.length, 5);
    for (const file of attachments.items) { assert.equal(path.dirname(file.path), cacheDir); assert.equal((await fs.readFile(file.path)).toString(), 'attachment text'); }
    assert.equal(attachments.items[0].text, 'attachment text'); assert.equal(attachments.items[2].text, 'PDF text'); assert.equal(attachments.items[3].extraction, 'file fallback');
    console.log('PASS webex_attachments txt/md/pdf extraction; docx fallback; image path');
    const main = await fs.readFile(path.join(__dirname, 'src/tools.ts'), 'utf8'); assert.doesNotMatch(main, /webexTool\(createWebexToolsHost/);
    const extension = await fs.readFile(path.join(__dirname, 'src/extension.ts'), 'utf8'); assert.match(extension, /memory, createWebexSuiteHost/);
    const mcp = await fs.readFile(path.join(__dirname, 'src/mcp/mcpServer.ts'), 'utf8'); assert.match(mcp, /handler\), this.webex/);
    console.log('PASS Webex suite MCP registration; absent from main LM registration');
    const { sample } = require('./tools/webex-style-sample.cjs');
    let saved; const pages = [];
    const sampled = await sample({ write: async data => { saved = data; }, request: async endpoint => {
        pages.push(endpoint);
        if (endpoint === '/people/me') return { data: { id: 'me' } };
        if (endpoint.startsWith('/rooms')) return { data: { items: [{ id: 'active' }] } };
        const page = endpoint.includes('page=2') ? 2 : 1;
        return { data: { items: Array.from({ length: 150 }, (_, i) => ({ id: `${page}-${i}`, personId: i % 3 === 0 ? 'other' : 'me', text: 'ok\n> quoted\n--\nsignature' })) }, next: page === 1 ? '/messages?page=2' : undefined };
    } });
    assert.equal(sampled.messages.length, 200); assert.equal(saved, sampled); assert.ok(sampled.messages.every(row => row.text === 'ok')); assert.match(pages[1], /sortBy=lastactivity/);
    console.log('PASS style sampler 200 own messages; paging; quote/signature stripping; zero model calls');
    await fs.writeFile(path.join(cacheDir, 'style-card.md'), 'plain short replies');
    assert.equal((await run('webex_style_card', {})).text, 'plain short replies');
    registerWebexDraftHook();
    assert.equal((await run('webex_send', { roomId: 'r', text: 'modal approved' })).status, 'sent');
    modal = 'denied'; const before = calls.filter(c => c.method === 'POST').length;
    assert.equal((await run('webex_send', { roomId: 'r', text: 'modal denied' })).status, 'pending');
    assert.equal(calls.filter(c => c.method === 'POST').length, before, 'refused draft sends nothing (the space-name read is not a send)');
    console.log('PASS webex_style_card; modal fallback approval and refusal');
    console.log('PASS EV-WEBEX-TOOLS-SUITE');
    assert.deepEqual(await fs.readdir(realCache).catch(() => []), cacheBefore);
    assert.deepEqual(await Promise.all(cacheBefore.map(async name => [name, (await fs.readFile(path.join(realCache, name))).toString('base64')])), contentsBefore);
    console.log('PASS Webex test temp cache only; real cache names and bytes unchanged');
    } finally { await fs.rm(cacheDir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
