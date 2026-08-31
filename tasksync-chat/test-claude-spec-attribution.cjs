const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLAUDE_COMMAND_STAGES, commandSwitchesSpec, createClaudeSpecEvent, pairClaudeTurns, parseClaudeCommand, parseClaudeUsage } = require('/tmp/askaway-claude-spec.cjs');

for (const stage of CLAUDE_COMMAND_STAGES) {
    assert.equal(parseClaudeCommand(`/sk.${stage} T014`).commandStage, stage);
}
assert.deepEqual(CLAUDE_COMMAND_STAGES.filter(commandSwitchesSpec), ['new', 'start', 'continue']);
assert.deepEqual(parseClaudeCommand('/sk.implement T014b'), { commandStage: 'implement', taskId: 'T014B', cycleId: '' });
assert.deepEqual(parseClaudeCommand('/sk.implement CY-002'), { commandStage: 'implement', taskId: '', cycleId: 'CY-002' });
assert.equal(parseClaudeCommand('ordinary request').commandStage, 'other');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'askaway-claude-spec-'));
fs.mkdirSync(path.join(repo, '.git'));
fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/test\n');
fs.mkdirSync(path.join(repo, '.specify'));
fs.writeFileSync(path.join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: path.join(repo, 'specs', '007-test') }));
fs.mkdirSync(path.join(repo, 'nested'));
const submit = createClaudeSpecEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', prompt_id: 'prompt-1', transcript_path: '/tmp/session-1.jsonl', cwd: path.join(repo, 'nested'), prompt: '/sk.implement T007' }, 1000);
assert.equal(submit.specSlug, '007-test');
assert.equal(submit.branch, 'feature/test');
assert.equal(submit.commandStage, 'implement');
assert.equal(submit.taskId, 'T007');
assert.equal(submit.cwd, repo);
const stop = createClaudeSpecEvent({ hook_event_name: 'Stop', session_id: 'session-1', prompt_id: 'prompt-1', transcript_path: '/tmp/session-1.jsonl', cwd: repo }, 2000);
assert.equal(stop.event, 'stop');
assert.equal(stop.sessionId, submit.sessionId);
assert.equal(createClaudeSpecEvent({ hook_event_name: 'Stop', agent_id: 'child', session_id: 'session-1', transcript_path: '/tmp/child.jsonl', cwd: repo }), undefined);
const newSubmit = { ...submit, ts: 3000, promptId: 'prompt-2', commandStage: 'new', specSlug: '007-test' };
const newStop = { ...stop, ts: 5000, promptId: 'prompt-2', specSlug: '008-created' };
const finalStop = { ...newStop, ts: 5500 };
const nextSubmit = { ...submit, ts: 6000, promptId: 'prompt-3', commandStage: 'plan', specSlug: '008-created' };
const pairs = pairClaudeTurns([nextSubmit, newStop, finalStop, newSubmit]);
assert.equal(pairs.length, 2);
assert.equal(pairs[0].specSlug, '008-created');
assert.equal(pairs[0].endTs, 5500);
assert.equal(pairs[1].specSlug, '008-created');
for (const commandStage of ['start', 'continue']) {
    const switchingSubmit = { ...submit, ts: 7000, commandStage, specSlug: '008-created' };
    const switchingStop = { ...stop, ts: 8000, specSlug: '009-target' };
    assert.equal(pairClaudeTurns([switchingSubmit, switchingStop])[0].specSlug, '009-target');
}

const start = Date.parse('2026-08-30T10:00:00.000Z');
const request = (id, at, model, usage) => JSON.stringify({
    type: 'assistant', requestId: id, timestamp: at,
    message: { model, usage }
});
const opusUsage = {
    input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 500,
    cache_read_input_tokens: 4000, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 0 },
    server_tool_use: { web_search_requests: 1 }, inference_geo: 'global', speed: 'standard'
};
const haikuUsage = {
    input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200,
    cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
    server_tool_use: { web_search_requests: 0 }, inference_geo: 'global', speed: 'standard'
};
const parent = [
    '{malformed',
    request('req-1', '2026-08-30T10:00:01.000Z', 'claude-opus-5', opusUsage),
    request('req-1', '2026-08-30T10:00:02.000Z', 'claude-opus-5', opusUsage)
].join('\n');
const child = request('req-2', '2026-08-30T10:00:03.000Z', 'claude-haiku-4-5', haikuUsage);
const usage = parseClaudeUsage([parent, child], start);
assert.equal(usage.requestCount, 2);
assert.equal(usage.inputTokens, 5800);
assert.equal(usage.outputTokens, 250);
assert.equal(usage.cachedTokens, 4000);
assert.equal(usage.cacheWrite5mTokens, 500);
assert.equal(usage.cacheWrite1hTokens, 200);
assert.equal(usage.activeMs, 3000);
assert.equal(usage.models.join(','), 'claude-haiku-4-5,claude-opus-5');
assert.ok(Math.abs(usage.estimatedUsd - 0.025875) < 1e-9, String(usage.estimatedUsd));
console.log(`PASS stages=${CLAUDE_COMMAND_STAGES.length} requests=${usage.requestCount} estimatedUsd=${usage.estimatedUsd.toFixed(6)}`);
fs.rmSync(repo, { recursive: true, force: true });