// EV-AITALK-PRESENCE-GUARD: Priya is always present; an unidentified tool call joins the main agent only during an active turn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/delivery'; export * from './src/aitalk/actors'; export * from './src/aitalk/validatorDelivery'; export * from './src/workers/workerTools';", resolveDir: __dirname, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { AITalkStore, configureAITalkDelivery, appendAITalkDelivery, setToolResultDelivery, setMainTurnProbe, invokeDefinition, roomFor, registerAITalkValidator } = mod.exports;
    const root = path.join(__dirname, '.test-fixtures', `aitalk-presence-guard-${process.pid}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    const store = new AITalkStore(root);
    const presence = kind => store.snapshot(true).members.find(member => member.kind === kind).presence;
    // Priya: two receivers, one disposed, plus another process writing her as left, never removes her.
    const first = registerAITalkValidator(root, async () => undefined);
    const second = registerAITalkValidator(root, async () => undefined);
    assert.equal(presence('validator'), 'joined');
    first.dispose(); second.dispose();
    assert.equal(presence('validator'), 'joined', 'dispose of a receiver leaves Priya present');
    const priya = store.snapshot(true).members.find(member => member.kind === 'validator');
    fs.mkdirSync(path.dirname(store.presenceFile), { recursive: true });
    fs.appendFileSync(store.presenceFile, JSON.stringify({ id: 'legacy-left', presenceEvent: 'left', member: priya, quiet: false, ts: Date.now() + 5 }) + '\n');
    new AITalkStore(root).setPresence(priya, false);
    roomFor(root).activate();
    assert.equal(presence('validator'), 'joined', 'another window or a stale log never writes her absent');
    assert.ok(store.snapshot(true).members.some(member => member.kind === 'validator'), 'she is listed for the header');
    assert.ok(roomFor(root).handle(priya.id).post('Noted.').message, 'she can still post');
    // Main agent: an unidentified tool call registers it only while a turn is active.
    configureAITalkDelivery(root); setToolResultDelivery(appendAITalkDelivery);
    const { z } = require('zod'); const tool = { name: 'any-tool', inputSchema: z.object({}), run: () => ({ status: 'ok' }) };
    let active = false; setMainTurnProbe(() => active);
    await invokeDefinition(tool, {});
    assert.equal(presence('agent'), 'left', 'no active turn: an unidentified call does not register the agent');
    active = true;
    await invokeDefinition(tool, {});
    assert.equal(presence('agent'), 'joined', 'active turn: the agent registers');
    roomFor(root).unregisterAgent(); active = false;
    await invokeDefinition(tool, {});
    assert.equal(presence('agent'), 'left', 'a late call after Stop never re-registers the agent');
    // The default probe reads the hook's mainTurns file for this workspace.
    setMainTurnProbe();
    const realHome = process.env.HOME, home = fs.mkdtempSync(path.join(root, 'home-'));
    process.env.HOME = home; fs.mkdirSync(path.join(home, '.askaway'));
    try {
        const state = turns => fs.writeFileSync(path.join(home, '.askaway', 'subagent-inflight.json'), JSON.stringify({ pending: [], bySession: {}, seen: {}, mainTurns: turns }));
        state({ s1: { startedAt: Date.now(), workspace: root } });
        await invokeDefinition(tool, {}); assert.equal(presence('agent'), 'joined', 'default probe: the hook recorded a turn for this workspace');
        roomFor(root).unregisterAgent(); state({ s2: { startedAt: Date.now(), workspace: path.join(root, 'elsewhere') } });
        await invokeDefinition(tool, {}); assert.equal(presence('agent'), 'left', 'default probe: another workspace\'s turn does not count');
        state({});
        await invokeDefinition(tool, {}); assert.equal(presence('agent'), 'left', 'default probe: after Stop nothing is active');
        state({ s3: { startedAt: Date.now(), workspace: '' } });
        await invokeDefinition(tool, {}); assert.equal(presence('agent'), 'joined', 'default probe: a turn recorded without a workspace counts');
        roomFor(root).unregisterAgent(); fs.unlinkSync(path.join(home, '.askaway', 'subagent-inflight.json'));
        await invokeDefinition(tool, {}); assert.equal(presence('agent'), 'joined', 'no hook state file: hooks not running, the old rule applies');
    } finally { process.env.HOME = realHome; }
    fs.rmSync(root, { recursive: true, force: true });
    console.log('PASS EV-AITALK-PRESENCE-GUARD');
})().catch(error => { console.error(error); process.exit(1); });
