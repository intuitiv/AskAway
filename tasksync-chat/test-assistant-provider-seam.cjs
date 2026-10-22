// EV-ASSISTANT-SEAM: the provider seam for Cathy's tools (ADR 0035): registry, approval request shape, no raw ids.
const assert = require('node:assert/strict');
const esbuild = require('esbuild');

async function main() {
    const build = await esbuild.build({ stdin: { contents: "export * from './src/services/assistant/provider';", resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    const { registerAssistantProvider, assistantTools, assistantProviders, assertHumanLabel, assertApprovalRequest, requestApproval, setApprovalHandler, isOpaqueRef } = mod.exports;
    const z = require('zod');
    const tool = name => ({ name, description: name, inputSchema: z.object({}).strict(), run: async () => ({ status: 'ok' }) });

    // Registry: a fake provider's tools are listed; duplicates are refused; unregister removes them.
    const stop = registerAssistantProvider({ id: 'fake', label: 'Fake mail', tools: () => [tool('fake_inbox'), tool('fake_send')] });
    assert.deepEqual(assistantTools().map(t => t.name), ['fake_inbox', 'fake_send']);
    assert.throws(() => registerAssistantProvider({ id: 'fake', label: 'Again', tools: () => [] }), /already registered/);
    assert.throws(() => registerAssistantProvider({ id: 'other', label: 'Other', tools: () => [tool('fake_send')] }), /already registered/);
    const stopOther = registerAssistantProvider({ id: 'other', label: 'Other', tools: () => [tool('other_find')] });
    assert.equal(assistantProviders().length, 2);
    assert.deepEqual(assistantTools().map(t => t.name), ['fake_inbox', 'fake_send', 'other_find']);
    stopOther(); stop();
    assert.deepEqual(assistantTools(), []);
    console.log('PASS EV-ASSISTANT-SEAM registry lists fake provider tools, refuses duplicates, unregisters');

    // Human labels pass; id-looking strings are refused.
    for (const ok of ['Release plan', 'Vinayak Chowsalkar', 'AskAway (team self)', 'vinayak@example.test', 'spec.pdf']) { assert.equal(assertHumanLabel(ok), ok); }
    const roomId = 'Y2lzY29zcGFyazovL3VzL1JPT00vYWJjZGVmMTIzNDU2Nzg5MA';
    for (const bad of ['', '   ', roomId, `Room ${roomId}`, 'ciscospark://us/ROOM/abc', '123e4567-e89b-12d3-a456-426614174000', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8']) {
        assert.throws(() => assertHumanLabel(bad), /human name|raw id/, `refused: ${bad}`);
    }
    assert.ok(isOpaqueRef('s3') && isOpaqueRef('m12') && isOpaqueRef('p4'));
    assert.ok(!isOpaqueRef(roomId) && !isOpaqueRef('3s'));
    console.log('PASS EV-ASSISTANT-SEAM assertHumanLabel refuses Webex-id-looking text; refs stay short and opaque');

    // Approval request: only human fields; id fields and id-looking values are refused; no handler fails closed.
    const req = { provider: 'webex', action: 'reply', targetLabel: 'Release plan', body: 'Thank you!', details: { Thread: 'Build 42' }, files: ['notes.pdf'] };
    assert.equal(assertApprovalRequest(req), req);
    for (const extra of ['roomId', 'personId', 'messageId', 'id']) { assert.throws(() => assertApprovalRequest({ ...req, [extra]: 'x' }), /no ".*" field/); }
    assert.throws(() => assertApprovalRequest({ ...req, targetLabel: roomId }), /raw id/);
    assert.throws(() => assertApprovalRequest({ ...req, details: { Space: roomId } }), /raw id/);
    assert.throws(() => assertApprovalRequest({ ...req, body: '  ' }), /full text/);
    assert.deepEqual(await requestApproval(req), { status: 'unavailable' }, 'no handler: nothing is approved');
    await assert.rejects(() => requestApproval({ ...req, targetLabel: roomId }), /raw id/);
    const seen = [];
    setApprovalHandler(async r => { seen.push(r); return { status: 'approved', result: { sent: true } }; });
    assert.deepEqual(await requestApproval(req), { status: 'approved', result: { sent: true } });
    assert.deepEqual(seen, [req]);
    setApprovalHandler();
    console.log('PASS EV-ASSISTANT-SEAM approval request has no id field, refuses id-like labels, fails closed without a handler');
}
main().catch(error => { console.error(error); process.exit(1); });
