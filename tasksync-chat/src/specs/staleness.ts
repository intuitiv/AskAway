import { execFileSync } from 'child_process';
import * as path from 'path';

export interface StaleEntry {
    artifact: string;
    upstream: string;
    reason: 'upstream-newer' | 'upstream-dirty';
}

export interface SpecsStaleness {
    available: boolean;
    bySlug: Map<string, StaleEntry[]>;
}

type Rank = { dirty: true } | { dirty: false; sha: string };

/** Artifact → the artifacts it is generated from (Spec Kit order; 005 plan D-6). */
function upstreamsOf(artifact: string): string[] {
    if (artifact === 'plan.md' || artifact.startsWith('checklists/')) { return ['spec.md']; }
    if (artifact === 'tasks.md') { return ['spec.md', 'plan.md']; }
    if (['research.md', 'data-model.md', 'quickstart.md'].includes(artifact) || artifact.startsWith('contracts/')) { return ['plan.md']; }
    return [];
}

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 32 * 1024 * 1024 });
}

function isAncestor(cwd: string, older: string, newer: string): boolean {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd, stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Staleness of every spec's artifacts by git commit order: a dependent is stale when an upstream artifact
 * was committed after it (ancestry, not timestamps) or has uncommitted/untracked edits while it has none.
 */
export function specsStaleness(specsRoot: string): SpecsStaleness {
    const none: SpecsStaleness = { available: false, bySlug: new Map() };
    let top: string;
    try {
        top = git(specsRoot, ['rev-parse', '--show-toplevel']).trim();
    } catch {
        return none;
    }
    const specsRel = path.relative(top, specsRoot).split(path.sep).join('/');
    const ranks = new Map<string, Rank>();
    try {
        const log = git(top, ['log', '--format=%x00%H', '--name-only', '--', specsRel]);
        for (const chunk of log.split('\0').slice(1)) {
            const [sha, ...files] = chunk.split('\n').map(line => line.trim()).filter(Boolean);
            for (const file of files) {
                if (!ranks.has(file)) { ranks.set(file, { dirty: false, sha }); }
            }
        }
        const status = git(top, ['status', '--porcelain', '--untracked-files=all', '--', specsRel]);
        for (const line of status.split('\n')) {
            if (line.length < 4) { continue; }
            const file = line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, '');
            ranks.set(file, { dirty: true });
        }
    } catch {
        return none;
    }

    const bySlug = new Map<string, StaleEntry[]>();
    const prefix = specsRel ? `${specsRel}/` : '';
    const artifactsBySlug = new Map<string, Set<string>>();
    for (const file of ranks.keys()) {
        if (!file.startsWith(prefix)) { continue; }
        const [slug, ...rest] = file.slice(prefix.length).split('/');
        if (!slug || rest.length === 0) { continue; }
        const set = artifactsBySlug.get(slug) || new Set<string>();
        set.add(rest.join('/'));
        artifactsBySlug.set(slug, set);
    }
    for (const [slug, artifacts] of artifactsBySlug) {
        const stale: StaleEntry[] = [];
        for (const artifact of [...artifacts].sort()) {
            const own = ranks.get(`${prefix}${slug}/${artifact}`)!;
            for (const upstream of upstreamsOf(artifact)) {
                const up = ranks.get(`${prefix}${slug}/${upstream}`);
                if (!up || own.dirty) { continue; }
                if (up.dirty) {
                    stale.push({ artifact, upstream, reason: 'upstream-dirty' });
                } else if (up.sha !== own.sha && isAncestor(top, own.sha, up.sha)) {
                    stale.push({ artifact, upstream, reason: 'upstream-newer' });
                }
            }
        }
        if (stale.length) { bySlug.set(slug, stale); }
    }
    return { available: true, bySlug };
}
