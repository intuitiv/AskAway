import { randomUUID } from 'crypto';
import { roomFor } from './actors';
import type { Room } from './actors';
import { currentAITalkCaller } from './delivery';
import { looksLikeWebexId, setApprovalHandler } from '../services/assistant/provider';
import type { ApprovalHandler } from '../services/assistant/provider';
import { approveDraft, humanDraft, queueApprovalDraft, registerWebexDraftHook, rejectDraft, restoreWebexDraft, setWebexDraftRouting, WebexDraft, WebexDraftEvent } from '../services/webexDrafts';

/** Card author when no worker's MCP call is running. */
export const WEBEX_DRAFT_AUTHOR = 'webex';
export type DraftCardState = 'pending' | 'sent' | 'failed' | 'rejected';
const providerName = (draft: Readonly<WebexDraft>) => { const id = draft.provider ?? 'webex'; return id.charAt(0).toUpperCase() + id.slice(1); };
/** The card text for any provider and action: provider, action, target NAME, thread and other details, files, then the full text. Never an id. */
export const cardText = (draft: Readonly<WebexDraft>) => {
    if (!draft.provider) { return `Draft · Webex to ${draft.recipientLabel}${draft.threaded || draft.parentId ? ' (thread reply)' : ''}\n\n${draft.text}`; }
    const details = Object.entries(draft.details ?? {}).map(([key, value]) => `${key}: ${value}`);
    const lines = [`Draft · ${providerName(draft)} ${draft.action} · ${draft.recipientLabel}`, ...details, ...(draft.files?.length ? [`Files: ${draft.files.join(', ')}`] : []),
        ...(draft.unresolved ? ['The name is not resolved yet, so this cannot be sent.'] : [])];
    return `${lines.join('\n')}\n\n${draft.text}`;
};
const doneText: Record<string, string> = { send: 'sent to', reply: 'sent to', upload: 'sent to', edit: 'edited your message in', delete: 'deleted your message in' };
const outcomeText: Record<Exclude<DraftCardState, 'pending'>, (draft: any) => string> = {
    sent: draft => draft.provider ? `👍 Approved: ${doneText[draft.action] ?? `${draft.action} done for`} ${draft.recipientLabel}.` : `👍 Approved: sent to ${draft.recipientLabel}${draft.sentId ? ` · id ${draft.sentId}` : ''}`,
    failed: draft => `👍 Approved, but ${providerName(draft)} did not confirm ${draft.provider ? `the ${draft.action} for` : 'the send to'} ${draft.recipientLabel}.`,
    rejected: draft => `👎 Rejected: nothing was ${draft.provider ? 'done' : 'sent'} ${draft.provider ? 'for' : 'to'} ${draft.recipientLabel}.`,
};

/**
 * The one approval card for any provider and action (R-CATHY-05): each queued request is posted by its worker as a draft card
 * (provider, action, target name, thread, files, full text) and registered as the `setApprovalHandler` implementation;
 * the user's 👍 is the permission that sends it once, 👎 discards it, an edit voids the old approval and asks again,
 * and the outcome is the reply to the worker's card. Pending cards return to the draft queue after a reload.
 *
 * The MCP server is shared by every VS Code window, so a card goes to the room of the workspace that owns the calling
 * worker (`callerWorkspace`); a workspace without a hook yet gets its room opened on the first draft, and an unknown
 * caller uses `room`, the server owner's room.
 */
export function connectWebexDrafts(room: Room, author: () => string | undefined = () => undefined, callerWorkspace: () => string | undefined = () => currentAITalkCaller()?.workspace): () => void {
    const attached = new Map<string, () => void>();
    setWebexDraftRouting(callerWorkspace, workspace => {
        if (!attached.has(workspace)) attached.set(workspace, attachRoom(roomFor(workspace), author, false));
    });
    const stopOwner = attachRoom(room, author, true);
    const handler: ApprovalHandler = async req => {
        const queued = await queueApprovalDraft(req);
        return queued ? queued.outcome : { status: 'unavailable' };
    };
    setApprovalHandler(handler);
    return () => {
        setApprovalHandler();
        stopOwner();
        for (const stop of attached.values()) stop();
        attached.clear();
        setWebexDraftRouting();
    };
}

function attachRoom(room: Room, author: () => string | undefined, primary: boolean): () => void {
    const cards = () => room.store.snapshot(true).messages.filter((message: any) => message.webexDraft);
    // A pending card returns to this process's queue; the room that holds the card settles it, wherever the draft was queued.
    const restore = (card: any) => {
        const { state: _state, edited: _edited, ...draft } = card.webexDraft;
        restoreWebexDraft(card.draftId, draft, room.workspace);
    };
    for (const card of cards()) {
        if (card.webexDraft.state === 'pending' && card.draftId) restore(card);
    }
    // A card that is gone or already settled no longer holds its worker in the room.
    room.releaseAnswered();
    const settle = (event: WebexDraftEvent) => {
        const card = cards().find((message: any) => message.draftId === event.id);
        if (!card) return;
        if (event.status === 'edited') {
            room.store.update(card.id, { draftId: event.nextId, text: cardText(event.draft), webexDraft: { ...event.draft, state: 'pending', edited: (card.webexDraft.edited ?? 0) + 1 } });
            return;
        }
        const webexDraft = { ...card.webexDraft, state: event.status, ...(event.status === 'sent' && !card.webexDraft.provider && !looksLikeWebexId(String(event.result?.id ?? '')) ? { sentId: String(event.result?.id ?? '') } : {}) };
        room.store.update(card.id, { draftId: '', webexDraft });
        room.userPost(outcomeText[event.status](webexDraft), card.id);
    };
    registerWebexDraftHook(async draft => {
        const draftId = randomUUID();
        // The stored card (and so the webview snapshot) holds human fields only; raw ids stay in the host-only side store (webexDrafts).
        const shown = humanDraft(draft);
        room.workerPost(author() || WEBEX_DRAFT_AUTHOR, cardText(shown), { kind: 'webexDraft', fields: { draftId, webexDraft: { ...shown, state: 'pending' } } });
        return draftId;
    }, settle, room.workspace, primary);
    // Only the user's reaction is permission; the card's current draftId is the one that can be approved.
    const user = room.store.snapshot().members.find((member: any) => member.kind === 'user')?.id;
    const claimPrefix = (draftId: string) => `decision:${draftId}:`;
    /**
     * Decide-once in the shared store: the claim is appended to the card's log BEFORE the draft runs, and the first live claim for this
     * draftId in the log wins, so two handlers (two windows, two processes) on one store cannot both run it.
     */
    const claim = (card: any, emoji: string): string | undefined => {
        const key = `${claimPrefix(card.draftId)}${randomUUID().slice(0, 8)}`;
        room.store.update(card.id, { [key]: emoji });
        const fresh: any = cards().find((item: any) => item.id === card.id);
        const first = Object.entries(fresh ?? {}).find(([name, value]) => name.startsWith(claimPrefix(card.draftId)) && value);
        return first?.[0] === key ? key : undefined;
    };
    const decide = async (card: any, emoji: string) => {
        const key = claim(card, emoji);
        if (!key) return;
        try {
            // The draft may have been queued in another window's process (the MCP server owner): this room's card is the source.
            restore(card);
            const result = emoji === '👍' ? await approveDraft(card.draftId) : rejectDraft(card.draftId);
            // Nothing ran (no executor here, or the name is unresolved): the card stays pending and can be decided again.
            if (result.status === 'unavailable' || result.status === 'unresolved') room.store.update(card.id, { [key]: null });
        } catch { room.store.update(card.id, { [key]: null }); }
    };
    // A bare reaction carries no draftId, so it cannot prove which text the reviewer read: after an edit it is refused and the card
    // is shown again with the new text; the card's own Send button carries the draftId and approves the edited text.
    const reshow = (card: any) => room.store.update(card.id, { text: card.text, webexDraft: { ...card.webexDraft } });
    const stop = room.onReaction((message: any, emoji, by) => {
        const card = cards().find((item: any) => item.id === message.id);
        if (by !== user || !card?.draftId || card.webexDraft.state !== 'pending') return;
        if (emoji !== '👍' && emoji !== '👎') return;
        if (emoji === '👍' && card.webexDraft.edited) { reshow(card); return; }
        void decide(card, emoji);
    });
    return () => { stop(); registerWebexDraftHook(undefined, undefined, room.workspace); };
}
