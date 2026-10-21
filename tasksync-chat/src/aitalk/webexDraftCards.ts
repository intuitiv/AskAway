import { randomUUID } from 'crypto';
import { roomFor } from './actors';
import type { Room } from './actors';
import { currentAITalkCaller } from './delivery';
import { approveDraft, registerWebexDraftHook, rejectDraft, restoreWebexDraft, setWebexDraftRouting, WebexDraft, WebexDraftEvent } from '../services/webexDrafts';

/** Card author when no worker's MCP call is running. */
export const WEBEX_DRAFT_AUTHOR = 'webex';
export type DraftCardState = 'pending' | 'sent' | 'failed' | 'rejected';
const cardText = (draft: Readonly<WebexDraft>) =>
    `Draft · Webex to ${draft.recipientLabel}${draft.parentId ? ' (thread reply)' : ''}\n\n${draft.text}`;
const outcomeText: Record<Exclude<DraftCardState, 'pending'>, (draft: any) => string> = {
    sent: draft => `👍 Approved: sent to ${draft.recipientLabel} · id ${draft.sentId}`,
    failed: draft => `👍 Approved, but Webex did not confirm the send to ${draft.recipientLabel}.`,
    rejected: draft => `👎 Rejected: nothing was sent to ${draft.recipientLabel}.`,
};

/**
 * Webex drafts in AITalk: each queued draft is posted by its worker as a draft card (recipient + full text);
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
    return () => {
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
    const settle = (event: WebexDraftEvent) => {
        const card = cards().find((message: any) => message.draftId === event.id);
        if (!card) return;
        if (event.status === 'edited') {
            room.store.update(card.id, { draftId: event.nextId, text: cardText(event.draft), webexDraft: { ...event.draft, state: 'pending', edited: (card.webexDraft.edited ?? 0) + 1 } });
            return;
        }
        const webexDraft = { ...card.webexDraft, state: event.status, ...(event.status === 'sent' ? { sentId: String(event.result?.id ?? '') } : {}) };
        room.store.update(card.id, { draftId: '', webexDraft });
        room.userPost(outcomeText[event.status](webexDraft), card.id);
    };
    registerWebexDraftHook(async draft => {
        const draftId = randomUUID();
        room.workerPost(author() || WEBEX_DRAFT_AUTHOR, cardText(draft), { kind: 'webexDraft', fields: { draftId, webexDraft: { ...draft, state: 'pending' } } });
        return draftId;
    }, settle, room.workspace, primary);
    // Only the user's reaction is permission; the card's current draftId is the one that can be approved.
    const user = room.store.snapshot().members.find((member: any) => member.kind === 'user')?.id;
    const decided = new Set<string>();
    const stop = room.onReaction((message: any, emoji, by) => {
        const card = cards().find((item: any) => item.id === message.id);
        if (by !== user || !card?.draftId || card.webexDraft.state !== 'pending') return;
        if (emoji !== '👍' && emoji !== '👎') return;
        // The draft may have been queued in another window's process (the MCP server owner): this room's card is the source.
        // A draft decided here is never restored again, so a second click cannot send it twice.
        if (!decided.has(card.draftId)) restore(card);
        decided.add(card.draftId);
        if (emoji === '👍') void approveDraft(card.draftId);
        else rejectDraft(card.draftId);
    });
    return () => { stop(); registerWebexDraftHook(undefined, undefined, room.workspace); };
}
