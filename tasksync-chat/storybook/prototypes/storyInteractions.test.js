import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as fixtures from './talk.js';
import * as rules from './talkRules.js';
import { createTalkController } from '../../media/aitalk/talkController.js';
import { mountPresence } from './presence.js';

export function fakeDocument() {
    const doc = { handlers: {}, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }, fire(name, target, key) { for (const fn of this.handlers[name] || []) fn({ target, key, preventDefault() {} }); } };
    doc.createElement = () => {
        const root = { ownerDocument: doc, children: [], innerHTML: '', handlers: {}, isConnected: true, append(...items) { this.children.push(...items); }, contains(target) { return target.root === this; }, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }, querySelectorAll(selector) { return selector === '[data-presence]' ? ['here', 'away', 'awayValidator', 'offline'].map(id => this.button({ presence: id })) : []; }, button(dataset = {}, cls = '') { return { root: this, dataset, classList: { contains: name => cls === name }, hasAttribute: name => name === 'data-send' && !!dataset.send, matches: selector => selector === 'textarea' && !!dataset.input, closest(selector) { if (selector === 'button') return this; if (selector.includes('presence-trigger') && cls === 'presence-trigger') return this; if (selector === '[data-presence]' && dataset.presence) return this; if (selector === '.presence-anchor' && (cls === 'presence-trigger' || dataset.presence)) return this; return null; }, focus() {} }; } };
        root.input = { ...root.button({ input: true }), value: '', selectionStart: 0, selectionEnd: 0, setSelectionRange() {} };
        root.querySelector = selector => selector === 'textarea' ? root.input : selector === '.presence-trigger' ? root.button({}, 'presence-trigger') : null;
        return root;
    };
    return doc;
}
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const stories = (source, bindings) => {
    const names = [...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
    const context = { ...bindings };
    vm.runInNewContext(source.replace(/^import .*;$/gm, '').replace(/^export default .*;$/gm, '').replace(/export const /g, 'const ') + `;globalThis.stories = {${names.join(',')}};`, context);
    return context.stories;
};
test('every Talk story renders on an arbitrary root and sends without affecting another mount', () => {
    const doc = fakeDocument();
    const context = { document: doc, ...fixtures, ...rules, createTalkController, cssText: '', VSCODE_DARK_THEME: '', prototypeCss: '', traceRowsHtml: () => '', setTimeout: () => 0 };
    vm.runInNewContext(read('./mount.js').replace(/^import .*;$/gm, '').replace(/^const \{ traceRowsHtml \}.*$/gm, '').replace('export function', 'function') + ';globalThis.mountTalk = mountTalk;', context);
    for (const [name, story] of Object.entries(stories(read('../stories/Talk.stories.js'), context))) {
        const first = story.render().children[1], second = story.render().children[1];
        assert.match(first.innerHTML, /talk-composer/, name);
        const unchanged = second.innerHTML;
        first.input.value = 'Story check';
        doc.fire('keydown', first.input, 'Enter');
        assert.match(first.innerHTML, /Story check/, name);
        assert.equal(second.innerHTML, unchanged, name + ' mount isolation');
        doc.fire('click', first.button({}, 'presence-trigger'));
        assert.match(first.innerHTML, /presence-flyout/, name);
        doc.fire('click', { root: null, closest: () => null });
        assert.doesNotMatch(first.innerHTML, /presence-flyout/, name + ' outside');
    }
});
test('every Presence story supports keyboard choice and outside dismissal through shared binding', () => {
    const previous = globalThis.document;
    const doc = fakeDocument(); globalThis.document = doc;
    try {
        for (const [name, story] of Object.entries(stories(read('../stories/Presence.stories.js'), { mountPresence }))) {
            const root = story.render(); assert.match(root.innerHTML, /presence-widget/, name);
            if (!root.innerHTML.includes('presence-flyout')) doc.fire('click', root.button({}, 'presence-trigger'));
            doc.fire('keydown', root.button({}, 'presence-trigger'), 'ArrowDown');
            doc.fire('keydown', root.button({}, 'presence-trigger'), 'Enter');
            assert.doesNotMatch(root.innerHTML, /presence-flyout/, name);
            doc.fire('click', root.button({}, 'presence-trigger')); doc.fire('click', { root: null, closest: () => null });
            assert.doesNotMatch(root.innerHTML, /presence-flyout/, name + ' outside');
        }
    } finally { globalThis.document = previous; }
});
