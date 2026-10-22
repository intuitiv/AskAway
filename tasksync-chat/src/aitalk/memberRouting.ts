/** Resolves an @mention to Team members by stable id, never by one literal display name (R-TEAM-09, R-TEAM-15). Pure: tests and the Room share it. */
export interface RosterMember { id: string; name: string; role?: string; kind: string; profiles: string[]; /** The name before a Team Edit rename: it keeps working. */ baseName?: string }
export interface Mentions { members: RosterMember[]; ambiguous: Array<{ token: string; options: RosterMember[] }> }

const first = (value: string) => value.trim().split(/[\s.]+/)[0] ?? '';
/** Everything a reviewer may type after the @ for this member: id, current and earlier name, and the first name of each. */
export function aliasesOf(member: RosterMember): string[] {
    const names = [member.name, member.baseName].filter((value): value is string => !!value);
    return [...new Set([member.id, ...names, ...names.map(first)].map(value => value.toLowerCase()).filter(Boolean))];
}

export function mentionTokens(text: string): string[] {
    return [...String(text ?? '').matchAll(/(^|[^\w@])@([A-Za-z][\w-]*)/g)].map(match => match[2]);
}

/** Each @token names exactly one member, several (ambiguous: never guess), or none. */
export function mentionedMembers(text: string, roster: RosterMember[]): Mentions {
    const members = new Map<string, RosterMember>();
    const ambiguous: Mentions['ambiguous'] = [];
    for (const token of new Set(mentionTokens(text).map(value => value.toLowerCase()))) {
        const hits = roster.filter(member => aliasesOf(member).includes(token));
        if (hits.length === 1) members.set(hits[0].id, hits[0]);
        else if (hits.length > 1) ambiguous.push({ token, options: hits });
    }
    return { members: [...members.values()], ambiguous };
}

/** The member that owns a worker, from the profile the worker runs (or the member's own id or name). */
export function memberOfProfile(profile: string, roster: RosterMember[]): RosterMember | undefined {
    const key = String(profile ?? '').toLowerCase().split(' · ')[0].trim();
    if (!key) return undefined;
    return roster.find(member => member.kind === 'worker' && [member.id, member.name, ...member.profiles].some(value => value && value.toLowerCase() === key));
}
