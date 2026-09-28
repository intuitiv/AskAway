const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;

async function loadRuntime() {
    const build = await esbuild.build({
        stdin: {
            contents: [
                "export { TelegramService, getTelegramPollDelaySeconds } from './src/services/telegramService';",
                "export { submitTelegramConversationReply } from './src/services/telegramConversationReply';"
            ].join('\n'),
            resolveDir: root,
            sourcefile: 'telegram-test-entry.ts',
            loader: 'ts'
        },
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        plugins: [{
            name: 'vscode-stub',
            setup(builder) {
                builder.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'test' }));
                builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                    contents: `module.exports = {
                        workspace: {
                            name: 'TaskSync',
                            workspaceFolders: [],
                            getConfiguration() {
                                return { get(key, fallback) {
                                    const values = {
                                        'telegram.enabled': true,
                                        'telegram.botToken': 'test-token',
                                        'telegram.chatId': 'test-chat',
                                        'telegram.retryIntervalSeconds': 60,
                                        'telegram.idlePauseMinutes': 0
                                    };
                                    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
                                } };
                            }
                        },
                        commands: {
                            async executeCommand(...args) { globalThis.__askawayCommands.push(args); }
                        },
                        window: { showErrorMessage() {}, showWarningMessage() {} },
                        Uri: { file(value) { return { fsPath: value }; } }
                    };`,
                    loader: 'js'
                }));
            }
        }]
    });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, loaded, loaded.exports);
    return loaded.exports;
}

function jsonResponse(body) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() { return body; },
        async text() { return JSON.stringify(body); }
    };
}

async function main() {
    globalThis.__askawayCommands = [];
    const runtime = await loadRuntime();

    assert.equal(runtime.getTelegramPollDelaySeconds(0, 60), 5);
    assert.equal(runtime.getTelegramPollDelaySeconds(299_999, 60), 5);
    assert.equal(runtime.getTelegramPollDelaySeconds(300_000, 60), 60);
    assert.equal(runtime.getTelegramPollDelaySeconds(599_999, 60), 60);
    assert.equal(runtime.getTelegramPollDelaySeconds(600_000, 60), 240);

    const originalFetch = global.fetch;
    let updatesDelivered = false;
    let sentMessageId = 320;
    global.fetch = async url => {
        const value = String(url);
        if (value.includes('/sendMessage')) {
            sentMessageId++;
            return jsonResponse({ ok: true, result: { message_id: sentMessageId } });
        }
        if (value.includes('/getUpdates')) {
            if (updatesDelivered) { return jsonResponse({ ok: true, result: [] }); }
            updatesDelivered = true;
            return jsonResponse({
                ok: true,
                result: [
                    {
                        update_id: 1,
                        message: {
                            message_id: 399,
                            text: '/start',
                            from: { id: 42, username: 'reviewer' }
                        }
                    },
                    {
                        update_id: 2,
                        message: {
                            message_id: 400,
                            message_thread_id: 8637,
                            text: 'TELEGRAM_ROUTE_OK',
                            from: { id: 42, username: 'reviewer' },
                            reply_to_message: { message_id: 322 }
                        }
                    }
                ]
            });
        }
        if (value.includes('/editMessageText') || value.includes('/editForumTopic')) {
            return jsonResponse({ ok: true, result: true });
        }
        throw new Error(`Unexpected Telegram request: ${value}`);
    };

    try {
        const service = new runtime.TelegramService();
        service._isForum = true;
        service._forumTopicsLoaded = true;
        service._topicIds.set('TaskSync', 8637);
        service._botId = 999;
        const routed = [];
        service.setResponseCallback(async (taskId, response) => {
            routed.push({ taskId, response });
            await runtime.submitTelegramConversationReply(response);
        });

        await service.postText('Old turn complete', 'Old turn complete', 'handoff:old');
        const posted = await service.postText('Current turn complete', 'Current turn complete', 'handoff:77');
        assert.equal(posted, true);
        assert.equal(service.getActiveTaskCount(), 1, 'Tracked handoff must remain active for replies.');
        assert.deepEqual([...service._activeTasks.keys()], ['handoff:77'], 'A new handoff must evict every older handoff route.');
        service.stopPolling();

        await service._poll();

        assert.deepEqual(routed, [{ taskId: 'handoff:77', response: 'TELEGRAM_ROUTE_OK' }]);
        assert.deepEqual(globalThis.__askawayCommands, [
            ['workbench.action.chat.open', { query: 'TELEGRAM_ROUTE_OK', isPartialQuery: true }],
            ['workbench.action.chat.submit']
        ]);
        assert.equal(service.getActiveTaskCount(), 0, 'Successful routing must resolve the tracked handoff.');
        console.log('EV-TELEGRAM-CONVERSATION-REPLY: PASS stale=evicted ignored=general routed=thread:8637 commands=2 fastPoll=5s');

        // Reviewer 2026-09-28: "old messages ... still being polled even though i replied to them here".
        const edits = [];
        global.fetch = async (url, init) => {
            const value = String(url);
            if (value.includes('/sendMessage')) { sentMessageId++; return jsonResponse({ ok: true, result: { message_id: sentMessageId } }); }
            if (value.includes('/editMessageText')) { edits.push(JSON.parse(init.body)); return jsonResponse({ ok: true, result: true }); }
            if (value.includes('/editForumTopic') || value.includes('/getUpdates')) { return jsonResponse({ ok: true, result: [] }); }
            throw new Error(`Unexpected Telegram request: ${value}`);
        };
        const local = new runtime.TelegramService();
        local._isForum = true; local._forumTopicsLoaded = true; local._topicIds.set('TaskSync', 8637); local._botId = 999;
        local.setResponseCallback(async () => {});
        await local.postText('Turn one complete', 'Turn one complete', 'handoff:1');
        const firstId = sentMessageId;
        await local.postText('Turn two complete', 'Turn two complete', 'handoff:2');
        await new Promise((resolve) => setImmediate(resolve));
        const superseded = edits.find((e) => e.message_id === firstId);
        assert.ok(superseded && /Continued in VS Code/.test(superseded.text), 'a replaced handoff is marked, never left looking unanswered');
        assert.equal(local.getActiveTaskCount(), 1);

        const secondId = sentMessageId;
        assert.equal(local.resolveHandoffs(), 1, 'a prompt typed in VS Code resolves the open handoff');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(local.getActiveTaskCount(), 0, 'nothing left to poll for');
        assert.equal(local._pollingTimer, undefined, 'polling stopped');
        assert.match(edits.find((e) => e.message_id === secondId).text, /Continued in VS Code/);

        await local.postText('Turn three complete', 'Turn three complete', 'handoff:3');
        local._lastTelegramReplyAt = Date.now();
        assert.equal(local.resolveHandoffs(), 0, 'a turn started by a Telegram reply leaves its own message to the reply path');
        assert.equal(local.getActiveTaskCount(), 1);
        local.stopPolling();
        console.log('EV-TELEGRAM-HANDOFF-CONTINUED: PASS supersededMarked=true vscodePromptResolves=true pollingStopped=true telegramReplyUntouched=true');
    } finally {
        global.fetch = originalFetch;
        delete globalThis.__askawayCommands;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});