// R-AITALK-60: at turn end the main agent posts ONE short AITalk message: only the Next line of its Response Handoff plus the
// turn's total cost. Telegram keeps the full handoff. Runs the real notifier, room and handoff formatter against a temp HOME.
// Run: node test-aitalk-next-handoff.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'next-handoff-home-')));
const realHome = process.env.HOME;
process.env.HOME = home;
const cfg = path.join(home, '.askaway');
fs.mkdirSync(cfg, { recursive: true });

(async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'next-handoff-ws-')));
    const mod = { exports: {} };
    vm.runInNewContext(esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/services/handoffNotifier'; export * from './src/talk/nextLine';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text,
        { module: mod, exports: mod.exports, require: id => id === 'vscode' ? { workspace: { getConfiguration: () => ({ get: () => true }), workspaceFolders: [{ uri: { fsPath: root } }] } } : require(id), __dirname, Buffer, console, process, setTimeout, clearTimeout, setInterval, clearInterval });
    const api = mod.exports;

    const debugLogs = path.join(home, 'debug-logs');
    const session = 'aaaaaaaa-1111-2222-3333-444444444444';
    fs.mkdirSync(path.join(debugLogs, session), { recursive: true });
    const writeFinal = text => fs.writeFileSync(path.join(debugLogs, session, 'main.jsonl'), JSON.stringify({ type: 'agent_response', ts: Date.now(), attrs: { response: JSON.stringify([{ parts: [{ type: 'text', content: text }] }]) } }) + '\n');
    let stampTs = Date.now() - 5000;
    const stamp = promptId => {
        stampTs += 1;
        fs.writeFileSync(path.join(cfg, 'turn-complete-ts'), String(stampTs));
        fs.writeFileSync(path.join(cfg, 'turn-complete-info.json'), JSON.stringify({ ts: stampTs, sessionId: session, cwd: root, promptId }));
    };

    const room = api.roomFor(root);
    api.configureAITalkDelivery(root);
    const telegram = [];
    const target = { name: 'Telegram', setting: 'telegram.notifyOnTurnEnd', get: () => ({ isConfigured: () => true, postText: async markdown => { telegram.push(markdown); return true; } }) };
    const metrics = { latestInputTokens: 1000, turnOutputTokens: 500, turnNanoAiu: 150_000_000_000 };
    const notifier = new api.HandoffNotifier([target], debugLogs, () => undefined, () => metrics, async () => undefined, () => room.unregisterAgent());
    notifier.setAgentFinal(() => undefined);
    notifier.setNextHandoff(text => { const id = room.store.agentId(); if (id && room.isRegistered(id)) { room.post(id, text, { kind: 'update' }); } });
    const nextRows = () => room.snapshot().messages.filter(message => /^Next:/.test(message.text));
    const poll = async () => { await sleep(1700); await notifier._onTurnEnd(); await sleep(50); };

    // A handoff with a Next line: one short room message, Telegram has the full handoff.
    const first = 'Long details here.\n\n## Response Handoff\n\nImpact: shipped the fix.\nNext: Deploy it now?';
    room.registerAgent(); writeFinal(first); stamp('p1'); await poll();
    assert.equal(nextRows().length, 1, 'one room post at turn end');
    assert.equal(nextRows()[0].text, 'Next: Deploy it now? · turn cost $1.50');
    assert.ok(!/Impact|shipped/.test(nextRows()[0].text), 'only the Next line, not the whole handoff');
    assert.equal(telegram.length, 1);
    assert.equal(telegram[0], api.telegramHandoffUpdate({ handoff: 'Impact: shipped the fix.\nNext: Deploy it now?', details: 'Long details here.' }, metrics), 'Telegram text is the unchanged full handoff');
    assert.ok(/Impact: shipped the fix/.test(telegram[0]) && /\$1\.50 turn/.test(telegram[0]));

    // The same turn stamped again posts nothing more.
    stamp('p1'); await poll();
    assert.equal(nextRows().length, 1, 'once per turn');

    // A turn without a Next line posts nothing to the room.
    room.registerAgent(); writeFinal('## Response Handoff\n\nImpact: done.'); stamp('p2'); await poll();
    assert.equal(nextRows().length, 1, 'no Next line, no room post');

    // A credential in the Next line is never posted.
    room.registerAgent(); writeFinal('## Response Handoff\n\nImpact: x.\nNext: Use token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 ?'); stamp('p3'); await poll();
    assert.equal(nextRows().length, 1, 'the secret gate drops a Next line with a credential');

    // Next turn posts again.
    room.registerAgent(); writeFinal('## Response Handoff\n\nImpact: y.\nNext: Merge?'); stamp('p4'); await poll();
    assert.equal(nextRows().length, 2);
    assert.equal(nextRows()[1].text, 'Next: Merge? · turn cost $1.50');

    // A Next line in a section after the handoff is not the handoff's Next.
    room.registerAgent(); writeFinal('## Response Handoff\n\nImpact: z.\n\n## Appendix\n\nNext: unrelated'); stamp('p5'); await poll();
    assert.equal(nextRows().length, 2, 'extraction stops at the end of the handoff section');

    // A room post that never resolves must not hold back the agent leaving or the Telegram handoff.
    notifier.setNextHandoff(() => new Promise(() => undefined));
    const telegramBefore = telegram.length;
    room.registerAgent(); writeFinal('## Response Handoff\n\nImpact: w.\nNext: Stuck?'); stamp('p6');
    await sleep(1700); await notifier._onTurnEnd(); await sleep(50);
    assert.equal(telegram.length, telegramBefore + 1, 'Telegram still gets the handoff when the room post hangs');
    assert.equal(room.isRegistered(room.store.agentId()), false, 'the agent still leaves when the room post hangs');
    console.log('PASS EV-AITALK-NEXT-HANDOFF: the AITalk room gets one Next line plus the turn cost per turn; Telegram keeps the full handoff');
    notifier.dispose();
})().catch(error => { console.error('FAIL EV-AITALK-NEXT-HANDOFF:', error); process.exitCode = 1; }).finally(() => { process.env.HOME = realHome; });
