process.env.ASKAWAY_TEST_NO_KEYCHAIN = '1';
delete process.env.ASKAWAY_AVAILABILITY_MODE;
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
async function main() {
    const build = esbuild.buildSync({ stdin: { contents: "export * from './src/services/availabilityGate'; export * from './src/commentary/telegramLive';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const loaded = { exports: {} };
    let stateRead = 'missing';
    const fakeFs = { ...require('node:fs'), readFileSync: (file, ...args) => {
        if (String(file).startsWith('/fixture-home/.askaway/availability/')) {
            if (stateRead === 'missing') { throw Object.assign(new Error('Missing fixture'), { code: 'ENOENT' }); }
            if (stateRead === 'unreadable') { throw Object.assign(new Error('Unreadable fixture'), { code: 'EACCES' }); }
            return '{invalid JSON';
        }
        return require('node:fs').readFileSync(file, ...args);
    } };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'fs' ? fakeFs : require(name), loaded, loaded.exports);
    const { availabilityPolicy, updatePolicy, TelegramLiveCommentary, telegramTurnTarget } = loaded.exports;
    for (stateRead of ['missing', 'unreadable', 'malformed']) {
        assert.deepEqual(availabilityPolicy('/fixture-home'), updatePolicy('here'));
        const sends = [];
        const channel = { isConfigured: () => true, sendLive: async () => { sends.push('start'); return 1; },
            editLive: async () => { sends.push('live'); return true; }, finishLive: async () => { sends.push('final'); return true; },
            postText: async () => { sends.push('final'); return true; }, sendDocument: async () => { sends.push('document'); return true; } };
        const relay = new TelegramLiveCommentary(() => channel, 'fixture', { policy: () => availabilityPolicy('/fixture-home') });
        await relay.update({ turnStarts: [1], currentPrompt: 'Build', items: [] });
        const target = telegramTurnTarget(relay, () => channel);
        await target.postText('Final', 'Final', 'handoff:missing'); await target.sendDocument('fixture', 'Final');
        assert.deepEqual(sends, [], `${stateRead} state must send nothing`);
        relay.dispose();
    }
    assert.ok(require('./package.json').scripts['test:workers'].includes('node test-availability-updates.cjs'));
    console.log('PASS EV-AVAILABILITY-UPDATES missing-state=Here unreadable-state=Here malformed-state=Here sends=0');
    for (const initial of ['here', 'away', 'awayValidator', 'offline']) {
        let mode = initial;
        const sends = [];
        const channel = { isConfigured: () => true, sendLive: async text => { sends.push('start'); return 1; },
            editLive: async () => { sends.push('live'); return true; }, finishLive: async () => { sends.push('final'); return true; },
            postText: async () => { sends.push('final'); return true; }, sendDocument: async () => { sends.push('document'); return true; } };
        const relay = new TelegramLiveCommentary(() => channel, 'fixture', { minEditMs: 0, policy: () => updatePolicy(mode) });
        const target = telegramTurnTarget(relay, () => channel);
        const view = { turnStarts: [1], currentPrompt: 'Build', items: [] };
        await relay.update(view);
        view.items.push({ ts: 2, kind: 'update', text: 'Working' }); await relay.update(view);
        await target.postText('Final', 'Final', 'handoff:1'); await target.sendDocument('fixture', 'Final');
        assert.deepEqual(sends, initial.startsWith('away') ? ['start', 'live', 'final', 'document'] : initial === 'offline' ? ['final'] : []);
        relay.dispose();
    }
    let mode = 'here'; const sends = [];
    const relay = new TelegramLiveCommentary(() => ({ isConfigured: () => true, sendLive: async () => { sends.push('start'); return 1; }, editLive: async () => true, finishLive: async () => true }), 'fixture', { policy: () => updatePolicy(mode) });
    const view = { turnStarts: [1], currentPrompt: 'Build', items: [] };
    await relay.update(view); assert.deepEqual(sends, []); mode = 'awayValidator'; await relay.update(view); assert.deepEqual(sends, ['start']); relay.dispose();
    assert.deepEqual(updatePolicy('offline'), { startAlert: false, liveStatus: false, final: true, endAlert: false, notify: false });
    console.log('PASS EV-AVAILABILITY-UPDATES Here silent; Away/awayValidator full; Offline final only; mid-turn Here->Away opens thread');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
