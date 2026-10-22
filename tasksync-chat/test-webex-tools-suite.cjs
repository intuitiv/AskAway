process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const esbuild = require('esbuild');
async function main() {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/webexSuite'; export * from './src/services/webexDrafts'; export * from './src/services/assistant/provider';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { webexSuiteTools, registerWebexDraftHook, approveDraft, setApprovalHandler, queueApprovalDraft } = mod.exports;
    let n = 0; const calls = [], drafts = [];
    // The AITalk card code's role: one hook that queues a card, and the generic approval handler.
    registerWebexDraftHook(async draft => { drafts.push(draft); return `draft-${++n}`; });
    setApprovalHandler(async req => { const queued = await queueApprovalDraft(req); return queued ? queued.outcome : { status: 'unavailable' }; });
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webex-suite-')); let modal = 'approved';
    const realCache = path.join(__dirname, '.webex-cache');
    const cacheBefore = await fs.readdir(realCache).catch(() => []);
    const contentsBefore = await Promise.all(cacheBefore.map(async name => [name, (await fs.readFile(path.join(realCache, name))).toString('base64')]));
    try {
    const rows = [
        { id: 'root', roomId: 'r', personId: 'a', personEmail: 'a@example.test', text: 'Files for review', created: '2026-10-09T00:00:00Z', files: ['txt', 'md', 'pdf', 'docx', 'png'].map(ext => `https://webexapis.com/v1/contents/${ext}`) },
        { id: 'old', roomId: 'r', personId: 'a', personEmail: 'a@example.test', created: '2026-10-10T00:00:00Z', text: 'first', parentId: 'root' },
        { id: 'new', roomId: 'r', personId: 'a', personEmail: 'a@example.test', text: 'ok', created: '2026-10-12T00:00:00Z', parentId: 'root' },
    ];
    const fakeRequest = async (method, endpoint, body) => {
        calls.push({ method, endpoint, body });
        const url = new URL(endpoint, 'https://x.test'); const p = url.pathname; const q = url.searchParams;
        const data = method === 'POST' ? { id: 'sent' } : p === '/rooms' ? { items: [{ id: 'r', title: 'Build Team', type: 'group', lastActivity: '2026-10-12T00:00:00Z' }, { id: 'x', title: 'Other', type: 'group', lastActivity: '2026-10-01T00:00:00Z' }] }
            : p === '/people/me' ? { id: 'me', displayName: 'Reviewer' } : p === '/people' ? { items: [{ id: 'a', displayName: 'Ana' }] }
            : p.startsWith('/messages/') ? (rows.find(row => row.id === decodeURIComponent(p.slice('/messages/'.length))) ?? {}) : p === '/messages' ? { items: rows.filter(row => row.roomId === q.get('roomId') && (!q.get('parentId') || row.parentId === q.get('parentId'))) } : {};
        return { ok: true, status: 200, json: async () => data };
    };
    const suite = (extra = {}) => webexSuiteTools({ cacheDir, request: fakeRequest, download: async url => ({ name: `file.${url.split('/').pop()}`, bytes: Buffer.from('attachment text') }), extract: async file => { if (file.endsWith('.docx')) throw Error('missing converter'); return 'PDF text'; }, ...extra });
    const tools = suite();
    const run = (name, args) => tools.find(tool => tool.name === name).run(args);
    const posts = () => calls.filter(c => c.method === 'POST');
    const read = await run('webex_read', { space: 'Build Team' });
    const rootRef = read.messages.find(message => message.text === 'Files for review').ref;
    for (const [name, args] of [['webex_send', { to: 'Build Team', text: 'ok' }], ['webex_reply', { to: rootRef, text: 'yes' }]]) {
        const out = await run(name, args); assert.equal(out.status, 'pending'); assert.equal(posts().length, n - 1);
        const results = await Promise.all([approveDraft(out.draftId), approveDraft(out.draftId)]);
        assert.equal(results.filter(r => r.status === 'sent').length, 1);
        if (name === 'webex_reply') assert.equal(posts().at(-1).body.parentId, 'root');
        console.log(`PASS ${name} pending draft; approval sends once`);
    }
    assert.equal((await run('webex_find', { query: 'build' })).spaces.length, 1);
    assert.equal((await run('webex_read', { person: 'Ana' })).status, 'ok');
    const thread = await run('webex_read', { thread: rootRef, includeFiles: false });
    assert.deepEqual(thread.messages.map(message => message.text), ['Files for review', 'first', 'ok']);
    const oldRef = read.messages.find(message => message.text === 'first').ref;
    assert.deepEqual((await run('webex_wait', { space: 'Build Team', sinceRef: oldRef, timeoutSeconds: 1 })).messages.map(message => message.text), ['ok']);
    console.log('PASS webex_find webex_read (space, person, thread) webex_wait');
    const files = read.messages.find(message => message.ref === rootRef).files; assert.equal(files.length, 5);
    for (const file of files) { assert.equal(path.dirname(file.path), cacheDir); assert.equal((await fs.readFile(file.path)).toString(), 'attachment text'); }
    assert.equal(files[0].text, 'attachment text'); assert.equal(files[2].text, 'PDF text'); assert.match(files[3].note, /could not be extracted/);
    console.log('PASS webex_read attachments txt/md/pdf extraction; docx fallback; image path');
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
    await fs.rm(path.join(cacheDir, 'style-card.md'), { force: true });
    const noCard = await run('webex_style_card', {});
    assert.equal(noCard.status, 'ok'); assert.equal(noCard.text, ''); assert.match(noCard.note, /No style card yet/);
    await fs.writeFile(path.join(cacheDir, 'style-card.md'), 'plain short replies');
    assert.equal((await run('webex_style_card', {})).text, 'plain short replies');
    registerWebexDraftHook();
    const bare = await run('webex_send', { to: 'Build Team', text: 'no card, no modal' });
    assert.equal(bare.status, 'unavailable'); assert.equal(posts().length, 2, 'without AITalk and without a supplied modal nothing is sent');
    const withModal = suite({ modalFallback: async () => modal });
    const viaModal = name => withModal.find(tool => tool.name === 'webex_send').run({ to: 'Build Team', text: name });
    assert.equal((await viaModal('modal approved')).status, 'sent');
    modal = 'rejected'; const before = posts().length;
    assert.equal((await viaModal('modal denied')).status, 'rejected');
    assert.equal(posts().length, before, 'refused modal sends nothing');
    console.log('PASS webex_style_card; modal fallback approval and refusal');
    console.log('PASS EV-WEBEX-TOOLS-SUITE');
    assert.deepEqual(await fs.readdir(realCache).catch(() => []), cacheBefore);
    assert.deepEqual(await Promise.all(cacheBefore.map(async name => [name, (await fs.readFile(path.join(realCache, name))).toString('base64')])), contentsBefore);
    console.log('PASS Webex test temp cache only; real cache names and bytes unchanged');
    } finally { await fs.rm(cacheDir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
