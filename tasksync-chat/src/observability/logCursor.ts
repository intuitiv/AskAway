import * as crypto from 'crypto';
import * as fs from 'fs';

export interface LogCursor {
    byteOffset: number;
    lineCount: number;
    headHash?: string;
    fileId?: string;
}

export function reconcileLogCursor(entry: LogCursor | undefined, fileSize: number, headHash: string | undefined, fileId: string): LogCursor {
    if (!entry) { return { byteOffset: 0, lineCount: 0, headHash, fileId }; }
    if (fileSize < entry.byteOffset || (entry.fileId && entry.fileId !== fileId) || (entry.headHash && headHash && entry.headHash !== headHash)) {
        return { byteOffset: 0, lineCount: 0, headHash, fileId };
    }
    return { ...entry, headHash: headHash || entry.headHash, fileId };
}

const HEAD_BYTES = 512;

/**
 * Complete lines appended to a log since `entry`. A log that shrank, was replaced, or was rewritten from the top is
 * read again from its start; otherwise the tracker would stay frozen on a stale offset.
 */
export async function readLogIncrement(file: string, entry: LogCursor | undefined): Promise<{ raw: string; lineIndexBase: number; cursor: LogCursor }> {
    const fd = await fs.promises.open(file, 'r');
    try {
        const stat = await fd.stat();
        const head = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
        await fd.read(head, 0, head.length, 0);
        const headHash = head.length === HEAD_BYTES ? crypto.createHash('sha1').update(head).digest('hex') : undefined;
        const cursor = reconcileLogCursor(entry, stat.size, headHash, `${stat.dev}:${stat.ino}`);
        if (stat.size <= cursor.byteOffset) { return { raw: '', lineIndexBase: cursor.lineCount, cursor }; }
        const buf = Buffer.allocUnsafe(stat.size - cursor.byteOffset);
        await fd.read(buf, 0, buf.length, cursor.byteOffset);
        // Stop at the last newline so a partially flushed line is read whole next time.
        const lastNl = buf.lastIndexOf(0x0a);
        if (lastNl < 0) { return { raw: '', lineIndexBase: cursor.lineCount, cursor }; }
        const raw = buf.toString('utf8', 0, lastNl + 1);
        const lines = raw.split('\n').length - 1;
        return { raw, lineIndexBase: cursor.lineCount, cursor: { ...cursor, byteOffset: cursor.byteOffset + lastNl + 1, lineCount: cursor.lineCount + lines } };
    } finally {
        await fd.close();
    }
}