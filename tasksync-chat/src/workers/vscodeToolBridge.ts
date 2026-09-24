import * as vscode from 'vscode';
import { z } from 'zod';

/**
 * VS Code language-model tools that OpenCode workers reach through the AskAway MCP server.
 * Read-mostly tools whose value is the VS Code state workers cannot see: memories, language servers, diagnostics.
 */
export const BRIDGED_VSCODE_TOOLS = [
    'copilot_memory',
    'vscode_listCodeUsages',
    'copilot_searchWorkspaceSymbols',
    'copilot_getErrors',
    'code_nav',
] as const;

type JsonSchema = { type?: string | string[]; enum?: unknown[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[]; description?: string };

/** Zod for the JSON-schema subset these tools declare, so MCP clients see the same parameters VS Code does. */
export function zodFromJsonSchema(schema: JsonSchema | undefined): z.ZodTypeAny {
    if (!schema) { return z.any(); }
    const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
    let out: z.ZodTypeAny;
    if (schema.enum?.length && schema.enum.every((v) => typeof v === 'string')) {
        out = z.enum(schema.enum as [string, ...string[]]);
    } else if (type === 'string') { out = z.string(); }
    else if (type === 'number' || type === 'integer') { out = z.number(); }
    else if (type === 'boolean') { out = z.boolean(); }
    else if (type === 'array') { out = z.array(zodFromJsonSchema(schema.items)); }
    else if (type === 'object' || schema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(schema.properties ?? {})) {
            const field = zodFromJsonSchema(value);
            shape[key] = schema.required?.includes(key) ? field : field.optional();
        }
        out = z.object(shape).passthrough();
    } else { out = z.any(); }
    return schema.description ? out.describe(schema.description) : out;
}

export function toolResultText(result: vscode.LanguageModelToolResult): string {
    return result.content.map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : JSON.stringify(part)).join('\n');
}

/**
 * Memory mutations workers may make. `create` fails when the file exists and `str_replace` fails when `old_str` is
 * no longer there, so a stale writer loses instead of overwriting. Line-number and whole-file edits have no such check.
 */
const WORKER_MEMORY_COMMANDS = new Set(['view', 'create', 'str_replace']);
const memoryWrites = new Map<string, Promise<unknown>>();

/** Runs writes to one memory path one at a time; reads never wait. */
function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = memoryWrites.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    memoryWrites.set(key, next);
    void next.finally(() => { if (memoryWrites.get(key) === next) { memoryWrites.delete(key); } }).catch(() => undefined);
    return next;
}

type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: object) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>) => void;

/** Registers each available bridged tool under its VS Code name; returns the names registered. */
export function registerVsCodeToolBridge(register: Register, lm: Pick<typeof vscode.lm, 'tools' | 'invokeTool'> = vscode.lm): string[] {
    const registered: string[] = [];
    for (const name of BRIDGED_VSCODE_TOOLS) {
        const tool = lm.tools.find((t) => t.name === name);
        if (!tool) { continue; }
        register(name, { description: `[VS Code] ${tool.description}`, inputSchema: zodFromJsonSchema(tool.inputSchema as JsonSchema) }, async (args) => {
            const input = args as { command?: string; path?: string };
            if (name === 'copilot_memory' && !WORKER_MEMORY_COMMANDS.has(String(input.command))) {
                return { content: [{ type: 'text', text: `Workers may only ${[...WORKER_MEMORY_COMMANDS].join(', ')} memories; report the ${input.command} you need instead.` }], isError: true };
            }
            try {
                const invoke = async () => lm.invokeTool(name, { input: args, toolInvocationToken: undefined });
                const result = name === 'copilot_memory' && input.command !== 'view' ? await serialized(String(input.path), invoke) : await invoke();
                return { content: [{ type: 'text', text: toolResultText(result) }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `VS Code tool ${name} failed: ${(error as Error).message}` }], isError: true };
            }
        });
        registered.push(name);
    }
    return registered;
}
