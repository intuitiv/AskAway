/**
 * After a restart the persisted log cursors sit at end-of-file, but the current turn's state (requests,
 * last-request time) lived only in memory. These helpers rewind the newest session to its last user
 * message once, so the turn is rebuilt; lines below the old cursor are marked already-counted.
 */
export interface Cursor { byteOffset: number; lineCount: number }

/** Byte offset, line index, and ts of the last parent `user_message` line in a main.jsonl buffer. */
export function lastUserMessage(buf: Buffer): (Cursor & { ts: number }) | undefined {
    let found: (Cursor & { ts: number }) | undefined;
    let start = 0;
    let line = 0;
    while (start < buf.length) {
        const end = buf.indexOf(0x0a, start);
        if (end < 0) { break; }
        const text = buf.toString('utf8', start, end);
        if (text.indexOf('"type":"user_message"') !== -1) {
            try {
                const ts = (JSON.parse(text) as { ts?: number }).ts;
                if (typeof ts === 'number') { found = { byteOffset: start, lineCount: line, ts }; }
            } catch { /* malformed line: skip */ }
        }
        start = end + 1;
        line++;
    }
    return found;
}

/**
 * New cursors for the session holding `mainFile`: main.jsonl rewinds to the turn start; its child logs rewind
 * to 0 (the turn filter keeps only this turn's lines). `floors` = first line index not yet counted per file.
 */
export function rewindPlan(sessionFiles: string[], mainFile: string, turnStart: Cursor, known: Map<string, Cursor>):
    { cursors: Map<string, Cursor>; floors: Map<string, number> } {
    const cursors = new Map<string, Cursor>();
    const floors = new Map<string, number>();
    const main = known.get(mainFile);
    // The turn started after everything already read: normal incremental reading rebuilds it.
    if (!main || turnStart.byteOffset >= main.byteOffset) { return { cursors, floors }; }
    for (const file of sessionFiles) {
        const seen = known.get(file);
        if (!seen) { continue; }
        floors.set(file, seen.lineCount);
        cursors.set(file, file === mainFile ? { byteOffset: turnStart.byteOffset, lineCount: turnStart.lineCount } : { byteOffset: 0, lineCount: 0 });
    }
    return { cursors, floors };
}
