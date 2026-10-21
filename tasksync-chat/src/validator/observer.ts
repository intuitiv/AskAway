import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CommentaryStore } from '../commentary/commentary';
import { recordSpecTurn, specCostLedgerFile, validatorTurnKey } from '../specs/specCostLedger';
import { WorkerProfile } from '../workers/workerProfiles';
import { redactOrDrop } from './redact';
import { validatorProfile } from './profile';
import { ValidatorRecords, ValidatorResponse, ValidatorUsage, Prediction } from './records';
import { OpenCodeWorkerRuntime } from '../workers/openCodeRuntime';
import { KnowledgeStore, KnowledgeScope, KnowledgeFact } from './knowledgeStore';

export function validatorWorkerRun(runtime: () => Promise<OpenCodeWorkerRuntime>, workspaceRoot: string,
    turnId: () => string): ValidatorRunPort {
    return async ({ prompt, profile, observedId, turnId: observedTurnId }) => {
        const worker = await runtime();
        const run = worker.start({ workspacePath: workspaceRoot, profile: profile.name, model: profile.model, thinking: profile.thinking,
            dispatchTurnId: observedTurnId || turnId(), baseRevision: 'HEAD', objective: prompt + '\nReturn the JSON on one line, then Result: PASS.',
            allowedFiles: [], acceptance: 'Read-only cited validator JSON answer', expected: 'JSON answer and Result: PASS',
            command: 'No command: validate against the provided sources', track: 'validator' });
        if (!('runId' in run)) throw new Error(run.reason);
        const result = await worker.wait(run.runId, 60);
        if (result.status !== 'COMPLETED') {
            worker.cancel(run.runId);
            const reason = 'reason' in result ? String(result.reason ?? '') : '';
            throw new Error('Validator worker ' + result.status + (redactOrDrop(reason) !== null && reason ? ': ' + reason.slice(0, 240) : ''));
        }
        const status = worker.status(run.runId);
        if (!status || !('usage' in status)) throw new Error('Validator worker usage unavailable: ' + observedId);
        return { text: result.evidence.join('\n'), usage: status.usage, workerId: status.workerId, sessionId: status.sessionId };
    };
}

export interface ObservedResponse { id: string; source: string; text: string; specSlug?: string; force?: boolean; turnId?: string; batch?: boolean }

export interface ValidatorSource { id: string; text: string }

export interface ValidatorRunResult { text: string; usage?: Partial<ValidatorUsage>; workerId?: string; sessionId?: string }

/** The worker run port: the only way the validator runs a model. Today an OpenCode worker; later the backend (FR-014). Read-only profile, no send surface. */
export type ValidatorRunPort = (input: { prompt: string; profile: WorkerProfile; observedId: string; turnId?: string }) => Promise<ValidatorRunResult>;

export interface ValidatorEvent { type: 'start' | 'stop' | 'error'; observedId: string; workerId?: string; sessionId?: string; ts: number; error?: string }

export interface ObserverPorts {
    workspaceRoot: string;
    commentary: CommentaryStore;
    run: ValidatorRunPort;
    /** Knowledge, ADRs, memories: extra sources beyond Goal.md, Rules.md and the spec. */
    recall?: (query: { text: string; specSlug: string | null }) => Promise<ValidatorSource[]>;
    knowledgeStore?: KnowledgeStore;
    knowledgeScope?: KnowledgeScope;
    /** Worker-hook pipeline sink (analyze N3): lifecycle events by worker ID and OpenCode session ID. */
    onEvent?: (event: ValidatorEvent) => void;
    costFile?: string;
    timeoutMs?: number;
    now?: () => number;
    newId?: () => string;
}

export interface ObserverStats { observed: number; skipped: number; errors: number }

const QUESTION_CUE = /\?|\b(should i|shall i|do you want|would you|could you|can you|which (one|option|approach)|prefer|confirm|let me know|need your|your call|please (decide|advise|choose|approve)|options?:|approve)\b/i;

/** R-2 cheap check, no model: a response with no question or decision request is a pure progress update. */
export function needsObserving(text: string): boolean {
    return QUESTION_CUE.test(text);
}

function readIfPresent(file: string, id: string): ValidatorSource | null {
    try { return { id, text: fs.readFileSync(file, 'utf8') }; } catch { return null; }
}

function num(value: unknown): number { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }

function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; }

function replyObject(raw: string): Record<string, unknown> | null {
    for (let start = raw.indexOf('{'); start >= 0; start = raw.indexOf('{', start + 1)) {
        let depth = 0, quoted = false, escaped = false;
        for (let end = start; end < raw.length; end++) {
            const char = raw[end];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                try {
                    const value = JSON.parse(raw.slice(start, end + 1));
                    if (value && typeof value === 'object' && 'answer' in value) return value;
                } catch { /* Try the next surrounded object. */ }
                break;
            }
        }
    }
    return null;
}

export class ValidatorObserver {
    constructor(private readonly ports: ObserverPorts) {}

    private now(): number { return (this.ports.now ?? Date.now)(); }

    private records(specSlug: string | null): ValidatorRecords { return new ValidatorRecords(this.ports.workspaceRoot, specSlug); }

    /** Skip count is visible beside the observed and error counts (A15). */
    stats(specSlug: string | null): ObserverStats {
        const rows = this.records(specSlug).responses();
        return { observed: rows.filter((r) => !r.skipped).length, skipped: rows.filter((r) => r.skipped).length, errors: rows.filter((r) => r.error).length };
    }

    predictions(specSlug: string | null): Prediction[] { return this.records(specSlug).predictions(); }

    /** Advisory context is posted only to the validator lane; the caller receives no additions to inject. */
    async proposeContext(prompt: { text: string; specSlug?: string }): Promise<void> {
        const store = this.ports.knowledgeStore;
        const scope = this.ports.knowledgeScope;
        if (!store || !scope || !prompt.text.trim() || redactOrDrop(prompt.text) === null) { return; }
        const spec = prompt.specSlug ?? scope.spec;
        const canonical = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        try {
            const items = await store.recall(prompt.text, { ...scope, spec }, 10);
            // Keep dismissed additions in the audit history so polling or reopening does not re-propose them.
            const seen = new Set<string>();
            for (const entry of this.ports.commentary.read(this.ports.workspaceRoot).validatorItems ?? []) {
                if (entry.detail?.contextSpec !== (spec ?? null)) { continue; }
                for (const addition of (entry.detail.contextSuggestions as Array<{ ref: string; reason: string }> | undefined) ?? []) {
                    seen.add(addition.ref); seen.add(canonical(addition.reason));
                }
            }
            const named = canonical(prompt.text);
            for (const item of items.slice(0, 10)) {
                const reason = item.fact.text.trim().slice(0, 280);
                const key = canonical(reason);
                if (!key || item.scope.project !== scope.project || item.scope.agentId !== scope.agentId || item.scope.spec !== spec
                    || redactOrDrop(JSON.stringify({ ref: item.id, reason })) === null
                    || seen.has(item.id) || seen.has(key) || prompt.text.includes(item.id) || named.includes(key)) { continue; }
                const posted = this.ports.commentary.postValidator(this.ports.workspaceRoot, {
                    text: `Proposed context: ${reason}`,
                    detail: { contextSpec: spec ?? null, contextSuggestions: [{ id: item.id, ref: item.id, reason, dismissed: false }] },
                });
                if (posted.status === 'POSTED') { seen.add(item.id); seen.add(key); }
            }
        } catch {
            try { this.ports.commentary.postValidator(this.ports.workspaceRoot, { text: 'Validator context recall failed; prompt unchanged.' }); } catch { /* caller flow continues */ }
        }
    }

    /** Start alongside delivery; completion contains no validator output for an agent tool result. */
    closeLoop(prev: { id: string; text: string; specSlug?: string; storyId?: string; taskId?: string },
        reply: { id: string; text: string }): Promise<void> {
        return Promise.resolve().then(async () => {
            const specSlug = prev.specSlug ?? null;
            try {
                if (redactOrDrop(JSON.stringify({ prev, reply })) === null) { throw new Error('reply pair holds a credential'); }
                const records = this.records(specSlug);
                const prediction = records.predictions().find(p => p.responseId === prev.id);
                let parsed: Record<string, unknown> | null = null;
                const observer = new ValidatorObserver({ ...this.ports, run: async input => {
                    const result = await this.ports.run({ ...input, prompt: input.prompt + '\nCompare prediction with reviewer reply. Extract only knowledge stated by the reviewer and related to the previous response. Bare acknowledgements and unrelated replies yield no facts. Return JSON with answer:null, sources:[], observations, summary, impact, related:boolean, matched:boolean|null, diff:string, facts:[{kind:rule|instruction|goal|fact,text:string,example?:string}].' });
                    parsed = replyObject(result.text);
                    return result;
                } });
                const response = await observer.observe({ id: reply.id, source: 'agent', specSlug: prev.specSlug, force: true,
                    text: `Previous response:\n${prev.text}\nPrediction:\n${prediction?.decision ?? 'No prediction available'}\nReviewer reply:\n${reply.text}` });
                if (response.error || !parsed) { return; }
                const comparison = parsed as Record<string, unknown>;
                if (redactOrDrop(JSON.stringify(comparison)) === null) { return; }
                const related = comparison.related === true;
                if (prediction) {
                    records.appendPrediction({ ...prediction, matched: related && typeof comparison.matched === 'boolean' ? comparison.matched : null,
                        diff: String(comparison.diff ?? '') });
                    const compared = records.predictions().filter(p => typeof p.matched === 'boolean');
                    this.ports.commentary.postValidator(this.ports.workspaceRoot, {
                        text: `Validator prediction ${related ? comparison.matched === true ? 'matched' : 'mismatched' : 'not compared'}; match measure ${compared.filter(p => p.matched).length}/${compared.length}`,
                        detail: { prediction: prediction.decision, reply: reply.text, diff: String(comparison.diff ?? ''), matched: related ? comparison.matched : null },
                    });
                }
                if (!related || /^(ok|okay|yes|thanks|thank you)[.!\s]*$/i.test(reply.text.trim())) { return; }
                if (!this.ports.knowledgeStore || !this.ports.knowledgeScope) { throw new Error('Knowledge store unavailable'); }
                for (const value of Array.isArray(comparison.facts) ? comparison.facts : []) {
                    if (!value || typeof value.text !== 'string' || !value.text.trim() || !['rule', 'instruction', 'goal', 'fact'].includes(value.kind)) { continue; }
                    const fact: KnowledgeFact = { text: value.text, kind: value.kind, from: reply.id,
                        ...(typeof value.example === 'string' ? { example: value.example } : {}), storyId: prev.storyId, taskId: prev.taskId };
                    await this.ports.knowledgeStore.remember(fact, { ...this.ports.knowledgeScope, spec: specSlug ?? undefined });
                }
            } catch (error) {
                const message = String(error instanceof Error ? error.message : error);
                try { this.ports.commentary.postValidator(this.ports.workspaceRoot, { text: `Validator close loop failed: ${redactOrDrop(message) ?? 'redacted error'}` }); } catch { /* delivery continues */ }
            }
        });
    }

    private emit(event: ValidatorEvent): void {
        try { this.ports.onEvent?.(event); } catch { /* observability never blocks the validator */ }
    }

    private async sources(response: ObservedResponse, specSlug: string | null): Promise<ValidatorSource[]> {
        const root = this.ports.workspaceRoot;
        const found: Array<ValidatorSource | null> = [
            readIfPresent(path.join(root, 'GOALS.md'), 'GOALS.md'),
        ];
        if (specSlug) {
            found.push(
                readIfPresent(path.join(root, 'specs', specSlug, 'Goal.md'), `specs/${specSlug}/Goal.md`),
                readIfPresent(path.join(root, 'specs', specSlug, 'Rules.md'), `specs/${specSlug}/Rules.md`),
                readIfPresent(path.join(root, 'specs', specSlug, 'spec.md'), `specs/${specSlug}/spec.md`),
            );
        }
        let recalled: ValidatorSource[] = [];
        try { recalled = (await this.ports.recall?.({ text: response.text, specSlug })) ?? []; } catch { /* recall failure leaves the file sources */ }
        if (this.ports.knowledgeStore && this.ports.knowledgeScope) {
            const items = await this.ports.knowledgeStore.recall(response.text, { ...this.ports.knowledgeScope, spec: specSlug ?? undefined }, 20);
            recalled.push(...items.map(item => ({ id: item.id, text: item.fact.text })));
        }
        const all = [...found, ...recalled].filter((s): s is ValidatorSource => !!s && typeof s.id === 'string');
        // FR-016: a source holding a credential is dropped whole.
        return all.filter((s) => redactOrDrop(s.text) !== null);
    }

    /** Never throws and never blocks the caller's flow: failures become `error` on the returned response (FR-017). */
    async observe(response: ObservedResponse): Promise<ValidatorResponse & { risk?: 'low' | 'high'; reversible?: boolean; confidence?: number }> {
        const specSlug = response.specSlug ?? null;
        const base: ValidatorResponse = {
            ...(response.batch ? { turnEnd: true } : {}),
            id: (this.ports.newId ?? randomUUID)(), observedId: response.id, source: response.source, specSlug, answer: null,
            observations: '', summary: '', impact: '', sources: [], contextSuggestions: [],
            usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, skipped: false, error: null, ts: this.now(),
        };
        try {
            return await this.observeInner(response, base, specSlug);
        } catch (error) {
            return this.finish({ ...base, error: `validator failed: ${error instanceof Error ? error.message : String(error)}` }, specSlug);
        }
    }

    private async observeInner(response: ObservedResponse, base: ValidatorResponse, specSlug: string | null): Promise<ValidatorResponse & { risk?: 'low' | 'high'; reversible?: boolean; confidence?: number }> {
        if (!response.force && !needsObserving(String(response.text ?? ''))) { return this.finish({ ...base, skipped: true }, specSlug); }
        const start = this.ports.commentary.turnStarts?.(this.ports.workspaceRoot).at(-1) ?? 0;
        const messages = response.batch ? (this.ports.commentary.read?.(this.ports.workspaceRoot).items ?? [])
            .filter(item => item.ts >= start && redactOrDrop(item.text) !== null).map(item => item.text).join('\n') : '';
        const text = redactOrDrop(messages ? messages + '\n' + response.text : response.text);
        if (text === null) { return this.finish({ ...base, error: 'response holds a credential; not observed' }, specSlug); }

        const sources = await this.sources(response, specSlug);
        const prompt = [
            'Observed response:', text, '',
            'Sources (cite by EXACT id, or say "no source answers"):',
            ...sources.map((s) => `--- ${s.id}\n${s.text}`),
            '', 'Write the "answer" as the answer body only: no greeting, no self-introduction, and do not say who or what you are answering; the room adds a context line first.' + (response.batch ? ' This is the end-of-turn pass over the agent\'s final response: no question was asked, so write the answer as the reply the reviewer would give ("If I were you I would say: ..."), which is shown as a guess.' : ''),
            'Reply as JSON: {"answer": string|null, "sources": string[], "observations": string, "summary": string, "impact": string, "risk": "low"|"high", "reversible": boolean, "confidence": number (0..1)}. High risk or irreversible questions must be held for the reviewer; never authorize destructive actions.',
            'The sources array MUST contain only exact ids from this list: ' + JSON.stringify(sources.map(s => s.id)) + '. Do not append sections, line numbers, quotes or descriptions to ids. For GOALS.md use exactly "GOALS.md"; put section detail in observations instead. All JSON keys above are required.',
        ].join('\n');

        const profile = validatorProfile();
        this.emit({ type: 'start', observedId: response.id, ts: this.now() });
        let timer: NodeJS.Timeout | undefined;
        let result: ValidatorRunResult;
        try {
            const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('validator timed out')), this.ports.timeoutMs ?? 60000); });
            result = await Promise.race([this.ports.run({ prompt, profile, observedId: response.id, turnId: response.turnId }), timeout]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emit({ type: 'error', observedId: response.id, ts: this.now(), error: message });
            return this.finish({ ...base, error: message }, specSlug);
        } finally {
            if (timer) { clearTimeout(timer); }
        }

        const usage: ValidatorUsage = {
            input: num(result.usage?.input), output: num(result.usage?.output), reasoning: num(result.usage?.reasoning),
            cacheRead: num(result.usage?.cacheRead), cacheWrite: num(result.usage?.cacheWrite), cost: num(result.usage?.cost),
        };
        const withRun = { ...base, usage, ...(result.workerId ? { workerId: result.workerId } : {}), ...(result.sessionId ? { sessionId: result.sessionId } : {}) };
        const ids = { workerId: result.workerId, sessionId: result.sessionId };

        const parsed = replyObject(String(result.text ?? ''));
        if (!parsed) {
            this.emit({ type: 'error', observedId: response.id, ts: this.now(), error: 'unreadable validator output', ...ids });
            return this.finish({ ...withRun, error: 'validator output was not readable' }, specSlug);
        }

        // FR-005: an answer needs a cited source that was actually provided; otherwise no source answers.
        const known = new Set(sources.map((s) => s.id));
        const cited = strings(parsed.sources).filter((id) => known.has(id));
        const answered = typeof parsed.answer === 'string' && parsed.answer.trim() !== '' && cited.length > 0;
        if (answered) {
            try {
                this.records(specSlug).appendPrediction({ id: base.id, responseId: response.id, decision: String(parsed.answer), ts: this.now() });
            } catch { /* prediction persistence must not change the observation result */ }
        }
        this.emit({ type: 'stop', observedId: response.id, ts: this.now(), ...ids });
        const decision = {
            ...(parsed.risk === 'low' || parsed.risk === 'high' ? { risk: parsed.risk as 'low' | 'high' } : {}),
            ...(typeof parsed.reversible === 'boolean' ? { reversible: parsed.reversible } : {}),
            ...(typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1 ? { confidence: parsed.confidence } : {}),
        };
        return Object.assign(this.finish({
            ...withRun,
            answer: answered ? String(parsed.answer) : null,
            sources: answered ? cited : [],
            observations: String(parsed.observations ?? ''), summary: String(parsed.summary ?? ''), impact: String(parsed.impact ?? ''),
            ...decision,
        }, specSlug), decision);
    }

    /** Records, posts to Commentary only (FR-018), and counts cost once under `validator:<id>`. */
    private finish(response: ValidatorResponse, specSlug: string | null): ValidatorResponse {
        const { turnEnd, ...record } = response;
        try { this.records(specSlug).appendResponse(record); } catch { /* a disk failure must not block the flow */ }
        if (response.skipped) { return response; }
        const headline = response.error ? `Validator could not check this: ${response.error}`
            : response.answer ? `Validator: ${response.answer} (source: ${response.sources.join(', ')})`
                : 'Validator: no source answers this question.';
        try {
            this.ports.commentary.postValidator(this.ports.workspaceRoot, {
                text: headline,
                detail: { ...(turnEnd ? { turnEnd } : {}), observedId: response.observedId, source: response.source, answer: response.answer, sources: response.sources,
                    observations: response.observations, summary: response.summary, impact: response.impact, error: response.error,
                    contextSuggestions: response.contextSuggestions,
                    usage: response.usage, workerId: response.workerId, sessionId: response.sessionId },
            });
        } catch { /* Commentary failure never blocks */ }
        const u = response.usage;
        if (specSlug && (u.cost > 0 || u.input > 0 || u.output > 0)) {
            try {
                recordSpecTurn(this.ports.costFile ?? specCostLedgerFile(this.ports.workspaceRoot), {
                    specSlug, turnKey: validatorTurnKey(response.id), day: new Date(response.ts).toISOString().slice(0, 10), requests: 1,
                    inputTokens: u.input, outputTokens: u.output, nanoAiu: Math.round(u.cost * 100 * 1e9), source: 'validator',
                    reasoningTokens: u.reasoning, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
                });
            } catch { /* cost failure never blocks */ }
        }
        return response;
    }
}
