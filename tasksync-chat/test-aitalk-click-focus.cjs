const assert = require('node:assert/strict');
// Reviewer 2026-10-21: "When i click on anywhere on the aitalk, it is taking me to Team. Even when i am reacting to it."
// Only a member's avatar face or name opens Team; everything else in the row (bubble, reactions, reply, links) does not.
(async () => {
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const handlers = {};
    const host = { innerHTML: '', ownerDocument: undefined, querySelector: () => null, querySelectorAll: () => [], contains: () => true };
    const sent = [];
    createTalkController({ host, events: { addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } }, post: action => sent.push(action) });
    // Mini DOM: node(classes, attrs, parent, tag). closest() understands the selectors the controller uses.
    const node = (tag, classes, attrs, parent) => {
        const el = { tag, classList: { contains: c => classes.includes(c) }, attrs, parent, dataset: {}, hasAttribute: n => n in attrs, textContent: attrs.text || '' };
        for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
        const matches = sel => sel.split(',').map(s => s.trim()).some(part => {
            const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/.exec(part);
            if (!m) return false;
            return (!m[1] || m[1] === tag) && (m[2].split('.').filter(Boolean).every(c => classes.includes(c))) && (m[3].match(/\[([\w-]+)\]/g) || []).every(a => a.slice(1, -1) in attrs);
        });
        el.closest = sel => { for (let n = el; n; n = n.parent) if (n.matchesSel(sel)) return n; return null; };
        el.matchesSel = matches;
        return el;
    };
    const row = node('div', ['talk-row', 'in'], { 'data-member-id': 'priya' });
    const bubble = node('div', ['talk-bubble'], { 'data-msg': 'm1' }, row);
    const text = node('span', ['talk-text'], {}, bubble);
    const avatar = node('span', ['talk-avatar'], { 'data-member-id': 'priya' }, row);
    const face = node('img', ['team-avatar-img'], {}, avatar);
    const sender = node('span', ['talk-sender'], { 'data-member-id': 'priya' }, bubble);
    const react = node('button', ['talk-react'], { 'data-react': '🙏', 'data-msg': 'm1' }, bubble);
    const chip = node('span', ['talk-reaction'], {}, bubble);
    const reply = node('button', [], { 'data-reply': 'm1' }, bubble);
    const click = target => { sent.length = 0; handlers.click.forEach(h => h({ target, preventDefault() {} })); return sent.map(m => m.type); };
    assert.deepEqual(click(react), ['aitalkReact']); assert.equal(sent[0].emoji, '🙏');
    assert.deepEqual(click(chip), []); assert.deepEqual(click(text), []); assert.deepEqual(click(bubble), []); assert.deepEqual(click(row), []);
    assert.deepEqual(click(reply), []);
    assert.deepEqual(click(face), ['talkMember']); assert.equal(sent[0].memberId, 'priya');
    assert.deepEqual(click(avatar), ['talkMember']);
    assert.deepEqual(click(sender), ['talkMember']);
    global.window = { getSelection: () => 'selected words' };
    assert.deepEqual(click(sender), [], 'selecting text never opens Team');
    delete global.window;
    console.log('PASS EV-AITALK-CLICK-FOCUS reaction posts aitalkReact; bubble/chip/reply click nothing; avatar and name open Team');
})().catch(e => { console.error(e); process.exit(1); });
