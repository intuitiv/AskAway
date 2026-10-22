const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

// These subprocess modes replace only the caller's credential and HTTP boundaries.
async function boundary(mode) {
    const fixture = JSON.parse(fs.readFileSync(process.env.SHARE_TEST_FIXTURE, 'utf8'));
    const args = process.argv.slice(3);
    if (mode === '--security') {
        assert.equal(args[0], 'find-generic-password');
        assert.equal(args[args.indexOf('-a') + 1], 'vibecoding');
        assert.ok(args.includes('-w'));
        const service = args[args.indexOf('-s') + 1];
        fs.appendFileSync(process.env.SHARE_TEST_SECURITY_LOG, service + '\n');
        if (!Object.hasOwn(fixture, service)) { process.exitCode = 1; return; }
        process.stdout.write(fixture[service]);
        return;
    }
    let stdin = '';
    for await (const chunk of process.stdin) stdin += chunk;
    const url = new URL(args.find(a => /^https?:\/\//.test(a)) || stdin.match(/url = "([^"]+)"/)?.[1]);
    assert.ok(['webexapis.com', 'api.telegram.org'].includes(url.hostname), 'unexpected external destination blocked');
    const fields = {};
    let file = '';
    for (let i = 0; i < args.length; i++) {
        if (['--form-string', '-F', '--data-urlencode', '-d'].includes(args[i])) {
            const value = args[++i];
            const eq = value.indexOf('=');
            fields[value.slice(0, eq)] = value.slice(eq + 1);
            if (['files', 'document'].includes(value.slice(0, eq))) file = fs.readFileSync(value.slice(eq + 2), 'utf8');
        }
    }
    const auth = stdin.match(/Authorization: Bearer ([^\r\n]+)/)?.[1];
    const request = {
        host: url.hostname,
        path: url.pathname.replace(fixture['telegram-bot-token'], '[redacted]'),
        method: args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET',
        authorization: Boolean(auth),
        bearerMatchesFixture: auth === fixture['webex-access-token'],
        formFile: Boolean(file), fields, file,
    };
    const response = await new Promise((resolve, reject) => {
        const req = http.request(process.env.SHARE_TEST_SERVER, { method: 'POST' }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end(JSON.stringify(request));
    });
    process.stdout.write(args.includes('-w') ? String(response.status) : response.body);
}

function run(script, file, env) {
    return new Promise((resolve, reject) => {
        const child = spawn('/bin/bash', [script, file], { env, timeout: 20000 });
        child.stdin.end();
        let output = '';
        child.stdout.on('data', c => output += c);
        child.stderr.on('data', c => output += c);
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal, output }));
    });
}

async function main() {
    const script = path.join(os.homedir(), '.local/bin/share-with-me');
    if (!fs.existsSync(script)) {
        console.log('SKIP EV-SHARE-WITH-ME-WEBEX matched=0 real ~/.local/bin/share-with-me does not exist');
        console.log('SKIP live (set ASKAWAY_WEBEX_LIVE=1)');
        return;
    }
    const root = fs.mkdtempSync(path.join(__dirname, 'build/share-with-me-'));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const file = path.join(root, 'share.txt');
    const text = 'Share-with-me offline check\n';
    fs.writeFileSync(file, text);
    const fixturePath = path.join(root, 'credentials.json');
    const log = path.join(root, 'security.log');
    const fixture = {
        'webex-access-token': 'FAKE-WEBEX-TOKEN-NOT-A-CREDENTIAL',
        'webex-general-room-id': 'fixture-room',
        'telegram-bot-token': 'FAKE-TELEGRAM-TOKEN-NOT-A-CREDENTIAL',
        'telegram-chat-id': 'fixture-chat',
    };
    for (const name of ['security', 'curl']) {
        fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(__filename)} --${name} "$@"\n`, { mode: 0o755 });
    }
    // No SSH/SCP or markdown subprocess can contact the reviewer's infrastructure.
    fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nexit "${SHARE_TEST_SSH_EXIT:-1}"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'scp'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    let requests = [], status = 200, matched = 0;
    const outputs = [], recorded = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            requests.push(JSON.parse(body));
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'fixture-message', items: [] }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = {
        HOME: root, PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        SHARE_TEST_FIXTURE: fixturePath, SHARE_TEST_SECURITY_LOG: log,
        SHARE_TEST_SERVER: `http://127.0.0.1:${server.address().port}`,
        PUSH_TO_FILES_URL: 'https://files.example.invalid',
        PUSH_TO_FILES_HOST: 'fixture-host', PUSH_TO_FILES_DIR: '/fixture',
    };
    async function execute(extra = {}, credentials = fixture) {
        fs.writeFileSync(fixturePath, JSON.stringify(credentials));
        fs.writeFileSync(log, '');
        requests = [];
        const result = await run(script, file, { ...env, ...extra });
        assert.equal(result.signal, null, 'script must finish without timeout');
        outputs.push(result.output);
        recorded.push(...requests);
        return result;
    }
    function noTelegram() {
        assert.ok(requests.every(r => r.host !== 'api.telegram.org'), 'Webex must never fall back to Telegram');
        assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /telegram-/, 'default must not read Telegram credentials');
    }
    function pass(name) { matched++; console.log(`PASS offline ${name}`); }
    try {
        let result = await execute();
        assert.equal(result.code, 0, 'default upload exits successfully');
        noTelegram();
        const upload = requests.find(r => r.formFile);
        assert.ok(upload, 'document must arrive at fake Webex');
        assert.equal(upload.host, 'webexapis.com');
        assert.equal(upload.path, '/v1/messages');
        assert.equal(upload.method, 'POST');
        assert.equal(upload.authorization, true);
        assert.equal(upload.bearerMatchesFixture, true, 'bearer must come from fake Keychain');
        assert.equal(upload.fields.roomId, fixture['webex-general-room-id']);
        assert.equal(upload.file, text, 'received document bytes must match');
        assert.match(upload.fields.markdown, /share\.txt/, 'document includes message');
        result = await execute({ SHARE_TEST_SSH_EXIT: '0' });
        assert.equal(result.code, 0);
        noTelegram();
        assert.ok(requests.some(r => !r.formFile && r.bearerMatchesFixture && r.fields.markdown.includes('https://files.example.invalid/share.txt')), 'URL message must arrive at fake Webex');
        pass('default Webex message and document delivery');

        result = await execute({ SHARE_CHANNEL: 'telegram' });
        assert.equal(result.code, 0);
        assert.ok(requests.some(r => r.host === 'api.telegram.org' && r.formFile && r.file === text), 'explicit Telegram opt-in delivers document');
        assert.ok(requests.every(r => r.host === 'api.telegram.org'), 'Telegram opt-in must not send Webex');
        pass('Telegram only by explicit opt-in');

        const missing = { ...fixture };
        delete missing['webex-access-token'];
        result = await execute({}, missing);
        noTelegram();
        assert.equal(requests.length, 0, 'missing token must not send');
        assert.match(result.output, /Webex not set up/, 'missing credential must be reported plainly');
        assert.equal(result.code, 0, 'reference currently reports missing credentials without nonzero exit');
        console.log('DISCREPANCY missing credentials: exit=0; warning only, not delivery success');
        pass('missing credential warning without fallback');

        for (const failure of [401, 500]) {
            status = failure;
            result = await execute();
            noTelegram();
            assert.ok(requests.some(r => r.formFile), 'failure case must attempt document upload');
            assert.match(result.output, new RegExp(failure === 401 ? 'Webex token rejected \\(401\\)' : 'Webex send failed \\(HTTP 500\\)'), 'HTTP failure must be reported');
            assert.equal(result.code, 0, 'reference currently reports upload failure without nonzero exit');
            console.log(`DISCREPANCY upload HTTP ${failure}: exit=0; warning only, not delivery success`);
            pass(`HTTP ${failure} warning without fallback`);
        }
        const evidence = JSON.stringify({ outputs, requests: recorded });
        for (const token of [fixture['webex-access-token'], fixture['telegram-bot-token']]) {
            assert.ok(!evidence.includes(token), 'captured output and request evidence must not contain tokens');
        }
        pass('sanitized output and recorded requests');
        console.log(`PASS EV-SHARE-WITH-ME-WEBEX matched=${matched} offline; real script, fake Keychain and HTTP`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    if (process.env.ASKAWAY_WEBEX_LIVE !== '1') {
        console.log('SKIP live (set ASKAWAY_WEBEX_LIVE=1)');
    } else {
        const liveFile = path.join(root, 'live.txt');
        fs.writeFileSync(liveFile, 'Share-with-me live check\n');
        const liveEnv = { ...process.env, SHARE_CHANNEL: 'webex', FORCE_TELEGRAM: '1', SKIP_TELEGRAM_DOC: '0' };
        const live = await run(script, liveFile, liveEnv);
        assert.equal(live.code, 0, 'live script must exit 0 (output suppressed for credential safety)');
        console.log('PASS live script exit=0; arrival pending reviewer confirmation; exit-zero failure discrepancy still applies');
    }
}

(process.argv[2]?.startsWith('--') ? boundary(process.argv[2]) : main()).catch(error => {
    console.error(`FAIL EV-SHARE-WITH-ME-WEBEX: ${error.message}\n${error.stack?.split('\n').filter(line => line.includes(__filename)).slice(0, 3).join('\n') || ''}`);
    process.exitCode = 1;
});
