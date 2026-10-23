import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aitalkDeliveryBlock } from './aitalkDeliveryText';

/**
 * Spool for the PostToolUse hook (subagentTimerScript.ts): the extension writes `pending.json` ({ ids, text }) for the main agent's
 * undelivered messages; the hook claims it by renaming it to `claimed-*.json`; the extension then marks those ids delivered.
 */
export function aitalkSpoolDir(root: string, home: string = os.homedir()): string {
    let real = root;
    try { real = fs.realpathSync(root); } catch { /* an unresolvable path keeps its name */ }
    return path.join(home, '.askaway', 'aitalk-spool', real.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase());
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
}

const STALE_CLAIM_MS = 10000;
const names = (dir: string, prefix: string): string[] => { try { return fs.readdirSync(dir).filter(name => name.startsWith(prefix)); } catch { return []; } };
const idsOf = (file: string): string[] => { try { const ids = JSON.parse(fs.readFileSync(file, 'utf8')).ids; return Array.isArray(ids) ? ids.filter((id: unknown) => typeof id === 'string') : []; } catch { return []; } };

/** True when the spool holds anything to do: a pending batch or any receipt. */
export function aitalkSpoolBusy(root: string, home?: string): boolean {
    const dir = aitalkSpoolDir(root, home);
    return fs.existsSync(path.join(dir, 'pending.json')) || names(dir, 'claim').length > 0;
}

/** Ids the hook has claimed or is printing right now: they are handed over, never to be handed over again. */
export function inflightSpoolIds(root: string, home?: string): Set<string> {
    const dir = aitalkSpoolDir(root, home);
    return new Set([...names(dir, 'claimed-'), ...names(dir, 'claiming-')].flatMap(name => idsOf(path.join(dir, name))));
}

/** Marks every message the hook printed (claimed-*) as delivered, then drops the receipt; a claiming-* older than 10 s (crash before the print) goes back to pending. */
export function reconcileAITalkSpool(root: string, store: any, recipient: string, home?: string): void {
    const dir = aitalkSpoolDir(root, home);
    for (const name of names(dir, 'claiming-')) {
        const file = path.join(dir, name);
        const at = Number(/-(\d+)\.json$/.exec(name)?.[1]) || (() => { try { return fs.statSync(file).mtimeMs; } catch { return Date.now(); } })();
        if (Date.now() - at < STALE_CLAIM_MS) continue;
        try { if (fs.existsSync(path.join(dir, 'pending.json'))) fs.unlinkSync(file); else fs.renameSync(file, path.join(dir, 'pending.json')); } catch { /* the hook finished meanwhile */ }
    }
    for (const name of names(dir, 'claimed-')) {
        const file = path.join(dir, name);
        try {
            const ids = idsOf(file);
            if (ids.length) store.track('delivered', recipient, ids);
            fs.unlinkSync(file);
        } catch { /* retried on the next sync */ }
    }
}

/** Called after a tool result already carried the queue: the spooled copy is stale. Returns whether a pending batch was still there to remove. */
export function dropPendingSpool(root: string, home?: string): boolean {
    try { fs.unlinkSync(path.join(aitalkSpoolDir(root, home), 'pending.json')); return true; } catch { return false; /* nothing spooled, or the hook claimed it */ }
}

/** Receipts first, then the current undelivered messages are (re)written atomically for the hook to claim. */
export function syncAITalkSpool(root: string, store: any, home?: string): void {
    const recipient = store.agentId();
    if (!recipient) return;
    const dir = aitalkSpoolDir(root, home);
    ensureDir(dir);
    reconcileAITalkSpool(root, store, recipient, home);
    const pending = path.join(dir, 'pending.json');
    let handed = inflightSpoolIds(root, home);
    let items: any[] = store.peekForTool(recipient).filter((item: any) => !handed.has(item.id));
    if (!items.length) { dropPendingSpool(root, home); return; }
    const ids = items.map(item => item.id);
    try { if (JSON.stringify(JSON.parse(fs.readFileSync(pending, 'utf8')).ids) === JSON.stringify(ids)) return; } catch { /* absent or stale */ }
    // A receipt may have landed while the room was read: settle it before the batch is written.
    reconcileAITalkSpool(root, store, recipient, home);
    handed = inflightSpoolIds(root, home);
    items = store.peekForTool(recipient).filter((item: any) => !handed.has(item.id));
    if (!items.length) { dropPendingSpool(root, home); return; }
    const temp = path.join(dir, `pending.tmp-${process.pid}`);
    fs.writeFileSync(temp, JSON.stringify({ ids: items.map(item => item.id), text: aitalkDeliveryBlock(items, store.nameOf(store.snapshot(true).members, recipient)) }), { mode: 0o600 });
    fs.renameSync(temp, pending);
}
