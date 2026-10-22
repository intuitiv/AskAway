const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const webview = fs.readFileSync(path.join(__dirname, 'media/webview.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, 'src/workers/workersState.ts'), 'utf8');
const slice = (source, start, end) => {
    const at = source.indexOf(start);
    assert.ok(at >= 0, start);
    const to = source.indexOf(end, at + start.length);
    assert.ok(to > at, end);
    return source.slice(at, to);
};
const moduleState = { exports: {} };
vm.runInNewContext(ts.transpileModule(stateSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: moduleState.exports, require: () => ({ initialsOf: () => 'D', teamRoster: () => [{
        id: 'diego', name: 'Diego', profile: 'build', profiles: [], model: 'model', statusWorking: [], statusIdle: []
    }] })
});
const { terminalResumeCommand, projectWorkersState } = moduleState.exports;
for (const adapter of ['agy', 'claude']) {
    assert.equal(terminalResumeCommand(adapter, 'session_123.abc-xyz'), `${adapter} ${adapter === 'agy' ? '--conversation' : '--resume'}=session_123.abc-xyz`);
    // An id can never be read as a flag: it starts alphanumeric, whatever its length, and rides in --flag=<id>.
    for (const id of ['', 'short', '-x', '-abcdefgh', '--resume=x1234567', '_abcdefgh', '.abcdefgh', 'session;bad', 'session\nbad', 'x'.repeat(81)]) assert.equal(terminalResumeCommand(adapter, id), undefined);
}
assert.equal(terminalResumeCommand('opencode', 'session_123'), undefined);
const card = new Function('workersEsc', 'workerBannerHtml', 'workerRemoveHtml',
    slice(webview, '    function workerCardHtml(', '    function teamPortraitHtml(') + '; return workerCardHtml;')(
    value => String(value ?? ''), () => '', () => '');
const workers = ['agy', 'claude', 'opencode'].map(adapter => ({
    workerId: `worker-${adapter}`, adapter, state: 'COMPLETED', sessionId: `${adapter}_session123`,
    sessionOpenAction: 'opencode --session opencode_session123', profile: 'build', model: `${adapter}/model`, runs: []
}));
for (const worker of workers) {
    const html = card(worker, false, 0);
    if (worker.adapter === 'opencode') {
        assert.match(html, /class="worker-open-btn"[^>]*>Open in VS Code<\/button>/);
    } else {
        assert.match(html, new RegExp(`class="worker-open-btn" data-worker-action="open" data-worker-id="${worker.workerId}"[^>]*>Open in terminal</button>`));
        assert.match(html, /headless run stops; concurrent resume may conflict/);
        assert.doesNotMatch(html, /no viewer|data-session-id/);
        for (const state of ['RUNNING', 'STARTING']) assert.doesNotMatch(card({ ...worker, state }, false, 0), /Open in terminal/);
        assert.doesNotMatch(card({ ...worker, sessionId: '' }, false, 0), /Open in terminal/);
    }
}
const projected = projectWorkersState({
    list: () => workers.map((worker, index) => ({ ...worker, runId: `run-${index}`, startedAt: index, endedAt: index + 1,
        queuePosition: 0, updatedAt: index, usage: { cost: 0, input: 0, output: 0, steps: 0 } })),
    facts: () => [], router: { worker: () => undefined }, serverEndpoint: ''
}, '/worker/workspace');
for (const worker of workers) assert.equal(projected.workers.find(row => row.workerId === worker.workerId).sessionId, worker.sessionId);
const terminals = [];
const vscode = { workspace: { workspaceFolders: [{ uri: { fsPath: '/host/workspace' } }, { uri: { fsPath: '/worker/workspace' } }] }, window: {
    createTerminal(options) {
        const terminal = { options, shown: false, command: '', show() { this.shown = true; }, sendText(command) { this.command = command; } };
        terminals.push(terminal);
        return terminal;
    }
} };
const method = slice(provider, '    private _openWorkerTerminal(', '    private _broadcast(').replace('private _openWorkerTerminal', 'function openWorkerTerminal');
const open = new Function('vscode', 'terminalResumeCommand', ts.transpileModule(method, {}).outputText + '; return openWorkerTerminal;')(vscode, terminalResumeCommand);
// Multi-root: the workers belong to the second folder; the terminal opens there, never in workspaceFolders[0].
const host = { _workersStateSource: (root) => root !== '/worker/workspace' ? { workspacePath: root, workers: [], members: [] } : ({ workspacePath: '/worker/workspace', workers,
    members: [{ name: 'Member Name', taskIds: ['worker-agy', 'worker-claude'] }] }) };
const handler = slice(provider, "            case 'openWorkerTerminal':", "            case 'openWorkerSession':");
const dispatch = new Function('message', `switch(message.type) { ${handler} }`);
host._openWorkerTerminal = open;
for (const worker of workers.slice(0, 2)) {
    dispatch.call(host, { type: 'openWorkerTerminal', workerId: worker.workerId, sessionId: 'malicious;ignored' });
    const terminal = terminals.at(-1);
    assert.deepEqual(terminal.options, { name: 'Member Name', cwd: '/worker/workspace' });
    assert.equal(terminal.shown, true);
    assert.equal(terminal.command, `${worker.adapter} ${worker.adapter === 'agy' ? '--conversation' : '--resume'}=${worker.sessionId}`);
}
for (const patch of [{ sessionId: 'bad;command' }, { sessionId: '-abcdefgh' }, { state: 'RUNNING' }, { state: 'STARTING' }, { adapter: 'opencode' }]) {
    const original = { ...workers[0] };
    Object.assign(workers[0], patch);
    dispatch.call(host, { type: 'openWorkerTerminal', workerId: workers[0].workerId });
    Object.assign(workers[0], original);
}
dispatch.call(host, { type: 'openWorkerTerminal', workerId: 'unknown' });
assert.equal(terminals.length, 2);
assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'provider stays CRLF');
console.log('PASS EV-WORKER-TERMINAL-VIEWER: agy and Claude workers with a session id show an Open in terminal button; the provider opens a VS Code terminal in the workspace running the right resume command');
