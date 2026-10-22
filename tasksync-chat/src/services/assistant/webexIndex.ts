import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { webexGet } from './webexResolver';
import type { WebexGetDeps } from './webexResolver';

/**
 * The Webex digest index (spec 009 US9, FR-046..050, ADR 0037): rooms, last activity, the reviewer's own posts, mentions of him
 * and replies to his threads, kept in module memory and filled by ONE sync. Every caller in this process (every workspace)
 * reads the same state, so two workspaces trigger one sync. Message text lives in memory only; nothing here writes it to disk.
 * Webex has no read receipts: the reviewer's own posts and mentions of him are the proxy for "seen".
 */

export const DEFAULT_FRESHNESS_MS = 10 * 60_000;
export const DEFAULT_QUIET_MS = 183 * 86_400_000; // about six months
export const DEFAULT_WINDOW_MS = 7 * 86_400_000;
const ROOMS_MAX = 100;
const ROWS_PER_ROOM = 50;
const PARALLEL = 5;
const TEXT_MAX = 500;

export interface IndexedMessage { id: string; roomId: string; parentId?: string; personId?: string; personEmail?: string; created: string; createdMs: number; text: string; mine: boolean; mentionsMe: boolean }
export interface IndexedRoom { id: string; title: string; type: string; lastActivity: string; rows: IndexedMessage[] }
export interface IndexSnapshot { at: number; meId: string; meName: string; rooms: Map<string, IndexedRoom> }

export interface DigestOptions { now: number; quietMs?: number; windowMs?: number; muted?: Set<string> }
export interface DigestEntry { room: IndexedRoom; row: IndexedMessage; parent?: IndexedMessage }
export interface Digest {
    syncedAt: number; mentions: DigestEntry[]; replies: DigestEntry[]; unanswered: DigestEntry[];
    /** Quiet or muted spaces that had nothing the reviewer must see. */
    skipped: number;
}

let state: IndexSnapshot | undefined;
let inflight: Promise<boolean> | undefined;

/** Forget everything (tests, sign-out). */
export function resetWebexIndex(): void { state = undefined; inflight = undefined; }
export function webexIndexSnapshot(): IndexSnapshot | undefined { return state; }

async function sync(deps: WebexGetDeps, now: number, quietMs: number): Promise<void> {
    const me = await webexGet(deps, '/people/me');
    const meId = String(me.id ?? '');
    const roomRows: any[] = ((await webexGet(deps, `/rooms?sortBy=lastactivity&max=${ROOMS_MAX}`)).items ?? [])
        .filter((row: any) => typeof row.id === 'string' && typeof row.title === 'string');
    const rooms = new Map<string, IndexedRoom>();
    const loaded: IndexedRoom[] = roomRows.map(row => ({ id: row.id, title: String(row.title), type: String(row.type ?? 'group'), lastActivity: String(row.lastActivity ?? ''), rows: [] }));
    // A space idle for longer than the quiet limit cannot hold anything recent: it is not fetched.
    const toFetch = loaded.filter(room => !(Date.parse(room.lastActivity) < now - quietMs));
    for (let index = 0; index < toFetch.length; index += PARALLEL) {
        await Promise.all(toFetch.slice(index, index + PARALLEL).map(async room => {
            try {
                const data = await webexGet(deps, `/messages?roomId=${encodeURIComponent(room.id)}&max=${ROWS_PER_ROOM}`);
                room.rows = (data.items ?? []).filter((row: any) => typeof row.id === 'string' && typeof row.created === 'string' && Number.isFinite(Date.parse(row.created)))
                    .map((row: any): IndexedMessage => ({
                        id: row.id, roomId: room.id, parentId: typeof row.parentId === 'string' ? row.parentId : undefined, personId: row.personId, personEmail: row.personEmail,
                        created: row.created, createdMs: Date.parse(row.created), text: String(row.text ?? row.markdown ?? '').slice(0, TEXT_MAX),
                        mine: !!meId && row.personId === meId, mentionsMe: !!meId && Array.isArray(row.mentionedPeople) && row.mentionedPeople.includes(meId),
                    }));
            } catch { /* One unreadable space must not stop the sync. */ }
        }));
    }
    for (const room of loaded) { rooms.set(room.id, room); }
    state = { at: now, meId, meName: String(me.displayName ?? 'You'), rooms };
}

/** Runs the one sync when the index is missing or older than the freshness limit; concurrent callers share it. Resolves true when it synced. */
export async function ensureWebexIndex(deps: WebexGetDeps, opts: { now: number; freshnessMs?: number; quietMs?: number }): Promise<boolean> {
    if (state && opts.now - state.at < (opts.freshnessMs ?? DEFAULT_FRESHNESS_MS)) { return false; }
    if (!inflight) {
        inflight = sync(deps, opts.now, opts.quietMs ?? DEFAULT_QUIET_MS).then(() => true).finally(() => { inflight = undefined; });
    }
    return inflight;
}

export const DEFAULT_MUTE_FILE = path.join(os.homedir(), '.askaway', 'webex-mute.json');
/** The reviewer's mute list: space names only, `{ "spaces": ["Name", ...] }`. A missing or unreadable file means nothing is muted. */
export function readMuteList(file: string = DEFAULT_MUTE_FILE): Set<string> {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const names: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.spaces) ? parsed.spaces : [];
        return new Set(names.filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase()).filter(Boolean));
    } catch { return new Set(); }
}

/** The digest, built from memory on demand. Mentions, replies to his threads and (unmuted) direct messages in the window always show; a quiet or muted space is otherwise skipped. */
export function buildDigest(opts: DigestOptions): Digest | undefined {
    if (!state) { return undefined; }
    const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS, windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS, muted = opts.muted ?? new Set<string>();
    const inWindow = (row: IndexedMessage) => opts.now - row.createdMs <= windowMs;
    const out: Digest = { syncedAt: state.at, mentions: [], replies: [], unanswered: [], skipped: 0 };
    for (const room of state.rooms.values()) {
        const rows = [...room.rows].sort((a, b) => b.createdMs - a.createdMs);
        const mine = rows.filter(row => row.mine);
        const lastOwn = mine[0]?.createdMs ?? -Infinity;
        const idle = rows.length === 0 && Date.parse(room.lastActivity) < opts.now - quietMs;
        // Quiet: nothing posted by him, and no mention older than the window, inside the quiet limit. A fresh mention is shown, not counted as activity.
        const olderMention = rows.some(row => !row.mine && row.mentionsMe && !inWindow(row) && opts.now - row.createdMs <= quietMs);
        const quiet = idle || (opts.now - lastOwn > quietMs && !olderMention);
        const isMuted = muted.has(room.title.trim().toLowerCase());
        const byId = new Map(rows.map(row => [row.id, row]));
        let shown = 0;
        for (const row of rows) {
            if (row.mine || !inWindow(row)) { continue; }
            const answered = lastOwn > row.createdMs;
            const parent = row.parentId ? byId.get(row.parentId) : undefined;
            if (row.mentionsMe && !answered) { out.mentions.push({ room, row, parent }); shown++; }
            else if (parent?.mine && !answered) { out.replies.push({ room, row, parent }); shown++; }
        }
        const last = rows[0];
        if (room.type === 'direct' && last && !last.mine && !isMuted && (!quiet || inWindow(last))) { out.unanswered.push({ room, row: last }); shown++; }
        if ((quiet || isMuted) && shown === 0) { out.skipped++; }
    }
    const newestFirst = (a: DigestEntry, b: DigestEntry) => b.row.createdMs - a.row.createdMs;
    out.mentions.sort(newestFirst); out.replies.sort(newestFirst); out.unanswered.sort(newestFirst);
    return out;
}
