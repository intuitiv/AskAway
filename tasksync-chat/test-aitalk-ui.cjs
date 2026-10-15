const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
    const render = await import('./media/aitalk/talkRender.js');
    const rules = await import('./media/aitalk/talkRules.js');
    const presence = await import('./media/aitalk/presence.js');
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const handlers = {}, sent = [];
    let menu, inserts = 0;
    const input = { value: '', selectionStart: 0, selectionEnd: 0, matches: () => true, closest: () => null, focus() {}, setSelectionRange() {} };
    const host = {
        innerHTML: '',
        querySelector(selector) {
            if (selector === 'textarea') return input;
            if (selector === '.talk-mentions') return menu;
            if (selector === '.talk-composer') return { insertAdjacentHTML(where, html) { inserts++; menu = { html, remove() { menu = undefined; } }; } };
        }
    };
    let snapshot;
    vm.runInNewContext(fs.readFileSync(__dirname + '/media/aitalk/extension.js', 'utf8').replace(/^import .*;$/gm, '').replace('export function', 'function'), {
        ...render, ...rules, ...presence, createTalkController, setInterval() {},
        window: { askawayPostMessage: action => sent.push(action), addEventListener: (name, fn) => { handlers['window-' + name] = fn; } },
         document: { querySelector: selector => ({ click() { sent.push({ type: 'navigate', selector }); } }), getElementById: () => host, addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } }
    });
    const paint = () => handlers['window-message']({ data: { type: 'aitalkState', data: snapshot } });
    const type = value => { input.value = value; handlers.input[0]({ target: input }); };
    const click = dataset => { const target = { closest: selector => selector === 'button' || selector === '[data-presence]' && dataset.presence ? { dataset, hasAttribute: () => false } : null }; for (const handler of handlers.click) handler({ target }); };
    const key = shiftKey => { let prevented = false; handlers.keydown[0]({ target: input, key: 'Enter', shiftKey, preventDefault() { prevented = true; } }); return prevented; };
    snapshot = { members: [
        { id: 'human', displayName: 'Sam Morgan', kind: 'user', rank: 400, presence: 'joined' },
        { id: 'review', displayName: 'Validator', kind: 'validator', rank: 300, presence: 'joined' }
    ], messages: [] };
    paint();
    snapshot.members.push({ id: 'main', displayName: 'Planning', kind: 'agent', rank: 200, presence: 'joined' });
    snapshot.messages.push({ id: 'join', kind: 'system', text: 'Planning joined' }, { id: 'question', author: 'main', text: 'Check this plan?' });
    snapshot.members.push({ id: 'task', displayName: 'Review tests', kind: 'worker', rank: 100, presence: 'joined' });
    snapshot.messages.push({ id: 'worker-join', kind: 'system', text: 'Review tests joined' });
    paint();
    assert.ok(host.innerHTML.includes(render.talkHtml(snapshot.messages, { members: snapshot.members, embedded: true })));
    for (const kind of ['update', 'heads-up']) {
        const post = { id: 'speech', author: 'main', kind, text: kind === 'update' ? "I've finished routing. I'm checking the tests now." : "Can you pick Workers or Trace? I'd put the scoreboard in Workers." };
        snapshot.messages.push(post); paint();
        assert.ok(host.innerHTML.includes(render.bubbleHtml(post, { messages: snapshot.messages, members: snapshot.members })), 'commentary uses the participant bubble');
        assert.equal(render.bubbleHtml(post, { members: snapshot.members }), render.bubbleHtml({ ...post, kind: undefined }, { members: snapshot.members }), 'updates and questions look like ordinary messages');
        snapshot.messages.pop();
    }
    assert.doesNotMatch(fs.readFileSync(__dirname + '/media/aitalk/talk.css', 'utf8'), /\.talk-bubble\.heads-up/, 'no warning strip overrides the shared bubble');
    console.log('PASS EV-AITALK-SPEECH updates and questions render as ordinary participant bubbles');
    type('@'); assert.match(menu.html, /Validator|Review tests/);
    const originalMenu = menu;
    type('@V'); type('@Validator'); assert.equal(menu, originalMenu); assert.equal(inserts, 1, 'mention menu does not flicker');
    type('@Validator check this?'); assert.equal(key(false), true);
    assert.equal(sent.at(-1).type, 'aitalkPost'); assert.equal(sent.at(-1).recipients, undefined, 'routing belongs to the room, not the widget');
    snapshot.messages.push({ id: 'answer', author: 'human', text: sent.at(-1).text, delivery: 'sent' });
    for (const [delivery, paths, colour] of [['sent', 1, 'posted'], ['delivered', 2, 'delivered'], ['read', 2, 'read']]) {
        snapshot.messages.at(-1).delivery = delivery; paint();
        const tick = host.innerHTML.match(new RegExp(`<span class="talk-ticks ${colour}"[^]*?</span>`))[0];
        assert.equal((tick.match(/<path /g) || []).length, paths);
    }
    click({ reply: 'question' }); assert.match(host.innerHTML, /talk-reply-bar[^]*Check this plan\?/);
    type('Looks good'); key(false); assert.equal(sent.at(-1).replyTo, 'question');
    type('two lines'); const count = sent.length; assert.equal(key(true), false); assert.equal(sent.length, count);
    // Native textarea default action inserts the newline when Shift+Enter is not prevented.
    type('two lines\nsecond'); assert.equal(input.value, 'two lines\nsecond');
    snapshot.members.find(member => member.id === 'task').presence = 'left';
    snapshot.messages.push({ id: 'worker-left', kind: 'system', text: 'Review tests left' }); paint();
    menu = undefined;
    type('@'); assert.doesNotMatch(menu.html, /Review tests/);
    assert.match(host.innerHTML, /Review tests left/);
    assert.ok(host.innerHTML.indexOf('id="talk-question"') < host.innerHTML.indexOf('id="talk-answer"'), 'newest message remains below earlier messages');
    assert.match(render.threadHtml([{ id: 'unsafe', author: 'main', text: '<script>bad</script>' }], snapshot.members), /&lt;script&gt;/);
    assert.match(fs.readFileSync(__dirname + '/storybook/prototypes/talk.js', 'utf8'), /media\/aitalk\/talkRender/);
    snapshot.userName = 'Sam Morgan'; paint(); assert.match(host.innerHTML, />SM<\/span>/);
    snapshot.userPhoto = 'https://example.invalid/avatar.png'; paint(); assert.match(host.innerHTML, /<img src="https:\/\/example.invalid\/avatar.png"/);
    assert.doesNotMatch(host.innerHTML, /Personal availability/);
    let tracePrevented = false;
    for (const handler of handlers.click) handler({ target: { closest: selector => selector === 'a.talk-trace-link[data-tab]' ? { dataset: { tab: 'Trace' } } : null }, preventDefault() { tracePrevented = true; } });
    assert.equal(tracePrevented, true); assert.equal(sent.at(-1).type, 'navigate'); assert.equal(sent.at(-1).selector, '.widget-tab[data-tab="observability"]');
    click({ presence: 'away' }); assert.equal(sent.at(-1).type, 'setAvailability'); assert.equal(sent.at(-1).mode, 'away');
    snapshot.messages.push({ id: 'draft', author: 'main', text: 'Send this?', draftId: 'webex-draft' }); paint();
    click({ react: '👍', msg: 'draft' }); assert.equal(sent.at(-1).type, 'aitalkApproveDraft'); assert.equal(sent.at(-1).draftId, 'webex-draft');
    snapshot = { messages: [{ id: 'fallback', author: 'reviewer', authorKind: 'user', displayName: 'Sam Morgan', rank: 400, text: 'Hello' }, { id: 'fallback-agent', author: 'planner', authorKind: 'agent', displayName: 'Planning', rank: 200, text: 'Ready' }] };
    paint(); assert.doesNotMatch(host.innerHTML, /moderate/); assert.match(host.innerHTML, />SM<\/span>/);
    // Who is in charge follows availability, not rank (2026-10-14).
    const inCharge = { here: null, away: 'You answer from your phone', awayValidator: 'Validator in charge', offline: 'Nobody answers; questions wait for you' };
    for (const [mode, label] of Object.entries(inCharge)) {
        handlers['window-message']({ data: { type: 'availabilityState', data: { mode, setAt: '' } } });
        const shown = host.innerHTML.match(/<span class="talk-in-charge">([^<]*)<\/span>/);
        assert.equal(shown ? shown[1] : null, label, mode);
    }
    handlers['window-message']({ data: { type: 'availabilityState', data: { mode: 'here', setAt: '' } } });
    assert.doesNotMatch(fs.readFileSync(__dirname + '/media/aitalk/talkRender.js', 'utf8'), /moderates?'/);
    console.log('PASS EV-AITALK-IN-CHARGE Here no label; Away phone; Validator in charge; Offline nobody answers; no moderate wording');
    assert.match(fs.readFileSync(__dirname + '/storybook/prototypes/presence.js', 'utf8'), /media\/aitalk\/presence/);
    const scriptHandlers = {};
    const controller = createTalkController({ host, events: { addEventListener(name, fn) { (scriptHandlers[name] ||= []).push(fn); } }, post: action => sent.push(action) });
    scriptHandlers.click[0]({ target: { closest: selector => selector === 'a.talk-trace-link[data-tab]' ? { dataset: { tab: 'Trace' } } : null }, preventDefault() {} });
    assert.equal(sent.at(-1).type, 'talkTab'); assert.equal(sent.at(-1).tab, 'Trace');
    const thread = { scrollTop: 0, scrollHeight: 800, clientHeight: 800 };
    const originalQuery = host.querySelector;
    host.querySelector = selector => selector === '.talk-thread' ? thread : originalQuery(selector);
    const scriptClick = (dataset = {}, attribute = '') => scriptHandlers.click[0]({ target: { closest: selector => selector === 'button' ? { dataset, hasAttribute: name => name === attribute } : null } });
    const scriptKey = key => scriptHandlers.keydown[0]({ target: input, key, preventDefault() {} });
    controller.render({ members: [...snapshot.messages.map(message => ({ id: message.author, displayName: message.displayName, kind: message.authorKind, rank: message.rank, presence: 'joined' })), { id: 'worker', displayName: 'Worker', rank: 100, presence: 'left' }], messages: [], unread: 2 });
    // Actors feed data only: the worker registers (banner), then the agent posts.
    const fed = controller.snapshot();
    controller.render({ ...fed, members: fed.members.map(member => member.id === 'worker' ? { ...member, presence: 'joined' } : member), messages: [{ id: 'worker-joined', kind: 'system', text: 'Worker joined' }, { id: 'long', author: 'planner', text: 'Quick question', details: 'Detailed plan' }] });
    assert.match(host.innerHTML, /Worker joined/); assert.doesNotMatch(host.innerHTML, /talk-typing"/);
    controller.render({ ...controller.snapshot(), typing: 'Planning is typing' }); assert.match(host.innerHTML, /talk-typing/);
    scriptClick({ more: 'long' }); assert.match(host.innerHTML, /Detailed plan/);
    scriptClick({ more: 'long' }); assert.doesNotMatch(host.innerHTML, />Detailed plan</);
    scriptClick({ reply: 'long' }); scriptClick({}, 'data-cancel-reply'); assert.doesNotMatch(host.innerHTML, /talk-reply-bar/);
    input.value = 'Hi'; input.selectionStart = input.selectionEnd = 2;
    scriptClick({}, 'data-emoji'); assert.match(host.innerHTML, /talk-emoji-picker/);
    scriptClick({ insertEmoji: '👍' }); assert.match(host.innerHTML, /Hi👍/);
    scriptClick({}, 'data-attach'); assert.equal(sent.at(-1).type, 'aitalkAttach');
    controller.receive({ type: 'aitalkAttachments', files: [{ name: 'notes.txt' }] }); assert.match(host.innerHTML, /notes.txt/);
    scriptClick({}, 'data-send'); assert.equal(sent.at(-1).type, 'aitalkPost'); assert.equal(sent.at(-1).attachments[0].name, 'notes.txt');
    scriptClick({ react: '🙏', msg: 'long' }); assert.equal(sent.at(-1).type, 'aitalkReact');
    scriptClick({}, 'data-bottom'); assert.equal(thread.scrollTop, 800); assert.doesNotMatch(host.innerHTML, /class="talk-unread"/);
    const choices = ['Planning', 'Worker'].map(name => ({ dataset: { mention: name }, setAttribute(key, value) { this[key] = value; } }));
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
        input.value = '@'; scriptHandlers.input[0]({ target: input });
        menu = { querySelectorAll: () => choices, remove() { menu = undefined; } };
        scriptKey(key);
        if (key === 'Enter' || key === 'Tab') assert.match(host.innerHTML, /@Planning /);
        if (key === 'Escape') assert.equal(menu, undefined);
    }
    const later = controller.snapshot();
    controller.render({ ...later, typing: '', messages: [...later.messages, { id: 'delivered', author: 'reviewer', text: 'Reply', tick: 'read' }] }); assert.match(host.innerHTML, /talk-ticks read/);
    const leaving = controller.snapshot();
    controller.render({ ...leaving, members: leaving.members.map(member => member.id === 'worker' ? { ...member, presence: 'left' } : member), messages: [...leaving.messages, { id: 'worker-left', kind: 'system', text: 'Worker left' }] }); assert.match(host.innerHTML, /Worker left/);
    const classes = new Set();
    const reactionButton = { focus() { this.focused = true; }, closest: () => bubble, matches: () => false };
    const bubble = { classList: { add: value => classes.add(value), toggle(value) { classes.has(value) ? classes.delete(value) : classes.add(value); } }, querySelectorAll: () => [reactionButton], closest: () => bubble, matches: () => false };
    scriptHandlers.contextmenu[0]({ target: bubble, preventDefault() {} }); assert.ok(classes.has('reacting'));
    scriptHandlers.keydown[0]({ target: reactionButton, key: 'ArrowRight', preventDefault() {} }); assert.equal(reactionButton.focused, true);
    classes.clear(); scriptHandlers.pointerdown[0]({ target: bubble, pointerType: 'touch' });
    await new Promise(resolve => setTimeout(resolve, 520)); assert.ok(classes.has('reacting'));
    const previousQueryAll = host.querySelectorAll;
    bubble.classList.remove = value => classes.delete(value);
    host.querySelectorAll = selector => selector === '.reacting' ? [bubble] : [];
    const outside = { closest: () => null, matches: () => false };
    for (const handler of scriptHandlers.click) handler({ target: outside }); assert.equal(classes.has('reacting'), false);
    classes.add('reacting'); for (const handler of scriptHandlers.keydown) handler({ target: outside, key: 'Escape', preventDefault() {} }); assert.equal(classes.has('reacting'), false);
    const trigger = { closest: selector => selector.includes('presence-trigger') || selector === '.presence-anchor' ? trigger : null, classList: { contains: name => name === 'presence-trigger' }, matches: () => false };
    const presenceKey = key => { for (const handler of scriptHandlers.keydown) handler({ target: trigger, key, preventDefault() {} }); };
    const open = () => { for (const handler of scriptHandlers.click) handler({ target: trigger }); };
    open(); assert.match(host.innerHTML, /presence-flyout/);
    presenceKey('ArrowDown'); assert.match(host.innerHTML, /tabindex="0" data-presence="away"/);
    presenceKey('ArrowUp'); assert.match(host.innerHTML, /tabindex="0" data-presence="here"/);
    presenceKey('ArrowDown'); presenceKey('Enter'); assert.equal(sent.at(-1).mode, 'away'); assert.doesNotMatch(host.innerHTML, /presence-flyout/);
    open(); presenceKey('Escape'); assert.doesNotMatch(host.innerHTML, /presence-flyout/);
    open(); for (const handler of scriptHandlers.click) handler({ target: outside }); assert.doesNotMatch(host.innerHTML, /presence-flyout/);
    host.querySelectorAll = previousQueryAll;
    assert.doesNotMatch(fs.readFileSync(__dirname + '/media/aitalk/talkController.js', 'utf8'), /aitalk-root|widget-tab/);
    console.log('PASS EV-AITALK-UI availability Up/Down/Enter/Escape; availability/reaction outside and Escape dismissal; arbitrary mount root');
    assert.match(fs.readFileSync(__dirname + '/storybook/prototypes/mount.js', 'utf8'), /createTalkController/);
    console.log('PASS EV-AITALK-UI shared controller script: send/cancel/mentions keyboard/emoji/attach/more/reaction/live typing+delivery/join+leave/unread scroll');
    console.log('PASS EV-AITALK-UI avatar initials/photo; shared availability action; draft thumbs-up approval; fallback registry and viewer moderator');
    console.log('PASS EV-AITALK-UI shared prototype; scripted joins/leaves; stable present mentions; addressed Enter send; sent/delivered/read ticks; quote reply; Shift+Enter; escaped text');
    require('./test-aitalk-availability-menu.cjs');
})().catch(error => { console.error(error); process.exitCode = 1; });
