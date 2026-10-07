const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-usage-'));
const data = path.join(temp, 'analyst');
const fixture = path.join(__dirname, 'test-fixtures', 'copilot-usage');
fs.cpSync(fixture, path.join(temp, 'storage'), { recursive: true });
const run = (tool, args) => execFileSync(process.execPath, [path.join(__dirname, 'tools', tool), ...args], {
    env: { ...process.env, ASKAWAY_ANALYST_DIR: data }, encoding: 'utf8'
});
const args = ['--ws', `TaskSync=${path.join(temp, 'storage', 'alpha')}`, '--ws', `AppLogic=${path.join(temp, 'storage', 'beta')}`];
const rows = (ws) => fs.readFileSync(path.join(data, 'copilot', ws + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.match(run('copilot-usage-extract.cjs', args), /TaskSync: \+2 requests/);
assert.deepEqual(rows('TaskSync')[0], { ws: 'TaskSync', sid: 's1', ts: 1, model: 'gpt-a', input: 100, cacheRead: 900, cacheWrite: 0, output: 10, nanoAiu: 2000000000 });
assert.equal(rows('AppLogic').length, 1);
assert.match(run('copilot-usage-extract.cjs', args), /TaskSync: \+0 requests/);
const log = path.join(temp, 'storage', 'alpha', 'GitHub.copilot-chat', 'debug-logs', 's1', 'main.jsonl');
const next = JSON.stringify({ ts: 5, type: 'llm_request', attrs: { model: 'gpt-a', inputTokens: 20, cachedTokens: 30, cacheCreationTokens: 10, outputTokens: 5, copilotUsageNanoAiu: 250000000 } });
fs.appendFileSync(log, next.slice(0, 40));
assert.match(run('copilot-usage-extract.cjs', args), /TaskSync: \+0 requests/);
fs.appendFileSync(log, next.slice(40) + '\n');
assert.match(run('copilot-usage-extract.cjs', args), /TaskSync: \+1 requests/);
assert.equal(rows('TaskSync').length, 3);
assert.equal(rows('AppLogic').length, 1);
const cursor = JSON.parse(fs.readFileSync(path.join(data, 'copilot', 'cursor.json')));
assert.equal(cursor[log], fs.statSync(log).size);
fs.mkdirSync(path.join(data, 'ledgers'), { recursive: true });
for (const [ws, cost] of [['TaskSync', 0.01], ['model-calculation-service-app-logic', 0.02], ['TaskSync-other', 9]]) {
    const records = [{ ts: 1, type: 'checkpoint', workspace: '/projects/' + ws, workerId: ws, runId: ws, usage: { input: 50, cacheRead: 40, cacheWrite: 10, output: 10, cost } }];
    fs.writeFileSync(path.join(data, 'ledgers', ws + '.jsonl'), records.map(JSON.stringify).join('\n') + '\n');
}
run('worker-analyst.cjs', ['--no-copy']);
const report = fs.readFileSync(path.join(data, 'report.md'), 'utf8');
const app = report.split('### Workspace AppLogic')[1].split('### Workspace TaskSync')[0];
const task = report.split('### Workspace TaskSync')[1];
assert.match(app, /#### Main agent\n\nRequests: 1; AIU: 0.50; tokens read: 10; tokens written: 10/);
assert.match(app, /#### Harness \(main \+ workers\)\n\nTotal requests: 2 .*AIU: 2.50 .*tokens read per token written: 5.50/);
assert.match(task, /Requests: 3; AIU: 3.25; tokens read: 1110; tokens written: 20; prompt tokens\/output token: 55.50/);
assert.match(task, /\| gpt-a \| 2 \| 2.25 \| 1060 \| 15 \| 70.67 \|/);
assert.match(task, /Total requests: 4 .*AIU: 4.25 .*tokens read per token written: 40.33/);
assert.doesNotMatch(report, /## Overall|OVERALL:/);
assert.match(report, /AppLogic 2.50 AIU \/ 2 requests \| TaskSync 4.25 AIU \/ 4 requests/);
console.log('PASS EV-COPILOT-USAGE-EXTRACT');
