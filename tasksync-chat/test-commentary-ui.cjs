// Commentary tab UI (T030): the real render block, panel markup, and message wiring, plus the play harness. Run: node test-commentary-ui.cjs
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const from = webview.indexOf('// ── Commentary tab: pure render');
const to = webview.indexOf('// ── end Commentary pure render ──');
assert.ok(from > 0 && to > from, 'Commentary render block present');
const ui = {};
vm.runInNewContext(`${webview.slice(from, to)}\nout.render = renderCommentaryHtml; out.open = commentaryOpenCount;`, { out: ui });

const t0 = new Date(2026, 8, 24, 19, 14, 5).getTime();
const view = {
    goal: 'Ship slugify', archivedCount: 3, opener: 'x',
    items: [
        { id: 'c1', ts: t0, kind: 'progress', ref: '0.1', text: 'Goal: slugify helper with tests. Track A implements, B verifies.' },
        { id: 'c2', ts: t0 + 40_000, kind: 'progress', ref: 'A.1', text: 'Code worker done in 38s, $0.004; reports SLUG-TEST: PASS.' },
        { id: 'c3', ts: t0 + 55_000, kind: 'milestone', ref: 'B.1', text: 'Independent verify reproduced SLUG-TEST: PASS in 9s. Accepted.' },
        { id: 'c4', ts: t0 + 60_000, kind: 'question', ref: '0.2', text: 'Unicode edge cases in scope, or a follow-up?' },
        { id: 'c5', ts: t0 + 61_000, kind: 'progress', ref: '', text: '<script>alert(1)</script> without a ref' },
    ],
};
const html = ui.render(view, 'all');
assert.match(html, /^<div class="cm-summary">5 lines · 1 milestone · 1 open · 3 archived<\/div>/);
const ids = [...html.matchAll(/data-id="(c\d)"/g)].map((m) => m[1]);
assert.deepEqual(ids, ['c5', 'c4', 'c3', 'c2', 'c1'], 'newest first, like a live match feed');
assert.match(html, /<div class="cm-item cm-kind-milestone" data-id="c3"><div class="cm-ball">B\.1<\/div><div class="cm-body"><div class="cm-meta"><span class="cm-kind">MILESTONE<\/span><span class="cm-time">19:15:00<\/span>/);
assert.match(html, /data-id="c5"><div class="cm-ball">•<\/div>/, 'a line without ref gets a plain ball');
assert.doesNotMatch(html, /<script>/, 'text is escaped');
const onlyQuestions = ui.render(view, 'question');
assert.deepEqual([...onlyQuestions.matchAll(/data-id="(c\d)"/g)].map((m) => m[1]), ['c4']);
assert.match(ui.render(view, 'blocked'), /Nothing of this kind yet\./);
assert.match(ui.render({ items: [], archivedCount: 0 }, 'all'), /Waiting for the orchestrator's first ball\./);
assert.equal(ui.open(view), 1);
console.log('EV-030a CommentaryFeedRender: PASS newestFirst=true kinds=5 filter=true escaped=true emptyStates=2');

// Markup and wiring: the tab exists, its controls send the backend messages, pushes are rendered.
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
for (const id of ['data-tab="commentary"', 'id="panel-commentary"', 'id="cm-goal-input"', 'id="cm-copy"', 'id="cm-clear"', 'id="cm-feed"']) {
    assert.ok(provider.includes(id), `panel has ${id}`);
}
assert.match(webview, /case 'commentaryState':\s*applyCommentaryState\(message\.data\)/);
for (const message of ["type: 'setCommentaryGoal'", "type: 'clearCommentary', what: 'goal'", "type: 'clearCommentary', what: 'feed'", "type: 'copyToClipboard', text: commentaryView.opener", "type: 'requestCommentary'"]) {
    assert.ok(webview.includes(message), `webview sends ${message}`);
}
const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
for (const selector of ['.cm-kind-milestone', '.cm-kind-question', '.cm-kind-blocked', '.cm-kind-decision', '.cm-ball', '.cm-goal-input']) {
    assert.ok(css.includes(selector), `style for ${selector}`);
}

// The play harness builds a page from the same real code and feeds it item by item.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-play-'));
const feed = path.join(dir, 'state.json');
fs.writeFileSync(feed, JSON.stringify({ goal: 'Ship slugify', clearedAt: t0 - 1, items: view.items }));
const out = path.join(dir, 'play.html');
const result = childProcess.execFileSync(process.execPath, [path.join(__dirname, 'tools', 'play-commentary.cjs'), '--feed', feed, '--out', out], { encoding: 'utf8' });
assert.match(result, /COMMENTARY-PLAY WRITTEN .* items=5/);
const page = fs.readFileSync(out, 'utf8');
assert.ok(page.includes('function renderCommentaryHtml'), 'page runs the real render code');
assert.ok(page.includes('id="cm-feed"') && page.includes('.cm-kind-milestone'), 'page uses the real markup and CSS');
fs.rmSync(dir, { recursive: true, force: true });
console.log('EV-030b CommentaryTabWiring: PASS controls=5 pushRendered=true styles=6 playHarness=realCode');
