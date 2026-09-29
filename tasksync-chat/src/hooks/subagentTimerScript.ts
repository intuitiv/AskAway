/** Hook script installed to ~/.askaway/hooks/subagent-timer.js; tested as a real process by test-subagent-timer.cjs. */
export const SUBAGENT_TIMER_INJECT_SCRIPT = `const fs = require('fs'), path = require('path'), os = require('os');
const SOFT_MS = 150000, HARD_MS = 240000, STALE_MS = 900000, SEEN_MS = 86400000;
const cfg = path.join(os.homedir(), '.askaway');
const stateFile = path.join(cfg, 'subagent-inflight.json');
function load() { try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); return { pending: Array.isArray(s.pending) ? s.pending : [], bySession: s.bySession || {}, seen: s.seen || {} }; } catch (e) { return { pending: [], bySession: {}, seen: {} }; } }
function save(s) { try { fs.mkdirSync(cfg, { recursive: true }); } catch (e) {} try { fs.writeFileSync(stateFile, JSON.stringify(s), 'utf8'); } catch (e) {} }
function fmt(ms) { const sec = Math.round(ms / 1000); return Math.floor(sec / 60) + 'm' + String(sec % 60).padStart(2, '0') + 's'; }
function emit(text) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })); }
// The parent's cache clock started when its last model request STARTED, earlier than this hook by the whole response.
function parentClock(sid, now) { try { const t = JSON.parse(fs.readFileSync(path.join(cfg, 'cache-clock.json'), 'utf8')).sessions[sid]; return t && t <= now && now - t < HARD_MS ? t : now; } catch (e) { return now; } }
try {
    let p = {}; try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (e) { process.exit(0); }
    const event = p.hook_event_name || p.hookEventName || '', tool = p.tool_name || p.toolName || '';
    const useId = p.tool_use_id || p.toolUseId || '', sid = p.session_id || p.sessionId || '', now = Date.now();
    const s = load();
    s.pending = s.pending.filter(e => now - e.startedAt < STALE_MS);
    const live = s.pending.map(e => e.startedAt);
    // A session is bound only to a sub-agent that is still in flight; old bindings would time the wrong conversation.
    for (const k of Object.keys(s.bySession)) { if (live.indexOf(s.bySession[k]) === -1) { delete s.bySession[k]; } }
    for (const k of Object.keys(s.seen)) { if (now - s.seen[k] > SEEN_MS) { delete s.seen[k]; } }
    if (sid && !s.seen[sid]) { s.seen[sid] = now; }
    if (event === 'PreToolUse') { if (tool === 'runSubagent') { s.pending.push({ id: useId, startedAt: now, parentSid: sid, clockFrom: parentClock(sid, now) }); } save(s); process.exit(0); }
    if (event !== 'PostToolUse') { save(s); process.exit(0); }
    if (tool === 'runSubagent') { let idx = useId ? s.pending.findIndex(e => e.id === useId) : -1; if (idx === -1) { idx = s.pending.findIndex(e => e.parentSid === sid); } const done = idx === -1 ? undefined : s.pending.splice(idx, 1)[0]; if (done) { for (const k of Object.keys(s.bySession)) { if (s.bySession[k] === done.startedAt) { delete s.bySession[k]; } } } save(s); if (done && now - (done.clockFrom || done.startedAt) >= HARD_MS) { emit('That sub-agent ran ' + fmt(now - done.startedAt) + ' (' + fmt(now - (done.clockFrom || done.startedAt)) + ' since your last model request) — past the ~5m prompt-cache window, so it was re-billed at full price. Split the next delegation of this kind into smaller single-deliverable tasks, or run it in the main thread.'); } process.exit(0); }
    // The parent (or any session that spawned a sub-agent) is never timed, and neither is an unknown session.
    if (!sid || s.pending.some(e => e.parentSid === sid)) { save(s); process.exit(0); }
    let startedAt = s.bySession[sid] || 0;
    if (!startedAt) {
        const claimed = Object.keys(s.bySession).map(k => s.bySession[k]);
        // A child is first seen after its spawn; a session seen earlier is some other conversation.
        const free = s.pending.filter(e => claimed.indexOf(e.startedAt) === -1 && s.seen[sid] >= e.startedAt);
        if (free.length) { startedAt = free[free.length - 1].startedAt; s.bySession[sid] = startedAt; }
    }
    save(s);
    if (!startedAt) { process.exit(0); }
    const entry = s.pending.find(e => e.startedAt === startedAt);
    const elapsed = now - ((entry && entry.clockFrom) || startedAt);
    if (elapsed >= HARD_MS) { emit('CACHE WINDOW EXPIRED (' + fmt(elapsed) + ' into your 4m budget). Stop all new work now. Do not start another tool call, search, or edit. Write your final report from what you already have, and state explicitly what you did NOT finish so the caller can re-delegate it.'); } else if (elapsed >= SOFT_MS) { emit('Elapsed ' + fmt(elapsed) + ' of your 4m sub-agent budget. Finish the current step and start writing your report — do not open a new line of investigation.'); }
} catch (e) {}
process.exit(0);
`;
