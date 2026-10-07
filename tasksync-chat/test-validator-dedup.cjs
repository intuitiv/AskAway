const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const http = require('node:http');
const fs = require('node:fs');
const rememberShape = require('./test-fixtures/agentmemory-shapes/remember.json');
const memoriesShape = require('./test-fixtures/agentmemory-shapes/memories.json');
const files = new Map();
const fakeFs = { ...fs, mkdirSync() {}, appendFileSync: (file, text) => files.set(file, (files.get(file) || '') + text),
    readFileSync: file => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); } };

const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/knowledgeStore.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const loaded = { exports: {} };
vm.runInNewContext(out, { module: loaded, exports: loaded.exports, require });
const { DedupKnowledgeStore } = loaded.exports;
const adapter = { exports: {} };
vm.runInNewContext(esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src/validator/agentmemoryStore.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
    { module: adapter, exports: adapter.exports, require: name => name === 'fs' ? fakeFs : require(name), fetch, URL, URLSearchParams, AbortSignal });
const { AgentmemoryStore } = adapter.exports;
const memories = [];
const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    res.setHeader('Content-Type', 'application/json');
    assert.ok(!('ttlDays' in data), 'no automatic expiry requested');
    if (req.url === '/agentmemory/remember') {
        assert.equal(req.method, 'POST');
        const memory = { ...rememberShape.memory, id: `mem_${memories.length + 1}`, content: data.content,
            agentId: data.agentId, concepts: data.concepts };
        memories.push(memory);
        res.writeHead(201);
        res.end(JSON.stringify({ ...rememberShape, memory }));
    } else if (new URL(req.url, 'http://localhost').pathname === '/agentmemory/memories') {
        assert.equal(req.method, 'GET'); assert.equal(body, '');
        const params = new URL(req.url, 'http://localhost').searchParams;
        assert.equal(params.get('agentId'), 'validator');
        const hits = [...memories, ...memories];
        res.end(JSON.stringify({ ...memoriesShape, memories: hits, total: hits.length,
            search: { query: params.get('q'), mode: 'keyword' } }));
    } else { res.writeHead(404); res.end('{}'); }
});
let url;
let workspace = 0;
const backing = () => new AgentmemoryStore(`dedup-fixture-${++workspace}`, url, '');

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
    const scope = { project: 'TaskSync', agentId: 'validator', spec: '007' };
    const texts = async store => Array.from(await store.recall("x", scope, 10), i => i.fact.text);

    // 1. A restated rule is stored once.
    let store = new DedupKnowledgeStore(backing());
    const first = await store.remember({ text: 'Never use sleeps in tests.', kind: 'rule' }, scope);
    const again = await store.remember({ text: 'Please, never use  SLEEPS in tests', kind: 'rule' }, scope);
    assert.equal(again.id, first.id);
    assert.equal((await store.export()).length, 1);
    await assert.rejects(store.recall('x', scope, 0), error => error.kind === 'rejected');
    const other = await store.remember({ text: first.fact.text }, { ...scope, spec: '008' });
    assert.notEqual(other.id, first.id, 'canonical facts remain scope-isolated');

    // 2. Same fact from an ADR and from a memory is loaded once.
    store = new DedupKnowledgeStore(backing());
    await store.remember({ text: 'Use one shared server per workspace', from: 'ADR-0007' }, scope);
    await store.remember({ text: 'use one shared server per workspace.', from: 'memory' }, scope);
    assert.deepEqual(await texts(store), ['Use one shared server per workspace']);
    const raw = backing();
    await raw.remember({ text: 'Keep the ledger append-only', from: 'ADR' }, scope);
    await raw.remember({ text: 'keep the ledger append only', from: 'memory' }, scope);
    assert.equal((await new DedupKnowledgeStore(raw).recall('x', scope, 10)).length, 1, 'recall collapses duplicates already stored');

    // 3. A reversal stores a new version; old retained but hidden; changed flag informational.
    const ledgerStore = backing();
    store = new DedupKnowledgeStore(ledgerStore);
    const old = await store.remember({ text: 'Use one server per worker', kind: 'rule' }, scope);
    const same = await store.supersede(old.id, { text: 'use one server per worker' });
    assert.equal(same.id, old.id, 'restating is not a reversal');
    const next = await store.supersede(old.id, { text: 'Use one shared server per workspace', kind: 'rule' });
    assert.equal(next.changed, true);
    assert.equal(next.supersedesId, old.id);
    store = new DedupKnowledgeStore(ledgerStore);
    assert.equal((await store.recall('x', scope, 10))[0].changed, true, 'changed derived from durable version relation');
    assert.equal((await store.history(next.id))[1].changed, true);
    assert.deepEqual(await texts(store), ['Use one shared server per workspace']);
    assert.deepEqual(Array.from(await store.history(old.id), i => i.id), [old.id, next.id]);
    assert.equal((await store.export()).length, 2, 'older version retained');
    assert.ok(!(await store.recall('x', scope, 10)).some(i => i.id === old.id), 'old version hidden from recall');

    // 4. A long reply is stored as a concise fact; nothing expires.
    store = new DedupKnowledgeStore(backing());
    const long = 'Always run the full worker suite before deploying. ' + 'Further rambling detail about why. '.repeat(40);
    const stored = await store.remember({ text: long }, scope);
    assert.equal(stored.fact.text, 'Always run the full worker suite before deploying.');
    const noStops = await store.remember({ text: 'word '.repeat(200) }, scope);
    assert.ok(noStops.fact.text.length <= 280);
    assert.equal((await store.export()).length, 2, 'stored knowledge is never removed');

    console.log('PASS EV-VALIDATOR-DEDUP: restated once, ADR+memory once, reversal supersedes with hidden old version, concise long reply');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());
