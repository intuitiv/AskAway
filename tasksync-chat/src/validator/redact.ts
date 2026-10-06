import { CREDENTIAL_ANYWHERE } from '../commentary/commentary';

/** True when `text` holds a credential. Uses replace, not test: CREDENTIAL_ANYWHERE is global and `.test` keeps lastIndex. */
export function hasCredential(text: string): boolean {
    return text.replace(CREDENTIAL_ANYWHERE, '') !== text;
}

/**
 * FR-016: the text, or null when it holds a credential. The whole item is dropped (never partly masked), because a
 * partly masked secret still tells a reader where it was. Applied to the reviewer's reply, the observed response and
 * the sources read, before any sink (jsonl, agentmemory body, Commentary, cost).
 */
export function redactOrDrop(text: unknown): string | null {
    if (typeof text !== 'string') { return null; }
    return hasCredential(text) ? null : text;
}

/** Same rule for a structured record: null when any string inside it (keys included) holds a credential or a value is not plain JSON. */
export function redactRecordOrDrop<T>(value: T): T | null {
    let json: string;
    try { json = JSON.stringify(value); } catch { return null; }
    if (json === undefined) { return null; }
    return hasCredential(json) ? null : value;
}
