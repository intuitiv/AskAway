import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TerminalLaunch { file: string; args: string[]; script?: { path: string; content: string } }

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** How to run an allowlisted command in the OS default terminal app, outside VS Code. */
export function terminalAppLaunch(command: string, cwd: string, platform: NodeJS.Platform = process.platform, tmpDir = '/tmp/aa'): TerminalLaunch {
    if (platform === 'darwin') {
        // `open` on a .command file uses whichever terminal app the user made the default for it.
        const script = path.join(tmpDir, `opencode-session-${Date.now()}.command`);
        return { file: 'open', args: [script], script: { path: script, content: `#!/bin/zsh -l\ncd ${quote(cwd)}\n${command}\n` } };
    }
    if (platform === 'win32') {
        return { file: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${cwd}" && ${command}`] };
    }
    return { file: 'x-terminal-emulator', args: ['-e', 'sh', '-c', `cd ${quote(cwd)} && ${command}; exec sh`] };
}

export function openInTerminalApp(command: string, cwd: string): void {
    const launch = terminalAppLaunch(command, cwd);
    if (launch.script) {
        fs.mkdirSync(path.dirname(launch.script.path), { recursive: true });
        fs.writeFileSync(launch.script.path, launch.script.content, { mode: 0o755 });
    }
    childProcess.spawn(launch.file, launch.args, { detached: true, stdio: 'ignore' }).unref();
}
