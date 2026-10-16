import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** The user's global git name; `--global` never reads the workspace repo's local config. */
export async function gitGlobalUserName(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
    try { return (await execFileAsync('git', ['config', '--global', 'user.name'], { cwd, env })).stdout.trim(); } catch { return ''; }
}

/** AITalk's user name from user-level sources only, so every workspace shows the same avatar:
 *  the application-scope setting, then global git user.name, then the OS account. */
export async function aitalkUserName(configured: string | undefined, globalGitName: () => Promise<string>, account: () => string = () => os.userInfo().username): Promise<string> {
    return configured?.trim() || (await globalGitName()) || account();
}

export function aitalkUserPhoto(configured: string, workspaceRoot: string, home: string = os.homedir()): string {
    const target = configured.trim() || path.join(home, '.askaway', 'profile', 'avatar.png');
    if (/^https?:\/\//i.test(target)) return target;
    const file = target.startsWith('~/') ? path.join(home, target.slice(2)) : path.resolve(workspaceRoot, target);
    const extension = path.extname(file).slice(1).toLowerCase();
    const mime = extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension;
    try { return 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64'); } catch { return ''; }
}
