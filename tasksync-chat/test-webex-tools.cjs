process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const build = await esbuild.build({ entryPoints: [path.join(__dirname, 'src/services/webexTools.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => {
        assert.ok(!['vscode', 'child_process'].includes(name), 'no host or Keychain access');
        return require(name);
    }, loaded, loaded.exports);
    const { runWebexTool } = loaded.exports;
    const calls = [], approvals = [], outputs = [];
    let decision = 'denied', failure = false;
    const deps = {
        approve: async draft => { approvals.push(draft); if (decision === 'throws') { throw Error('Bearer approval-secret'); } return decision; },
        request: async (method, url, body) => {
            calls.push({ method, url, body });
            if (failure) { throw Error('Bearer request-secret'); }
            const parsed = new URL(url, 'https://fixture.test');
            const max = Number(parsed.searchParams.get('max'));
            assert.ok(url.startsWith('/'));
            let data;
            if (method === 'POST') { assert.equal(url, '/messages'); data = { id: 'sent', access_token: 'hidden-secret' }; }
            else if (parsed.pathname === '/people/me') { data = { id: 'me', token: 'hidden-secret' }; }
            else {
                assert.ok(max > 0 && max <= 50);
                if (parsed.pathname === '/rooms') {
                    assert.equal(parsed.searchParams.get('sortBy'), 'lastactivity');
                    data = { items: Array.from({ length: 60 }, (_, i) => ({ id: `room-${i}`, title: 'Space', access_token: 'hidden-secret' })) };
                } else if (parsed.pathname === '/people') {
                    assert.ok(parsed.searchParams.has('email') || parsed.searchParams.has('displayName'));
                    data = { items: [{ id: 'person', displayName: 'Reviewer', token: 'hidden-secret' }] };
                } else {
                    assert.equal(parsed.pathname, '/messages');
                    assert.equal(parsed.searchParams.get('roomId'), 'room & one');
                    data = { items: [
                        { id: 'm1', personId: 'me', text: 'HELLO style', access_token: 'hidden-secret' },
                        { id: 'm2', personId: 'other', text: 'hello team' },
                        { id: 'm3', personId: 'me', text: 'x'.repeat(1500) },
                        { id: 'm4', text: 'Bearer response-secret' },
                    ] };
                }
            }
            return { ok: true, json: async () => data, headers: { get: name => name === 'Link' ? '<https://unsafe.test/?token=hidden-secret>; rel="next"' : null } };
        },
    };
    const run = async input => { const out = await runWebexTool(input, deps); outputs.push(out); return out; };
    const spaces = await run({ action: 'spaces', max: 500 });
    assert.equal(spaces.items.length, 50); assert.equal(spaces.hasMore, true); assert.equal(spaces.truncated, true);
    console.log('PASS spaces bounded max=50 lastactivity and pagination flag');
    const read = await run({ action: 'read', roomId: 'room & one', mine: true });
    assert.deepEqual(read.items.map(item => item.id), ['m1', 'm3']);
    assert.equal(read.items[1].text.length, 1000); assert.equal(read.truncated, true);
    assert.ok(calls.some(call => call.url === '/people/me'));
    console.log('PASS read mine filters token owner; text bounded to 1000');
    await run({ action: 'thread', roomId: 'room & one', parentId: 'parent & one', max: 2 });
    assert.equal(new URL(calls.at(-1).url, 'https://fixture.test').searchParams.get('parentId'), 'parent & one');
    console.log('PASS thread roomId and parentId encoded');
    const search = await run({ action: 'search', roomId: 'room & one', query: 'HeLLo', max: 2 });
    assert.deepEqual(search.items.map(item => item.id), ['m1', 'm2']); assert.equal(search.scanned, 2);
    console.log('PASS search case-insensitive last N messages');
    for (const input of [{ email: 'reviewer@example.test' }, { displayName: 'A & B' }]) {
        assert.equal((await run({ action: 'people', ...input })).items[0].id, 'person');
    }
    console.log('PASS people email and displayName lookup');
    for (decision of ['denied', 'unavailable', 'throws']) {
        for (const recipient of [{ roomId: 'other-space' }, { toPersonEmail: 'other@example.test' }]) {
            const before = calls.length;
            const out = await run({ action: 'send', ...recipient, text: 'Please review.', parentId: 'parent' });
            assert.deepEqual(out, { status: 'draft', recipientLabel: Object.values(recipient)[0], text: 'Please review.' });
            assert.equal(calls.length, before); assert.equal(approvals.at(-1).parentId, 'parent');
        }
    }
    console.log('PASS draft-refusal person and space denied/unavailable/approval failure never post');
    decision = 'approved';
    for (const recipient of [{ roomId: 'other-space' }, { toPersonEmail: 'other@example.test' }]) {
        assert.equal((await run({ action: 'send', ...recipient, text: 'Approved reply', parentId: 'parent' })).status, 'sent');
        assert.deepEqual(calls.at(-1).body, { ...recipient, text: 'Approved reply', parentId: 'parent' });
    }
    const before = calls.length;
    assert.equal((await run({ action: 'send', roomId: 'a', toPersonEmail: 'a@example.test', text: 'bad' })).status, 'invalid');
    assert.equal((await run({ action: 'read' })).status, 'invalid');
    assert.equal((await run({ action: 'spaces', token: 'hidden-secret' })).status, 'invalid');
    assert.equal(calls.length, before);
    failure = true;
    assert.equal((await run({ action: 'spaces' })).status, 'error');
    failure = false;
    await run({ action: 'read', roomId: 'room & one' });
    assert.doesNotMatch(JSON.stringify(outputs), /hidden-secret|request-secret|response-secret|approval-secret|access_token|Bearer/);
    console.log('PASS secret-free output allowlisted fields, redacted text, sanitized errors and strict token-free inputs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
