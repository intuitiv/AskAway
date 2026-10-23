import { workspaceMatchTotals } from '../validator/records';

/** No ratio until this many predictions were compared (reviewer, 2026-10-22: points start low on a new workspace). */
export const MATCH_MIN_COMPARED = 10;

export interface MatchScore { matched: number; compared: number; label: string }

/** 'Match 2/4' from 10 compared on; before that 'Match: learning' with the bare count. */
export function matchLabel(totals: { matched: number; compared: number }): string {
    return totals.compared >= MATCH_MIN_COMPARED ? `Match ${totals.matched}/${totals.compared}` : `Match: learning (${totals.compared} compared)`;
}

export function matchScore(workspaceRoot: string): MatchScore {
    const totals = workspaceMatchTotals(workspaceRoot);
    return { ...totals, label: matchLabel(totals) };
}

/** Adds `match` to Priya's member only; every other member is returned unchanged. */
export function withMatchScore<T extends { id: string }>(members: T[], workspaceRoot: string): Array<T & { match?: MatchScore }> {
    return members.map(member => member.id === 'priya' ? { ...member, match: matchScore(workspaceRoot) } : member);
}

/** Profile-header chip in the Team card's existing `team-chip` markup (same class as the model and effort chips). */
export function matchChipHtml(match: MatchScore | undefined): string {
    if (!match) { return ''; }
    const text = match.label.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    return `<span class="team-chip team-chip-match" data-match-compared="${match.compared}" title="Predictions that matched your replies">${text}</span>`;
}
