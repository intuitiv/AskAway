// EV-VALIDATOR-CONTEXT: every Validator post opens with a context line written by code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/validator/validatorTriggers'; export * from './src/validator/observer'; export * from './src/commentary/commentary'; export * from './src/aitalk/validatorContext';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'validator-context-')));
    api.configureAITalkDelivery(root);
    const room = api.roomFor(root);
    room.registerAgent('AskAway Build');
    const commentary = new api.CommentaryStore({ dir: path.join(root, 'commentary') });
    const observer = new api.ValidatorObserver({ workspaceRoot: root, commentary,
        recall: async () => [{ id: 'fixture', text: 'Use green.' }],
        run: async () => ({ text: JSON.stringify({ answer: 'Use green', sources: ['fixture'] }) }) });
    const triggers = new api.ValidatorTriggers(root, async () => observer, () => 'fixture', () => assert.fail('Validator failed'));
    const routing = api.registerAITalkValidator(root, (text, id) => triggers.validatorCall(text, id));
    const members = () => room.snapshot().members;
    const agent = members().find(m => m.kind === 'agent'), user = members().find(m => m.kind === 'user'), validator = members().find(m => m.kind === 'validator');
    const lastValidatorPost = () => room.snapshot().messages.filter(m => m.author === validator.id && m.kind !== 'system').at(-1);

    // pure helper
    assert.equal(api.validatorContextLine(undefined, 'observation'), 'Observation:');
    assert.match(api.validatorContextLine({ authorName: 'Ann', text: 'x'.repeat(200) + '?' }, 'message'), /^Re: Ann's question: "x{1,60}…?"$/);

    assert.equal(api.validatorContextLine({ authorName: 'Ann' }, 'turnEndNoGuess'), "Nothing in your goals, ADRs or notes tells me your reply to Ann's turn summary.");

    // 1. a direct question from the reviewer
    const asked = room.userPost('@Validator which colour?').message;
    await routing.flush();
    let post = lastValidatorPost();
    assert.equal(post.replyTo, asked.id);
    assert.equal(post.text.split('\n')[0], `Re: ${user.displayName}'s question: "which colour?"`);
    assert.equal(post.text.split('\n')[1], 'Use green');
    console.log('PASS EV-VALIDATOR-CONTEXT question');

    // 2. a heads-up from the main agent
    const headsUp = room.post(agent.id, '@Validator ship Friday or Monday', { kind: 'heads-up' }).message;
    await routing.flush();
    post = lastValidatorPost();
    assert.equal(post.replyTo, headsUp.id);
    assert.match(post.text.split('\n')[0], new RegExp(`^Answering ${agent.displayName}'s heads-up: "ship Friday or Monday"$`));
    console.log('PASS EV-VALIDATOR-CONTEXT heads-up');

    // 3. the end-of-turn pass over the agent's final response
    await triggers.turnEnd('Final response: all done.', 'final-1');
    post = lastValidatorPost();
    assert.equal(post.text.split('\n')[0], `My guess at your reply to ${agent.displayName}'s turn summary:`);
    assert.equal(post.text.split('\n')[1], 'Use green');
    console.log('PASS EV-VALIDATOR-CONTEXT turn end');

    // 4. an observation with no parent
    commentary.postValidator(root, { headsUp: true, text: 'Validator drift/risk flag: scope grew' });
    post = lastValidatorPost();
    assert.equal(post.replyTo, undefined);
    assert.equal(post.text.split('\n')[0], 'Observation:');
    assert.match(post.text, /scope grew/);
    console.log('PASS EV-VALIDATOR-CONTEXT observation');
    routing.dispose();
    console.log('PASS EV-VALIDATOR-CONTEXT all four lead-ins');
})().catch(error => { console.error(error); process.exit(1); });
