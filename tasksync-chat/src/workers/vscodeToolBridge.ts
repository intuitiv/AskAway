import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';

/**
 * VS Code language-model tools that OpenCode workers reach through the AskAway MCP server.
 * Their value is VS Code state workers cannot see: memories, language servers, diagnostics, Sonar analysis, the profiler.
 * Each entry matches a VS Code tool name; the match is the stable name workers see (VS Code prefixes MCP tools).
 */
export const BRIDGED_VSCODE_TOOLS: readonly RegExp[] = [
    /^copilot_memory$/,
    /^vscode_listCodeUsages$/,
    /^copilot_searchWorkspaceSymbols$/,
    /^copilot_getErrors$/,
    /^code_nav$/,
    /^sonarqube_(analyze_file|list_potential_security_issues)$/,
    /yourkit_(profiler|snapshot)$/,
];

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

type ToolReply = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
type Register = (name: string, config: { description: string; inputSchema: z.ZodTypeAny }, handler: (args: object) => Promise<ToolReply>) => void;

/** A VS Code window's AskAway MCP endpoint and the workspace folders it serves. */
export interface WindowRoute { workspaces: string[]; port: number; pid: number }

export const MCP_WINDOWS_DIR = path.join(os.homedir(), '.askaway', 'mcp-windows');

/** Records this window so the window that owns the shared port can route a worker's call to it. */
export function registerWindow(route: WindowRoute, dir: string = MCP_WINDOWS_DIR): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${route.pid}.json`), JSON.stringify(route));
}

export function readWindows(dir: string = MCP_WINDOWS_DIR, alive: (pid: number) => boolean = processAlive): WindowRoute[] {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const routes: WindowRoute[] = [];
    for (const name of names) {
        try {
            const route = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as WindowRoute;
            if (alive(route.pid)) { routes.push(route); } else { fs.rmSync(path.join(dir, name), { force: true }); }
        } catch { /* skip malformed entry */ }
    }
    return routes;
}

function processAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The window whose workspace folder contains `workspacePath` (deepest folder wins). */
export function routeFor(workspacePath: string, routes: WindowRoute[]): WindowRoute | undefined {
    const target = path.resolve(workspacePath);
    let best: { route: WindowRoute; depth: number } | undefined;
    for (const route of routes) {
        for (const folder of route.workspaces) {
            const root = path.resolve(folder);
            if (target === root || target.startsWith(root + path.sep)) {
                if (!best || root.length > best.depth) { best = { route, depth: root.length }; }
            }
        }
    }
    return best?.route;
}

/** Calls a bridged tool on another window's AskAway MCP. */
async function forwardToWindow(port: number, name: string, args: object): Promise<ToolReply> {
    const response = await fetch(`http://127.0.0.1:${port}/sse`, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    const message = JSON.parse(data ? data.slice(6) : text);
    if (message.error) { throw new Error(message.error.message); }
    return message.result as ToolReply;
}

export interface BridgeOptions {
    lm?: Pick<typeof vscode.lm, 'tools' | 'invokeTool'>;
    /** This window's MCP port; a call routed to it is handled here. */
    selfPort?: number;
    windows?: () => WindowRoute[];
    forward?: (port: number, name: string, args: object) => Promise<ToolReply>;
}

const WORKSPACE_PARAM = 'Your working directory (absolute). AskAway sends the call to the VS Code window that has it open, so memories and language servers are that workspace\'s.';

/** Registers each available bridged tool under its VS Code name; returns the names registered. */
export function registerVsCodeToolBridge(register: Register, options: BridgeOptions = {}): string[] {
    const lm = options.lm ?? vscode.lm;
    const windows = options.windows ?? (() => readWindows());
    const forward = options.forward ?? forwardToWindow;
    const registered: string[] = [];
    for (const pattern of BRIDGED_VSCODE_TOOLS) {
        const tool = lm.tools.find((t) => pattern.test(t.name));
        if (!tool) { continue; }
        const name = (pattern.exec(tool.name) as RegExpExecArray)[0];
        const vscodeName = tool.name;
        const schema = zodFromJsonSchema(tool.inputSchema as JsonSchema);
        const inputSchema = schema instanceof z.ZodObject ? schema.extend({ workspacePath: z.string().optional().describe(WORKSPACE_PARAM) }) : schema;
        register(name, { description: `[VS Code] ${tool.description}`, inputSchema }, async (args) => {
            const { workspacePath, ...input } = args as { workspacePath?: string; command?: string; path?: string };
            if (name === 'copilot_memory' && !WORKER_MEMORY_COMMANDS.has(String(input.command))) {
                return { content: [{ type: 'text', text: `Workers may only ${[...WORKER_MEMORY_COMMANDS].join(', ')} memories; report the ${input.command} you need instead.` }], isError: true };
            }
            const route = workspacePath ? routeFor(workspacePath, windows()) : undefined;
            try {
                if (route && route.port !== options.selfPort) { return await forward(route.port, name, args); }
                const invoke = async () => lm.invokeTool(vscodeName, { input, toolInvocationToken: undefined });
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
