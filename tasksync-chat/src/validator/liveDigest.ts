import type { CommentaryStore } from '../commentary/commentary';
import { readLiveDecisions } from './liveDecisions';

export interface LiveAvailability { mode: string; until?: string; setAt?: string }
export function isLiveAway(state: LiveAvailability | null, now: number): boolean {
    return state?.mode === 'awayValidator' && (!state.until || Date.parse(state.until) > now);
}
export class LiveDigest {
    private awaySince: number | undefined;
    constructor(private readonly workspace: string, private readonly commentary: Pick<CommentaryStore, 'postValidator'>,
        private readonly enabled: () => boolean, private readonly availability: () => LiveAvailability | null,
        private readonly now: () => number = Date.now) {}
    check(): void {
        if (!this.enabled()) { this.awaySince = undefined; return; }
        const state = this.availability(), now = this.now();
        if (isLiveAway(state, now)) {
            if (this.awaySince === undefined) this.awaySince = state?.setAt && Number.isFinite(Date.parse(state.setAt)) ? Date.parse(state.setAt) : now;
            return;
        }
        if (this.awaySince === undefined) return;
        const since = this.awaySince;
        this.awaySince = undefined;
        if (state?.mode !== 'here' && !(state?.mode === 'awayValidator' && state.until && Date.parse(state.until) <= now)) return;
        const decisions = readLiveDecisions(this.workspace, since, now);
        if (!decisions.length) return;
        const answered = decisions.filter(row => !row.held);
        const held = decisions.filter(row => row.held);
        const uncertain = decisions.filter(row => row.confidence === null || row.confidence < 0.8 || !row.sources.length);
        this.commentary.postValidator(this.workspace, { headsUp: true,
            text: `Validator return digest: ${answered.length} answered, ${uncertain.length} uncertain, ${held.length} held. Open details to review.`,
            detail: { summary: { answered, uncertain, held }, sources: [...new Set(decisions.flatMap(row => row.sources))],
                observations: 'Held questions await the reviewer; no action was taken by the digest.' } });
    }
}
