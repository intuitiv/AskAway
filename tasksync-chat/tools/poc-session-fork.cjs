// POC: does forking a warm OpenCode session keep the prompt cache for parallel requests?
// Run: node tools/poc-session-fork.cjs [--model provider/model] [--server http://127.0.0.1:4096] [--agent aa-explore] [--fork-at-base] [--max-cost 0.10]
// Flow: base (~8K tokens of fixed context) -> control (question 1, same session) -> fork twice -> questions 2 and 3 in parallel.
// By default a fork copies the whole session (base + control exchange); --fork-at-base forks before the control message instead.
const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const SERVER = arg('server', 'http://127.0.0.1:4096');
const AGENT = arg('agent', 'aa-explore');
const MODEL = arg('model', 'github-copilot/gpt-6-luna');
const MAX_COST = Number(arg('max-cost', '0.10'));
const FORK_AT_BASE = process.argv.includes('--fork-at-base');
const [providerID, ...rest] = MODEL.split('/');
const modelID = rest.join('/');
const TARGET_CHARS = 32000; // ~8K tokens

async function call(method, route, body) {
    const res = await fetch(`${SERVER}${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) { throw new Error(`${method} ${route} -> ${res.status} ${text.slice(0, 300)}`); }
    return text ? JSON.parse(text) : null;
}

function baseText() {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    let text = '';
    for (let n = 1; text.length < TARGET_CHARS; n++) { text += `\n\n--- context copy ${n} ---\n${readme}`; }
    return `Fixed context follows. Do not summarise it.${text}\n\nReply OK, no tools.`;
}

async function send(sessionID, text) {
    const reply = await call('POST', `/session/${sessionID}/message`, {
        agent: AGENT,
        model: { providerID, modelID },
        parts: [{ type: 'text', text }],
    });
    const info = reply.info;
    if (info.error) { throw new Error(`assistant error: ${JSON.stringify(info.error).slice(0, 300)}`); }
    const t = info.tokens || { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    const cache = t.cache || { read: 0, write: 0 };
    const total = t.input + cache.read + cache.write;
    return {
        userMessageID: info.parentID,
        input: t.input, output: t.output, cacheRead: cache.read, cacheWrite: cache.write,
        hit: total > 0 ? (100 * cache.read) / total : 0,
        cost: info.cost || 0,
        answer: (reply.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('').trim().slice(0, 100),
    };
}

function row(name, r) {
    return `${name.padEnd(8)}${String(r.input).padStart(8)}${String(r.cacheRead).padStart(11)}${String(r.cacheWrite).padStart(11)}${r.hit.toFixed(1).padStart(8)}%${('$' + r.cost.toFixed(4)).padStart(10)}`;
}

async function main() {
    const created = [];
    const results = {};
    try {
        const open = async (title) => { const s = await call('POST', '/session', { title }); created.push(s.id); return s; };
        const base = await open('poc-fork base');
        results.base = await send(base.id, baseText());
        if (results.base.cost > MAX_COST) { throw new Error(`base cost $${results.base.cost} over budget`); }

        results.control = await send(base.id, 'Question 1: what is 2+2? Answer in one sentence, no tools.');

        const forkBody = FORK_AT_BASE ? { messageID: results.control.userMessageID } : {};
        const forkA = await call('POST', `/session/${base.id}/fork`, forkBody);
        created.push(forkA.id);
        const forkB = await call('POST', `/session/${base.id}/fork`, forkBody);
        created.push(forkB.id);
        const copied = (await call('GET', `/session/${forkA.id}/message`)).length;
        const original = (await call('GET', `/session/${base.id}/message`)).length;

        const [a, b] = await Promise.all([
            send(forkA.id, 'Question 2: what is 3+3? Answer in one sentence, no tools.'),
            send(forkB.id, 'Question 3: what is 4+4? Answer in one sentence, no tools.'),
        ]);
        results.forkA = a;
        results.forkB = b;

        console.log(`model=${MODEL} agent=${AGENT}`);
        console.log(`fork copied ${copied} of ${original} messages (${FORK_AT_BASE ? 'forked at the control message: base exchange only' : 'whole session: base + control exchange'})`);
        console.log('row       input  cacheRead cacheWrite     hit%      cost');
        for (const name of ['base', 'control', 'forkA', 'forkB']) { console.log(row(name, results[name])); }
        const total = Object.values(results).reduce((s, r) => s + r.cost, 0);
        console.log(`total cost $${total.toFixed(4)}`);
        const ok = a.hit >= 90 && b.hit >= 90;
        console.log(`HYPOTHESIS forks share the base cache: ${ok ? 'CONFIRMED' : 'REJECTED'} (forkA ${a.hit.toFixed(1)}%, forkB ${b.hit.toFixed(1)}%)`);
    } finally {
        for (const id of created) {
            try { await call('DELETE', `/session/${id}`); } catch (e) { console.error(`cleanup failed for ${id}: ${e.message}`); }
        }
        console.log(`deleted ${created.length} sessions`);
    }
}

main().catch((e) => { console.error(`POC FAILED: ${e.message}`); process.exitCode = 1; });
