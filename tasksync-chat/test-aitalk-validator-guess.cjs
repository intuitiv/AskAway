// EV-AITALK-VALIDATOR-GUESS: a Validator turn-end bubble shows the lead-in AND the start of the guess when collapsed; no source never reads "No source answers".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/commentary/commentary'; export * from './src/aitalk/validatorContext';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const render = await import('./media/aitalk/talkRender.js');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'validator-guess-')));
    api.configureAITalkDelivery(root);
    const room = api.roomFor(root);
    room.registerAgent('AskAway Build');
    const commentary = new api.CommentaryStore({ dir: path.join(root, 'commentary') });
    const routing = api.registerAITalkValidator(root, async () => undefined);
    const members = () => room.snapshot().members;
    const validator = members().find(m => m.kind === 'validator');
    const last = () => room.snapshot().messages.filter(m => m.author === validator.id && m.kind !== 'system').at(-1);
    const html = message => render.bodyHtml({ ...message, expanded: false }, members());

    // 1. a guess with sources: the collapsed bubble carries the lead-in and the guess
    const guess = 'Ship it on Friday after the smoke test passes, and keep the release notes short because the reviewer prefers plain sentences. '.repeat(3);
    commentary.postValidator(root, { text: 'Validator: x', detail: { turnEnd: true, answer: guess, sources: ['GOALS.md'], observations: 'Rule applies.', summary: 'Covered.' } });
    let collapsed = html(last());
    assert.match(collapsed, /My take would be:/);
    assert.match(collapsed, /Ship it on Friday/);
    assert.doesNotMatch(collapsed, /No source answers/i);
    assert.match(collapsed, /Show more/);
    console.log('PASS EV-AITALK-VALIDATOR-GUESS guess visible');

    // 2. turn end with no source: an honest lead-in plus the Validator's own summary
    commentary.postValidator(root, { text: 'Validator: no source answers this question.', detail: { turnEnd: true, answer: null, sources: [], summary: 'Migration done, two tests skipped.', observations: 'Skipped tests need a decision.' } });
    collapsed = html(last());
    assert.match(collapsed, /got nothing solid on this one/);
    assert.match(collapsed, /Migration done/);
    assert.doesNotMatch(collapsed, /No source answers/i);
    assert.doesNotMatch(collapsed, /My take would be/);
    console.log('PASS EV-AITALK-VALIDATOR-GUESS no guess');

    // 3. a message reply with no source
    const asked = room.userPost('@Validator which colour?').message;
    commentary.postValidator(root, { text: 'Validator: no source answers this question.', detail: { observedId: asked.id, answer: null, sources: [] } });
    collapsed = html(last());
    assert.match(collapsed, /Hmm, you have not told me anything on this one\./);
    assert.doesNotMatch(collapsed, /No source answers/i);
    console.log('PASS EV-AITALK-VALIDATOR-GUESS reply without source');

    // 4. the shared rule: any lead-in line continues onto the next line
    const short = render.splitBody({ text: 'Lead-in:\n' + 'word '.repeat(80) }).short;
    assert.match(short, /^Lead-in: word word/);
    assert.ok(short.length <= 145 && short.endsWith('…'));
    console.log('PASS EV-AITALK-VALIDATOR-GUESS summary rule');
    routing.dispose();
})().catch(error => { console.error(error); process.exit(1); });
