const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
    const bundle = await esbuild.build({ stdin: { contents: "export { ValidatorObserver } from './src/validator/observer'; export { CommentaryStore, commentaryView, buildOpener, commentaryToolDefinitions } from './src/commentary/commentary'; export { invokeDefinition } from './src/workers/workerTools';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, loaded, loaded.exports);
    const { ValidatorObserver, CommentaryStore, commentaryView, buildOpener, commentaryToolDefinitions, invokeDefinition } = loaded.exports;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-propose-context-'));
    const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
    let clock = 1000, runs = 0;
    const commentary = new CommentaryStore({ dir: path.join(root, 'commentary'), now: () => clock });
    const scope = { project: workspace, agentId: 'validator', spec: '007-demo' };
    const item = (id, text, extra = {}) => ({ id, fact: { text }, scope, ts: clock, rootId: id, ...extra });
    let recalled = [item('memory-caller', 'Use caller-view tests.'), item('memory-offline', 'Run tests offline.')];
    const calls = [];
    const knowledgeStore = { recall: async (...args) => { calls.push(args); return recalled; } };
    const make = () => new ValidatorObserver({ workspaceRoot: workspace, commentary, knowledgeStore, knowledgeScope: scope,
        run: async () => { runs++; throw new Error('proposals must not run a model'); }, now: () => clock });
    const observer = make();
    const prompt = Object.freeze({ text: 'Check the build.\r\nKeep original spacing.  ', specSlug: '007-demo' });
    const bytes = Buffer.from(prompt.text);
    const agentInputs = { chat: prompt.text, worker: prompt.text, hook: buildOpener(commentary.read(workspace)) };
    const before = JSON.stringify(agentInputs);
    const completion = await observer.proposeContext(prompt);
    assert.equal(completion, undefined, 'no proposals returned to an agent tool result');
    assert.deepEqual(calls[0], [prompt.text, scope, 10]);
    const shown = () => commentaryView(commentary.read(workspace)).items.filter(row => row.detail?.contextSuggestions);
    assert.equal(shown().length, 2);
    assert.deepEqual(shown().map(row => row.detail.contextSuggestions[0].ref), ['memory-caller', 'memory-offline']);
    console.log('PASS proposal shown KnowledgeStore recall scoped; separate cited additions');

    recalled.push(item('duplicate', 'Use caller-view tests.'));
    await Promise.all([observer.proposeContext(prompt), make().proposeContext(prompt)]);
    assert.equal(shown().length, 2, 'duplicate calls, reopened observer and duplicate facts do not duplicate context');
    console.log('PASS no duplicate across calls and fresh observer');

    clock = 2000;
    commentary.clear(workspace, 'feed');
    assert.equal(shown().length, 0);
    assert.equal(commentary.read(workspace).validatorItems.length, 2, 'audit history survives dismiss');
    await make().proposeContext(prompt);
    assert.equal(shown().length, 0, 'dismissed suggestions stay dismissed');
    console.log('PASS dismiss works via Commentary clear and stays dismissed');

    recalled = [];
    await observer.proposeContext({ text: 'unrelated request', specSlug: '007-demo' });
    assert.equal(shown().length, 0);
    console.log('PASS nothing relevant = no proposal');

    recalled = [item('named-memory', 'Use the release checklist.')];
    await observer.proposeContext({ text: 'Read named-memory for this build', specSlug: '007-demo' });
    await observer.proposeContext({ text: 'Use the release checklist. Then build.', specSlug: '007-demo' });
    assert.equal(shown().length, 0);
    console.log('PASS named context not duplicated by reference or text');

    recalled = [item('foreign', 'FOREIGN_MARKER', { scope: { ...scope, project: 'other' } }),
        item('secret', 'Use ghp_abcdefghijklmnopqrstuvwxyz0123')];
    await observer.proposeContext(prompt);
    assert.equal(shown().length, 0);
    assert.doesNotMatch(JSON.stringify(commentary.read(workspace)), /FOREIGN_MARKER|ghp_/);
    assert.deepEqual(Buffer.from(prompt.text), bytes);
    assert.equal(JSON.stringify(agentInputs), before);
    assert.doesNotMatch(buildOpener(commentary.read(workspace)), /caller-view|offline|Proposed context/);
    assert.deepEqual(commentary.read(workspace).items, []);
    const [tool] = commentaryToolDefinitions(() => commentary, workspace);
    const result = await invokeDefinition(tool, { kind: 'validator', text: 'inject proposed additions here' });
    assert.equal(JSON.parse(result).status, 'INVALID_INPUT');
    assert.doesNotMatch(result, /caller-view|Run tests offline/);
    assert.equal(runs, 0);
    console.log('PASS prompt byte-identical; no agent-input leak through chat/worker/hook/MCP result; no model run');
    console.log('PASS EV-VALIDATOR-PROPOSE-CONTEXT all T007 cases');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
