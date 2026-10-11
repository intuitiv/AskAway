import { z } from 'zod';
import type { ToolDefinition } from '../workers/workerTools';
import { LiveReply, recordLiveDecision } from './liveDecisions';
import { redactOrDrop, redactRecordOrDrop } from './redact';

export interface LiveValidatorOptions {
    workspace: string;
    enabled: () => boolean;
    availability: () => { mode: string; until?: string } | null;
    timeoutMs?: number;
}
export function validatorTool(observe: (text: string) => Promise<unknown>, live?: LiveValidatorOptions): ToolDefinition {
    const active = () => {
        const state = live?.availability();
        return live?.enabled() === true && state?.mode === 'awayValidator' &&
            (!state.until || (Number.isFinite(Date.parse(state.until)) && Date.parse(state.until) > Date.now()));
    };
    const inputSchema = z.object({ message: z.string().min(1), context: z.string().optional() });
    return {
        name: 'askaway_validator',
        description: 'Ask what the reviewer would decide. Beta queues a Commentary prediction. When the reviewer enables live and is Away, returns only sourced, confident, low-risk reversible answers; otherwise holds for the reviewer. Never pushes an answer unasked.',
        inputSchema,
        run: async input => {
            const args = inputSchema.parse(input);
            const question = args.message + (args.context ? '\nContext:\n' + args.context : '');
            if (live && active()) {
                const held = { held: true, note: 'Held for the reviewer; continue with independent work.' };
                if (redactOrDrop(question) === null) return held;
                let reply: LiveReply = {};
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const result = await Promise.race([Promise.resolve().then(() => observe(question)),
                        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Live validator timed out')), live.timeoutMs ?? 65000); })]);
                    if (result && typeof result === 'object' && redactRecordOrDrop(result)) reply = result as LiveReply;
                } catch { /* Errors and timeouts hold, never approve. */ }
                finally { if (timer) clearTimeout(timer); }
                const safe = active() && !reply.error && reply.risk === 'low' && reply.reversible === true &&
                    typeof reply.confidence === 'number' && reply.confidence >= 0.8 && reply.confidence <= 1 &&
                    typeof reply.answer === 'string' && !!reply.answer.trim() && Array.isArray(reply.sources) &&
                    reply.sources.length > 0 && reply.sources.every(source => typeof source === 'string' && !!source.trim());
                recordLiveDecision(live.workspace, { question, answer: safe ? reply.answer! : null, held: !safe,
                    sources: reply.sources ?? [], risk: reply.risk ?? null, reversible: reply.reversible ?? null,
                    confidence: reply.confidence ?? null, ts: Date.now() });
                return safe ? { answer: reply.answer, sources: reply.sources } : held;
            }
            void Promise.resolve().then(() => observe(question)).catch(() => undefined);
            return { queued: true, note: "The validator's prediction goes to Commentary for the reviewer." };
        },
    };
}
