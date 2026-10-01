import * as fs from 'fs';
import * as path from 'path';

/** Long or overnight runs (Away/Offline) hand off to a new conversation once input exceeds this. */
export const HANDOFF_INPUT_TOKENS = 300_000;

export type Availability = 'here' | 'away' | 'offline' | undefined | null;

/** The one decision: only Away/Offline are tied to 300K; other handoffs are not. */
export function handoffNeeded(input: { lastInputTokens: number; availability: Availability }): boolean {
    return (input.availability === 'away' || input.availability === 'offline')
        && Number(input.lastInputTokens) > HANDOFF_INPUT_TOKENS;
}

export function handoffLine(availability: 'away' | 'offline'): string {
    const mode = availability === 'away' ? 'Away' : 'Offline';
    return `Context over 300K while ${mode}: run /sk.handoff now, then continue in a new conversation`;
}

/** The extension writes the latest main-chat input tokens into the availability JSON so the external hook reads the same file. */
export function recordLastInput(availabilityFile: string, lastInputTokens: number): void {
    try {
        const state = JSON.parse(fs.readFileSync(availabilityFile, 'utf8'));
        if (state.lastInputTokens === lastInputTokens) { return; }
        fs.mkdirSync(path.dirname(availabilityFile), { recursive: true });
        fs.writeFileSync(availabilityFile, JSON.stringify({ ...state, lastInputTokens }));
    } catch { /* no availability state: nothing to annotate */ }
}

/**
 * Called whenever the extension builds an ask/continue tool result. Records the latest input size, returns the
 * line to append (or ''), and sends ONE notice per conversation while Away; a drop below the threshold means
 * a new conversation began, which re-arms the notice.
 */
export class LongRunHandoff {
    private _noticed = false;

    constructor(private readonly _notify: (text: string) => void | Promise<unknown>) { }

    public check(availabilityFile: string, lastInputTokens: number, availability: Availability): string {
        recordLastInput(availabilityFile, lastInputTokens);
        if (!handoffNeeded({ lastInputTokens, availability })) {
            if (lastInputTokens <= HANDOFF_INPUT_TOKENS) { this._noticed = false; }
            return '';
        }
        const line = handoffLine(availability as 'away' | 'offline');
        if (availability === 'away' && !this._noticed) {
            this._noticed = true;
            void this._notify(line);
        }
        return line;
    }
}
