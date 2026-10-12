const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
async function main() {
    const root = path.join(__dirname, 'build/cloud-cost-estimate-' + process.pid);
    await fs.mkdir(root, { recursive: true });
    const build = await esbuild.build({ stdin: { contents: "export * from './src/cloud/cloudPoller'; export * from './src/cloud/gh'; export * from './src/services/workspaceCost';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(name => name === 'os' ? { ...require('os'), homedir: () => root } : name === 'child_process' ? { execFile: (...args) => args.at(-1)(Error('not a git workspace')) } : require(name), mod, mod.exports);
    const { pollPr, createGh, workspaceCostRequests } = mod.exports;
    const at = '2026-10-12T10:00:00Z', start = '2026-10-12T09:59:00Z';
    const pr = 'https://github.com/example/repo/pull/1';
    let records = [{ v: 1, slug: '006', taskId: 'T1', packetSha: 'packet', pr, branch: 'cloud', commentId: '1', state: 'Working', queuedAt: start, history: [], request: { root, explicitRequest: true, task: { verify: [] } } }];
    const calls = [];
    const workflows = [1,2,3,4,5].map(id => ({ databaseId: id, status: id === 5 ? 'in_progress' : 'completed', headSha: 'packet' }));
    workflows.push({ databaseId: 999, status: 'completed', headSha: 'unrelated' });
    const gh = createGh(async args => {
        calls.push(args); const endpoint = args.at(-1); let data;
        if (args[0] === 'run') data = workflows;
        else if (endpoint.endsWith('/timing')) {
            const id = Number(endpoint.split('/').at(-2));
            data = { billable: id === 4 ? {} : { [id === 1 ? 'Linux' : id === 2 ? 'Windows' : 'macOS']: { total_ms: 120000 } }, run_duration_ms: 180000 };
        } else if (endpoint.endsWith('/jobs')) data = { jobs: [{ labels: ['self-hosted', 'Linux'] }] };
        else if (endpoint.includes('/timeline')) data = [[{ id: 10, event: 'copilot_work_started', created_at: start, performed_via_github_app: { slug: 'copilot-swe-agent' } }]];
        else if (endpoint.includes('/check-runs')) data = { check_runs: [] };
        else if (endpoint.endsWith('/pulls/1')) data = { state: 'open', head: { ref: 'cloud', sha: 'packet' } };
        else data = [];
        return { stdout: JSON.stringify(data), stderr: '', code: 0 };
    });
    const file = path.join(root, '.askaway/specs/006/cloud/runs.json');
    const io = { gh, load: async () => structuredClone(records), save: async (workspace, next) => { assert.equal(workspace, root); records = next; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(next)); } };
    await pollPr(root, pr, io, ['Copilot'], Date.parse(at));
    await pollPr(root, pr, io, ['Copilot'], Date.parse(at) + 240000);
    assert.equal(records[0].workflowRuns.length, 5); assert.equal(records[0].agentSessions.length, 1);
    assert.equal(calls.filter(args => args.at(-1).endsWith('/timing')).length, 4);
    assert.equal(records[0].workflowRuns.find(r => r.id === 4).timing[0].billableMs, 180000);
    console.log('PASS workflow IDs workspace-owned; completed timing fetched once; self-hosted duration/OS fallback; repeated polling deduped');
    records.push({ ...structuredClone(records[0]), taskId: 'duplicate' }, { ...structuredClone(records[0]), request: { root: '/other-workspace' } });
    await fs.writeFile(file, JSON.stringify(records));
    const costs = (await workspaceCostRequests(root)).filter(row => row.source === 'cloud');
    assert.equal(costs.length, 5); assert.ok(costs.every(row => row.estimated === true));
    assert.deepEqual(costs.map(row => row.id).sort(), ['cloud:1','cloud:2','cloud:3','cloud:4','cloud:premium:example/repo:10'].sort());
    assert.ok(Math.abs(costs.reduce((sum, row) => sum + row.dollars, 0) - (2*.006 + 2*.010 + 2*.062 + 3*.006 + .04)) < 1e-10);
    assert.deepEqual(await workspaceCostRequests(root), await workspaceCostRequests(root));
    console.log('PASS cloud estimated rows at official Linux/Windows/macOS rates plus $0.04/session; other workspace and unfinished excluded');
    console.log('PASS EV-CLOUD-COST-ESTIMATE');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
