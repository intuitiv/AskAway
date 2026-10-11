import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { talkHtml, traceHtml, scenarios, traceSessions, liveStart, liveScript, ticksHtml, whoClass, reactionNote } from './talk.js';
import { buildCommentaryKit } from '../kit.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const count = (html, pattern) => (html.match(pattern) || []).length;

test('full conversation has tails only on first bubble of a run, sender names and system pills', () => {
    const html = talkHtml(scenarios.Full.messages, scenarios.Full);
    assert.match(html, /aria-label="Group chat"/);
    assert.match(html, /<h2>AITalk<\/h2>/);
    assert.match(html.replace(/<[^>]+>/g, ""), /YouAgent|You, Agent, Validator, build-1/);
    // e11 and e12 are consecutive "You" bubbles: one tail, one follow.
    assert.match(html, /id="talk-e11"[^>]*>.*?talk-bubble tail/s);
    assert.match(html, /<div class="talk-row out follow" id="talk-e12"><div class="talk-bubble\s+"/);
    assert.equal(count(html, /talk-bubble tail/g), count(html, /talk-row [a-z]+ first/g));
    for (const text of ['Today', 'build-1 joined', 'build-1 left', 'Agent left — joins again when you message it']) assert.match(html, new RegExp(`talk-pill[^>]*>${text}`));
    assert.match(html, /<b class="talk-mention">@Agent<\/b>/);
    assert.match(html, /View trace ↗/);
    assert.match(html, /talk-reaction/);
    assert.match(html, /3 new messages ↓/);
    assert.doesNotMatch(html, /grey|talk-progress/);
});

test('sender name appears only on the first bubble of a run, with a stable colour', () => {
    const html = talkHtml([
        { id: 'a', author: 'Agent', text: 'one', time: '1' },
        { id: 'b', author: 'Agent', text: 'two', time: '2' },
    ]);
    assert.equal(count(html, /class="talk-sender who-agent"/g), 1);
    assert.equal(whoClass('Agent'), whoClass('agent'));
    assert.notEqual(whoClass('Agent'), whoClass('Validator'));
});

test('ticks: grey check = posted, blue double check = delivered with tool in tooltip', () => {
    assert.match(ticksHtml({ delivery: 'posted' }), /class="talk-ticks posted"[^>]*>✓</);
    const delivered = ticksHtml({ delivery: 'delivered', tool: 'read_file' });
    assert.match(delivered, /class="talk-ticks delivered"/);
    assert.match(delivered, /✓✓/);
    assert.match(delivered, /title="[^"]*read_file/);
    assert.equal(ticksHtml({}), '');
});

test('quote block, quiz votes and reactions render inside the bubble', () => {
    const html = talkHtml(scenarios.Full.messages);
    assert.match(html, /<div class="talk-quote who-agent"><b class="talk-quote-who">Agent<\/b><span class="talk-quote-text">Keep the name AITalk\?/);
    assert.match(html, /<ol class="talk-questions">.*data-vote="up".*data-vote="down"/s);
    assert.match(html, /data-vote="up"[^>]*aria-pressed="true"/);
    // Validator reply with replyTo quotes the worker message.
    assert.match(html, /talk-quote who-worker.*should the reply preview/s);
});

test('composer, @ popover with presence, typing and proxy frame', () => {
    const html = talkHtml(scenarios.Away.messages, scenarios.Away);
    assert.match(html, /class="talk-composer"/);
    assert.match(html, /placeholder="Message"/);
    assert.match(html, /aria-label="Emoji"/);
    assert.match(html, /aria-label="Attach"/);
    assert.match(html, /class="talk-send" data-send/);
    assert.match(html, /role="listbox"/);
    assert.match(html, /class="left" data-mention="Agent"/);
    assert.match(html, /mention to bring back/);
    assert.match(html, /Validator memory updated/);
    assert.doesNotMatch(talkHtml([], { draft: 'hi' }), /talk-mentions/);
    assert.match(talkHtml(liveStart, { typing: 'Agent is typing…' }), /Agent is typing…/);
    assert.match(talkHtml([], scenarios.Proxy), /moderator-validator/);
    assert.match(talkHtml([], scenarios.Empty), /No messages yet/);
    assert.match(talkHtml([], scenarios.Light), /theme-light/);
    assert.match(talkHtml([], {}), /moderator-you/);
    assert.ok(liveScript.some(s => s.do === 'deliver') && liveScript.some(s => s.do === 'typing'));
});

test('user text is escaped', () => {
    assert.doesNotMatch(talkHtml([{ id: 'u', author: 'You', text: '<script>bad()</script>' }]), /<script>/);
});

test('Trace contains the exact shared production trace output for each session', () => {
    const kit = buildCommentaryKit({ webviewSrc: read('../../media/webview.js'), providerSrc: read('../../src/webview/webviewProvider.ts') });
    const html = traceHtml(traceSessions, kit.traceRowsHtml);
    for (const session of traceSessions) assert.ok(html.includes(kit.traceRowsHtml(session.events, { now: 1791716400000 })));
    assert.doesNotMatch(html, /Observability|RTK|Gradle/);
});

test('css is readable, 420px, reduced-motion aware; stories live under AITalk/', () => {
    const css = read('./talk.css');
    assert.match(css, /width: 420px;/);
    assert.match(css, /height: 760px;/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.ok(css.split('\n').length > 150);
    const stories = read('../stories/Talk.stories.js');
    assert.match(stories, /title: 'AITalk\/Talk'/);
    for (const name of ['FullConversation', 'LiveSimulation', 'ValidatorWhileAgentAway', 'LightTheme', 'ValidatorAsProxy', 'EmptyState']) assert.ok(stories.includes(`export const ${name} =`));
    assert.match(read('../stories/Trace.stories.js'), /title: 'AITalk\/Trace tab'/);
    assert.match(read('./mount.js'), /prefers-reduced-motion/);
    assert.match(read('./mount.js'), /setInterval/);
});

test('every message from someone else gets a focusable bubble with a reaction bar; your own do not', () => {
    const messages = [
        { id: 'a', author: 'Agent', text: 'hi', time: '1' },
        { id: 'v', author: 'Validator', text: 'hello', time: '2' },
        { id: 'w', author: 'build-1', text: 'yo', time: '3' },
        { id: 'y', author: 'You', text: 'mine', time: '4' },
    ];
    const html = talkHtml(messages);
    assert.equal(count(html, /class="talk-react-bar"/g), 3);
    assert.equal(count(html, /<div class="talk-bubble[^"]*"[^>]*tabindex="0" data-msg=/g), 3);
    for (const emoji of ['👍', '👎', '❤️', '😂', '🙏']) assert.equal(count(html, new RegExp(`class="talk-react-btn " data-react="${emoji}" data-msg="[avw]"`, 'g')), 3);
    assert.equal(count(html, /data-react-more/g), 3);
    assert.match(html, /role="menu" aria-label="React to build-1"/);
    // Your own bubble has neither bar nor tabindex.
    assert.match(html, /id="talk-y"><div class="talk-bubble[^"]*">/);
});

test('reaction tooltips say who receives it', () => {
    assert.match(reactionNote('Agent', '👍'), /Delivered to Agent with its next tool call/);
    assert.match(reactionNote('build-1', '❤️'), /Delivered to build-1/);
    assert.match(reactionNote('Validator', '👎'), /learning/);
    const html = talkHtml([{ id: 'a', author: 'Agent', text: 'x', reactions: [] }]);
    assert.match(html, /data-react="👍"[^>]*title="👍 · Delivered to Agent with its next tool call"/);
    const v = talkHtml([{ id: 'v', author: 'Validator', text: 'x' }]);
    assert.match(v, /data-react="👎"[^>]*title="👎 · Marks this for Validator learning"/);
});

test('reaction pills show count, your own state and ✓ → ✓✓ delivery in the tooltip', () => {
    const html = talkHtml([{ id: 'a', author: 'Agent', text: 'x', reactions: [
        { emoji: '👍', count: 3, mine: true, delivery: 'posted' },
        { emoji: '🙏', count: 1, mine: true, delivery: 'delivered', tool: 'read_file' },
        '❤️ 2',
    ] }]);
    assert.match(html, /talk-reaction-pill mine"[^>]*aria-pressed="true" title="[^"]*✓ posted[^"]*">👍 <small>3<\/small><span class="talk-ticks posted">✓</);
    assert.match(html, /title="[^"]*✓✓ delivered · read_file[^"]*">🙏<span class="talk-ticks delivered">✓✓</);
    assert.match(html, /aria-pressed="false" title="2 reacted">❤️ <small>2<\/small>/);
    // Validator reactions have no delivery ticks: Validator learns from them.
    const v = talkHtml([{ id: 'v', author: 'Validator', text: 'x', reactions: [{ emoji: '👎', count: 1, mine: true }] }]);
    assert.match(v, /talk-reaction-pill mine/);
    assert.doesNotMatch(v, /talk-reaction"[^]*talk-ticks/);
});

test('Full conversation and Live simulation show pre-reacted messages; quiz votes stay', () => {
    assert.ok(count(talkHtml(scenarios.Full.messages), /talk-reaction-pill/g) >= 4);
    assert.match(talkHtml(liveStart.concat(liveScript.filter(s => s.do === 'add').map(s => s.message))), /talk-reaction-pill mine/);
    assert.ok(liveScript.some(s => s.do === 'deliverReaction'));
    assert.match(talkHtml(scenarios.Full.messages), /data-vote="down"/);
});

test('keyboard handling and hover/focus css exist', () => {
    const mount = read('./mount.js');
    for (const key of ['Enter', 'ArrowRight', 'ArrowLeft', 'Escape']) assert.ok(mount.includes(`'${key}'`));
    const css = read('./talk.css');
    assert.match(css, /\.talk-bubble\[data-msg\]:hover > \.talk-react-bar/);
    assert.match(css, /:focus-within > \.talk-react-bar/);
});
