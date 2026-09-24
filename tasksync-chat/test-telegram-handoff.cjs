const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = __dirname;
const settings = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    .contributes.configuration.properties;
const providerSource = fs.readFileSync(path.join(root, 'src/webview/webviewProvider.ts'), 'utf8');

assert.equal(
    settings['askaway.telegram.notifyOnTurnEnd']?.default,
    false,
    'Telegram turn-completion notifications must be independently configurable.'
);

async function main() {
const build = await esbuild.build({
    entryPoints: [path.join(root, 'src/services/handoffNotifier.ts')],
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
                        getConfiguration() {
                            return { get(key, fallback) {
                                return key === 'telegram.notifyOnTurnEnd' ? true : fallback;
                            } };
                        }
                    }
                };`,
                loader: 'js'
            }));
        }
    }]
});

const loaded = { exports: {} };
new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, loaded, loaded.exports);
const { HandoffNotifier, createHandoffTargets } = loaded.exports;

let telegramPosts = 0;
let postedMarkdown = '';
let replyTaskId = '';
let telegramShouldSucceed = false;
const telegram = {
    isConfigured: () => true,
    async postText(markdown, _fallback, taskId) {
        telegramPosts++;
        postedMarkdown = markdown;
        replyTaskId = taskId;
        return telegramShouldSucceed;
    }
};

const targets = createHandoffTargets(() => undefined, () => telegram);
assert.deepEqual(
    targets.map(target => [target.name, target.setting]),
    [
        ['Webex', 'webex.notifyOnTurnEnd'],
        ['Telegram', 'telegram.notifyOnTurnEnd']
    ]
);

let metricReads = 0;
const notifier = new HandoffNotifier(targets, undefined, () => {}, async () => {
    metricReads++;
    return {
        latestInputTokens: 12_500,
        turnOutputTokens: 2_750,
        turnNanoAiu: 250_000_000_000
    };
});
let stamp = 1234;
notifier._readStamp = () => stamp;
notifier._findHandoff = () => stamp === 1234 ? ({
    details: 'Completed the first requested work.',
    handoff: 'Impact: Telegram receives the first handoff.\nSummary: First done.\nNext: Continue?'
}) : ({
    details: 'Completed the second requested work.',
    handoff: 'Impact: Telegram receives the current handoff.\nSummary: Second done.\nNext: Reply now?'
});

    await notifier._onTurnEnd();
    assert.equal(telegramPosts, 1, 'The current turn must attempt Telegram delivery.');
    assert.equal(metricReads, 1, 'One notification attempt must acquire one fresh turn snapshot.');
    assert.equal(notifier._lastPostedTs, 0, 'A failed send must not mark the turn delivered.');

    telegramShouldSucceed = true;
    await notifier._onTurnEnd();
    assert.equal(telegramPosts, 2, 'The same turn must retry after a transient Telegram failure.');
    assert.equal(metricReads, 2, 'A retry must reacquire current metrics rather than reuse stale zeros.');
    assert.equal(replyTaskId, 'handoff:1234', 'Turn handoff must carry a stable reply route ID.');
    assert.match(postedMarkdown, /12\.5K last in · 2\.75K turn out · \$2\.50 turn/);
    assert.match(postedMarkdown, /Impact.*Telegram receives the first handoff/s);
    assert.match(postedMarkdown, /Next.*Continue\?/s);
    assert.match(postedMarkdown, /Details.*Completed the first requested work/s);
    assert.ok(postedMarkdown.indexOf('last in') < postedMarkdown.indexOf('Handoff'));
    assert.ok(postedMarkdown.indexOf('Handoff') < postedMarkdown.indexOf('Details'));

    stamp = 5678;
    await notifier._onTurnEnd();
    assert.equal(telegramPosts, 3, 'A later turn stamp must post the current handoff without one-turn lag.');
    assert.equal(metricReads, 3);
    assert.equal(replyTaskId, 'handoff:5678');
    assert.match(postedMarkdown, /Impact.*Telegram receives the current handoff/s);
    assert.match(postedMarkdown, /Next.*Reply now\?/s);
    assert.match(postedMarkdown, /Details.*Completed the second requested work/s);
    assert.match(providerSource, /await this\._broadcastObservabilityMetrics\(\)/);
    assert.match(providerSource, /_observabilityScanPromise/);
    console.log('EV-TELEGRAM-HANDOFF: PASS order=banner>handoff>details metrics=last-input+turn-output+turn-cost retry=same-turn');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});