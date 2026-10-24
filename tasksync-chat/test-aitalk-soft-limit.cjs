// The AITalk word limit is soft (reviewer, 2026-10-24): up to 40 words post as written; longer is shortened, full text in details.
// Run: node test-aitalk-soft-limit.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const buildDir = path.join(__dirname, '.aitalk-soft-limit-build');
fs.rmSync(buildDir, { recursive: true, force: true });
require('./test-fixture-transpile.cjs')(buildDir, 'commentary/commentary.ts');
const { CommentaryStore, commentaryToolDefinitions, setCommentaryAITalkMirror } = require(path.join(buildDir, 'commentary', 'commentary.js'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-soft-limit-'));
const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-soft-limit-ws-')));
const store = new CommentaryStore({ dir: path.join(home, 'commentary') });
const room = [];
setCommentaryAITalkMirror((ws, input) => { room.push(input); return { status: 'POSTED', id: `m${room.length}` }; });
const [tool] = commentaryToolDefinitions(() => store, workspace);
const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
const count = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

try {
    for (const action of ['say', 'post']) {
        for (const n of [21, 40]) {
            const before = room.length;
            const result = await_(tool.run({ action, kind: 'update', text: words(n), workspacePath: workspace }));
            assert.equal(result.status, 'POSTED', `${action} ${n}`);
            assert.ok(!result.shortened, `${action} ${n} is not shortened`);
            assert.equal(room[before].text, words(n), `${action} ${n} words reach AITalk as written`);
        }
        for (const n of [41, 80]) {
            const before = room.length;
            const result = await_(tool.run({ action, kind: 'update', text: words(n), workspacePath: workspace }));
            assert.equal(result.status, 'POSTED', `${action} ${n} is not rejected`);
            assert.equal(result.shortened, true, `${action} ${n} is flagged shortened`);
            const sent = room[before];
            assert.ok(sent.text.endsWith('…') && count(sent.text) <= 30 && count(sent.text) > 3, `${action} ${n} cut to <=30 words with an ellipsis`);
            assert.ok(sent.details.includes(words(n)), `${action} ${n}: the full text is in details`);
        }
    }
    // Sentence boundary preferred over a mid-sentence cut.
    const sentences = `${words(12)}. ${words(12)}. ${words(30)}`;
    const cut = await_(tool.run({ action: 'say', kind: 'update', text: sentences, workspacePath: workspace }));
    assert.equal(cut.shortened, true);
    assert.equal(room[room.length - 1].text, `${words(12)}. ${words(12)}…`, 'cut at the last sentence end within 30 words');
    // (1) A credential in details (feed post and say) or in the full original refuses the whole post.
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
    for (const action of ['post', 'say']) {
        const sent = room.length;
        const leaked = await_(tool.run({ action, kind: 'update', text: words(12), details: `token ${secret}`, workspacePath: workspace }));
        assert.deepEqual([leaked.status, leaked.reason], ['REJECTED', 'text contains a credential'], `${action}: credential in details`);
        const longLeak = await_(tool.run({ action, kind: 'update', text: `${words(60)} ${secret}`, workspacePath: workspace }));
        assert.equal(longLeak.status, 'REJECTED', `${action}: credential in the cut-off part of a long text`);
        assert.equal(room.length, sent, `${action}: nothing reached AITalk`);
    }
    // (2) Details over 8000 chars: existing details first, then as much of the original as fits, with a visible marker.
    for (const action of ['post', 'say']) {
        const existing = 'E'.repeat(7000);
        const original = `${words(60)} ${'x'.repeat(3000)}`;
        const result = await_(tool.run({ action, kind: 'update', text: original, details: existing, workspacePath: workspace }));
        assert.equal(result.status, 'POSTED');
        const details = room[room.length - 1].details;
        assert.ok(details.length <= 8000 && details.startsWith(existing) && details.endsWith('[truncated]'), `${action}: bounded details with the marker`);
        assert.ok(details.includes('w1 w2 w3'), `${action}: the original follows the existing details`);
        const fits = await_(tool.run({ action, kind: 'update', text: words(60), details: 'D'.repeat(100), workspacePath: workspace }));
        assert.equal(fits.status, 'POSTED');
        assert.ok(!room[room.length - 1].details.includes('[truncated]'), `${action}: no marker when everything fits`);
    }
    // (3) Never cut inside a code span, link or URL; punctuation inside them is not a sentence end.
    const spanCases = [
        `${words(28)} run \`npm run test now\` then ${words(20)}`,
        `${words(29)} see [the long docs page](https://example.com/a.b/c) then ${words(20)}`,
        `${words(29)} see https://example.com/a.b/c.d for more ${words(20)}`,
        `Use \`a. b\` carefully ${words(8)} and \`x.y.\` ${words(40)}`,
    ];
    for (const text of spanCases) {
        const result = await_(tool.run({ action: 'say', kind: 'update', text, workspacePath: workspace }));
        const sent = room[room.length - 1].text;
        assert.equal(result.shortened, true);
        assert.equal((sent.match(/`/g) || []).length % 2, 0, `backticks stay balanced: ${sent}`);
        assert.equal((sent.match(/\[/g) || []).length, (sent.match(/\]/g) || []).length, `brackets stay balanced: ${sent}`);
        assert.ok(!sent.includes('example.com') || /example\.com\/a\.b\/c(\.d)?[ …)]/.test(sent), `URL kept whole or dropped: ${sent}`);
        assert.ok(count(sent) <= 30, `still at most 30 words: ${sent}`);
    }
    // (4) A short first sentence never becomes the whole message.
    const doneFirst = await_(tool.run({ action: 'say', kind: 'update', text: `Done. ${words(50)}`, workspacePath: workspace }));
    assert.equal(doneFirst.shortened, true);
    assert.ok(count(room[room.length - 1].text) >= 25, 'cut near 30 words, not after "Done."');
    // The 3-word minimum stays.
    const tiny = await_(tool.run({ action: 'post', kind: 'update', text: 'too short', workspacePath: workspace }));
    assert.equal(tiny.status, 'REJECTED');
    assert.match(tiny.reason, /2 words/);
    // The guidance stays a target, not a gate.
    assert.match(tool.description + JSON.stringify(tool.inputSchema.shape.text.description), /10-20 plain words/);
    console.log('PASS EV-AITALK-SOFT-LIMIT: 21 and 40 words as written; 41 and 80 shortened with full text in details, status POSTED; 2 words invalid');
} finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
}

function await_(value) {
    assert.ok(!(value && typeof value.then === 'function'), 'tool result is synchronous without a waiter');
    return value;
}
