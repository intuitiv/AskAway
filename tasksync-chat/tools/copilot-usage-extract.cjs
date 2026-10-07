#!/usr/bin/env node
// Streams Copilot main-agent debug logs (<storage>/<wsHash>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl),
// keeps only llm_request entries and appends compact rows to .askaway/analyst/copilot/<wsName>.jsonl.
// Incremental: cursor.json holds a byte offset per file; only complete (newline-terminated) lines are consumed.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(process.env.ASKAWAY_ANALYST_DIR || path.join(ROOT, '.askaway', 'analyst'), 'copilot');
const STORAGE = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
const DEFAULT_WS = { TaskSync: path.join(STORAGE, '98a723828199ea16f18487c4641f2ff1'), AppLogic: path.join(STORAGE, 'f1a7dd08869cd6af635247dcd4a21cc8') };
const CHUNK = 1 << 20;
const num = (v) => (typeof v === 'number' ? v : 0);

/** Converts one log line to a compact row, or null when it is not a parseable LLM request. */
function toRow(line, ws, sid) {
    if (line.indexOf('llm_request') === -1) { return null; }
    let p; try { p = JSON.parse(line); } catch { return null; }
    const a = p && p.attrs;
    if (p.type !== 'llm_request' || !a || typeof a !== 'object') { return null; }
    return { ws, sid, ts: num(p.ts), model: typeof a.model === 'string' ? a.model : 'unknown', input: num(a.inputTokens),
        cacheRead: num(a.cachedTokens), cacheWrite: num(a.cacheCreationTokens), output: num(a.outputTokens), nanoAiu: num(a.copilotUsageNanoAiu) };
}

/** Reads file from `from` in chunks; returns rows and the offset after the last complete line. */
function streamFile(file, from, ws, sid, append) {
    let count = 0;
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
    let pos = from, tail = Buffer.alloc(0);
    try {
        const buf = Buffer.allocUnsafe(CHUNK);
        while (pos < size) {
            const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
            if (!n) { break; }
            pos += n;
            let data = Buffer.concat([tail, buf.subarray(0, n)]), nl;
            while ((nl = data.indexOf(0x0a)) >= 0) {
                const row = toRow(data.toString('utf8', 0, nl), ws, sid);
                if (row) { append(row); count++; }
                data = data.subarray(nl + 1);
            }
            tail = Buffer.from(data);
        }
    } finally { fs.closeSync(fd); }
    return { count, offset: pos - tail.length };
}

function extract(workspaces, outDir = OUT) {
    fs.mkdirSync(outDir, { recursive: true });
    const curFile = path.join(outDir, 'cursor.json');
    let cursor = {}; try { cursor = JSON.parse(fs.readFileSync(curFile, 'utf8')); } catch { /* first run */ }
    const added = {};
    for (const [ws, dir] of Object.entries(workspaces)) {
        const logs = path.join(dir, 'GitHub.copilot-chat', 'debug-logs');
        added[ws] = 0;
        if (!fs.existsSync(logs)) { continue; }
        for (const sid of fs.readdirSync(logs).sort()) {
            const file = path.join(logs, sid, 'main.jsonl');
            if (!fs.existsSync(file)) { continue; }
            let from = cursor[file] || 0;
            if (from > fs.statSync(file).size) { from = 0; }
            const output = fs.openSync(path.join(outDir, `${ws}.jsonl`), 'a');
            try {
                const { count, offset } = streamFile(file, from, ws, sid, (row) => fs.writeSync(output, JSON.stringify(row) + '\n'));
                cursor[file] = offset; added[ws] += count;
            } finally { fs.closeSync(output); }
        }
    }
    fs.writeFileSync(curFile, JSON.stringify(cursor));
    return added;
}

function main(args) {
    const ws = {};
    for (let i = 0; i < args.length; i++) {
        const m = args[i] === '--ws' && args[i + 1] && /^([^=]+)=(.+)$/.exec(args[++i]);
        if (!m || !/^[a-zA-Z0-9_-]+$/.test(m[1])) { throw new Error('Usage: copilot-usage-extract.cjs [--ws name=<storageDir>]...'); }
        ws[m[1]] = m[2];
    }
    const added = extract(Object.keys(ws).length ? ws : DEFAULT_WS);
    for (const [k, v] of Object.entries(added)) { console.log(`${k}: +${v} requests`); }
}

module.exports = { extract, toRow };
if (require.main === module) { main(process.argv.slice(2)); }
