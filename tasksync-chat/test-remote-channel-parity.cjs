const assert = require('node:assert/strict');
const { fixture, failure } = require('./test-webex-remote-adapter.cjs');
(async () => {
    const f = fixture();
    const telegram = new f.api.TelegramService();
    try {
        const webex = await f.create();
        const status = 'Running · 28 requests · 3 workers · $1.95 · 12.5K input · 2.75K output · 50% cache · efficiency 88';
        const final = f.api.telegramHandoffUpdate({ handoff: 'Impact: delivered.\nNext: Continue?', details: 'Not in text' }, { latestInputTokens: 12500, turnOutputTokens: 2750, turnNanoAiu: 195000000000, requests: 28, workers: 3, workerDollars: 0.95, workerIds: ['worker-a', 'worker-b', 'worker-c'], cacheHitPct: 50, efficiencyScore: 88 });
        for (const [name, service] of [['telegram', telegram], ['webex', webex]]) {
            const id = await service.sendText(status, status); assert.ok(id);
            assert.equal(await service.editLive(id, status + ' · stuck'), true);
            assert.equal(await service.finishLive(id, '', final, 'parity'), true);
            const sent = f.calls.filter(c => c.channel === name && c.body && !(c.body instanceof FormData));
            for (const field of ['28 requests', '3 workers', '$1.95', '12.5K', '2.75K', '50%', '88', 'stuck']) assert.ok(sent.some(c => JSON.stringify(c.body).includes(field)), `${name} loses status field ${field}`);
            const text = sent.map(c => c.body.markdown || c.body.text || '').find(text => text.includes('Impact: delivered.'));
            assert.ok(text && text.includes('$1.95') && text.includes('12.5K') && text.includes('2.75K'), `${name} loses final cost/tokens`);
            for (const field of ['28 requests', '3 workers', '$0.95 workers', 'worker-a', 'worker-b', 'worker-c', '50% cache', 'efficiency 88']) assert.ok(text.includes(field), `${name} loses final worker metric ${field}`);
            assert.ok(text.indexOf('$1.95') < text.indexOf('Impact:'), 'banner must precede handoff'); assert.ok(!text.includes('Not in text'));
        }
        console.log('PASS EV-REMOTE-CHANNEL-PARITY matched=2 Webex/Telegram preserve status and final cost/token/worker/request/cache/efficiency fields');
    } finally { telegram.dispose(); f.close(); }
})().catch(failure);
