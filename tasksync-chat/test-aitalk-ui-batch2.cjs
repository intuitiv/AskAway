// EV-AITALK-UI-BATCH2: the reviewer's 2026-10-24 AITalk asks, seen from the caller (real controller, real extension.js, fake DOM).
// (A) a reaction-only reply is a reaction, never a bubble; (B) unread count clears on tab/panel click, and every new message plays the notification once.
// Run: node test-aitalk-ui-batch2.cjs
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const render = await import('./media/aitalk/talkRender.js');
    const members = render.defaultMembers;
    const agent = members.find(member => member.kind === 'agent') || members.find(member => member.kind !== 'user');

    // (A) controller: reply quote set, composer holds only a reaction emoji.
    const handlers = {};
    const textarea = { value: '', selectionStart: 0, selectionEnd: 0, style: {}, scrollHeight: 30, matches: s => s === 'textarea', focus() {}, setSelectionRange() {} };
    const host = { innerHTML: '', contains: () => true, querySelectorAll: () => [], querySelector: s => s === 'textarea' ? textarea : null };
    const posts = [];
    const fire = (name, event) => (handlers[name] || []).forEach(h => h(event));
    const button = dataset => ({ dataset, hasAttribute: name => name === 'data-send' && dataset.send === '', closest(sel) { return sel === 'button' ? this : null; } });
    const controller = createTalkController({ host, events: { addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } }, post: message => posts.push(message) });
    controller.render({ messages: [{ id: 'p1', author: agent.id, text: 'Shipped it', time: '10:00' }], members });
    const startReply = () => fire('click', { target: button({ reply: 'p1' }), preventDefault() {} });

    startReply();
    textarea.value = ' 👍 ';
    fire('click', { target: button({ send: '' }), preventDefault() {} });
    assert.deepEqual(posts, [{ type: 'aitalkReact', replyTo: 'p1', emoji: '👍' }], 'a reaction-only reply is posted as a reaction');

    posts.length = 0; startReply();
    fire('click', { target: button({ insertEmoji: '🙏' }), preventDefault() {} });
    assert.deepEqual(posts, [{ type: 'aitalkReact', replyTo: 'p1', emoji: '🙏' }], 'picking an emoji while a reply is set reacts');

    posts.length = 0; startReply();
    textarea.value = 'Thanks 👍';
    fire('click', { target: button({ send: '' }), preventDefault() {} });
    assert.equal(posts[0].type, 'aitalkReply', 'an emoji inside longer text stays text');

    posts.length = 0;
    textarea.value = '👍';
    fire('click', { target: button({ send: '' }), preventDefault() {} });
    assert.equal(posts[0].type, 'aitalkPost', 'with no reply quote the emoji is a plain message');

    // (A2) a reaction picked while a reply quote is set never discards a draft or attachments.
    posts.length = 0; startReply();
    textarea.value = 'Please also check the tests'; textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    const opener = { dataset: {}, hasAttribute: name => name === 'data-emoji', closest(sel) { return sel === 'button' ? this : null; } };
    fire('click', { target: opener, preventDefault() {} });
    fire('click', { target: button({ insertEmoji: '👍' }), preventDefault() {} });
    assert.deepEqual(posts, [], 'with text in the composer the emoji is inserted, nothing is sent or discarded');
    assert.ok(host.innerHTML.includes('Please also check the tests'), 'the draft text is kept in the composer');

    // (A3) room: the reaction-only reply goes through the room's react path (watchers, owner, no bubble); store.post stays a plain append.
    const esbuild = require('esbuild');
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-b2-home-')));
    process.env.HOME = home;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-b2-ws-')));
    const bundle = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/delivery'; export * from './src/aitalk/actors';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', bundle)(require, mod, mod.exports);
    mod.exports.configureAITalkDelivery(root);
    mod.exports.setMainTurnProbe(() => true);
    const room = mod.exports.roomFor(root);
    const agentHandle = room.registerAgent();
    const asked = room.post(room.store.agentId(), 'Shall I ship it?', { kind: 'heads-up' }).message;
    const watched = [];
    room.onReaction((message, emoji, by) => watched.push([message.id, emoji, by]));
    const before = room.snapshot().messages.length;
    const result = room.userPost(' 👍 ', asked.id);
    assert.equal(result.message.id, asked.id);
    const after = room.snapshot().messages;
    assert.equal(after.length, before + 1, 'one reaction record, exactly as a chip click stores it');
    assert.ok(!after.some(m => m.id !== asked.id && m.text === '👍' && !m.emoji && JSON.stringify(m).includes('"kind"')), 'no ordinary bubble');
    assert.deepEqual(watched, [[asked.id, '👍', 'you']], 'reaction watchers (Webex draft approval, notifications) run as for a chip click');
    assert.deepEqual([after.at(-1).text, after.at(-1).replyTo, after.at(-1).author], ['👍', asked.id, 'you'], 'the reaction is stored on the message, the same record a chip click writes');
    void render;
    room.userPost('👍 thanks', asked.id);
    assert.equal(room.snapshot().messages.length, before + 2, 'an emoji inside longer text stays a message');
    room.userPost('👍', undefined);
    assert.equal(room.snapshot().messages.length, before + 3, 'with no reply the emoji is a plain message');
    assert.ok(!/REACTIONS\.includes\(String\(text\)/.test(fs.readFileSync(path.join(__dirname, 'src', 'aitalk', 'store.ts'), 'utf8')), 'store.post is a plain append');
    void agentHandle;

    // (B) the real extension.js in a vm with a fake DOM.
    let now = 1_000_000; Date.now = () => now;
    const code = fs.readFileSync(path.join(__dirname, 'media', 'aitalk', 'extension.js'), 'utf8');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-b2-'));
    fs.cpSync(path.join(__dirname, 'media', 'aitalk'), dir, { recursive: true });
    const file = path.join(dir, 'extension.mjs');
    fs.writeFileSync(file, code);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');

    const docHandlers = {}, winHandlers = {};
    const label = { textContent: '' };
    let focused = true, hidden = false, tabActive = true, sounds = 0;
    const tab = { classList: { contains: c => c === 'active' && tabActive } };
    const document = {
        get hidden() { return hidden; },
        hasFocus: () => focused,
        addEventListener(name, fn) { (docHandlers[name] ||= []).push(fn); },
        getElementById: id => id === 'tab-count-aitalk' ? label : id === 'aitalk-root' ? host : null,
        querySelector: s => s === '.widget-tab[data-tab="aitalk"]' ? tab : null,
    };
    const window = { addEventListener(name, fn) { (winHandlers[name] ||= []).push(fn); }, askawayPostMessage() {}, askawayPlayNotification() { sounds++; } };
    const timers = [];
    Object.assign(globalThis, { document, window, setInterval: fn => { timers.push(fn); return 0; } });
    await import(require('node:url').pathToFileURL(file).href);
    const state = messages => winHandlers.message.forEach(h => h({ data: { type: 'aitalkState', data: { messages, members } } }));
    const click = target => docHandlers.click.forEach(h => h({ target }));
    const tabTarget = { closest: sel => sel === '.widget-tab[data-tab="aitalk"]' ? tabTarget : null };
    const panelTarget = { closest: sel => sel === '#panel-aitalk' ? panelTarget : null };
    const old = { id: 'h1', author: agent.id, text: 'history' };
    const m2 = { id: 'm2', author: agent.id, text: 'new' };
    const mine = { id: 'm3', author: 'you', text: 'mine' };
    const join = { id: 'm4', author: 'system', kind: 'system', text: 'Agent joined' };

    // First state is history: no count, no sound.
    focused = false; tabActive = true;
    state([old]);
    assert.equal(sounds, 0, 'history is silent'); assert.equal(label.textContent, '');
    // A new message while AITalk is active but the window is blurred: counts, and plays.
    state([old, m2, mine, join]);
    assert.equal(label.textContent, '(1)', 'a snapshot in a blurred window does not clear the count');
    assert.equal(sounds, 1, 'one sound for the one new message from someone else; none for own or system lines');
    state([old, m2, mine, join]);
    assert.equal(sounds, 1, 'a message plays once only');
    // Panel click clears it.
    click(panelTarget);
    assert.equal(label.textContent, '', 'a click in the panel clears the count');
    // Another message in a focused, active tab: still plays; the count is cleared at once.
    focused = true; now += 2000;
    state([old, m2, mine, join, { id: 'm5', author: agent.id, text: 'again' }]);
    assert.equal(sounds, 2, 'sound plays even when AITalk is the active tab');
    // Another tab active: counts, and the tab click clears. A big snapshot plays the sound once, and not again within 1.5 s.
    tabActive = false;
    const big = [old, m2, mine, join, { id: 'm5', author: agent.id, text: 'again' }, { id: 'm6', author: agent.id, text: 'x' }, { id: 'm7', author: agent.id, text: 'y' }];
    now += 1000;
    state(big);
    assert.equal(sounds, 2, 'a second sound within 1.5 s is suppressed');
    assert.equal(label.textContent, '(2)');
    now += 2000;
    state([...big, ...Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, author: agent.id, text: `flood ${i}` }))]);
    assert.equal(sounds, 3, 'a 20-message snapshot plays one sound');
    click({ closest: () => null });
    assert.equal(label.textContent, '(22)', 'every message is still counted; an unrelated click does not clear');
    click(tabTarget);
    assert.equal(label.textContent, '', 'opening the AITalk tab clears the count');
    // Without the hook the tracker does not throw.
    delete window.askawayPlayNotification;
    state([old, m2, { id: 'm8', author: agent.id, text: 'z' }]);

    const web = fs.readFileSync(path.join(__dirname, 'media', 'webview.js'), 'utf8');
    assert.ok(/window\.askawayPlayNotification\s*=\s*function[^\n]*soundEnabled[^\n]*playNotificationSound/.test(web), 'webview exposes the hook, honouring the sound setting');

    console.log('PASS EV-AITALK-UI-BATCH2: reaction-only reply is a reaction, unread count clears on tab and panel click, one notification per new message');
})().catch(error => { console.error('FAIL EV-AITALK-UI-BATCH2:', error); process.exit(1); });
