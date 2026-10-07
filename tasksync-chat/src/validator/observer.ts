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

export function validatorWorkerRun(runtime: () => Promise<OpenCodeWorkerRuntime>, workspaceRoot: string,
    turnId: () => string): ValidatorRunPort {
    return async ({ prompt, profile, observedId }) => {
        const worker = await runtime();
        const run = worker.start({ workspacePath: workspaceRoot, profile: profile.name, model: profile.model, thinking: profile.thinking,
            dispatchTurnId: turnId(), baseRevision: 'HEAD', objective: prompt + '\nReturn the JSON on one line, then Result: PASS.',
            allowedFiles: [], acceptance: 'Read-only cited validator JSON answer', expected: 'JSON answer and Result: PASS',
            command: 'No command: validate against the provided sources', track: 'validator' });
        if (!('runId' in run)) throw new Error(run.reason);
        const result = await worker.wait(run.runId, 60);
        if (result.status !== 'COMPLETED') {
            worker.cancel(run.runId);
            throw new Error('Validator worker ' + result.status);
        }
        const status = worker.status(run.runId);
        if (!status || !('usage' in status)) throw new Error('Validator worker usage unavailable: ' + observedId);
        return { text: result.evidence.join('\n'), usage: status.usage, workerId: status.workerId, sessionId: status.sessionId };
    };
}

export interface ObservedResponse { id: string; source: string; text: string; specSlug?: string; force?: boolean }

export interface ValidatorSource { id: string; text: string }

export interface ValidatorRunResult { text: string; usage?: Partial<ValidatorUsage>; workerId?: string; sessionId?: string }

/** The worker run port: the only way the validator runs a model. Today an OpenCode worker; later the backend (FR-014). Read-only profile, no send surface. */
export type ValidatorRunPort = (input: { prompt: string; profile: WorkerProfile; observedId: string }) => Promise<ValidatorRunResult>;

export interface ValidatorEvent { type: 'start' | 'stop' | 'error'; observedId: string; workerId?: string; sessionId?: string; ts: number; error?: string }

export interface ObserverPorts {
    workspaceRoot: string;
    commentary: CommentaryStore;
    run: ValidatorRunPort;
    /** Knowledge, ADRs, memories: extra sources beyond Goal.md, Rules.md and the spec. */
    recall?: (query: { text: string; specSlug: string | null }) => Promise<ValidatorSource[]>;
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

    private emit(event: ValidatorEvent): void {
        try { this.ports.onEvent?.(event); } catch { /* observability never blocks the validator */ }
    }

    private async sources(response: ObservedResponse, specSlug: string | null): Promise<ValidatorSource[]> {
        const root = this.ports.workspaceRoot;
        const found: Array<ValidatorSource | null> = [
            readIfPresent(path.join(root, 'Goal.md'), 'Goal.md'),
            readIfPresent(path.join(root, 'Rules.md'), 'Rules.md'),
        ];
        if (specSlug) { found.push(readIfPresent(path.join(root, 'specs', specSlug, 'spec.md'), `specs/${specSlug}/spec.md`)); }
        let recalled: ValidatorSource[] = [];
        try { recalled = (await this.ports.recall?.({ text: response.text, specSlug })) ?? []; } catch { /* recall failure leaves the file sources */ }
        const all = [...found, ...recalled].filter((s): s is ValidatorSource => !!s && typeof s.id === 'string');
        // FR-016: a source holding a credential is dropped whole.
        return all.filter((s) => redactOrDrop(s.text) !== null);
    }

    /** Never throws and never blocks the caller's flow: failures become `error` on the returned response (FR-017). */
    async observe(response: ObservedResponse): Promise<ValidatorResponse> {
        const specSlug = response.specSlug ?? null;
        const base: ValidatorResponse = {
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

    private async observeInner(response: ObservedResponse, base: ValidatorResponse, specSlug: string | null): Promise<ValidatorResponse> {
        if (!response.force && !needsObserving(String(response.text ?? ''))) { return this.finish({ ...base, skipped: true }, specSlug); }
        const text = redactOrDrop(response.text);
        if (text === null) { return this.finish({ ...base, error: 'response holds a credential; not observed' }, specSlug); }

        const sources = await this.sources(response, specSlug);
        const prompt = [
            'Observed response:', text, '',
            'Sources (cite by id, or say "no source answers"):',
            ...sources.map((s) => `--- ${s.id}\n${s.text}`),
            '', 'Reply as JSON: {"answer": string|null, "sources": string[], "observations": string, "summary": string, "impact": string}.',
        ].join('\n');

        const profile = validatorProfile();
        this.emit({ type: 'start', observedId: response.id, ts: this.now() });
        let timer: NodeJS.Timeout | undefined;
        let result: ValidatorRunResult;
        try {
            const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('validator timed out')), this.ports.timeoutMs ?? 60000); });
            result = await Promise.race([this.ports.run({ prompt, profile, observedId: response.id }), timeout]);
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

        let parsed: Record<string, unknown> | null = null;
        try {
            const raw = String(result.text ?? '');
            const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
            parsed = json && typeof json === 'object' ? json : null;
        } catch { parsed = null; }
        if (!parsed) {
            this.emit({ type: 'error', observedId: response.id, ts: this.now(), error: 'unreadable validator output', ...ids });
            return this.finish({ ...withRun, error: 'validator output was not readable' }, specSlug);
        }

        // FR-005: an answer needs a cited source that was actually provided; otherwise no source answers.
        const known = new Set(sources.map((s) => s.id));
        const cited = strings(parsed.sources).filter((id) => known.has(id));
        const answered = typeof parsed.answer === 'string' && parsed.answer.trim() !== '' && cited.length > 0;
        this.emit({ type: 'stop', observedId: response.id, ts: this.now(), ...ids });
        return this.finish({
            ...withRun,
            answer: answered ? String(parsed.answer) : null,
            sources: answered ? cited : [],
            observations: String(parsed.observations ?? ''), summary: String(parsed.summary ?? ''), impact: String(parsed.impact ?? ''),
        }, specSlug);
    }

    /** Records, posts to Commentary only (FR-018), and counts cost once under `validator:<id>`. */
    private finish(response: ValidatorResponse, specSlug: string | null): ValidatorResponse {
        try { this.records(specSlug).appendResponse(response); } catch { /* a disk failure must not block the flow */ }
        if (response.skipped) { return response; }
        const headline = response.error ? `Validator could not check this: ${response.error}`
            : response.answer ? `Validator: ${response.answer} (source: ${response.sources.join(', ')})`
                : 'Validator: no source answers this question.';
        try {
            this.ports.commentary.postValidator(this.ports.workspaceRoot, {
                text: headline,
                detail: { observedId: response.observedId, source: response.source, answer: response.answer, sources: response.sources,
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
