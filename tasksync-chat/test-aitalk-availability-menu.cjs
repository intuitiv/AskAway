// Caller view: the open availability menu survives the provider's periodic posts (2 s requestAITalk poll,
// availabilityState pushes) as the same node, still open, with no animation-restarting rewrite.
const assert = require('node:assert/strict');
(async () => {
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const regions = ['title', 'presence', 'thread', 'unread', 'composer'];
    let slots = {}, rewrites = 0, nodes = 0;
    const node = key => { const id = ++nodes; let html = ''; return { id, dataset: { talkRegion: key }, get innerHTML() { return html; }, set innerHTML(value) { html = value; this.writes = (this.writes || 0) + 1; } }; };
    const host = {
        get innerHTML() { return regions.map(key => slots[key]?.innerHTML).join(''); },
        set innerHTML(value) { rewrites++; slots = Object.fromEntries(regions.map(key => [key, node(key)])); regions.forEach(key => { slots[key].innerHTML = value; }); },
        querySelector(selector) { const match = /data-talk-region="(\w+)"/.exec(selector); return match ? slots[match[1]] : null; },
        querySelectorAll: () => [], contains: () => true,
    };
    const events = { handlers: {}, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); } };
    const controller = createTalkController({ host, events, post: () => {} });
    // Exactly what the provider posts: JSON-cloned room snapshot plus the user's name, and the availability file.
    const snapshot = () => JSON.parse(JSON.stringify({ messages: [{ id: 'a', author: 'main', text: 'hi', time: '10:00' }], members: [{ id: 'you', displayName: 'You', kind: 'user', rank: 400, presence: 'joined' }, { id: 'main', displayName: 'Planning', kind: 'agent', rank: 200, presence: 'joined' }], typing: '', userName: 'Sam Morgan', userPhoto: '' }));
    const availability = { mode: 'awayValidator', until: new Date(Date.now() + 3600e3).toISOString(), setAt: new Date().toISOString() };
    controller.receive({ type: 'aitalkState', data: snapshot() });
    controller.receive({ type: 'availabilityState', data: availability, states: [] });
    controller.receive({ type: 'openPresence' });
    // The user picked "Reset status after 30 min": the provider's pushes carry the persisted `until`.
    for (const handler of events.handlers.change) handler({ target: { matches: () => true, value: '30m' } });
    controller.receive({ type: 'availabilityState', data: availability, states: [] });
    const menu = slots.presence, before = menu.writes, html = menu.innerHTML, full = rewrites;
    assert.match(html, /presence-flyout/);
    assert.match(slots.title.innerHTML, /Validator in charge/);
    let clock = Date.now();
    const realNow = Date.now;
    for (let poll = 0; poll < 10; poll++) {
        clock += 61000; Date.now = () => clock;
        controller.receive({ type: 'aitalkState', data: snapshot() });
        controller.receive({ type: 'availabilityState', data: JSON.parse(JSON.stringify(availability)), states: [] });
    }
    Date.now = realNow;
    assert.equal(rewrites, full, 'host is never re-mounted by a poll');
    assert.equal(slots.presence, menu, 'menu region is the same node');
    assert.equal(menu.writes, before, 'menu is never rewritten, so its open animation never replays');
    assert.equal(menu.innerHTML, html);
    assert.match(menu.innerHTML, /presence-flyout/, 'menu stays open');
    console.log('PASS EV-AITALK-AVAILABILITY-STABLE open availability menu: same node, still open, no rewrite across 10 provider polls');
})().catch(error => { console.error(error); process.exitCode = 1; });
