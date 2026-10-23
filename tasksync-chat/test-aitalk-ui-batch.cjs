// EV-AITALK-UI-BATCH: the reviewer's 2026-10-23 AITalk UI asks, seen from the caller: the real render blocks and controller.
// (a) fixed bubble width, (b) turn cost in the time row, (c) composer grows, (d) caret after a picked mention,
// (e) unread count in the tab title, (f) the startup skeleton looks like the AITalk widget.
// Run: node test-aitalk-ui-batch.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const render = await import('./media/aitalk/talkRender.js');
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const members = render.defaultMembers;

    // (a) every bubble takes the same lane: no per-author or per-length percentage width.
    const css = fs.readFileSync(path.join(__dirname, 'media', 'aitalk', 'talk.css'), 'utf8');
    const bubbleRule = /^\.talk-bubble \{([^}]*)\}/m.exec(css)[1];
    assert.ok(/flex:\s*1 1 auto/.test(bubbleRule) && /max-width:\s*100%/.test(bubbleRule), 'bubble fills the lane');
    assert.ok(!/max-width:\s*\d+%/.test(bubbleRule.replace(/max-width:\s*100%/, '')), 'no narrower per-message width');
    assert.ok(!/\.talk-row\.(in|out) \.talk-bubble[^{]*\{[^}]*(?:max-)?width/.test(css), 'no per-author width');
    const rows = render.threadHtml([{ id: 'a', author: 'you', text: 'hi', time: '20:01' }, { id: 'b', author: 'agent', text: 'a much longer answer that wraps around the lane '.repeat(3), time: '20:02' }], members);
    assert.ok(!/<div class="talk-bubble[^>]*style=/.test(rows), 'bubbles carry no inline width');

    // (b) the turn cost shows in the time row of the message that carries it, and only there.
    const turn = render.threadHtml([
        { id: 'm1', author: 'agent', text: 'working', time: '20:20' },
        { id: 'm2', author: 'agent', text: 'Next: Deploy it now?', time: '20:27', meta: { cost: '$1.70' } },
    ], members);
    assert.ok(/<time>20:27 · <span class="talk-cost">\$1\.70<\/span><\/time>/.test(turn), 'time row shows 20:27 · $1.70');
    assert.equal((turn.match(/talk-cost/g) || []).length, 1, 'only the last message of the turn carries the cost');
    assert.ok(/<time>20:20<\/time>/.test(turn), 'other messages show only the time');
    assert.ok(!/turn cost/.test(turn), 'the cost is not in the text');

    // Controller with a mini composer: (c) auto-grow, (d) caret after the picked mention.
    const handlers = {};
    const textarea = { value: '', selectionStart: 0, selectionEnd: 0, style: {}, scrollHeight: 30, selection: null, matches: s => s === 'textarea', focus() {}, setSelectionRange(a, b) { this.selection = [a, b]; this.selectionStart = a; this.selectionEnd = b; } };
    const host = { innerHTML: '', contains: () => true, querySelectorAll: () => [], querySelector: s => s === 'textarea' ? textarea : s === '.talk-composer' ? { insertAdjacentHTML() {} } : null };
    const fire = (name, event) => handlers[name].forEach(h => h(event));
    const controller = createTalkController({ host, events: { addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } }, post() {} });
    controller.render({ messages: [], members });

    textarea.scrollHeight = 52; textarea.value = 'a\nb';
    fire('input', { target: textarea });
    assert.equal(textarea.style.height, '52px', 'the composer grows with its text');
    textarea.scrollHeight = 900; textarea.value = 'x\n'.repeat(40);
    fire('input', { target: textarea });
    assert.equal(textarea.style.height, '176px', 'growth stops at about 8 lines, then it scrolls');
    assert.ok(/overflow-y:\s*auto/.test(/\.talk-input-wrap textarea \{([^}]*)\}/.exec(css)[1]), 'beyond the cap the textarea scrolls');

    textarea.value = 'hi @Val'; textarea.scrollHeight = 30;
    fire('input', { target: textarea });
    const pick = { dataset: { mention: 'Validator', memberId: 'validator' }, hasAttribute: () => false, closest(sel) { return sel === 'button' ? this : null; } };
    fire('click', { target: pick, preventDefault() {} });
    assert.equal(textarea.value, 'hi @Validator ', 'the text is @Name followed by a space');
    assert.deepEqual(textarea.selection, ['hi @Validator '.length, 'hi @Validator '.length], 'the caret sits after that space');

    // (e) unread count in the tab title.
    const seen = new Set(['m1']);
    const incoming = [{ id: 'm1', author: 'agent', text: 'old' }, { id: 'm2', author: 'agent', text: 'new' }, { id: 'm3', author: 'validator', text: 'new too' },
        { id: 'm4', author: 'you', text: 'mine' }, { id: 'm5', author: 'system', kind: 'system', text: 'Agent joined' }];
    assert.equal(render.unreadCount(incoming, seen, members), 2, 'only unseen messages from others count');
    assert.equal(render.tabCountLabel(3), '(3)');
    assert.equal(render.tabCountLabel(0), '', 'cleared when AITalk is opened');
    incoming.forEach(m => seen.add(m.id));
    assert.equal(render.unreadCount(incoming, seen, members), 0, 'opening AITalk marks everything seen');
    const provider = fs.readFileSync(path.join(__dirname, 'src', 'webview', 'webviewProvider.ts'), 'utf8').replace(/\r/g, '');
    assert.ok(/data-tab="aitalk"[^>]*>AITalk<span class="tab-count" id="tab-count-aitalk"><\/span>/.test(provider), 'the AITalk tab carries the count slot');
    const ext = fs.readFileSync(path.join(__dirname, 'media', 'aitalk', 'extension.js'), 'utf8');
    assert.ok(/document\.hidden/.test(ext) && /tab-count-aitalk/.test(ext) && !/Audio|sound/i.test(ext), 'counts while hidden, silent');

    // (f) the startup skeleton is the AITalk widget in outline.
    const loader = /<div id="aa-loader"[^\n]*/.exec(provider)[0];
    assert.equal((loader.match(/class="aa-tab[" ]/g) || []).length, 5, 'five tab labels');
    assert.ok(/class="aa-tab aa-on"/.test(loader), 'AITalk is the active, underlined tab');
    assert.ok(/aa-health/.test(loader) && /aa-brand/.test(loader), 'health strip and round blue header avatar');
    assert.equal((loader.match(/class="aa-sk aa-bubble"/g) || []).length, 3, 'three message bubbles');
    assert.ok(/aa-msg aa-me/.test(loader) && /aa-composer/.test(loader), 'a right bubble and the composer');
    assert.ok(/aa-shimmer/.test(provider) && /--vscode-/.test(/#aa-loader \.aa-tabs \.aa-tab\.aa-on::after[^\n]*/.exec(provider)[0]), 'shimmer kept, themed with VS Code variables');

    console.log('PASS EV-AITALK-UI-BATCH: fixed bubble width, cost in the time row, growing composer, caret after mention, unread count in the tab, AITalk skeleton');
})().catch(error => { console.error('FAIL EV-AITALK-UI-BATCH:', error); process.exit(1); });
