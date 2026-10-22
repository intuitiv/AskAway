import { globCovers } from '../workers/workerRouter';

/** Spec 005 T041: the changed files that no allowed glob covers (empty allowedFiles covers nothing). Glob rules live in workerRouter. */
export function scopeCheck(allowedFiles: string[], changedFiles: string[]): string[] {
    return changedFiles.filter((file) => !allowedFiles.some((glob) => globCovers(glob, file)));
}
