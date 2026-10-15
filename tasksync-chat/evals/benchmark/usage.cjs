// Whole-harness usage: every step_finish of the main session and every worker session in a benchmark run.
// Requests are step_finish events; tool calls are counted separately. Any step without a cost makes dollars null.

function createUsage() {
    let main = '';
    const totals = { requests: 0, toolCalls: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    let known = 0;
    let missingCost = false;
    let mainRequests = 0;
    let mainPrompt = 0;
    const workers = new Map();

    function add(event) {
        if (!event || typeof event !== 'object') { return; }
        const session = event.sessionID || '';
        main = main || session;
        const part = event.part || {};
        if (event.type === 'step_finish') {
            const tokens = part.tokens || {};
            const prompt = (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0);
            totals.requests++;
            totals.input += tokens.input || 0;
            totals.output += tokens.output || 0;
            totals.reasoning += tokens.reasoning || 0;
            totals.cacheRead += tokens.cache?.read || 0;
            totals.cacheWrite += tokens.cache?.write || 0;
            const cost = typeof part.cost === 'number' && Number.isFinite(part.cost) ? part.cost : undefined;
            if (cost === undefined) { missingCost = true; } else { known += cost; }
            if (session === main) {
                mainRequests++;
                mainPrompt += prompt;
            } else {
                const w = workers.get(session) || { requests: 0, dollars: 0 };
                w.requests++;
                w.dollars += cost || 0;
                workers.set(session, w);
            }
        } else if (event.type === 'tool_use' || part.tool) {
            totals.toolCalls++;
        }
    }

    function result() {
        const list = [...workers.values()];
        return {
            ...totals,
            dollars: missingCost ? null : known,
            mainAveragePrompt: mainRequests ? Math.round(mainPrompt / mainRequests) : 0,
            workers: { workers: list.length, requests: list.reduce((n, w) => n + w.requests, 0), dollars: missingCost ? null : list.reduce((n, w) => n + w.dollars, 0) },
        };
    }

    /** Observed spend so far from steps that report cost; drives the spend cap even when some steps lack cost. */
    function spent() { return known; }

    return { add, result, spent };
}

function sumUsage(events) {
    const usage = createUsage();
    for (const event of events) { usage.add(event); }
    return usage.result();
}

module.exports = { createUsage, sumUsage };
