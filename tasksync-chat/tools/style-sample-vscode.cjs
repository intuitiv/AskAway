const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { createReadStream } = require('node:fs');

function clean(text) {
    if (typeof text !== 'string') return '';
    let fenced = false;
    const lines = [];
    for (let line of text.replace(/```[\s\S]*?```/g, '\n').split(/\r?\n/)) {
        if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
        if (fenced) continue;
        line = line.trim().replace(/^(?:\/sk\.[\w.-]+\s*)+/, '');
        if (!line || /^\/[\w.-]+(?:\s+\/\S+)*$/.test(line)) continue;
        if (/(?:https?:\/\/|file:\/\/|(?:^|\s)(?:\/|~\/|[A-Za-z]:[\\/]|\.{1,2}\/)|\b[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\.(?:ts|js|json|md|py|java|log)\b)/i.test(line)) continue;
        if (/^(?:[\[{\]}]|"[^"]+"\s*:|at\s+\S+|Traceback\b|File\s+"|Caused by:|\w*(?:Error|Exception):|\d{4}-\d{2}-\d{2}[T\s]|\[?(?:DEBUG|INFO|WARN|ERROR|TRACE)\b|(?:attachment|tool (?:output|result))\s*:)/i.test(line)) continue;
        if (/\b(?:Bearer\s+\S+|access_token|refresh_token|client_secret)\b/i.test(line)) continue;
        lines.push(line);
    }
    const result = lines.join(' ').replace(/\s+/g, ' ').trim();
    return result.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length >= 4 ? result : '';
}
function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
    return undefined;
}
async function collect(roots, max = 200) {
    const rows = [];
    const add = (ts, text) => { const time = timestamp(ts), cleaned = clean(text); if (time !== undefined && cleaned) rows.push({ ts: time, text: cleaned }); };
    const visited = new Set();
    async function walk(dir) {
        const absolute = path.resolve(dir); if (visited.has(absolute)) return; visited.add(absolute);
        let entries; try { entries = await fs.readdir(absolute, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const file = path.join(absolute, entry.name);
            if (entry.isDirectory()) { await walk(file); continue; }
            if (!entry.isFile()) continue;
            const parts = file.split(path.sep);
            if (entry.name === 'main.jsonl' && parts.includes('debug-logs') && parts.includes('GitHub.copilot-chat')) {
                try {
                    for await (const line of readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
                        let event; try { event = JSON.parse(line); } catch { continue; }
                        if (event?.type === 'user_message') add(event.ts, event.attrs?.text);
                    }
                } catch { /* Unreadable logs do not hide other sessions. */ }
            } else if (entry.name.endsWith('.json') && path.basename(absolute) === 'chatSessions') {
                try {
                    const session = JSON.parse(await fs.readFile(file, 'utf8'));
                    for (const request of Array.isArray(session.requests) ? session.requests : []) {
                        if (request?.message?.role && request.message.role !== 'user') continue;
                        add(request.timestamp ?? request.ts ?? session.creationDate, request?.message?.text);
                    }
                } catch { /* Partial session files are skipped. */ }
            }
        }
    }
    for (const root of roots) await walk(root);
    rows.sort((a, b) => b.ts - a.ts);
    const seen = new Set();
    return rows.filter(row => { if (seen.has(row.text)) return false; seen.add(row.text); return true; }).slice(0, Math.min(max, 200));
}
async function main(args) {
    const roots = []; let out, max = 200;
    for (let i = 0; i < args.length; i++) {
        const flag = args[i], value = args[++i];
        if (!value) throw Error('Missing option value');
        if (flag === '--root') roots.push(value);
        else if (flag === '--out') out = value;
        else if (flag === '--max' && /^\d+$/.test(value) && Number(value) > 0) max = Number(value);
        else throw Error('Invalid option');
    }
    if (!out) throw Error('--out is required');
    if (!roots.length) roots.push(path.join(os.homedir(), 'Library/Application Support/Code/User/workspaceStorage'));
    const data = { source: 'vscode', collectedAt: new Date().toISOString(), messages: await collect(roots, max) };
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, JSON.stringify(data, null, 2), { mode: 0o600 });
    console.log(`Saved ${data.messages.length} style messages.`);
}
module.exports = { clean, collect, main };
if (require.main === module) main(process.argv.slice(2)).catch((error) => {
    console.error(`Style sampling failed: ${error?.message ?? error}`);
    console.error('Usage: node tools/style-sample-vscode.cjs --root <dir> [--root <dir>...] --out <file> [--max 200]');
    process.exitCode = 1;
});
