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