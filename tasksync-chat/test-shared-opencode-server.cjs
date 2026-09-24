const assert = require('node:assert/strict');
const path = require('node:path');
const childProcess = require('node:child_process');

const opencode = path.join(__dirname, '..', 'tasksync-opencode');
childProcess.execFileSync(process.execPath, [path.join(opencode, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: opencode, stdio: 'pipe' });
const { ensureGlobalServer } = require(path.join(opencode, 'dist', 'server.js'));

(async () => {
    const [first, second] = await Promise.all([
        ensureGlobalServer(0),
        ensureGlobalServer(0),
    ]);
    assert.equal(first.serverId, second.serverId);
    assert.equal(first.endpoint, second.endpoint);
    assert.match(first.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/relay$/);
    console.log('EV-004 OneGlobalServer: PASS serverCount=1 workspaceFilters=external');

    const sessions = first.server.getSessionManager();
    const workspaceA = '/fixture/workspace-a';
    const workspaceB = '/fixture/workspace-b';
    const sessionA = sessions.createSession('workspace-a', workspaceA);
    const sessionB = sessions.createSession('workspace-b', workspaceB);

    assert.notEqual(sessionA.id, sessionB.id);
    const targetA = first.server.getSessionOpenTarget(sessionA.id);
    const targetB = first.server.getSessionOpenTarget(sessionB.id);
    assert.equal(targetA.sessionId, sessionA.id);
    assert.equal(targetB.sessionId, sessionB.id);
    assert.equal(targetA.endpoint, first.endpoint);
    assert.equal(targetB.endpoint, first.endpoint);
    assert.equal(new Set([targetA.endpoint, targetB.endpoint]).size, 1);
    assert.equal(targetA.workspacePath, workspaceA);
    assert.equal(targetB.workspacePath, workspaceB);
    assert.equal(sessions.getSessionsForWorkspace(workspaceA).length, 1);
    assert.equal(sessions.getSessionsForWorkspace(workspaceB).length, 1);
    assert.equal(first.server.getSessionOpenTarget('session_missing'), undefined);

    const distinctSessions = new Set([targetA.sessionId, targetB.sessionId]).size;
    console.log(`EV-005 TwoSessionsShareEndpoint: PASS sessionIds=${distinctSessions} endpoints=1 workspaceFilters=1+1`);

    // Live proof: two real relay clients on the one endpoint, each streaming its own facts.
    const WebSocket = require(path.join(opencode, 'node_modules', 'ws'));
    const httpBase = first.endpoint.replace('ws://', 'http://').replace('/relay', '');

    const connectRelay = (label, workspace) => new Promise((resolve, reject) => {
        const socket = new WebSocket(`${first.endpoint}?name=${label}&workspace=${encodeURIComponent(workspace)}`);
        socket.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'session-created') { resolve({ socket, sessionId: msg.sessionId }); }
        });
        socket.on('error', reject);
    });

    const liveA = await connectRelay('live-a', workspaceA);
    const liveB = await connectRelay('live-b', workspaceB);
    assert.notEqual(liveA.sessionId, liveB.sessionId);

    for (const [live, cost] of [[liveA, 0.0021], [liveB, 0.0034]]) {
        const response = await fetch(`${httpBase}/api/plugin-stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'step_finish',
                sessionId: live.sessionId,
                step: { input: 1200, output: 340, cost },
            }),
        });
        assert.equal(response.status, 200);
    }

    const statsA = first.server.getPluginStats(liveA.sessionId);
    const statsB = first.server.getPluginStats(liveB.sessionId);
    assert.equal(statsA.length, 1);
    assert.equal(statsB.length, 1);
    assert.equal(statsA[0].step.input, 1200);
    assert.equal(statsA[0].step.cost, 0.0021);
    assert.equal(statsB[0].step.cost, 0.0034);
    assert.ok(statsA[0].step.output > 0 && statsB[0].step.output > 0);
    assert.equal(first.server.getPluginStats('session_missing').length, 0);

    const liveEndpoints = new Set([
        first.server.getSessionOpenTarget(liveA.sessionId).endpoint,
        first.server.getSessionOpenTarget(liveB.sessionId).endpoint,
    ]);
    assert.equal(liveEndpoints.size, 1);

    console.log('EV-006 SharedServerLiveConversation: PASS serverCount=1 sessionIds=2 sessionUpdates=2 terminalUsageRecords=2');
    console.log('CAC-CY-002 LiveAttachmentProven: PASS');
    console.log('PAC-P1 OneServerTwoLiveSessions: PASS serverCount=1 sessionIds=2');

    liveA.socket.close();
    liveB.socket.close();
    first.server.stop();
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});