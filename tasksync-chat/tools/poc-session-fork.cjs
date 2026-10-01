// POC: does forking a warm OpenCode session keep the prompt cache for parallel requests?
// Run: node tools/poc-session-fork.cjs [--model provider/model] [--server http://127.0.0.1:4096] [--agent aa-explore] [--fork-at-base] [--busy] [--max-cost 0.10]
// Flow: base (~8K tokens of fixed context) -> control (question 1, same session) -> fork twice -> questions 2 and 3 in parallel.
// --busy: skip the control/parallel flow; fork while the base session is still generating a long answer (see busy()).
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

const messageText = (m) => (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
const inFlight = (m) => m.info.role === 'assistant' && !(m.info.time && m.info.time.completed);

// The fork body's messageID is EXCLUSIVE: messages before it are copied. Cutting at the user message of the in-flight
// reply keeps everything completed and drops the unfinished turn.
function cutBeforeInFlight(messages) {
    const open = messages.find(inFlight);
    if (!open) { return undefined; }
    return messages.some((m) => m.info.id === open.info.parentID) ? open.info.parentID : open.info.id;
}

// --busy: fork a session while it is still generating a long answer, at its last completed message.
async function busy() {
    const created = [];
    const results = {};
    try {
        const base = await call('POST', '/session', { title: 'poc-fork busy base' });
        created.push(base.id);
        results.base = await send(base.id, baseText());
        if (results.base.cost > MAX_COST) { throw new Error(`base cost $${results.base.cost} over budget`); }

        let longError;
        const long = send(base.id, 'Write a 500 word essay about the history of tea. Plain prose, no tools, no lists.').catch((e) => { longError = e; });
        let messages = [];
        let partial = '';
        for (let i = 0; i < 100 && !longError; i++) {
            messages = await call('GET', `/session/${base.id}/message`);
            const open = messages.find(inFlight);
            partial = open ? messageText(open) : '';
            if (open && partial.length > 40) { break; }
            await new Promise((r) => setTimeout(r, 200));
        }
        if (!messages.some(inFlight)) { throw new Error('the long answer finished before it could be forked (still busy window missed)'); }
        const cut = cutBeforeInFlight(messages);
        const completedBefore = messages.findIndex((m) => m.info.id === cut);

        const fork = await call('POST', `/session/${base.id}/fork`, cut ? { messageID: cut } : {});
        created.push(fork.id);
        const copied = await call('GET', `/session/${fork.id}/message`);
        const copiedPartial = copied.some((m) => m.info.role === 'assistant' && partial.slice(0, 40) !== '' && messageText(m).startsWith(partial.slice(0, 40)));
        const copiedInFlight = copied.some(inFlight);

        results.fork = await send(fork.id, 'Question 2: what is 3+3? Answer in one sentence, no tools.');
        await long;
        if (longError) { throw longError; }
        const after = await call('GET', `/session/${base.id}/message`);
        const last = after[after.length - 1];
        const finished = last.info.role === 'assistant' && !!(last.info.time && last.info.time.completed) && !last.info.error;
        const words = messageText(last).split(/\s+/).filter(Boolean).length;

        console.log(`model=${MODEL} agent=${AGENT} mode=busy`);
        console.log(`base session had ${messages.length} messages at fork time (${completedBefore} before the cut, partial answer ${partial.length} chars in flight)`);
        console.log(`fork copied ${copied.length} messages; partial in-progress message copied: ${copiedPartial || copiedInFlight ? 'YES' : 'NO'}`);
        console.log('row       input  cacheRead cacheWrite     hit%      cost');
        console.log(row('base', results.base));
        console.log(row('fork', results.fork));
        console.log(`original long run completed: ${finished ? 'YES' : 'NO'} (${words} words)`);
        const ok = results.fork.hit >= 90 && finished && !copiedPartial && !copiedInFlight;
        console.log(`VERDICT busy fork: ${ok ? 'CONFIRMED' : 'REJECTED'} fork hit ${results.fork.hit.toFixed(1)}%, partial copied ${copiedPartial || copiedInFlight}, original completed ${finished}`);
    } finally {
        for (const id of created) {
            try { await call('DELETE', `/session/${id}`); } catch (e) { console.error(`cleanup failed for ${id}: ${e.message}`); }
        }
        console.log(`deleted ${created.length} sessions`);
    }
}

async function main() {
    if (process.argv.includes('--busy')) { return busy(); }
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
