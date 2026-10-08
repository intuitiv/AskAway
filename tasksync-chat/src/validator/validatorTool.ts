import { z } from 'zod';
import type { ToolDefinition } from '../workers/workerTools';

export function validatorTool(observe: (text: string) => Promise<unknown>): ToolDefinition {
    const inputSchema = z.object({ message: z.string().min(1), context: z.string().optional() });
    return {
        name: 'askaway_validator',
        description: 'Call when unsure what the reviewer would decide, so the validator records its prediction for the reviewer in Commentary. The result carries no answer.',
        inputSchema,
        run: async input => {
            const args = inputSchema.parse(input);
            void Promise.resolve().then(() => observe(args.message + (args.context ? '\nContext:\n' + args.context : ''))).catch(() => undefined);
            return { queued: true, note: "The validator's prediction goes to Commentary for the reviewer." };
        },
    };
}
