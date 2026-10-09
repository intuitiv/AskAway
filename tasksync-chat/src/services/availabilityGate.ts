import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { commentaryKey } from '../commentary/commentary';

export function updatePolicy(mode: string) {
    const away = mode.startsWith('away');
    return { startAlert: away, liveStatus: away, final: away || mode === 'offline', endAlert: away, notify: away };
}

export function availabilityPolicy(workspace: string, home = os.homedir(), now = Date.now()) {
    // Test hook: pins the mode so tests never read the reviewer's real ~/.askaway state.
    if (process.env.ASKAWAY_AVAILABILITY_MODE) { return updatePolicy(process.env.ASKAWAY_AVAILABILITY_MODE); }
    try {
        const state = JSON.parse(fs.readFileSync(path.join(home, '.askaway', 'availability', `${commentaryKey(workspace)}.json`), 'utf8'));
        return updatePolicy(state.until && Date.parse(state.until) <= now ? 'here' : String(state.mode ?? 'here'));
    } catch { return updatePolicy('here'); }
}
