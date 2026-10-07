'use strict';
// EV-CARD-TIMER-SETTINGS: reviewer 2026-10-06 — one stage element + rendered markdown on the collapsed spec card,
// a Settings switch for askaway.workers.keepWarm, and a turn timer that freezes when the turn ends. Real webview code via vm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const webview = fs.readFileSync(path.join(root, 'media/webview.js'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'src/webview/webviewProvider.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function between(start, end) {
    const from = webview.indexOf(start);
    const to = webview.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Expected executable webview block ${start}`);
    return webview.slice(from, to);
}
const escapeHtml = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// 1. Collapsed spec card.
{
    const listEl = { innerHTML: '' };
    const ctx = {
        specsState: { stalenessAvailable: true, specs: [{
            id: '005', slug: '005-x', dir: 'specs/005-x', title: 'X', active: true, stage: 'in-progress',
            specKitStage: 'implement', stageButton: 'Implement', nextStep: '/sk.implement', hasPlan: true, hasTasks: true,
            nextTaskId: 'T028', nextTaskText: 'Track `.askaway/specs/` in git for **everyone**', total: 2, done: 1, percent: 50, tasks: [], cycles: []
        }] },
        specsExpanded: {}, specsShowDone: false, specsShowAll: false, specsWorkExpanded: {}, SPEC_STAGE_LABEL: {},
        document: { getElementById: (id) => (id === 'specs-list' ? listEl : null) },
        escapeHtml
    };
    vm.createContext(ctx);
    vm.runInContext(between('function specAgo(ms)', 'function onSpecsListClick(e)'), ctx);
    vm.runInContext('renderSpecs()', ctx);
    const html = listEl.innerHTML;
    assert.equal((html.match(/IMPLEMENT|implement<\/span>|Stage /gi) || []).filter((m) => /stage/i.test(m)).length, 0, 'no "Stage …" pill');
    assert.match(html, /<span class="spec-badge spec-stage-implement">implement<\/span>/, 'the header badge stays');
    assert.doesNotMatch(html, /spec-stage-name/, 'the row pill is gone');
    assert.deepEqual([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ['/sk.implement', '/sk.check'], 'buttons stay');
    assert.match(html, /data-act="open-spec">spec\.md<.*open-plan">plan\.md<.*open-tasks">tasks\.md</s, 'links stay');
    const next = html.match(/<div class="spec-next"[^>]*>(.*?)<\/div>/s)[1];
    assert.match(next, /<code class="inline-code">\.askaway\/specs\/<\/code> in git for <strong>everyone<\/strong>/, 'collapsed next-task line renders markdown');
    assert.doesNotMatch(next, /`|\*\*/, 'no literal markdown');
    assert.match(webview, /formatSpecInline\(spec\.nextTaskText\)/, 'the card reuses the expanded view renderer');
}

// 2. keepWarm switch.
{
    assert.equal(pkg.contributes.configuration.properties['askaway.workers.keepWarm'].default, true);
    assert.match(webview, /id="workers-keep-warm-toggle" role="switch"/, 'a switch like the other settings toggles');
    assert.match(webview, /type: 'updateWorkersKeepWarm', enabled: workersKeepWarmEnabled/, 'toggling posts the message');
    assert.match(webview, /workersKeepWarmEnabled = message\.workersKeepWarm !== false/, 'initial value comes from the settings payload');
    assert.match(provider, /case 'updateWorkersKeepWarm':/);
    assert.match(provider, /_handleUpdateWorkersKeepWarm\(enabled: boolean\)/);
    assert.match(provider, /getConfiguration\('askaway\.workers'\)\.update\('keepWarm', enabled === true, vscode\.ConfigurationTarget\.Global\)/, 'writes the config Global');
    assert.match(provider, /workersKeepWarm: vscode\.workspace\.getConfiguration\('askaway\.workers'\)\.get<boolean>\('keepWarm', true\)/, 'payload carries the value');

    // Run the real toggle code.
    const classes = new Set(['active']);
    const attrs = {};
    const posted = [];
    const ctx = {
        workersKeepWarmEnabled: true,
        workersKeepWarmToggle: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, setAttribute: (k, v) => { attrs[k] = v; } },
        vscode: { postMessage: (m) => posted.push(m) },
        document: { activeElement: null },
        extendedCacheTtlToggle: null, extendedCacheTtlMessagesToggle: null, cacheKeepWarmToggle: null, cacheKeepWarmProbesInput: null
    };
    vm.createContext(ctx);
    vm.runInContext(between('function toggleWorkersKeepWarm()', 'function toggleRtkCompressionSetting()'), ctx);
    vm.runInContext('toggleWorkersKeepWarm()', ctx);
    assert.equal(JSON.stringify(posted), JSON.stringify([{ type: 'updateWorkersKeepWarm', enabled: false }]), 'click turns it off and tells the extension');
    assert.equal(attrs['aria-checked'], 'false');
    assert.ok(!classes.has('active'));
    vm.runInContext('toggleWorkersKeepWarm()', ctx);
    assert.equal(posted[1].enabled, true);
    assert.equal(attrs['aria-checked'], 'true');
    assert.ok(classes.has('active'));
}

// 3. Turn timer.
{
    const ctx = { formatObservabilityCompact: String, window: {}, document: { getElementById: () => null } };
    vm.createContext(ctx);
    vm.runInContext(between('// ── Usage banner', '// ── end Usage banner'), ctx);
    const T0 = 1_000_000_000_000;
    const metrics = (extra) => ({
        lastRequest: { requestCount: 3, nanoAiu: 0, inputTokens: 10, outputTokens: 5, cachedTokens: 5 },
        turnRequests: [], turnStartedAt: T0, lastRequestTs: T0 + 83_000, ...extra
    });
    const banner = (m, now) => ctx.chatBannerHtml(m, now).replace(/<[^>]+>/g, '');
    assert.match(banner(metrics(), T0 + 100_000), /Turn 1:40( &middot; Efficiency \d+)?$/, 'ticks while the turn is active');
    assert.match(banner(metrics(), T0 + 120_000), /Turn 2:00( &middot; Efficiency \d+)?$/, 'still ticking');
    const hours = 85 * 3600 + 15 * 60 + 48;
    assert.match(banner(metrics(), T0 + hours * 1000), /Turn 1:23( &middot; Efficiency \d+)?$/, 'cold turn freezes at turn start -> last request');
    assert.match(banner(metrics(), T0 + hours * 1000 + 999_000), /Turn 1:23( &middot; Efficiency \d+)?$/, 'and stays frozen');
    assert.match(banner(metrics({ lastRequestTs: 0 }), T0 + 1000 * 1000), /Turn 0:00( &middot; Efficiency \d+)?$/, 'a turn with no request that went idle does not run on');
}

console.log('EV-CARD-TIMER-SETTINGS: PASS oneStage=true cardMarkdown=true keepWarmSwitch=true timerFreezes=true');
