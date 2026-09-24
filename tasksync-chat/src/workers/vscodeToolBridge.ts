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

type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: object) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>) => void;

/** Registers each available bridged tool under its VS Code name; returns the names registered. */
export function registerVsCodeToolBridge(register: Register, lm: Pick<typeof vscode.lm, 'tools' | 'invokeTool'> = vscode.lm): string[] {
    const registered: string[] = [];
    for (const name of BRIDGED_VSCODE_TOOLS) {
        const tool = lm.tools.find((t) => t.name === name);
        if (!tool) { continue; }
        register(name, { description: `[VS Code] ${tool.description}`, inputSchema: zodFromJsonSchema(tool.inputSchema as JsonSchema) }, async (args) => {
            try {
                const result = await lm.invokeTool(name, { input: args, toolInvocationToken: undefined });
                return { content: [{ type: 'text', text: toolResultText(result) }] };
            } catch (error) {
                return { content: [{ type: 'text', text: `VS Code tool ${name} failed: ${(error as Error).message}` }], isError: true };
            }
        });
        registered.push(name);
    }
    return registered;
}
