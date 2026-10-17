import * as fs from 'fs';
import * as path from 'path';

/**
 * VS Code 1.140+ runs the Copilot harness on the Copilot SDK. It no longer writes
 * `GitHub.copilot-chat/debug-logs/<session>/main.jsonl`; it writes `~/.copilot/session-state/<session>/events.jsonl`.
 * Every AskAway consumer (Trace, credits, turn budget, handoff, hooks) reads the main.jsonl line format, so this
 * bridge converts each SDK session of the current workspace into that format, at the same path.
 */

type Json = Record<string, any>;

interface PendingTool { ts: number; name: string; args: string }

export interface ConvertState {
    sid: string;
    pending: Map<string, PendingTool>;
    started: boolean;
}

export function newConvertState(sid: string): ConvertState {
    return { sid, pending: new Map(), started: false };
}

function row(state: ConvertState, type: string, ts: number, dur: number, name: string, spanId: string, attrs: Json, status = 'ok', parentSpanId?: string): string {
    const line: Json = { v: 1, ts, dur, sid: state.sid, type, name, spanId };
    if (parentSpanId) { line.parentSpanId = parentSpanId; }
    line.status = status;
    line.attrs = attrs;
    return JSON.stringify(line);
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
}

/** Convert complete `events.jsonl` lines into main.jsonl lines. Unknown events are skipped; bad lines are ignored. */
export function convertEventLines(lines: string[], state: ConvertState): string[] {
    const out: string[] = [];
    for (const raw of lines) {
        if (!raw) { continue; }
        let event: Json;
        try { event = JSON.parse(raw); } catch { continue; }
        const data: Json = event.data ?? {};
        const ts = Date.parse(event.timestamp);
        if (!Number.isFinite(ts)) { continue; }
        switch (event.type) {
            case 'session.start':
                if (state.started) { break; }
                state.started = true;
                out.push(row(state, 'session_start', Date.parse(data.startTime) || ts, 0, 'session_start', `session-start-${state.sid}`,
                    { copilotVersion: data.copilotVersion, source: 'copilot-sdk', model: data.selectedModel, cwd: data.context?.cwd }));
                break;
            case 'user.message':
                out.push(row(state, 'user_message', ts, 0, 'user_message', text(data.messageId) || `user-${ts}`, { content: text(data.content), text: text(data.content) }));
                break;
            case 'assistant.turn_start':
                out.push(row(state, 'turn_start', ts, 0, `turn_start:${text(data.turnId)}`, `turn_start-${text(data.turnId)}-${ts}`, { turnId: text(data.turnId) }));
                break;
            case 'assistant.turn_end':
                out.push(row(state, 'turn_end', ts, 0, `turn_end:${text(data.turnId)}`, `turn_end-${text(data.turnId)}-${ts}`, { turnId: text(data.turnId) }));
                break;
            case 'session.usage_record': {
                const usage: Json = data.usage ?? {};
                const dur = Number(usage.duration) || 0;
                const nano = usage.copilotUsage?.totalNanoAiu;
                const attrs: Json = {
                    model: usage.model,
                    debugName: `sdk/${text(usage.interactionType) || 'request'}`,
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                    cachedTokens: usage.cacheReadTokens ?? 0,
                    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
                    reasoningTokens: usage.reasoningTokens ?? 0,
                    ttft: Math.round(Number(usage.timeToFirstTokenMs) || 0),
                    responseId: usage.apiCallId,
                    requestId: usage.providerCallId,
                    maxTokens: usage.maxOutputTokens,
                    initiator: usage.initiator,
                };
                if (typeof nano === 'number' && Number.isFinite(nano)) { attrs.copilotUsageNanoAiu = nano; }
                out.push(row(state, 'llm_request', ts - dur, dur, `chat:${text(usage.model)}`, `llm-${text(usage.apiCallId) || ts}`, attrs));
                break;
            }
            case 'assistant.message': {
                const parts: Json[] = [];
                if (text(data.content)) { parts.push({ type: 'text', content: text(data.content) }); }
                for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
                    parts.push({ type: 'tool_call', id: request.toolCallId, name: request.name, arguments: request.arguments });
                }
                out.push(row(state, 'agent_response', ts, 0, 'agent_response', `agent-msg-${text(data.messageId) || ts}`,
                    { response: JSON.stringify([{ role: 'assistant', parts }]), reasoning: text(data.reasoningText) }));
                break;
            }
            case 'tool.execution_start':
                if (data.toolCallId) { state.pending.set(data.toolCallId, { ts, name: text(data.toolName) || 'unknown', args: text(data.arguments) }); }
                break;
            case 'tool.execution_complete': {
                const started = state.pending.get(data.toolCallId);
                state.pending.delete(data.toolCallId);
                const begin = started?.ts ?? ts;
                const result = data.result?.content ?? data.error?.message ?? '';
                out.push(row(state, 'tool_call', begin, Math.max(0, ts - begin), started?.name ?? 'unknown', `tool-${text(data.toolCallId)}`,
                    { args: started?.args ?? '', result: text(result) }, data.success === false ? 'error' : 'ok'));
                break;
            }
            default:
                break;
        }
    }
    return out;
}

interface SessionBridge {
    state: ConvertState;
    offset: number;
    mainFile: string;
    ready: boolean;
}

export interface BridgeOptions {
    /** `~/.copilot/session-state` */
    sessionStateDir: string;
    /** `<workspaceStorage>/<id>/GitHub.copilot-chat/debug-logs` */
    debugRoot: string;
    workspaceRoots: () => string[];
}

function insideWorkspace(cwd: string, roots: string[]): boolean {
    return roots.some(root => cwd === root || cwd.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}

/** Reads the bytes appended to a file since `offset`, up to the last complete line. */
async function readCompleteLines(file: string, offset: number): Promise<{ lines: string[]; consumed: number }> {
    const stat = await fs.promises.stat(file);
    if (stat.size <= offset) { return { lines: [], consumed: 0 }; }
    const handle = await fs.promises.open(file, 'r');
    try {
        const buffer = Buffer.alloc(stat.size - offset);
        await handle.read(buffer, 0, buffer.length, offset);
        const end = buffer.lastIndexOf(0x0a);
        if (end < 0) { return { lines: [], consumed: 0 }; }
        return { lines: buffer.subarray(0, end).toString('utf8').split('\n'), consumed: end + 1 };
    } finally {
        await handle.close();
    }
}

export class CopilotSdkLogBridge {
    private readonly sessions = new Map<string, SessionBridge>();
    private readonly notOurs = new Set<string>();
    private running = false;

    constructor(private readonly options: BridgeOptions) {}

    /** Convert new SDK events of this workspace's sessions. Returns the number of lines written. */
    async sync(): Promise<number> {
        if (this.running) { return 0; }
        this.running = true;
        try {
            let names: string[] = [];
            try { names = await fs.promises.readdir(this.options.sessionStateDir); } catch { return 0; }
            let written = 0;
            for (const name of names) {
                if (this.notOurs.has(name)) { continue; }
                try { written += await this.syncSession(name); } catch { /* unreadable session: retry next time */ }
            }
            return written;
        } finally {
            this.running = false;
        }
    }

    private async syncSession(sid: string): Promise<number> {
        const eventsFile = path.join(this.options.sessionStateDir, sid, 'events.jsonl');
        let bridge = this.sessions.get(sid);
        if (!bridge) {
            const head = await readCompleteLines(eventsFile, 0).catch(() => undefined);
            const first = head?.lines.find(line => line.includes('"session.start"'));
            if (!first) { return 0; }
            const cwd = String(JSON.parse(first)?.data?.context?.cwd ?? '');
            if (!cwd || !insideWorkspace(cwd, this.options.workspaceRoots())) { this.notOurs.add(sid); return 0; }
            bridge = { state: newConvertState(sid), offset: 0, mainFile: path.join(this.options.debugRoot, sid, 'main.jsonl'), ready: false };
            this.sessions.set(sid, bridge);
        }
        const { lines, consumed } = await readCompleteLines(eventsFile, bridge.offset);
        if (consumed === 0) { return 0; }
        const converted = convertEventLines(lines, bridge.state);
        bridge.offset += consumed;
        const body = converted.length ? converted.join('\n') + '\n' : '';
        await fs.promises.mkdir(path.dirname(bridge.mainFile), { recursive: true });
        if (!bridge.ready) {
            // First pass this run: keep an identical existing prefix (readers' cursors stay valid), else rewrite.
            const existing = await fs.promises.readFile(bridge.mainFile, 'utf8').catch(() => '');
            bridge.ready = true;
            if (body.startsWith(existing)) {
                if (body.length > existing.length) { await fs.promises.appendFile(bridge.mainFile, body.slice(existing.length)); }
            } else {
                await fs.promises.writeFile(bridge.mainFile, body);
            }
            return converted.length;
        }
        if (body) { await fs.promises.appendFile(bridge.mainFile, body); }
        return converted.length;
    }
}
