import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ToolDefinition } from '../workers/workerTools';
import { ID_ARGUMENT_MESSAGE, looksLikeWebexId } from './assistant/provider';
import type { AssistantCandidate, AssistantProvider } from './assistant/provider';
import { createWebexRead, webexReadTools } from './assistant/webexRead';
import type { WebexReadDeps } from './assistant/webexRead';
import { createWebexActions } from './assistant/webexActions';
import type { WebexActionDeps } from './assistant/webexActions';
import { scrubIds } from './assistant/webexResolver';
import type { WebexResponse } from './assistant/webexResolver';
import { editDraft } from './webexDrafts';

/**
 * Cathy's Webex tools (spec 009 US8, contract assistant-tools.md): twelve strict tools that take names, never ids.
 * Six read tools come from webexRead.ts; the outbound tools queue approval cards through webexActions.ts, so a send, reply, edit,
 * delete or upload runs only after the reviewer's 👍 in AITalk. The host adds `modalFallback` only for when AITalk is unavailable.
 */
export interface WebexSuiteDeps extends Omit<WebexReadDeps, 'request'> {
    request(method: string, endpoint: string, body?: unknown): Promise<WebexResponse>;
    uploadFiles?: WebexActionDeps['uploadFiles'];
    modalFallback?: WebexActionDeps['modalFallback'];
}

const text = z.string().min(1).max(7000);
/** Tools take names and short refs; a raw Webex id as an argument is refused with a plain message (R-CATHY-03). */
const name = z.string().trim().min(1).max(200).refine(value => !looksLikeWebexId(value), { message: ID_ARGUMENT_MESSAGE });
const draftId = z.string().min(1).max(100);
/** The draft id is AskAway's own uuid the model must hand back; it is not a Webex id, so it passes through the id scrub. */
const finish = (result: Record<string, unknown>) => {
    const { draftId: id, ...rest } = result;
    return { ...scrubIds(rest), ...(typeof id === 'string' ? { draftId: id } : {}) };
};

function buildWebexSuite(deps: WebexSuiteDeps) {
    const read = createWebexRead(deps as WebexReadDeps);
    const actions = createWebexActions({ resolver: read.resolver, request: deps.request, uploadFiles: deps.uploadFiles, modalFallback: deps.modalFallback });
    const outbound = (toolName: string, description: string, inputSchema: z.ZodObject<any>, run: (args: any) => Promise<Record<string, unknown>> | Record<string, unknown>): ToolDefinition => ({
        name: toolName, description: `${description} Sends nothing by itself: the reviewer approves a card in AITalk first. Names only; no secrets.`, inputSchema,
        run: async (input: unknown) => {
            const parsed = inputSchema.safeParse(input);
            if (!parsed.success) { return { status: 'invalid', message: parsed.error.issues.some(issue => issue.message === ID_ARGUMENT_MESSAGE) ? ID_ARGUMENT_MESSAGE : 'Those tool arguments are not valid.' }; }
            try { return finish(await run(parsed.data)); } catch { return { status: 'error', message: 'Webex request failed.' }; }
        },
    });
    const styleCard: ToolDefinition = {
        name: 'webex_style_card', description: "The reviewer's writing style card for Webex drafts (empty on a fresh workspace).", inputSchema: z.object({}).strict(),
        run: async (input: unknown) => {
            if (!z.object({}).strict().safeParse(input).success) { return { status: 'invalid', message: 'Those tool arguments are not valid.' }; }
            // A missing card is normal on a fresh workspace: the worker then writes plainly instead of failing.
            const card = await fs.readFile(path.join(deps.cacheDir, 'style-card.md'), 'utf8').catch(() => '');
            return card ? { status: 'ok', text: card.split('\n').slice(0, 40).join('\n') } : { status: 'ok', text: '', note: 'No style card yet; write short, plain replies.' };
        },
    };
    const tools: ToolDefinition[] = [
        ...webexReadTools(deps as WebexReadDeps, read),
        outbound('webex_send', 'Queue a message to a space or person by name, optionally in a thread (a message ref) or with files. Returns pending with a draftId.',
            z.object({ to: name, text, thread: name.optional(), files: z.array(z.string().min(1).max(1000)).max(10).optional() }).strict(), args => actions.send(args)),
        outbound('webex_reply', 'Queue a reply to a message ref, or to "latest from <person> in <space>". Returns pending with a draftId.',
            z.object({ to: name, text }).strict(), args => actions.reply(args)),
        outbound('webex_edit_message', 'Queue an edit of one of your own messages (a message ref). Others\' messages are refused.',
            z.object({ ref: name, text }).strict(), args => actions.editMessage(args)),
        outbound('webex_delete_message', 'Queue the deletion of one of your own messages (a message ref). Others\' messages are refused.',
            z.object({ ref: name }).strict(), args => actions.deleteMessage(args)),
        outbound('webex_edit_draft', 'Change the text of a pending draft by its draftId. The old approval is void and the card asks again.',
            z.object({ draftId, text }).strict(), args => editDraft(args.draftId, args.text)),
        styleCard,
    ];
    return { tools, read };
}

export function webexSuiteTools(deps: WebexSuiteDeps): ToolDefinition[] { return buildWebexSuite(deps).tools; }

/** Webex as one provider behind the shared assistant seam (R-CATHY-07): the host registers it; Outlook can follow beside it. */
export function createWebexProvider(deps: WebexSuiteDeps): AssistantProvider {
    const { tools, read } = buildWebexSuite(deps);
    return {
        id: 'webex', label: 'Webex', tools: () => tools,
        resolve: async (query: string, kind?: string): Promise<AssistantCandidate[]> => {
            const found: AssistantCandidate[] = [];
            if (kind !== 'person') { found.push(...(await read.resolver.spaceCandidates(query)).map(({ ref, label, kind: type }) => ({ ref, label, kind: type }))); }
            if (kind !== 'space') {
                for (const person of await read.resolver.searchPeople(query)) { if (person.status === 'ok') { found.push({ ref: person.ref, label: person.label, kind: 'person' }); } }
            }
            return found;
        },
    };
}
