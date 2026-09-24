// UserPromptSubmit hook: injects the active spec's Goal.md and Rules.md ONCE per conversation.
// Later prompts in the same conversation get nothing, so the prompt prefix and cache stay stable.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_CHARS = 6000;

function readStdin() {
    try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function readBounded(file) {
    try {
        const text = fs.readFileSync(file, 'utf8').trim();
        return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(truncated; read the file for the rest)` : text;
    } catch {
        return '';
    }
}

// Same key as CommentaryStore.commentaryKey in src/commentary/commentary.ts.
function commentaryKey(workspace) {
    let resolved = workspace;
    try { resolved = fs.realpathSync(workspace); } catch { /* keep as given */ }
    return resolved.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function readCommentary(cwd) {
    try {
        const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.askaway', 'commentary', `${commentaryKey(cwd)}.json`), 'utf8'));
        const items = (Array.isArray(state.items) ? state.items : []).filter((item) => item.ts > (state.clearedAt || 0));
        return { goal: String(state.goal || '').trim(), items };
    } catch {
        return { goal: '', items: [] };
    }
}

function activeCycle(specDir) {
    try {
        const match = fs.readFileSync(path.join(specDir, 'tasks.md'), 'utf8').match(/^- \[ \] T\d+\w* \[(CY-\d+)\]/m);
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

function carryOver(commentary) {
    if (!commentary.goal && !commentary.items.length) { return ''; }
    const lines = ['\n## Carry-over from the previous conversation (goal box + uncleared commentary)'];
    lines.push(`Main goal: ${commentary.goal || '(none set; use the active spec cycle)'}`);
    for (const item of commentary.items.slice(-30)) {
        const flagged = ['heads-up', 'question', 'blocked'].includes(item.kind);
        lines.push(`- ${new Date(item.ts).toISOString().slice(11, 16)}${item.ref ? ` ${item.ref}` : ''} ${flagged ? 'HEADS-UP: ' : ''}${item.text}`);
    }
    return lines.join('\n');
}

function main() {
    const input = readStdin();
    const sessionId = String(input.session_id || input.sessionId || '');
    const cwd = input.cwd || process.cwd();
    const prompt = String(input.prompt || input.user_prompt || '').trim();
    if (!sessionId) { return; }

    const stateFile = path.join(os.homedir(), '.askaway', 'spec-context-sessions.json');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = {}; }

    let featureDir = '';
    try { featureDir = JSON.parse(fs.readFileSync(path.join(cwd, '.specify', 'feature.json'), 'utf8')).feature_directory || ''; } catch { featureDir = ''; }
    const specDir = featureDir ? path.resolve(cwd, featureDir) : '';
    const commentary = readCommentary(cwd);
    const parts = [];

    if (!state[sessionId] && specDir) {
        const goal = readBounded(path.join(specDir, 'Goal.md'));
        const rules = readBounded(path.join(specDir, 'Rules.md'));
        if (goal || rules) {
            state[sessionId] = new Date().toISOString();
            fs.mkdirSync(path.dirname(stateFile), { recursive: true });
            fs.writeFileSync(stateFile, JSON.stringify(state));
            parts.push(
                `Active spec: ${path.basename(specDir)}. Its Goal.md and Rules.md are injected once for this conversation.`,
                `Update ${featureDir}/Goal.md or Rules.md only when the goal or a rule actually changes; never rewrite them routinely.`,
                goal ? `\n## Goal (${featureDir}/Goal.md)\n${goal}` : '',
                rules ? `\n## Rules (${featureDir}/Rules.md)\n${rules}` : '',
                carryOver(commentary),
            );
        }
    }

    // Per-prompt anchor: it sits in the new user turn, so the cached prompt prefix is unchanged.
    const anchor = commentary.goal ? `Main goal (goal box): ${commentary.goal}` : (specDir && activeCycle(specDir) ? `Main goal: finish ${activeCycle(specDir)} of ${path.basename(specDir)}.` : '');
    if (anchor) {
        parts.push(/^aside:/i.test(prompt)
            ? `${anchor}\nThis prompt is an aside: answer it briefly, do not change the main goal, then return to it.`
            : `${anchor}\nStay on it; treat unrelated requests as asides.`);
    }

    const context = parts.filter(Boolean).join('\n');
    if (!context) { return; }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

try { main(); } catch { /* never block a prompt */ }
