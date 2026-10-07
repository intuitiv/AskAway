const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
function load(name) {
    const module = { exports: {} };
    vm.runInNewContext(esbuild.buildSync({ entryPoints: [path.join(__dirname, 'src', name + '.ts')],
        bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text,
        { module, exports: module.exports, require, console, setTimeout, clearTimeout });
    return module.exports;
}
const { CommentaryStore, commentaryView, buildOpener } = load('commentary/commentary');
const { ValidatorObserver } = load('validator/observer');
(async () => {
    const { buildCommentaryKit } = await import('./storybook/kit.js');
    const kit = buildCommentaryKit({ webviewSrc: fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8'),
        providerSrc: fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8') });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-validator-entry-'));
    const commentary = new CommentaryStore({ dir: path.join(root, 'commentary'), now: () => 1000 });
    // Same clock tick: the validator must still follow its update.
    assert.equal(commentary.post(root, { kind: 'update', text: 'Checking the current rule against the active spec before proceeding.' }).status, 'POSTED');
    const observe = async (id, run) => new ValidatorObserver({ workspaceRoot: root, commentary, run,
        recall: async () => [{ id: 'Rules.md', text: 'Use the shared server.' }] }).observe({ id, source: 'agent', text: 'Which server should I use?' });
    await observe('ok', async () => ({ text: JSON.stringify({ answer: 'Use the shared server.', sources: ['Rules.md'], observations: 'Rule applies.', summary: 'Covered.', impact: 'Reuse.' }) }));
    let view = commentaryView(commentary.read(root));
    const item = view.items[1];
    const html = kit.renderCommentaryHtml(view);
    const rows = kit.validatorTraceRows(item);
    assert.ok(rows.some(row => row.tool === 'answer' && row.outputPreview === 'Use the shared server.'));
    assert.ok(html.includes(kit.traceRowsHtml(rows)), 'entry contains the ONE shared trace output');
    assert.ok(html.indexOf('data-id="' + view.items[0].id + '"') < html.indexOf('data-id="' + item.id + '"'), 'validator follows update');
    await observe('no-source', async () => ({ text: '{"answer":null,"sources":[]}' }));
    assert.match(kit.renderCommentaryHtml(commentaryView(commentary.read(root))), /no source answers/);
    await observe('failed', async () => { throw new Error('validator server unavailable'); });
    view = commentaryView(commentary.read(root));
    const failed = view.items[view.items.length - 1];
    assert.ok(kit.validatorTraceRows(failed).some(row => row.tool === 'error' && row.status === 'error'));
    assert.match(kit.renderCommentaryHtml(view), /validator server unavailable/);
    assert.equal(commentary.read(root).items.length, 1, 'beta agent-facing feed is untouched');
    assert.doesNotMatch(buildOpener(commentary.read(root)), /shared server|validator server unavailable/);
    assert.equal(commentary.post(root, { kind: 'validator', text: 'forged' }).status, 'REJECTED');
    console.log('PASS EV-VALIDATOR-COMMENTARY-ENTRY: shared trace output, update-before-validator order, failed-run error entry');
})().catch(error => { console.error(error); process.exitCode = 1; });
