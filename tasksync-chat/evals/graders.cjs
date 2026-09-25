// Deterministic graders for worker and orchestrator evals. No model judges: every check is a predicate.
const LIGHT = [/gpt-5\.6-luna/, /gpt-6-luna/, /gemini-.*-flash/];
const HEAVY = [/claude-opus/, /gpt-6-sol/];

function modelTier(model) {
    if (LIGHT.some((re) => re.test(model))) { return 'light'; }
    if (HEAVY.some((re) => re.test(model))) { return 'heavy'; }
    return 'mid';
}

/** Folds `opencode run --format json` events into the facts evals grade and record. */
function parseEvents(jsonl) {
    const run = { sessionId: '', texts: [], tools: [], errors: [],
        usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 } };
    for (const line of String(jsonl).split('\n')) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (!event || typeof event !== 'object') { continue; }
        run.sessionId = run.sessionId || event.sessionID || '';
        const part = event.part || {};
        if (event.type === 'text' && part.text) {
            run.texts.push(part.text);
        } else if (event.type === 'step_finish') {
            const tokens = part.tokens || {};
            run.usage.input += tokens.input || 0;
            run.usage.output += tokens.output || 0;
            run.usage.reasoning += tokens.reasoning || 0;
            run.usage.cacheRead += tokens.cache?.read || 0;
            run.usage.cacheWrite += tokens.cache?.write || 0;
            run.usage.cost += part.cost || 0;
            run.usage.steps += 1;
        } else if (event.type === 'error') {
            run.errors.push(JSON.stringify(event.error || event).slice(0, 300));
        } else if (part.tool) {
            run.tools.push(part.tool);
        }
    }
    run.finalText = run.texts.length ? run.texts[run.texts.length - 1] : '';
    return run;
}

function check(name, pass, detail = '') { return { name, pass: Boolean(pass), detail }; }

/** Grades one worker run. `ctx` carries harness observations: changed files and post-check output. */
function gradeWorker(testCase, run, ctx = {}) {
    const g = testCase.grade || {};
    const text = run.finalText;
    const checks = [check('noErrors', run.errors.length === 0, run.errors[0])];
    checks.push(check('answered', text.trim().length > 0));
    for (const re of g.expect || []) { checks.push(check(`expect ${re}`, new RegExp(re, 'im').test(text))); }
    for (const re of g.forbid || []) { checks.push(check(`forbid ${re}`, !new RegExp(re, 'im').test(text))); }
    if (g.maxLines) {
        const lines = text.trim().split('\n').length;
        checks.push(check(`maxLines ${g.maxLines}`, lines <= g.maxLines, `lines=${lines}`));
    }
    if (g.result) { checks.push(check(`result ${g.result}`, new RegExp(`Result:\\s*\\**\\s*${g.result}\\b`, 'i').test(text))); }
    const changed = ctx.changedFiles || [];
    if (g.readOnly) { checks.push(check('readOnly', changed.length === 0, changed.join(','))); }
    if (g.mustChange) { checks.push(check('mustChange', changed.length > 0)); }
    if (g.allowedChanges) {
        const outside = changed.filter((file) => !g.allowedChanges.includes(file));
        checks.push(check('scope', outside.length === 0, outside.join(',')));
    }
    for (const tool of g.toolsForbidden || []) { checks.push(check(`noTool ${tool}`, !run.tools.includes(tool))); }
    for (const tool of g.toolsRequired || []) { checks.push(check(`tool ${tool}`, run.tools.includes(tool))); }
    if (g.maxCost !== undefined) { checks.push(check(`maxCost ${g.maxCost}`, run.usage.cost <= g.maxCost, `cost=${run.usage.cost}`)); }
    if (g.postCheck) {
        const out = ctx.postCheckOutput || '';
        checks.push(check(`postCheck ${g.postCheck.expect}`, new RegExp(g.postCheck.expect, 'm').test(out), out.trim().split('\n').pop()));
    }
    return { pass: checks.every((c) => c.pass), checks };
}

function extractPlan(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try { return JSON.parse(raw); } catch { return undefined; }
}

const PACKET_FIELDS = ['id', 'mode', 'model', 'thinking', 'reason', 'objective', 'assertion', 'expected', 'command'];

/** The same limits the `commentary` tool enforces in src/commentary/commentary.ts. */
const COMMENTARY_KINDS = ['update', 'heads-up'];
const COMMENTARY_WORDS = { min: 3, max: 20 };
/** Plain words for a fan: no run/worker IDs, model names, or step labels like `A.1`. */
const COMMENTARY_JARGON = /\b(run|worker)-[a-z0-9]+-\d+\b|\b(gpt|claude|gemini)-|\b(opus|luna|terra)\b|^\W*[A-Z0-9]\.\d\b/i;

function commentaryWords(text) {
    return String(text).replace(/\s+/g, ' ').trim().split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Commentary is mandatory: the reviewer traces the run, steers it in time, and prepares for questions. */
function commentaryChecks(items, g) {
    const lines = Array.isArray(items) ? items : [];
    const checks = [check('commentaryPresent', lines.some((c) => c && c.kind === 'update'), `lines=${lines.length}`)];
    const badKind = lines.filter((c) => !COMMENTARY_KINDS.includes(c && c.kind));
    checks.push(check('commentaryKinds', badKind.length === 0, badKind.map((c) => c && c.kind).join(',')));
    const badLength = lines.filter((c) => { const n = commentaryWords(c && c.text); return n < COMMENTARY_WORDS.min || n > COMMENTARY_WORDS.max; });
    checks.push(check(`commentaryWords ${COMMENTARY_WORDS.min}-${COMMENTARY_WORDS.max}`, badLength.length === 0, badLength.map((c) => commentaryWords(c && c.text)).join(',')));
    const jargon = lines.filter((c) => COMMENTARY_JARGON.test(String(c && c.text)));
    checks.push(check('commentaryPlain', jargon.length === 0, jargon.map((c) => String(c.text).slice(0, 40)).join(' | ')));
    if (g.requireHeadsUp) {
        // A heads-up names the decision and its options, never just "something is unclear".
        const named = lines.filter((c) => c && c.kind === 'heads-up' && /\?|\bor\b/i.test(String(c.text)));
        checks.push(check('headsUpNamesDecision', named.length > 0));
    }
    return checks;
}

/** Each durable lesson has exactly one home; an ADR needs the reviewer's own words (reviewer, 2026-08-23). */
const CAPTURE_DESTINATIONS = ['skill', 'memory', 'adr', 'docs', 'refused'];

function captureChecks(captures, expected, goal) {
    const items = Array.isArray(captures) ? captures : [];
    const checks = [];
    const unknown = items.filter((c) => !CAPTURE_DESTINATIONS.includes(c && c.destination));
    checks.push(check('captureDestinationsKnown', unknown.length === 0, unknown.map((c) => c && c.destination).join(',')));
    for (const [lesson, destination] of Object.entries(expected)) {
        const routed = items.filter((c) => c && c.lesson === lesson);
        checks.push(check(`capture ${lesson}→${destination}`, routed.length === 1 && routed[0].destination === destination, routed.map((c) => c.destination).join(',') || 'missing'));
    }
    const stated = [...String(goal).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const unquoted = items.filter((c) => {
        const quote = String((c && c.quote) || '').trim();
        return c && c.destination === 'adr' && !(quote.length >= 8 && stated.some((words) => words.includes(quote)));
    });
    checks.push(check('adrQuotesReviewer', unquoted.length === 0, unquoted.map((c) => c.lesson).join(',')));
    return checks;
}

/** True when `packet` waits, directly or through others, on a packet in one of `modes`. */
function dependsOnMode(packet, byId, modes, seen = new Set()) {
    return (packet.dependsOn || []).some((dep) => {
        const parent = byId.get(dep);
        if (!parent || seen.has(dep)) { return false; }
        seen.add(dep);
        return modes.includes(parent.mode) || dependsOnMode(parent, byId, modes, seen);
    });
}

/** Which worker modes may judge each kind of work: by running it, never by reading it (reviewer, 2026-09-24). */
const VERIFIERS_BY_WORK = { code: ['verify', 'gradle', 'test'], test: ['verify', 'gradle'], authoring: ['verify', 'devx'], devx: ['verify'] };
/** A verify command that only looks at the change proves nothing about its behaviour; for a docs-only write, the text IS the result. */
const INSPECTION_ONLY = /^(cat|less|head|tail|grep|rg|ls|git\s+(diff|show|log|status))\b/;

/** Grades an orchestrator's plan against decomposition, pairing, and cost-discipline rules. */
function gradePlan(testCase, text, modes) {
    const g = testCase.grade || {};
    const plan = extractPlan(text);
    const checks = [check('planIsJson', plan && Array.isArray(plan.tracks))];
    if (!checks[0].pass) { return { pass: false, checks, plan: undefined }; }
    const tracks = plan.tracks;
    const packets = tracks.flatMap((track) => track.packets || []);
    const byId = new Map(packets.map((p) => [p.id, p]));

    if (g.minTracks) { checks.push(check(`minTracks ${g.minTracks}`, tracks.length >= g.minTracks, `tracks=${tracks.length}`)); }
    if (g.minParallelTracks) {
        const parallel = tracks.filter((t) => t.parallel === true).length;
        checks.push(check(`minParallelTracks ${g.minParallelTracks}`, parallel >= g.minParallelTracks, `parallel=${parallel}`));
    }
    if (g.maxPackets) { checks.push(check(`maxPackets ${g.maxPackets}`, packets.length <= g.maxPackets, `packets=${packets.length}`)); }

    const incomplete = packets.filter((p) => PACKET_FIELDS.some((f) => p[f] === undefined || p[f] === ''));
    checks.push(check('packetsComplete', packets.length > 0 && incomplete.length === 0, incomplete.map((p) => p.id).join(',')));
    const unknownMode = packets.filter((p) => !modes[p.mode]);
    checks.push(check('modesKnown', unknownMode.length === 0, unknownMode.map((p) => `${p.id}:${p.mode}`).join(',')));
    const disallowed = packets.filter((p) => modes[p.mode] && !modes[p.mode].models.includes(p.model));
    checks.push(check('modelsAllowed', disallowed.length === 0, disallowed.map((p) => `${p.id}:${p.model}`).join(',')));

    const lightModes = ['explore', 'verify', 'research', 'gradle'];
    const overspent = packets.filter((p) => lightModes.includes(p.mode) && modelTier(p.model) !== 'light');
    checks.push(check('lightModesUseLightTier', overspent.length === 0, overspent.map((p) => p.id).join(',')));
    const unjustifiedHeavy = packets.filter((p) => modelTier(p.model) === 'heavy' && String(p.reason || '').length < 20);
    checks.push(check('heavyTierJustified', unjustifiedHeavy.length === 0, unjustifiedHeavy.map((p) => p.id).join(',')));
    if (g.forbidHeavy) {
        const heavy = packets.filter((p) => modelTier(p.model) === 'heavy');
        checks.push(check('noHeavyTier', heavy.length === 0, heavy.map((p) => p.id).join(',')));
    }

    // A packet that is itself the check for other work (e.g. a DevX end-to-end run) needs no verifier of its own.
    const judges = new Set(packets.map((p) => p.verifyBy).filter(Boolean));
    const mutating = packets.filter((p) => VERIFIERS_BY_WORK[p.mode] && !judges.has(p.id));
    const unverified = mutating.filter((p) => {
        const verifier = byId.get(p.verifyBy);
        return !verifier || verifier.id === p.id || !VERIFIERS_BY_WORK[p.mode].includes(verifier.mode)
            || (p.writes !== 'docs' && INSPECTION_ONLY.test(String(verifier.command).trim()));
    });
    checks.push(check('mutationsVerifiedByBehaviour', unverified.length === 0, unverified.map((p) => p.id).join(',')));

    const danglingDeps = packets.filter((p) => (p.dependsOn || []).some((dep) => !byId.has(dep)));
    checks.push(check('dependenciesResolve', danglingDeps.length === 0, danglingDeps.map((p) => p.id).join(',')));
    for (const mode of g.requireModes || []) {
        checks.push(check(`usesMode ${mode}`, packets.some((p) => p.mode === mode)));
    }
    if (g.researchBeforeWork) {
        // Missing evidence is researched first, and the change waits for that answer.
        const blind = packets.filter((p) => ['code', 'test', 'authoring'].includes(p.mode) && !dependsOnMode(p, byId, ['research', 'explore']));
        checks.push(check('researchBeforeWork', packets.some((p) => p.mode === 'research' || p.mode === 'explore') && blind.length === 0, blind.map((p) => p.id).join(',')));
    }
    if (g.captures) { checks.push(...captureChecks(plan.captures, g.captures, testCase.goal)); }
    checks.push(...commentaryChecks(plan.commentary, g));
    return { pass: checks.every((c) => c.pass), checks, plan };
}

module.exports = { modelTier, parseEvents, gradeWorker, gradePlan, extractPlan, COMMENTARY_KINDS, COMMENTARY_WORDS, CAPTURE_DESTINATIONS };
