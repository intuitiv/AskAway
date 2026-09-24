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

function main() {
    const input = readStdin();
    const sessionId = String(input.session_id || input.sessionId || '');
    const cwd = input.cwd || process.cwd();
    if (!sessionId) { return; }

    const stateFile = path.join(os.homedir(), '.askaway', 'spec-context-sessions.json');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = {}; }
    if (state[sessionId]) { return; }

    let featureDir = '';
    try { featureDir = JSON.parse(fs.readFileSync(path.join(cwd, '.specify', 'feature.json'), 'utf8')).feature_directory || ''; } catch { return; }
    if (!featureDir) { return; }
    const specDir = path.resolve(cwd, featureDir);
    const goal = readBounded(path.join(specDir, 'Goal.md'));
    const rules = readBounded(path.join(specDir, 'Rules.md'));
    if (!goal && !rules) { return; }

    state[sessionId] = new Date().toISOString();
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));

    const slug = path.basename(specDir);
    const context = [
        `Active spec: ${slug}. Its Goal.md and Rules.md are injected once for this conversation.`,
        `Update ${featureDir}/Goal.md or Rules.md only when the goal or a rule actually changes; never rewrite them routinely.`,
        goal ? `\n## Goal (${featureDir}/Goal.md)\n${goal}` : '',
        rules ? `\n## Rules (${featureDir}/Rules.md)\n${rules}` : '',
    ].filter(Boolean).join('\n');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

try { main(); } catch { /* never block a prompt */ }
