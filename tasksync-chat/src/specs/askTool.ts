import { z } from 'zod';
import type { ToolDefinition } from '../workers/workerTools';
import { redactRecordOrDrop } from '../validator/redact';
import { readActiveSpecSlug } from './specCostLedger';
import { captureAsks, updateAskOutcome, updateAskQuestions, askProgressReport, batchAskQuestions, readAskDocuments, AskRefusal } from './askCapture';

export function asksTool(workspace: string): ToolDefinition {
    const text = z.string().trim().min(1).max(2000);
    const ref = z.object({ file: text, id: text }).strict();
    const question = z.object({ text, options: z.array(text).min(1).max(10), recommendation: text, answer: text.optional() }).strict();
    const inputSchema = z.object({
        action: z.enum(['capture', 'close', 'wait', 'report', 'questions']),
        spec: z.string().regex(/^\d+-[a-z0-9-]+$/).optional(),
        asks: z.array(z.object({ kind: z.enum(['request', 'bug', 'correction', 'side remark', 'repeated ask']),
            text, existingRow: ref.optional(), questions: z.array(question).max(20).optional() }).strict()).min(1).max(50).optional(),
        row: ref.optional(), evidence: text.optional(), reason: text.optional(),
        questions: z.array(question).max(20).optional(),
        offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
    }).strict();
    const documents = () => readAskDocuments(workspace);
    return { name: 'askaway_asks', inputSchema,
        description: 'Track every ask in every message, including unnumbered corrections and side remarks: capture; close with evidence; wait with reason; report coverage; questions returns ONE batch across all open/waiting asks. Never include secrets in arguments. Report is paginated; questions is never split.',
        run: async input => {
            if (!redactRecordOrDrop(input) || /\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*[^\s"\\]{8,}/i.test(JSON.stringify(input))) {
                return { status: 'REFUSED', reason: 'Credentials are not allowed' };
            }
            const parsed = inputSchema.safeParse(input);
            if (!parsed.success) { return { status: 'INVALID_INPUT', reason: 'Invalid action fields' }; }
            const args = parsed.data;
            try {
                let result: unknown;
                switch (args.action) {
                    case 'capture':
                        if (!args.asks) { throw new Error('Capture requires asks'); }
                        result = { rows: captureAsks(workspace, args.spec ?? (readActiveSpecSlug(workspace) || undefined), args.asks) }; break;
                    case 'close':
                        if (!args.row || !args.evidence) { throw new Error('Close requires a row and evidence'); }
                        result = { row: updateAskOutcome(workspace, args.row, { status: 'done', evidence: args.evidence }) }; break;
                    case 'wait':
                        if (!args.row || !args.reason) { throw new Error('Wait requires a row and reason'); }
                        result = { row: updateAskOutcome(workspace, args.row, { status: 'waiting', reason: args.reason }) }; break;
                    case 'report': {
                        const rows = askProgressReport(documents());
                        const offset = args.offset ?? 0;
                        const end = offset + (args.limit ?? 100);
                        result = { rows: rows.slice(offset, end), total: rows.length, nextOffset: end < rows.length ? end : null }; break;
                    }
                    case 'questions':
                        if (args.questions) {
                            if (!args.row) { throw new Error('Updating questions requires a row'); }
                            updateAskQuestions(workspace, args.row, args.questions);
                        }
                        result = { message: batchAskQuestions(documents()) }; break;
                }
                if (!redactRecordOrDrop(result)) { return { status: 'REFUSED', reason: 'Tracked content contains credentials' }; }
                if (JSON.stringify(result).length > 200000) { return { status: 'BLOCKED', reason: 'Output exceeds bound; questions are never split' }; }
                return result;
            } catch (error) {
                if (error instanceof AskRefusal) {
                    const refusal = { status: 'REFUSED', reason: error.message, ...(error.candidates ? { candidates: error.candidates } : {}) };
                    return redactRecordOrDrop(refusal) || { status: 'REFUSED', reason: 'Tracked content contains credentials' };
                }
                return { status: 'REFUSED', reason: 'Action requires valid tracked rows and evidence/reason for outcomes' };
            }
        } };
}
