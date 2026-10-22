import * as fs from 'fs';
import * as path from 'path';
import { isOpaqueRef } from './provider';

/**
 * Names to short opaque refs to internal Webex ids (spec 009 US8, contract assistant-tools.md section 2).
 * Raw ids live only in this class and its state file; every outgoing value passes `scrubIds`.
 */

export interface WebexResponse { ok: boolean; status?: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }
export interface WebexGetDeps { request(method: 'GET', endpoint: string): Promise<WebexResponse> }
export interface ResolverDeps extends WebexGetDeps {
    /** Where the per-space seen watermark is kept (inside the workspace .askaway storage). Omitted: in memory only. */
    stateFile?: string;
    now?(): number;
}

export class WebexHttpError extends Error {
    constructor(public status: number, public retryAfter?: number) { super(`Webex HTTP ${status}`); }
}
export async function webexGet(deps: WebexGetDeps, endpoint: string): Promise<any> {
    const response = await deps.request('GET', endpoint);
    if (!response.ok) { throw new WebexHttpError(response.status ?? 0, Number(response.headers?.get('retry-after')) || undefined); }
    return response.json();
}

/** A failure told in plain words, never an exception or a stack. `scope` names the permission a 403 most likely means. */
export function plainWords(error: unknown, what: string, scope?: string): { status: string; message: string } {
    if (error instanceof WebexHttpError) {
        if (error.status === 401) { return { status: 'unauthorized', message: 'Webex sign-in is missing or expired. Run "AskAway: Set Webex Token" and try again.' }; }
        if (error.status === 403) { return { status: 'unauthorized', message: `This Webex sign-in is not allowed to ${what}${scope ? ` (it needs the ${scope} permission)` : ''}.` }; }
        if (error.status === 404) { return { status: 'not_found', message: `Webex has nothing to show for ${what}.` }; }
        if (error.status === 429) { return { status: 'busy', message: `Webex asked us to slow down; try again in ${error.retryAfter ?? 'a few'} seconds.` }; }
        return { status: 'error', message: `Webex could not ${what} (HTTP ${error.status}).` };
    }
    if (error instanceof Error && /^(Disabled|Not configured)\.$/.test(error.message)) { return { status: 'disabled', message: 'Webex is turned off or not signed in.' }; }
    return { status: 'error', message: `Webex could not ${what}.` };
}

const PREFIX = 'Y2lzY29zcGFyazov'; // base64 of "ciscospark:/"
const ID_PATTERNS: RegExp[] = [
    new RegExp(`[A-Za-z0-9_=+/-]*${PREFIX}[A-Za-z0-9_=+/-]*`, 'g'),
    /ciscospark:\/\/\S+/gi,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    /(?<![A-Za-z0-9_=-])[0-9a-f]{32,}(?![A-Za-z0-9_=-])/gi,
];
const LONG_TOKEN = /(?<![A-Za-z0-9_=-])[A-Za-z0-9_=-]{32,}(?![A-Za-z0-9_=-])/g;
/** Standard base64 (+ and /) is a separate class: letting / into LONG_TOKEN would scrub file paths such as a cache folder. */
const LONG_BASE64 = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/=]{32,}(?![A-Za-z0-9+/=])/g;
const REMOVED = '[id removed]';

/** Removes anything shaped like a Webex id (ciscospark URI, its base64 form, UUID, long hex, long mixed-case token) from one string. */
export function scrubText(text: string): string {
    let out = text;
    for (const pattern of ID_PATTERNS) { out = out.replace(pattern, REMOVED); }
    const mixed = (token: string) => /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
    return out.replace(LONG_TOKEN, token => mixed(token) ? REMOVED : token).replace(LONG_BASE64, token => /[+/]/.test(token) && mixed(token) ? REMOVED : token);
}
/** Deep copy with every string scrubbed. The last step of every tool result. */
export function scrubIds<T>(value: T): T {
    if (typeof value === 'string') { return scrubText(value) as unknown as T; }
    if (Array.isArray(value)) { return value.map(scrubIds) as unknown as T; }
    if (value && typeof value === 'object') { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubIds(item)])) as T; }
    return value;
}

export type Kind = 'space' | 'person' | 'message';
export interface Candidate { ref: string; label: string; kind: Kind; detail?: string }
interface Internal { id: string; roomId?: string; parentId?: string; personId?: string; email?: string; created?: string; mine?: boolean; type?: string; lastActivity?: string; title?: string; presence?: string; author?: string; snippet?: string }
/** `_internal` is non-enumerable: it never serialises into a tool result. */
export type Resolved =
    | { status: 'ok'; ref: string; label: string; kind: Kind; _internal: Internal }
    | { status: 'ambiguous'; query: string; candidates: Candidate[] }
    | { status: 'not_found'; query: string }
    | { status: 'stale_ref'; ref: string; hint: string };
export interface Room { id: string; title: string; type: string; lastActivity: string }
interface Entry { ref: string; kind: Kind; label: string; internal: Internal }

const STALE_HINT = 'Call webex_inbox or webex_find again.';
const hide = (resolved: Omit<Extract<Resolved, { status: 'ok' }>, '_internal'>, internal: Internal): Resolved =>
    Object.defineProperty({ ...resolved }, '_internal', { value: internal, enumerable: false }) as Resolved;
const lower = (text: string) => text.trim().toLowerCase();
const PREFIXES: Record<Kind, string> = { space: 's', person: 'p', message: 'm' };
const ROOMS_TTL_MS = 60_000;

export class WebexResolver {
    private table = new Map<string, Entry>();
    private byInternal = new Map<string, string>();
    private counters: Record<Kind, number> = { space: 0, person: 0, message: 0 };
    private rooms?: { at: number; items: Room[] };
    private names = new Map<string, string>();
    private self?: { id: string; name: string; email: string };
    private seenMarks?: Record<string, string>;

    constructor(private deps: ResolverDeps) {}

    now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

    // ---- refs ----
    private issue(kind: Kind, id: string, label: string, internal: Internal): Resolved {
        const key = `${kind}:${id}`;
        let ref = this.byInternal.get(key);
        if (!ref) {
            ref = `${PREFIXES[kind]}${++this.counters[kind]}`;
            this.byInternal.set(key, ref);
        }
        const defined = Object.fromEntries(Object.entries(internal).filter(([, value]) => value !== undefined));
        const merged = { ...this.table.get(ref)?.internal, ...defined, id } as Internal;
        this.table.set(ref, { ref, kind, label, internal: merged });
        return hide({ status: 'ok', ref, label, kind }, merged);
    }
    private lookup(ref: string, kind?: Kind): Resolved | undefined {
        const entry = this.table.get(ref);
        if (!entry || (kind && entry.kind !== kind)) { return undefined; }
        return hide({ status: 'ok', ref, label: entry.label, kind: entry.kind }, entry.internal);
    }
    private stale(ref: string): Resolved { return { status: 'stale_ref', ref, hint: STALE_HINT }; }

    // ---- caches ----
    async listRooms(): Promise<Room[]> {
        if (this.rooms && this.now() - this.rooms.at < ROOMS_TTL_MS) { return this.rooms.items; }
        const data = await webexGet(this.deps, '/rooms?sortBy=lastactivity&max=100');
        const items: Room[] = (data.items ?? []).filter((row: any) => typeof row.id === 'string' && typeof row.title === 'string')
            .map((row: any) => ({ id: row.id, title: String(row.title), type: String(row.type ?? 'group'), lastActivity: String(row.lastActivity ?? '') }));
        this.rooms = { at: this.now(), items };
        return items;
    }
    async me(): Promise<{ id: string; name: string; email: string }> {
        if (!this.self) {
            const data = await webexGet(this.deps, '/people/me');
            this.self = { id: String(data.id ?? ''), name: String(data.displayName ?? 'You'), email: String(data.emails?.[0] ?? '') };
        }
        return this.self;
    }
    /** One batched call for every author name not yet known; a refused lookup falls back to the email later. */
    async loadNames(personIds: string[]): Promise<void> {
        const missing = [...new Set(personIds)].filter(id => id && !this.names.has(id));
        for (let index = 0; index < missing.length; index += 80) {
            const chunk = missing.slice(index, index + 80);
            try {
                const data = await webexGet(this.deps, `/people?id=${chunk.map(encodeURIComponent).join(',')}`);
                for (const person of data.items ?? []) { if (person.id && person.displayName) { this.names.set(person.id, String(person.displayName)); } }
            } catch { /* Names are a nicety: the email is the fallback. */ }
        }
    }
    authorName(row: { personId?: string; personEmail?: string }): string {
        if (this.self && row.personId === this.self.id) { return this.self.name; }
        return (row.personId && this.names.get(row.personId)) || row.personEmail || 'Unknown';
    }

    // ---- watermark ----
    private marks(): Record<string, string> {
        if (!this.seenMarks) {
            this.seenMarks = {};
            if (this.deps.stateFile) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(this.deps.stateFile, 'utf8'));
                    if (parsed && typeof parsed.seen === 'object') { this.seenMarks = parsed.seen; }
                } catch { /* No state yet, or unreadable: start fresh. */ }
            }
        }
        return this.seenMarks as Record<string, string>;
    }
    /** AskAway's own "seen up to" time for a space (ISO), or undefined. Webex has no unread API. */
    seen(roomId: string): string | undefined { return this.marks()[roomId]; }
    markSeen(roomId: string, iso: string): void {
        const marks = this.marks();
        if (!roomId || !iso || (marks[roomId] && Date.parse(marks[roomId]) >= Date.parse(iso))) { return; }
        marks[roomId] = iso;
        if (!this.deps.stateFile) { return; }
        try {
            fs.mkdirSync(path.dirname(this.deps.stateFile), { recursive: true });
            const temporary = `${this.deps.stateFile}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({ version: 1, seen: marks }), { mode: 0o600 });
            fs.renameSync(temporary, this.deps.stateFile);
        } catch { /* Losing a watermark only makes a space look unseen again. */ }
    }

    // ---- resolving ----
    private pick(query: string, items: Array<{ label: string; make: () => Resolved; candidate: () => Candidate }>): Resolved {
        const wanted = lower(query);
        const exact = items.filter(item => lower(item.label) === wanted);
        const found = exact.length ? exact : items.filter(item => lower(item.label).includes(wanted));
        if (found.length === 1) { return found[0].make(); }
        if (found.length === 0) { return { status: 'not_found', query }; }
        return { status: 'ambiguous', query, candidates: found.slice(0, 10).map(item => item.candidate()) };
    }

    private roomResolved(room: Room): Resolved {
        return this.issue('space', room.id, room.title, { id: room.id, type: room.type, lastActivity: room.lastActivity });
    }
    private roomCandidate(room: Room): Candidate {
        const resolved = this.roomResolved(room) as Extract<Resolved, { status: 'ok' }>;
        return { ref: resolved.ref, label: room.title, kind: 'space', detail: `${room.type === 'direct' ? 'direct' : 'group'}${room.lastActivity ? `, last activity ${room.lastActivity}` : ''}` };
    }

    /** A space by exact or unique partial name (searches the 100 most recently active spaces), or by ref. */
    async space(nameOrRef: string): Promise<Resolved> {
        const query = nameOrRef.trim();
        // An opaque ref that misses the table is stale, never a name: "s3" must not match a space called "Ops3 team".
        if (isOpaqueRef(query)) { return this.lookup(query, 'space') ?? this.stale(query); }
        const rooms = await this.listRooms();
        return this.pick(query, rooms.map(room => ({ label: room.title, make: () => this.roomResolved(room), candidate: () => this.roomCandidate(room) })));
    }

    private personResolved(row: any): Resolved {
        const email = String(row.emails?.[0] ?? '');
        const label = String(row.displayName ?? email);
        if (row.id && row.displayName) { this.names.set(row.id, label); }
        return this.issue('person', String(row.id), label, { id: String(row.id), email, title: typeof row.title === 'string' ? row.title : undefined, presence: typeof row.status === 'string' ? row.status : undefined });
    }
    /** People matching a name or email; the raw rows stay inside. */
    async searchPeople(query: string, max = 10): Promise<Resolved[]> {
        const byEmail = query.includes('@');
        const data = await webexGet(this.deps, `/people?${byEmail ? 'email' : 'displayName'}=${encodeURIComponent(query.trim())}&max=${max}`);
        return (data.items ?? []).filter((row: any) => typeof row.id === 'string').map((row: any) => this.personResolved(row));
    }
    /** A person by exact or unique partial name, by email, or by ref. */
    async person(nameOrEmail: string): Promise<Resolved> {
        const query = nameOrEmail.trim();
        if (isOpaqueRef(query)) { return this.lookup(query, 'person') ?? this.stale(query); }
        const people = (await this.searchPeople(query)).filter((item): item is Extract<Resolved, { status: 'ok' }> => item.status === 'ok');
        const wanted = lower(query);
        const items = people.map(item => ({ label: item.label, make: () => item as Resolved,
            candidate: (): Candidate => ({ ref: item.ref, label: item.label, kind: 'person', detail: item._internal.email }) }));
        // An email query matches by address, not by display name.
        return query.includes('@')
            ? (people.length === 1 ? people[0] : people.length === 0 ? { status: 'not_found' as const, query } : this.pick(wanted, items))
            : this.pick(query, items);
    }

    /** Remembers a message so a follow-up can point at it by ref. */
    rememberMessage(row: { id: string; roomId: string; parentId?: string; personId?: string; created?: string; text?: string; markdown?: string }, spaceLabel: string, authorLabel: string, mine: boolean): Resolved {
        // A short scrubbed quote lets an approval card say which message an edit, delete or reply is about, by words and never by id.
        const snippet = scrubText(String(row.text ?? row.markdown ?? '')).replace(/\s+/g, ' ').trim().slice(0, 120) || undefined;
        return this.issue('message', row.id, `Message from ${authorLabel} in ${spaceLabel}`, { id: row.id, roomId: row.roomId, parentId: row.parentId, personId: row.personId, created: row.created, mine, title: spaceLabel, author: authorLabel, snippet });
    }
    /** What a message ref points at: its space, its thread root (if any) and whether the reviewer wrote it. */
    async message(ref: string): Promise<{ status: 'ok'; space: Resolved; thread?: Resolved; mine: boolean; created?: string; messageId: string; rootId: string; author?: string; snippet?: string } | Extract<Resolved, { status: 'stale_ref' }>> {
        const found = this.lookup(ref, 'message');
        if (!found || found.status !== 'ok') { return { status: 'stale_ref', ref, hint: STALE_HINT }; }
        const { roomId, parentId, mine, created, title, author, snippet } = found._internal;
        const space = this.issue('space', String(roomId), title ?? 'Space', { id: String(roomId) });
        const thread = parentId ? this.issue('message', parentId, `Thread in ${title ?? 'space'}`, { id: parentId, roomId }) : undefined;
        return { status: 'ok', space, thread, mine: !!mine, created, messageId: found._internal.id, rootId: parentId ?? found._internal.id, author, snippet };
    }
    /** The ref of a message already seen, or a new one for a thread root we only know by position. */
    messageRef(id: string, roomId: string, spaceLabel: string): string {
        const existing = this.byInternal.get(`message:${id}`);
        if (existing) { return existing; }
        return (this.issue('message', id, `Thread in ${spaceLabel}`, { id, roomId, title: spaceLabel }) as Extract<Resolved, { status: 'ok' }>).ref;
    }
    /** The ref of a space whose room row is already in hand. */
    refForRoom(room: Room): string { return (this.roomResolved(room) as Extract<Resolved, { status: 'ok' }>).ref; }
    /** Spaces whose name contains the query, as candidates with refs. */
    async spaceCandidates(query: string, max = 10): Promise<Candidate[]> {
        const wanted = lower(query);
        return (await this.listRooms()).filter(room => lower(room.title).includes(wanted)).slice(0, max).map(room => this.roomCandidate(room));
    }
    /** The newest message by `person` (name or email) in a space: "latest from <person> in <space>". */
    async latestFrom(person: string, space: string): Promise<Resolved> {
        const room = await this.space(space);
        if (room.status !== 'ok') { return room; }
        const data = await webexGet(this.deps, `/messages?roomId=${encodeURIComponent(room._internal.id)}&max=50`);
        const rows: any[] = (data.items ?? []).filter((row: any) => typeof row.id === 'string');
        await Promise.all([this.me(), this.loadNames(rows.map(row => row.personId))]);
        const wanted = lower(person);
        const authored = rows.filter(row => lower(String(row.personEmail ?? '')) === wanted || lower(this.authorName(row)).includes(wanted));
        const authors = new Map(authored.map(row => [row.personId, row]));
        if (authors.size > 1) {
            const candidates: Candidate[] = [...authors.values()].slice(0, 10).map(row => {
                const resolved = this.issue('person', String(row.personId), this.authorName(row), { id: String(row.personId), email: row.personEmail }) as Extract<Resolved, { status: 'ok' }>;
                return { ref: resolved.ref, label: resolved.label, kind: 'person' as const, detail: row.personEmail };
            });
            return { status: 'ambiguous', query: person, candidates };
        }
        if (!authored.length) { return { status: 'not_found', query: `${person} in ${room.label}` }; }
        authored.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
        const newest = authored[0];
        return this.rememberMessage(newest, room.label, this.authorName(newest), newest.personId === this.self?.id);
    }
}
