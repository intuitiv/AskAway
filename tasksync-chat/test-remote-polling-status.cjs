'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = {
    'webex-status': { innerHTML: '', title: '' },
    'telegram-status': { innerHTML: '', title: '' }
};
let now = 1_800_000_000_000;
const timers = new Map();
let timerId = 0;
const window = {};
const context = {
    window, console: { log() {}, warn() {}, error: console.error },
    acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage() {} }),
    document: {
        readyState: 'loading', addEventListener() {}, getElementById: id => elements[id] || null, querySelectorAll: () => [],
        createElement: () => ({ set textContent(value) { this.innerHTML = String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); } })
    },
    Date: class extends Date { static now() { return now; } },
    setInterval: fn => { timers.set(++timerId, fn); return timerId; },
    clearInterval: id => timers.delete(id),
    setTimeout: () => 0, clearTimeout() {}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8'), context);
const status = { status: 'connected', message: 'Ready', hint: 'Reply tracking', isPolling: true, activeTasks: 1, lastPollAt: now - 3000, nextPollAt: now + 12000 };
function send(webexEnabled, telegramEnabled, webexStatus = status, telegramStatus = status) {
    window.dispatchVSCodeMessage({ type: 'remotePollingStatus', webexEnabled, telegramEnabled, webexStatus, telegramStatus });
}
send(true, false);
assert.match(elements['webex-status'].innerHTML, /Webex:.*Polling for replies.*1 tracked replies.*Next poll in 12s.*Last poll 3s ago/);
assert.equal(elements['telegram-status'].innerHTML, '');
send(true, true);
assert.equal(elements['webex-status'].innerHTML.replace('Webex:', 'Telegram:'), elements['telegram-status'].innerHTML, 'both channels reuse identical component markup');
assert.match(elements['telegram-status'].innerHTML, /class="remote-poll-countdown".*Next poll in 12s/);
assert.equal(timers.size, 1, 'one timer updates both components');
now += 5000;
for (const tick of timers.values()) tick();
for (const el of Object.values(elements)) assert.match(el.innerHTML, /Next poll in 7s/);
now += 10000;
for (const tick of timers.values()) tick();
for (const el of Object.values(elements)) assert.match(el.innerHTML, /Next poll in 0s/);
send(true, false, { ...status, lastPollAt: undefined, nextPollAt: undefined });
assert.match(elements['webex-status'].innerHTML, /Polling for replies.*Next poll timing unavailable/);
assert.doesNotMatch(elements['webex-status'].innerHTML, /NaN|Last poll/);
send(true, true, { ...status, isPolling: false }, { ...status, isPolling: false });
assert.equal(timers.size, 0);
for (const el of Object.values(elements)) {
    assert.match(el.innerHTML, /Polling idle/);
    assert.doesNotMatch(el.innerHTML, /remote-poll-countdown/);
}
send(false, false);
for (const el of Object.values(elements)) assert.equal(el.innerHTML, '');
console.log('PASS EV-REMOTE-POLLING-STATUS sharedMarkup=true labelledChannels=true countdown=true optionalTiming=true');
