process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
process.env.ASKAWAY_AVAILABILITY_MODE = 'away';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const bundle = esbuild.buildSync({ stdin: { contents: "export { CloudDigestScheduler, digestLines, cloudDigestPoster } from './src/cloud/cloudDigest'; export { remoteDigestPoster } from './src/commentary/telegramLive';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const m = { exports: {} };
vm.runInNewContext(bundle, { module: m, exports: m.exports, require, console, process, Date, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval });
const { CloudDigestScheduler, remoteDigestPoster, cloudDigestPoster } = m.exports;
const root = path.join(__dirname, 'build/cloud-digest-' + process.pid);
fs.mkdirSync(root, { recursive: true });
let now = new Date(2026, 9, 8, 7, 59).getTime();
const sent = []; let configured = true, deliver = true;
const post = remoteDigestPoster(() => ({ isConfigured: () => configured, async sendLive(html) { if (!deliver) return undefined; sent.push(html); return sent.length; } }));
let runs = [{ slug: '006-cloud-tasks', taskId: 'T013', attempt: 1, state: 'Needs review', pr: 'https://github.com/o/r/pull/1',
    queuedAt: new Date(now - 120000).toISOString(), startedAt: new Date(now - 60000).toISOString(), endedAt: new Date(now).toISOString(),
    model: 'self-reported: fixture model', history: [{ at: new Date(now).toISOString(), state: 'Needs review', signal: 'report' }],
    report: { url: 'https://github.com/o/r/pull/1#issuecomment-2', verifyOutput: 'PASS', result: 'blocked', question: 'Which <API>?' }, decisionNeeded: 'Which <API>?',
    commits: [{ url: 'https://github.com/o/r/commit/abc' }], checkRuns: [] }];
const file = path.join(root, 'digest.json');
const io = { async loadRuns() { return structuredClone(runs); }, async loadState() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { fingerprints: {} }; }, async saveState(_, state) { fs.writeFileSync(file, JSON.stringify(state)); } };
const scheduler = new CloudDigestScheduler(io, () => now);
(async () => {
    await scheduler.tick(root, '08:00', post); assert.equal(sent.length, 0);
    now += 60000; await Promise.all([scheduler.tick(root, '08:00', post), scheduler.tick(root, '08:00', post)]);
    assert.equal(sent.length, 1);
    for (const text of ['T013', 'Needs review', 'https://github.com/o/r/pull/1', 'issuecomment-2', '/commit/abc', 'duration: 60s', 'self-reported: fixture model', 'blocker:', 'decision needed: Which &lt;API&gt;?']) assert.ok(sent[0].includes(text), text);
    assert.doesNotMatch(sent[0], /\$|price|Credits/);
    runs[0].state = 'Accepted'; await scheduler.tick(root, '08:00', post); assert.equal(sent.length, 1);
    console.log('PASS configured local time, changed-run facts, once daily, escaped poster delivery, no price');
    const restarted = new CloudDigestScheduler(io, () => now);
    await restarted.tick(root, '08:00', post); assert.equal(sent.length, 1);
    now = new Date(2026, 9, 9, 9, 29).getTime(); await restarted.tick(root, '09:30', post); assert.equal(sent.length, 1);
    now += 60000; await restarted.tick(root, '09:30', post); assert.equal(sent.length, 2); assert.match(sent[1], /Accepted/);
    now = new Date(2026, 9, 10, 9, 30).getTime(); await restarted.tick(root, '09:30', post); assert.equal(sent.length, 2);
    console.log('PASS persisted watermark, configured time change, unchanged and empty digest suppressed');
    now = new Date(2026, 9, 11, 9, 30).getTime(); runs[0].state = 'Returned'; configured = false;
    await restarted.tick(root, '09:30', post); assert.equal(sent.length, 2);
    configured = true; deliver = false; await restarted.tick(root, '09:30', post); assert.equal(sent.length, 2);
    deliver = true; await restarted.tick(root, '09:30', post); assert.equal(sent.length, 3);
    now = new Date(2026, 9, 12, 9, 30).getTime(); runs = []; await restarted.tick(root, '09:30', post); assert.equal(sent.length, 3);
    assert.equal(await post([]), false); assert.equal(sent.length, 3);
    console.log('PASS unavailable/failed poster retains pending digest; zero runs sends nothing');
    const config = require('./package.json').contributes.configuration.properties;
    assert.equal(config['askaway.cloud.digestTime'].default, '08:00');
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.ok(provider.includes("config.get<string>('digestTime', '08:00')")); assert.ok(provider.includes('cloudDigestPoster(root, () => this._webexService, () => this._telegramService)'));
    const digest = fs.readFileSync(path.join(__dirname, 'src/cloud/cloudDigest.ts'), 'utf8');
    assert.doesNotMatch(digest, /queueTask|releaseHeld|execFile|fetch\(/);
    console.log('PASS configured scheduler wiring uses remote poster with no cloud launch side effects');
    const deliveries = []; let webexConfigured = true, telegramConfigured = true, succeeds = true;
    const channel = name => ({ isConfigured: () => name === 'webex' ? webexConfigured : telegramConfigured,
        sendText: async (formatted, fallback, destination, options) => { deliveries.push({ name, formatted, options }); return succeeds ? `${name}-message` : undefined; } });
    const selectedPost = cloudDigestPoster(root, () => channel('webex'), () => channel('telegram'));
    let state = { fingerprints: {} };
    runs = [{ taskId: 'T012', slug: '009', attempt: 1, state: 'Needs review', queuedAt: new Date(now - 60000).toISOString(),
        pr: 'https://github.com/o/r/pull/12', model: 'self-reported model', report: { verifyOutput: 'PASS', result: 'blocked', question: 'Which <API>?' }, decisionNeeded: 'Which <API>?' }];
    const routedScheduler = new CloudDigestScheduler({ loadRuns: async () => runs, loadState: async () => state, saveState: async (_, next) => { state = next; } }, () => now);
    for (const mode of ['here', 'offline']) {
        process.env.ASKAWAY_AVAILABILITY_MODE = mode;
        await routedScheduler.tick(root, '08:00', selectedPost);
        assert.equal(deliveries.length, 0); assert.equal(state.day, undefined);
    }
    process.env.ASKAWAY_AVAILABILITY_MODE = 'awayValidator';
    await routedScheduler.tick(root, '08:00', selectedPost);
    assert.equal(deliveries.length, 1); assert.equal(deliveries[0].name, 'webex');
    for (const fact of ['T012', '/pull/12', 'PASS', 'duration: 60s', 'self-reported model', 'blocker: Which <API>?', 'decision needed: Which <API>?']) assert.ok(deliveries[0].formatted.includes(fact), fact);
    assert.ok(deliveries[0].formatted.startsWith('**Cloud task digest**'));
    assert.equal(deliveries[0].options.notify, false);
    assert.doesNotMatch(deliveries[0].formatted, /\$|price|Credits/);
    await routedScheduler.tick(root, '08:00', selectedPost); assert.equal(deliveries.length, 1);
    webexConfigured = false; assert.equal(await selectedPost(['Fallback <API>']), true);
    assert.equal(deliveries.at(-1).name, 'telegram'); assert.match(deliveries.at(-1).formatted, /&lt;API&gt;/);
    telegramConfigured = false; const count = deliveries.length;
    assert.equal(await selectedPost(['Disabled']), false); assert.equal(deliveries.length, count);
    webexConfigured = true; succeeds = false;
    assert.equal(await selectedPost(['Failed Webex']), false); assert.equal(deliveries.at(-1).name, 'webex');
    assert.equal(await selectedPost([]), false);
    console.log('PASS EV-CLOUD-DIGEST-WEBEX configured Webex preferred; Telegram fallback; Here/Offline suppressed; Away mid-day delivers once; failed/disabled remain pending');
})().catch(error => { console.error(error); process.exitCode = 1; });
