import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presenceStates, createPresence, badgeHtml } from './presence.js';

test('four configured modes render distinct icons, production colours and labels in the avatar menu', () => {
    assert.equal(presenceStates.length, 4);
    for (const key of ['icon', 'colour', 'label']) assert.equal(new Set(presenceStates.map(state => state[key])).size, 4);
    const production = readFileSync(new URL('../../media/main.css', import.meta.url), 'utf8');
    const control = createPresence({ open: true });
    const html = control.html();
    for (const state of presenceStates) {
        assert.ok(production.includes(`--presence: ${state.colour}`));
        assert.ok(html.includes(badgeHtml(state)));
        assert.ok(html.includes(`data-presence="${state.id}"`));
        assert.ok(html.includes(state.meaning));
    }
    assert.equal((html.match(/role="menuitemradio"/g) || []).length, 4);
    for (const label of ['Settings', 'View History', 'New session', 'Reset status after']) assert.ok(html.includes(`aria-label="${label}"`));
});
test('choosing each state closes the flyout and updates the avatar badge and widget frame', () => {
    const control = createPresence();
    for (const state of presenceStates) {
        control.toggle(); control.choose(state.id);
        assert.equal(control.snapshot().open, false);
        assert.match(control.html(), new RegExp(`avail-${state.id}`));
        assert.ok(control.html().includes(`--presence:${state.colour}`));
        assert.ok(control.html().includes(badgeHtml(state)));
        assert.match(control.html(), /aria-expanded="false"/);
        assert.doesNotMatch(control.html(), /class="presence-flyout"/);
    }
});
test('reset durations set an expiry, Today is local midnight, Never clears it and expiry resets Available', () => {
    let now = new Date(2026, 9, 12, 12).getTime();
    const control = createPresence({ mode: 'away', now: () => now });
    for (const [id, minutes] of [['30m', 30], ['1h', 60], ['2h', 120]]) {
        control.setReset(id); assert.equal(control.snapshot().expiresAt, now + minutes * 60000);
    }
    control.setReset('today');
    assert.equal(control.snapshot().expiresAt, new Date(2026, 9, 13).getTime());
    control.setReset('never'); assert.equal(control.snapshot().expiresAt, null);
    control.setReset('30m'); now += 30 * 60000; control.expire();
    assert.equal(control.snapshot().mode, 'here');
});
test('Enter and Space open; arrows wrap roving menu focus; selection and Escape close', () => {
    const control = createPresence();
    control.key('Enter'); assert.equal(control.snapshot().open, true);
    control.key('ArrowDown'); assert.equal(control.snapshot().focusIndex, 1);
    assert.match(control.html(), /tabindex="0" data-presence="away"/);
    control.key('ArrowUp'); control.key('ArrowUp'); assert.equal(control.snapshot().focusIndex, 3);
    control.key(' '); assert.equal(control.snapshot().mode, 'offline'); assert.equal(control.snapshot().open, false);
    control.key(' '); assert.equal(control.snapshot().open, true);
    control.key('Escape'); assert.equal(control.snapshot().open, false);
});
test('new availability states need config only; theme and reduced-motion rendering remain generic', () => {
    const custom = { id: 'focus', label: 'Focus', meaning: 'Quiet time', icon: '◆', colour: '#123456', accent: '#abcdef' };
    const control = createPresence({ states: [...presenceStates, custom], open: true, theme: 'light' });
    control.key('End'); assert.equal(control.snapshot().focusIndex, 4);
    control.key('Enter'); assert.match(control.html(), /avail-focus/);
    assert.match(control.html(), /theme-light/);
    assert.ok(control.html().includes(badgeHtml(custom)));
    const css = readFileSync(new URL('./presence.css', import.meta.url), 'utf8');
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /animation: presence-open/);
    assert.match(css, /animation: presence-border/);
});
