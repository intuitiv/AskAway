const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function main() {
    const voice = fs.readFileSync(path.join(__dirname, 'docs/voice.md'), 'utf8');
    assert.ok(voice.trimEnd().split('\n').length <= 40);
    assert.doesNotMatch(voice, /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]+|\b(?:Bearer\s+\S+|access_token|refresh_token|client_secret)\b/i);
    const block = /<!-- shared-voice:start -->[\s\S]*?<!-- shared-voice:end -->/.exec(voice)[0];
    const build = await esbuild.build({ stdin: { contents: "export * from './src/workers/workerProfiles'; export * from './src/validator/profile'; export * from './src/agents/askawayBuildAgent';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false });
    const mod = { exports: {} }; new Function('require', 'module', 'exports', build.outputFiles[0].text)(require, mod, mod.exports);
    assert.equal(mod.exports.SHARED_VOICE, block);
    const validator = mod.exports.validatorProfile(); assert.ok(validator.prompt.includes(block));
    for (const profile of mod.exports.loadWorkerProfiles(path.join(__dirname, 'worker-profiles'))) assert.ok(mod.exports.toOpenCodeAgent(profile).includes(block), profile.name);
    const webex = fs.readFileSync(path.join(__dirname, 'worker-profiles/webex.md'), 'utf8'); assert.ok(webex.includes(block)); assert.match(webex, /per-recipient style card/);
    console.log('PASS voice doc <=40 lines, private-data guard; identical shared worker, Validator and Webex voice');
    const main = mod.exports.ASKWAY_BUILD_AGENT_CONTENT;
    assert.ok(main.includes(block), 'Build generated prompt must contain the identical voice block');
    assert.equal(main.split('<!-- shared-voice:start -->').length - 1, 1, 'one Build voice section');
    assert.doesNotMatch(main, /^## Communication$/m, 'old style section merged into shared voice');
    assert.match(main, /Be honest about boundaries/);
    console.log('PASS Build generated prompt contains one identical shared voice section');
    console.log('PASS EV-STYLE-VOICE');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
