// Commentary tab UI (T030): the real render block, panel markup, and message wiring, plus the play harness. Run: node test-commentary-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const webview = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
const from = webview.indexOf('// ── Commentary tab: pure render');
const to = webview.indexOf('// ── end Commentary pure render ──');
assert.ok(from > 0 && to > from, 'Commentary render block present');
const ui = {};
vm.runInNewContext(`${webview.slice(from, to)}\nout.render = renderCommentaryHtml; out.open = commentaryOpenCount; out.markup = commentaryMarkup;`, { out: ui });

// Light formatting: our tags only, applied after escaping.
assert.equal(ui.markup('✅ **Slugify accepted**, ==2 of 2==, ++once++, _really_, run `npm test`'),
    '✅ <strong>Slugify accepted</strong>, <mark>2 of 2</mark>, <u>once</u>, <em>really</em>, run <code>npm test</code>');
assert.equal(ui.markup('**<img src=x onerror=alert(1)>**'), '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>', 'markup never un-escapes HTML');
assert.equal(ui.markup('snake_case_name stays'), 'snake_case_name stays', 'underscores inside words are not italics');

const t0 = new Date(2026, 8, 24, 19, 14, 5).getTime();
const view = {
    goal: 'Ship slugify', archivedCount: 3, opener: 'x',
    items: [
        { id: 'c1', ts: t0, kind: 'update', ref: '0.1', text: 'Goal: slugify helper with tests. Track A implements, B verifies.' },
        { id: 'c2', ts: t0 + 40_000, kind: 'update', ref: 'A.1', text: 'Code worker done in 38s, $0.004; reports SLUG-TEST: PASS.' },
        { id: 'c3', ts: t0 + 55_000, kind: 'milestone', ref: 'B.1', text: 'Independent verify reproduced SLUG-TEST: PASS in 9s. Accepted.' },
        { id: 'c4', ts: t0 + 60_000, kind: 'heads-up', ref: '0.2', text: 'Unicode edge cases in scope, or a follow-up?' },
        { id: 'c5', ts: t0 + 61_000, kind: 'update', ref: '', text: '<script>alert(1)</script> without a ref' },
    ],
};
const html = ui.render(view);
assert.match(html, /^<div class="cm-summary">5 lines · 1 heads-up · 3 archived<\/div>/);
const ids = [...html.matchAll(/data-id="(c\d)"/g)].map((m) => m[1]);
assert.deepEqual(ids, ['c1', 'c2', 'c3', 'c4', 'c5'], 'oldest first, newest at the bottom, like the chat');
assert.match(html, /<div class="cm-item" data-id="c3"><div class="cm-body"><div class="cm-meta"><span class="cm-time">19:15:00<\/span><\/div>/, 'updates carry no category label, old kinds included');
assert.match(html, /<div class="cm-item cm-heads-up" data-id="c4">[\s\S]*?<span class="cm-heads-up-tag">HEADS-UP<\/span>/, 'a heads-up stands out');
assert.match(ui.render({ ...view, items: [{ id: 'q', ts: t0, kind: 'question', text: 'old feed' }] }), /cm-heads-up/, 'old question/blocked lines read as heads-up');
assert.doesNotMatch(html, /cm-ball|A\.1|B\.1|0\.1/, 'no track.step refs, even for old items that stored one');
assert.doesNotMatch(html, /<script>/, 'text is escaped');
assert.match(ui.render({ items: [], archivedCount: 0 }), /Waiting for the orchestrator's first update\./);
assert.equal(ui.open(view), 1);
assert.doesNotMatch(html, /cm-day/, 'a one-day feed needs no divider');

// Regression (reviewer, 2026-09-25): the feed looked newest-on-top because yesterday's 20:52 sat above today's 17:45.
const yesterday = new Date(2026, 8, 24, 20, 52, 0).getTime();
const today = new Date(2026, 8, 25, 17, 45, 0).getTime();
const twoDays = ui.render({ items: [
    { id: 'y1', ts: yesterday, kind: 'update', text: 'Yesterday: word counter accepted by a separate checker.' },
    { id: 'y2', ts: yesterday + 60_000, kind: 'update', text: 'Yesterday: done, two of two accepted.' },
    { id: 't1', ts: today, kind: 'update', text: 'Today: plan two tracks with independent checks.' },
    { id: 't2', ts: today + 60_000, kind: 'update', text: 'Today: both tracks accepted, the newest line.' },
], archivedCount: 0 });
const order = [...twoDays.matchAll(/class="cm-day">([^<]+)<|data-id="(\w+)"/g)].map((m) => m[1] || m[2]);
assert.deepEqual(order, ['Thu 24 Sep', 'y1', 'y2', 'Fri 25 Sep', 't1', 't2'], 'oldest first, newest line last, and each day is labelled');
const feedCss = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
const feedRules = feedCss.match(/\.cm-(feed|item|body)\b[^{]*\{[^}]*\}/g) || [];
assert.ok(feedRules.length >= 3, 'the feed rules were found');
for (const rule of feedRules) {
    assert.doesNotMatch(rule, /column-reverse|\border\s*:/, `CSS never re-orders the feed: ${rule.slice(0, 40)}`);
}
assert.match(webview, /if \(pinned\) feed\.scrollTop = feed\.scrollHeight;/, 'a live push keeps the newest line in view at the bottom');
console.log('EV-030c CommentaryNewestAtBottom: PASS order=chronological dayDividers=true cssReorder=none scrollPinsBottom=true');
console.log('EV-030a CommentaryFeedRender: PASS newestAtBottom=true refs=none kinds=update+heads-up noFilters=true escaped=true');

// Markup and wiring: the tab exists, its controls send the backend messages, pushes are rendered.
const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8');
for (const id of ['data-tab="commentary" title="Live orchestrator commentary and the main goal">Commentary', 'id="panel-commentary"', 'id="cm-goal-input" rows="6"', 'id="cm-copy"', 'id="cm-clear"', 'id="cm-feed"']) {
    assert.ok(provider.includes(id), `panel has ${id}`);
}
assert.ok(!provider.includes('data-cm-filter') && !provider.includes('cm-goal-label'), 'no filters and no goal heading');
assert.match(webview, /case 'commentaryState':\s*applyCommentaryState\(message\.data\)/);
for (const message of ["type: 'setCommentaryGoal'", "type: 'clearCommentary', what: 'feed'", "type: 'copyToClipboard', text: commentaryView.opener", "type: 'requestCommentary'"]) {
    assert.ok(webview.includes(message), `webview sends ${message}`);
}
const css = fs.readFileSync(path.join(__dirname, 'media', 'main.css'), 'utf8');
for (const selector of ['.cm-heads-up', '.cm-heads-up-tag', '.cm-goal-input', '.cm-icon-btn']) {
    assert.ok(css.includes(selector), `style for ${selector}`);
}

// Storybook builds its stories from the same real sources through storybook/kit.js.
(async () => {
    const { buildCommentaryKit } = await import(path.join(__dirname, 'storybook', 'kit.js'));
    const kit = buildCommentaryKit({ webviewSrc: webview, providerSrc: provider });
    assert.equal(kit.renderCommentaryHtml(view), html, 'Storybook renders byte-identical feed HTML');
    assert.match(kit.panelHtml, /^<div class="tab-panel active" id="panel-commentary">[\s\S]*id="cm-feed"[\s\S]*<!-- End panel-commentary -->$/);

    // Typewriter: a new line types in character by character; lines already seen do not.
    const node = (id, text, html) => {
        const textEl = { textContent: text, innerHTML: html || text, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } } };
        return { id, textEl, classList: { add() {} }, getAttribute: () => id, querySelector: () => textEl };
    };
    const oldLine = node('c1', 'already on screen');
    const newLine = node('c2', 'Accepted: A slugify.', '<strong>Accepted:</strong> A slugify.');
    const frames = [];
    const realTimeout = global.setTimeout;
    global.setTimeout = (fn) => { frames.push(newLine.textEl.textContent); fn(); };
    kit.commentaryAnimateNew({ querySelectorAll: () => [oldLine, newLine] }, { c1: true }, 5);
    global.setTimeout = realTimeout;
    assert.equal(oldLine.textEl.textContent, 'already on screen');
    assert.equal(newLine.textEl.innerHTML, '<strong>Accepted:</strong> A slugify.', 'formatting is restored once typing ends');
    assert.deepEqual(frames.slice(0, 3), ['A', 'Ac', 'Acc'], 'types one character per frame');
    assert.equal(newLine.textEl.classList.set.has('cm-typing'), false, 'cursor removed when done');

    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'storybook', 'fixtures', 'orchestrator-demo-feed.json'), 'utf8'));
    assert.ok(fixture.items.length >= 5 && fixture.items.every((i) => i.id && i.ts && i.kind && i.text), 'real recorded feed fixture');
    console.log(`EV-030b CommentaryTabWiring: PASS controls=5 pushRendered=true styles=6 storybookIdentical=true typewriter=true fixtureItems=${fixture.items.length}`);
})().catch((error) => { console.error(error); process.exit(1); });
