// EV-AITALK-VALIDATOR-BUBBLE: Priya's bubble speaks plainly, Show more reveals the WHOLE guess, formatted with the shared markdown, and no-source reads human.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/commentary/commentary';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const render = await import('./media/aitalk/talkRender.js');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'validator-bubble-')));
    api.configureAITalkDelivery(root);
    const room = api.roomFor(root);
    room.registerAgent('AskAway Build');
    const commentary = new api.CommentaryStore({ dir: path.join(root, 'commentary') });
    const routing = api.registerAITalkValidator(root, async () => undefined);
    const members = () => room.snapshot().members;
    const validator = members().find(m => m.kind === 'validator');
    const last = () => room.snapshot().messages.filter(m => m.author === validator.id && m.kind !== 'system').at(-1);
    const html = (message, expanded) => render.bodyHtml({ ...message, expanded }, members());

    const tail = 'THE-VERY-END-OF-THE-GUESS';
    const guess = 'Pause here. Do not investigate the memory, move to spec 008, or start more work until the reviewer confirms. '.repeat(4) + tail;
    commentary.postValidator(root, { text: 'Validator: x', detail: { turnEnd: true, answer: guess, sources: ['GOALS.md', 'ADR-004'], observations: 'The **rule** applies.', impact: 'Low', summary: 'Covered.' } });
    const message = last();
    const collapsed = html(message, false);
    assert.match(collapsed, /My take would be:/);
    assert.doesNotMatch(collapsed, /My guess at/);
    assert.doesNotMatch(collapsed, new RegExp(tail));
    const open = html(message, true);
    assert.match(open, new RegExp(tail), 'Show more reveals the whole guess');
    assert.match(open, /<strong>Sources:<\/strong>/);
    assert.match(open, /<strong>rule<\/strong>/);
    assert.match(open, /<li>/);
    console.log('PASS EV-AITALK-VALIDATOR-BUBBLE expanded');

    commentary.postValidator(root, { text: 'Validator: none', detail: { turnEnd: true, answer: null, sources: [], summary: 'Migration done.', observations: '' } });
    const none = html(last(), false);
    assert.doesNotMatch(none, /goals|ADRs|notes|No source answers/i);
    assert.match(none, /Migration done/);
    console.log('PASS EV-AITALK-VALIDATOR-BUBBLE no source');
    routing.dispose();
})().catch(error => { console.error(error); process.exit(1); });
