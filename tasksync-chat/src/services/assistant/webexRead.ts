import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { ToolDefinition } from '../../workers/workerTools';
import { ID_ARGUMENT_MESSAGE, looksLikeWebexId } from './provider';
import { ensureWebexIndex, buildDigest, readMuteList, DEFAULT_FRESHNESS_MS, DEFAULT_QUIET_MS, DEFAULT_WINDOW_MS } from './webexIndex';
import type { DigestEntry } from './webexIndex';
import { WebexResolver, ResolverDeps, webexGet, plainWords, scrubIds, Resolved } from './webexResolver';

/**
 * The read side of Cathy's tools (spec 009 US8, contract assistant-tools.md section 3): one call does what chains did.
 * Names in, names and short refs out; every result passes `scrubIds`, so a raw Webex id cannot reach the model.
 */

export interface WebexReadDeps extends ResolverDeps {
    download(url: string): Promise<{ bytes: Buffer; name: string }>;
    extract?(file: string): Promise<string>;
    cacheDir: string;
    sleep?(ms: number): Promise<void>;
    /** Digest tuning (spec 009 US9): freshness limit, six-month quiet limit, report window, and the mute list file (names only). */
    digest?: { freshnessMs?: number; quietMs?: number; windowMs?: number; muteFile?: string };
}

const CREDENTIAL = /\b(?:Bearer\s+\S+|(?:access_token|refresh_token|client_secret)\s*[:=]\s*\S+)/gi;
const clean = (value: unknown, max = 1500) => String(value ?? '').replace(CREDENTIAL, '[redacted]').slice(0, max);
const clamp = (value: number | undefined, fallback = 20) => Math.min(Math.max(value ?? fallback, 1), 50);
const MAX_FILES_PER_READ = 5;
const MAX_SEARCH_SPACES = 10;
const MAX_MATCHES = 30;
const DAY_MS = 86_400_000;

interface Target { label: string; ref: string; roomId?: string; personId?: string; parentId?: string }
type Failure = Exclude<Resolved, { status: 'ok' }> | { status: 'invalid' | 'unauthorized' | 'busy' | 'error' | 'disabled' | 'not_found'; message?: string };
const isFailure = (value: Target | Failure): value is Failure => 'status' in value;

export function createWebexRead(deps: WebexReadDeps) {
    const resolver = new WebexResolver(deps);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

    async function target(args: { space?: string; person?: string; thread?: string }): Promise<Target | Failure> {
        let found: Target | undefined;
        if (args.thread) {
            const message = await resolver.message(args.thread);
            if (message.status !== 'ok') { return message; }
            const space = message.space as Extract<Resolved, { status: 'ok' }>;
            found = { label: space.label, ref: space.ref, roomId: space._internal.id, parentId: message.rootId };
        }
        if (args.space) {
            const space = await resolver.space(args.space);
            if (space.status !== 'ok') { return space; }
            if (found && found.roomId !== space._internal.id) { return { status: 'invalid', message: `That thread is not in ${space.label}.` }; }
            found = found ?? { label: space.label, ref: space.ref, roomId: space._internal.id };
        } else if (args.person && !found) {
            const person = await resolver.person(args.person);
            if (person.status !== 'ok') { return person; }
            found = { label: person.label, ref: person.ref, personId: person._internal.id };
        }
        return found ?? { status: 'invalid', message: 'Give a space, a person or a thread.' };
    }

    async function fetchRows(t: Target, max: number): Promise<any[]> {
        const params = new URLSearchParams({ max: String(max) });
        if (t.roomId) {
            params.set('roomId', t.roomId);
            if (t.parentId) { params.set('parentId', t.parentId); }
        } else { params.set('personId', t.personId ?? ''); }
        const data = await webexGet(deps, `${t.roomId ? '/messages' : '/messages/direct'}?${params}`);
        return (data.items ?? []).filter((row: any) => typeof row.id === 'string' && typeof row.created === 'string');
    }
    const byTime = (a: any, b: any) => Date.parse(a.created) - Date.parse(b.created);

    async function attachments(urls: string[], budget: { left: number }) {
        const files: Array<{ name: string; text?: string; path?: string; note?: string }> = [];
        for (const url of urls) {
            if (budget.left <= 0) { files.push({ name: 'attachment', note: 'not downloaded: file limit per read reached' }); continue; }
            budget.left -= 1;
            try {
                const parsed = new URL(url);
                if (parsed.protocol !== 'https:' || parsed.hostname !== 'webexapis.com' || !parsed.pathname.startsWith('/v1/contents/')) {
                    files.push({ name: 'attachment', note: 'skipped: unexpected download address' });
                    continue;
                }
                const file = await deps.download(url);
                const name = clean(path.basename(file.name), 120);
                const extension = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
                await fs.mkdir(deps.cacheDir, { recursive: true });
                const target = path.join(deps.cacheDir, `att-${randomBytes(4).toString('hex')}${extension}`);
                await fs.writeFile(target, file.bytes, { mode: 0o600 });
                const entry: { name: string; text?: string; path?: string; note?: string } = { name, path: target };
                if (['.txt', '.md'].includes(extension)) { entry.text = clean(file.bytes.toString('utf8'), 6000); }
                else if (['.pdf', '.docx'].includes(extension) && deps.extract) {
                    try { entry.text = clean(await deps.extract(target), 6000); } catch { entry.note = 'text could not be extracted; the file is saved'; }
                } else { entry.note = 'saved; text not extracted'; }
                files.push(entry);
            } catch { files.push({ name: 'attachment', note: 'could not be downloaded' }); }
        }
        return files;
    }

    async function shape(rows: any[], spaceLabel: string, includeFiles: boolean) {
        const me = await resolver.me();
        await resolver.loadNames(rows.map(row => row.personId));
        const ordered = [...rows].sort(byTime);
        const refs = new Map<string, string>();
        for (const row of ordered) {
            const mine = row.personId === me.id;
            refs.set(row.id, (resolver.rememberMessage(row, spaceLabel, mine ? me.name : resolver.authorName(row), mine) as Extract<Resolved, { status: 'ok' }>).ref);
        }
        const budget = { left: MAX_FILES_PER_READ };
        const messages = [];
        for (const row of ordered) {
            const files: string[] = Array.isArray(row.files) ? row.files.filter((item: unknown) => typeof item === 'string') : [];
            messages.push({
                ref: refs.get(row.id),
                author: row.personId === me.id ? me.name : resolver.authorName(row),
                time: row.created,
                text: clean(row.text ?? row.markdown),
                ...(row.personId === me.id ? { fromMe: true } : {}),
                ...(row.parentId ? { threadOf: refs.get(row.parentId) ?? resolver.messageRef(row.parentId, row.roomId, spaceLabel) } : {}),
                ...(Array.isArray(row.mentionedPeople) && row.mentionedPeople.includes(me.id) ? { mentionsMe: true } : {}),
                ...(files.length ? (includeFiles ? { files: await attachments(files, budget) } : { fileCount: files.length }) : {}),
            });
        }
        return messages;
    }

    const newest = (rows: any[]) => rows.reduce((best, row) => !best || Date.parse(row.created) > Date.parse(best.created) ? row : best, undefined as any);

    async function read(args: { space?: string; person?: string; thread?: string; since?: string; limit?: number; includeFiles?: boolean }) {
        try {
            const t = await target(args);
            if (isFailure(t)) { return t; }
            const limit = clamp(args.limit);
            const rows = await fetchRows(t, limit);
            const fresh = rows.filter(row => !args.since || Date.parse(row.created) > Date.parse(args.since));
            const all = [...fresh];
            if (t.parentId && !all.some(row => row.id === t.parentId)) {
                const root = await webexGet(deps, `/messages/${encodeURIComponent(t.parentId)}`).catch(() => undefined);
                if (root?.id) { all.push(root); }
            }
            const messages = await shape(all, t.label, args.includeFiles !== false);
            if (!args.thread) {
                const latest = newest(rows);
                if (latest) { resolver.markSeen(t.roomId ?? latest.roomId, latest.created); }
            }
            return { status: 'ok', conversation: t.label, conversationRef: t.ref, messages, hasMore: rows.length >= limit };
        } catch (error) { return plainWords(error, 'read those messages'); }
    }

    /** The daily report from the in-memory index (FR-046..050): read-only, names and short refs, never ids. */
    async function digest(args: { since?: string; limit?: number }) {
        const options = deps.digest ?? {};
        const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
        const now = resolver.now();
        const synced = await ensureWebexIndex(deps, { now, freshnessMs: options.freshnessMs ?? DEFAULT_FRESHNESS_MS, quietMs });
        const windowMs = args.since ? Math.max(now - Date.parse(args.since), 0) : options.windowMs ?? DEFAULT_WINDOW_MS;
        const built = buildDigest({ now, quietMs, windowMs, muted: readMuteList(options.muteFile) });
        if (!built) { return { status: 'error', message: 'Webex could not build the digest.' }; }
        const limit = clamp(args.limit);
        const me = await resolver.me();
        const sections = { mentions: built.mentions.slice(0, limit), replies: built.replies.slice(0, limit), unanswered: built.unanswered.slice(0, limit) };
        await resolver.loadNames([...sections.mentions, ...sections.replies, ...sections.unanswered].map(entry => entry.row.personId ?? ''));
        const shaped = ({ room, row, parent }: DigestEntry) => {
            const author = resolver.authorName(row);
            const ref = (resolver.rememberMessage({ id: row.id, roomId: row.roomId, parentId: row.parentId, personId: row.personId, created: row.created, text: row.text }, room.title, author, false) as Extract<Resolved, { status: 'ok' }>).ref;
            return { space: room.title, type: room.type === 'direct' ? 'direct' : 'group', ref, author, time: row.created, text: clean(row.text, 300),
                ...(parent ? { yourMessage: clean(parent.text, 120) } : {}) };
        };
        // Newest at the bottom, like every other feed.
        const ordered = (entries: DigestEntry[]) => entries.map(shaped).reverse();
        return {
            status: 'ok', mode: 'digest', for: me.name, syncedAt: new Date(built.syncedAt).toISOString(), freshSync: synced,
            mentions: ordered(sections.mentions), replies: ordered(sections.replies), unansweredDirect: ordered(sections.unanswered),
            skipped: `${built.skipped} quiet spaces skipped`,
            note: 'Read-only. Built from memory after one sync. Webex has no read receipts: your own posts and mentions of you stand in for "seen". Quiet or muted spaces are skipped, but a mention or a reply to your message always shows.',
        };
    }

    async function inbox(args: { unreadOnly?: boolean; mentionsOnly?: boolean; since?: string; limit?: number; mode?: 'list' | 'digest' }) {
        try {
            if (args.mode === 'digest') { return await digest(args); }
            const limit = clamp(args.limit);
            const me = await resolver.me();
            const baseline = resolver.now() - DAY_MS;
            const candidates = [];
            for (const room of await resolver.listRooms()) {
                if (args.since && !(Date.parse(room.lastActivity) > Date.parse(args.since))) { continue; }
                const mark = resolver.seen(room.id);
                const markMs = mark ? Date.parse(mark) : baseline;
                const hasNew = Date.parse(room.lastActivity) > markMs;
                if ((args.unreadOnly || args.mentionsOnly) && !hasNew) { continue; }
                candidates.push({ room, markMs });
                if (candidates.length >= limit) { break; }
            }
            const fetched: Array<{ room: typeof candidates[number]['room']; markMs: number; rows: any[] }> = [];
            for (let index = 0; index < candidates.length; index += 5) {
                fetched.push(...await Promise.all(candidates.slice(index, index + 5).map(async ({ room, markMs }) =>
                    ({ room, markMs, rows: await fetchRows({ label: room.title, ref: '', roomId: room.id }, 10) }))));
            }
            await resolver.loadNames(fetched.flatMap(item => item.rows.map(row => row.personId)));
            const spaces = [];
            for (const { room, markMs, rows } of fetched) {
                const last = newest(rows);
                if (!last) { continue; }
                const unseenRows = rows.filter(row => Date.parse(row.created) > markMs && row.personId !== me.id);
                const mentionsMe = unseenRows.some(row => Array.isArray(row.mentionedPeople) && row.mentionedPeople.includes(me.id));
                if (args.unreadOnly && !unseenRows.length) { continue; }
                if (args.mentionsOnly && !mentionsMe) { continue; }
                const space = resolver.rememberMessage(last, room.title, last.personId === me.id ? me.name : resolver.authorName(last), last.personId === me.id) as Extract<Resolved, { status: 'ok' }>;
                spaces.push({
                    space: room.title, ref: resolver.refForRoom(room), type: room.type === 'direct' ? 'direct' : 'group',
                    lastMessage: { ref: space.ref, author: last.personId === me.id ? me.name : resolver.authorName(last), time: last.created, text: clean(last.text ?? last.markdown, 300) },
                    mentionsMe, waitingOnMe: last.personId !== me.id, unseen: unseenRows.length,
                });
            }
            return { status: 'ok', spaces, note: "unseen and waitingOnMe are AskAway's view (Webex has no unread flag): unseen counts messages from others since AskAway last showed you that space, or in the last 24 hours if it never did." };
        } catch (error) { return plainWords(error, 'list your spaces'); }
    }

    async function find(args: { query: string; kind?: 'space' | 'person' }) {
        try {
            const spaces = args.kind === 'person' ? [] : await resolver.spaceCandidates(args.query);
            let people: unknown[] = [];
            let note: string | undefined;
            if (args.kind !== 'space') {
                try {
                    people = (await resolver.searchPeople(args.query)).filter((item): item is Extract<Resolved, { status: 'ok' }> => item.status === 'ok')
                        .map(item => ({ label: item.label, ref: item.ref, detail: item._internal.email, email: item._internal.email,
                            ...(item._internal.title ? { title: item._internal.title } : {}), ...(item._internal.presence ? { presence: item._internal.presence } : {}) }));
                } catch (error) {
                    if (!spaces.length) { throw error; }
                    note = plainWords(error, 'look people up').message;
                }
            }
            if (!spaces.length && !people.length) { return { status: 'not_found', query: args.query }; }
            return { status: 'ok', spaces, people, ...(note ? { note } : {}) };
        } catch (error) { return plainWords(error, 'look that up'); }
    }

    async function search(args: { query: string; space?: string; person?: string; since?: string }) {
        try {
            const wanted = args.query.trim().toLowerCase();
            const sources: Target[] = [];
            let owner: string | undefined;
            let scope: string;
            if (args.person) {
                const person = await resolver.person(args.person);
                if (person.status !== 'ok') { return person; }
                if (args.space) { owner = person._internal.id; }
                else { sources.push({ label: person.label, ref: person.ref, personId: person._internal.id }); }
            }
            if (args.space) {
                const space = await resolver.space(args.space);
                if (space.status !== 'ok') { return space; }
                sources.push({ label: space.label, ref: space.ref, roomId: space._internal.id });
                scope = 'the last 50 messages of that space';
            } else if (args.person) { scope = 'the last 50 messages of your direct conversation with that person'; }
            else {
                for (const room of (await resolver.listRooms()).slice(0, MAX_SEARCH_SPACES)) { sources.push({ label: room.title, ref: '', roomId: room.id }); }
                scope = `the last 50 messages in each of your ${sources.length} most recently active spaces`;
            }
            const hits: Array<{ row: any; label: string }> = [];
            for (const source of sources) {
                for (const row of await fetchRows(source, 50)) {
                    if (!String(row.text ?? row.markdown ?? '').toLowerCase().includes(wanted)) { continue; }
                    if (args.since && !(Date.parse(row.created) > Date.parse(args.since))) { continue; }
                    if (owner && row.personId !== owner) { continue; }
                    hits.push({ row, label: source.label });
                }
            }
            hits.sort((a, b) => byTime(a.row, b.row));
            const kept = hits.slice(-MAX_MATCHES);
            await Promise.all([resolver.me(), resolver.loadNames(kept.map(hit => hit.row.personId))]);
            const me = await resolver.me();
            const matches = kept.map(({ row, label }) => {
                const author = row.personId === me.id ? me.name : resolver.authorName(row);
                return { space: label, author, time: row.created, text: clean(row.text ?? row.markdown, 500),
                    ref: (resolver.rememberMessage(row, label, author, row.personId === me.id) as Extract<Resolved, { status: 'ok' }>).ref };
            });
            return { status: 'ok', matches, scope, hasMore: hits.length > kept.length };
        } catch (error) { return plainWords(error, 'search messages'); }
    }

    async function wait(args: { space?: string; person?: string; thread?: string; sinceRef?: string; timeoutSeconds: number }) {
        try {
            const t = await target(args);
            if (isFailure(t)) { return t; }
            let baseline = resolver.now();
            if (args.sinceRef) {
                const since = await resolver.message(args.sinceRef);
                if (since.status !== 'ok') { return since; }
                if (since.created) { baseline = Date.parse(since.created); }
            }
            const me = await resolver.me();
            const deadline = resolver.now() + Math.min(Math.max(args.timeoutSeconds, 1), 120) * 1000;
            let delay = 2000;
            for (;;) {
                const rows = await fetchRows(t, 20);
                const fresh = rows.filter(row => Date.parse(row.created) > baseline && row.personId !== me.id);
                if (fresh.length) {
                    const messages = await shape(fresh, t.label, true);
                    const latest = newest(fresh);
                    if (!args.thread) { resolver.markSeen(t.roomId ?? latest.roomId, latest.created); }
                    return { status: 'ok', conversation: t.label, conversationRef: t.ref, messages };
                }
                const left = deadline - resolver.now();
                if (left <= 0) { return { status: 'timeout', conversation: t.label, message: 'No new message arrived in time.' }; }
                await sleep(Math.min(delay, left));
                delay = Math.min(Math.round(delay * 1.5), 10_000);
            }
        } catch (error) { return plainWords(error, 'wait for messages'); }
    }

    async function meetings(args: { from?: string; to?: string; person?: string }) {
        try {
            let owner: Extract<Resolved, { status: 'ok' }> | undefined;
            if (args.person) {
                const person = await resolver.person(args.person);
                if (person.status !== 'ok') { return person; }
                owner = person;
            }
            const from = args.from ?? new Date(resolver.now()).toISOString();
            const to = args.to ?? new Date(resolver.now() + 7 * DAY_MS).toISOString();
            const params = new URLSearchParams({ from, to, meetingType: 'scheduledMeeting', max: '20' });
            let data: any;
            try { data = await webexGet(deps, `/meetings?${params}`); }
            catch (error) { return plainWords(error, 'read your meetings', 'meeting:schedules_read'); }
            const items: any[] = (data.items ?? []).filter((row: any) => typeof row.start === 'string').slice(0, 10);
            let note: string | undefined;
            const withPeople = await Promise.all(items.map(async row => {
                try {
                    const invitees = await webexGet(deps, `/meetingInvitees?meetingId=${encodeURIComponent(String(row.id))}&max=50`);
                    return { row, participants: (invitees.items ?? []).map((item: any) => clean(item.displayName ?? item.email, 120)).filter(Boolean) as string[] };
                } catch (error) {
                    note = plainWords(error, 'read meeting participants', 'meeting:schedules_read').message;
                    return { row, participants: undefined as string[] | undefined };
                }
            }));
            const wanted = owner ? [owner.label.toLowerCase(), String(owner._internal.email ?? '').toLowerCase()] : [];
            const kept = withPeople.filter(({ row, participants }) => !owner
                || wanted.includes(String(row.hostEmail ?? '').toLowerCase()) || wanted.includes(String(row.hostDisplayName ?? '').toLowerCase())
                || (participants ?? []).some(name => wanted.includes(name.toLowerCase())));
            return { status: 'ok', meetings: kept.map(({ row, participants }) => ({
                title: clean(row.title, 200), start: row.start, end: row.end, host: clean(row.hostDisplayName ?? row.hostEmail, 120),
                ...(participants ? { participants } : {}),
            })), ...(note ? { note } : {}) };
        } catch (error) { return plainWords(error, 'read your meetings', 'meeting:schedules_read'); }
    }

    return { resolver, inbox, digest, find, read, search, wait, meetings };
}

const name = z.string().trim().min(1).max(200).refine(value => !looksLikeWebexId(value), { message: ID_ARGUMENT_MESSAGE });
const invalidMessage = (error: z.ZodError) => error.issues.some(issue => issue.message === ID_ARGUMENT_MESSAGE) ? ID_ARGUMENT_MESSAGE : 'Those tool arguments are not valid.';
const when = z.string().datetime({ offset: true });
const limit = z.number().int().min(1).max(50);

/** The six read tools as shared ToolDefinitions. Pass the `api` the outbound actions share so refs from a read resolve there too; every result is scrubbed of ids on the way out. */
export function webexReadTools(deps: WebexReadDeps, api: ReturnType<typeof createWebexRead> = createWebexRead(deps)): ToolDefinition[] {
    const define = (toolName: string, description: string, inputSchema: z.ZodObject<any>, run: (args: any) => Promise<unknown>, check?: (args: any) => string | undefined): ToolDefinition => ({
        name: toolName, description, inputSchema,
        run: async (input: unknown) => {
            const parsed = inputSchema.safeParse(input);
            if (!parsed.success) { return { status: 'invalid', message: invalidMessage(parsed.error) }; }
            const problem = check?.(parsed.data);
            if (problem) { return { status: 'invalid', message: problem }; }
            try { return scrubIds(await run(parsed.data)); } catch { return scrubIds({ status: 'error', message: 'Webex request failed.' }); }
        },
    });
    const where = (args: any) => args.space || args.person || args.thread ? (args.space && args.person ? 'Give a space or a person, not both.' : undefined) : 'Give a space, a person or a thread.';
    return [
        define('webex_inbox', 'Spaces by name with the last message, mention flag and a waiting-on-me hint. Unread is AskAway\'s own view. mode "digest" is the daily report: mentions, replies to threads you sent and unanswered direct messages across everything you are in, quiet spaces skipped. Names only; read-only.',
            z.object({ mode: z.enum(['list', 'digest']).optional(), unreadOnly: z.boolean().optional(), mentionsOnly: z.boolean().optional(), since: when.optional(), limit: limit.optional() }).strict(), api.inbox),
        define('webex_find', 'Find spaces and people by name or email; people include title and presence when Webex returns them. Returns names and short refs; read-only.',
            z.object({ query: name, kind: z.enum(['space', 'person']).optional() }).strict(), api.find),
        define('webex_read', 'Read messages in a space or direct conversation by name in ONE call: authors, times, thread markers and attachment text. Creates nothing.',
            z.object({ space: name.optional(), person: name.optional(), thread: name.optional(), since: when.optional(), limit: limit.optional(), includeFiles: z.boolean().optional() }).strict(), api.read, where),
        define('webex_search', 'Search recent messages by text, optionally in one space or with one person. Says how far back it looked; read-only.',
            z.object({ query: name, space: name.optional(), person: name.optional(), since: when.optional() }).strict(), api.search),
        define('webex_wait', 'Wait up to timeoutSeconds (max 120) for a new message from someone else in a space, conversation or thread, after sinceRef.',
            z.object({ space: name.optional(), person: name.optional(), thread: name.optional(), sinceRef: name.optional(), timeoutSeconds: z.number().int().min(1).max(120) }).strict(), api.wait, where),
        define('webex_meetings', 'Your scheduled meetings (read-only), optionally with one person. Needs the meeting:schedules_read permission.',
            z.object({ from: when.optional(), to: when.optional(), person: name.optional() }).strict(), api.meetings),
    ];
}
