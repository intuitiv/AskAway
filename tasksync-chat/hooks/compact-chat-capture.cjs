// Stop hook: records each turn's user message and FINAL assistant message as a compact conversation.
// Tool calls and intermediate narration are dropped. Stored outside the repo; emits no output.
const fs = require('fs');
const os = require('os');
const path = require('path');

function readStdin() {
    try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function workspaceKey(cwd) {
    let canonical = cwd;
    try { canonical = fs.realpathSync(cwd); } catch { /* keep literal path */ }
    return canonical.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function lastTurn(transcriptPath) {
    const records = [];
    for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
        if (!line) { continue; }
        try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
    let userIndex = -1;
    for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].type === 'user.message') { userIndex = i; break; }
    }
    if (userIndex < 0) { return undefined; }
    let assistant = '';
    for (let i = records.length - 1; i > userIndex; i--) {
        const content = records[i].type === 'assistant.message' ? String(records[i].data?.content || '').trim() : '';
        if (content) { assistant = content; break; }
    }
    const user = records[userIndex];
    return { turnId: user.id, timestamp: user.timestamp, user: String(user.data?.content || ''), assistant };
}

function main() {
    const input = readStdin();
    const sessionId = String(input.session_id || input.sessionId || '');
    const transcriptPath = input.transcript_path || input.transcriptPath;
    if (!sessionId || !transcriptPath || !fs.existsSync(transcriptPath)) { return; }
    const turn = lastTurn(transcriptPath);
    if (!turn || !turn.assistant) { return; }

    const dir = path.join(os.homedir(), '.askaway', 'compact-chats', workspaceKey(input.cwd || process.cwd()));
    const file = path.join(dir, `${sessionId}.jsonl`);
    const rows = [];
    try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (line) { try { rows.push(JSON.parse(line)); } catch { /* skip malformed */ } }
        }
    } catch { /* first turn */ }
    // Stop can fire more than once per turn (a blocked stop retries), so upsert by turn.
    const index = rows.findIndex((row) => row.turnId === turn.turnId);
    if (index >= 0) { rows[index] = turn; } else { rows.push(turn); }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

try { main(); } catch { /* never block a stop */ }
