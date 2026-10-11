import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { talkHtml, traceHtml, scenarios, betaMessages, traceSessions } from './talk.js';
import { buildCommentaryKit } from '../kit.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('all realistic scenarios render from the caller-facing module', () => {
    for (const scenario of Object.values(scenarios)) {
        const html = talkHtml(scenario.messages, scenario);
        assert.match(html, /aria-label="Group chat"/);
        assert.match(html, /Talk.*Specs.*Trace.*Workers.*Settings/s);
    }
    const html = talkHtml(scenarios.GroupChatBasics.messages, scenarios.GroupChatBasics);
    for (const pattern of [/talk-day/, /talk-quote/, /👍 1/, /<mark>@agent<\/mark>/, /@validator/, /@build-1/, /Agent won't see this/, /Seen by Agent.*commentary/]) assert.match(html, pattern);
    assert.match(talkHtml(scenarios.Ticks.messages), /aria-label="Posted"/);
    assert.match(talkHtml(scenarios.ValidatorAnswers.messages), /aria-pressed="true"/);
    assert.match(talkHtml(scenarios.ValidatorAnswers.messages), /Keep them collapsed, not deleted/);
    assert.match(talkHtml(scenarios.AgentProgress.messages), /data-tab="Trace">trace ↗/);
    assert.match(talkHtml(scenarios.LongBusyThread.messages, scenarios.LongBusyThread), /6 unread/);
    assert.match(talkHtml(scenarios.AsyncCompletion.messages), /Agent gets it with its next tool call/);
    assert.match(talkHtml([{ ...scenarios.AsyncCompletion.messages[0], delivery: 'delivered', tool: 'read_file' }]), /delivered.*read_file/s);
    assert.doesNotMatch(talkHtml(betaMessages(false)), /talk-quote/);
    assert.match(talkHtml(betaMessages(true)), /talk-quote/);
});
test('Trace contains the exact shared production trace output for each session', () => {
    const kit = buildCommentaryKit({ webviewSrc: read('../../media/webview.js'), providerSrc: read('../../src/webview/webviewProvider.ts') });
    const html = traceHtml(traceSessions, kit.traceRowsHtml);
    for (const session of traceSessions) assert.ok(html.includes(kit.traceRowsHtml(session.events, { now: 1791716400000 })));
    assert.doesNotMatch(html, /Observability|RTK|Gradle/);
});
test('narrow layout, motion preferences, safe user text and all story exports', () => {
    const css = read('./talk.css');
    assert.match(css, /width:420px;max-width:100%/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /overflow-y:auto/);
    assert.doesNotMatch(talkHtml([{ id: 'unsafe', author: 'You', text: '<script>bad()</script>' }]), /<script>/);
    const stories = read('../stories/Talk.stories.js');
    for (const name of [...Object.keys(scenarios), 'BetaVsAfterBeta', 'Naming', 'AvailabilityColours']) assert.ok(stories.includes(`export const ${name} =`));
    assert.match(read('../stories/Trace.stories.js'), /title: 'Prototype\/Trace'/);
});
