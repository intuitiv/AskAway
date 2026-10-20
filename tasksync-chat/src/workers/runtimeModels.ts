import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The models each integration offered at its last check, kept on disk so the Team dropdowns are full right after a restart. */
export type ModelRuntime = 'opencode' | 'agy' | 'claude';
export interface StoredModels { checkedAt: number; models: string[] }
export type RuntimeModels = Partial<Record<ModelRuntime, StoredModels>>;

const SAFE_ID = /^[\w./:-]+$/;
export const RUNTIME_MODELS_FILE = path.join(os.homedir(), '.askaway', 'runtime-models.json');

export function loadRuntimeModels(file = RUNTIME_MODELS_FILE): RuntimeModels {
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const result: RuntimeModels = {};
        for (const runtime of ['opencode', 'agy', 'claude'] as ModelRuntime[]) {
            const entry = raw?.[runtime];
            if (entry && Array.isArray(entry.models) && Number.isFinite(entry.checkedAt)) {
                result[runtime] = { checkedAt: entry.checkedAt, models: entry.models.filter((id: unknown) => typeof id === 'string' && SAFE_ID.test(id)) };
            }
        }
        return result;
    } catch { return {}; }
}

/** A check that found no models (signed out, server down) never wipes the last good list. */
export function recordRuntimeModels(runtime: ModelRuntime, models: string[], checkedAt: number, file = RUNTIME_MODELS_FILE): RuntimeModels {
    const stored = loadRuntimeModels(file);
    if (!models.length) { return stored; }
    const safe = [...new Set(models)].filter((id) => SAFE_ID.test(id));
    if (!safe.length) { return stored; }
    stored[runtime] = { checkedAt, models: safe };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
    return stored;
}

/** Worker model ids as the profiles and the Team dropdown write them: agy/<id>, claude/<alias>, and OpenCode's provider/model as is. */
export function namespacedModels(models: RuntimeModels, enabled: (runtime: ModelRuntime) => boolean = () => true): string[] {
    const ids: string[] = [];
    for (const runtime of ['opencode', 'agy', 'claude'] as ModelRuntime[]) {
        if (!enabled(runtime)) { continue; }
        for (const id of models[runtime]?.models ?? []) { ids.push(runtime === 'opencode' ? id : `${runtime}/${id}`); }
    }
    return ids;
}

/** `opencode models` prints one provider/model per line. */
export function parseOpenCodeModels(output: string): string[] {
    return output.split('\n').map((line) => line.trim()).filter((line) => /^[\w.-]+\/[\w./:-]+$/.test(line));
}
