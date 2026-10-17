import * as path from 'path';

/**
 * Copilot harness (VS Code 1.140+) runs user hooks from ~/.copilot/hooks/*.json inside the session
 * sandbox when `chat.agent.sandbox.enabled` is on. A hook that cannot start (exit 126/127) is a failure,
 * and a failed `preToolUse` hook is fail-closed: every tool call is denied. AskAway hooks are
 * observability and rewrite helpers, so they must never block the agent.
 */

export const SANDBOX_PATHS_SETTING = 'chat.agent.sandbox.fileSystem.userConfiguredPaths';

const FAIL_OPEN_SUFFIX = ' || exit 0';

function shellQuote(filePath: string): string {
    return /\s/.test(filePath) ? `'${filePath.replace(/'/g, `'\\''`)}'` : filePath;
}

/** Make a hook command exit 0 when the script cannot be started (sandbox denial, missing file). */
export function failOpenCommand(command: string): string {
    return command.trimEnd().endsWith(FAIL_OPEN_SUFFIX.trim()) ? command : `${command}${FAIL_OPEN_SUFFIX}`;
}

/** Cross-platform Copilot command hook entry (`command` is copied to bash/powershell by the harness). */
export function copilotCommandHook(command: string, timeoutSec: number): { type: 'command'; command: string; cwd: string; timeout: number } {
    return { type: 'command', command: failOpenCommand(command), cwd: '.', timeout: timeoutSec };
}

/** camelCase `preToolUse` entry (explicit bash/powershell fields, `timeoutSec`). */
export function copilotShellHook(command: string, timeoutSec: number): { type: 'command'; bash: string; powershell: string; cwd: string; timeoutSec: number } {
    const guarded = failOpenCommand(command);
    return { type: 'command', bash: guarded, powershell: guarded, cwd: '.', timeoutSec };
}

export interface SandboxPaths {
    readwritePaths?: string[];
    readonlyPaths?: string[];
    deniedPaths?: string[];
}

/** Paths the AskAway hook scripts read and write. */
export function hookSandboxPaths(home: string, userDataDir: string): Required<Pick<SandboxPaths, 'readwritePaths' | 'readonlyPaths'>> {
    return {
        readwritePaths: [path.join(home, '.askaway')],
        readonlyPaths: [
            path.join(userDataDir, 'workspaceStorage'),
            path.join(home, '.copilot', 'session-state'),
        ],
    };
}

/**
 * Merge the wanted grants into the user's existing sandbox path settings.
 * Returns undefined when nothing needs to change. A path the user denied stays denied;
 * a read-only grant is satisfied by an existing read/write grant.
 */
export function mergeSandboxPaths(
    current: SandboxPaths | undefined,
    wanted: Required<Pick<SandboxPaths, 'readwritePaths' | 'readonlyPaths'>>,
): SandboxPaths | undefined {
    const base: SandboxPaths = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const asList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
    const readwrite = asList(base.readwritePaths);
    const readonly = asList(base.readonlyPaths);
    const denied = new Set(asList(base.deniedPaths));
    let changed = false;
    for (const p of wanted.readwritePaths) {
        if (!denied.has(p) && !readwrite.includes(p)) { readwrite.push(p); changed = true; }
    }
    for (const p of wanted.readonlyPaths) {
        if (!denied.has(p) && !readwrite.includes(p) && !readonly.includes(p)) { readonly.push(p); changed = true; }
    }
    return changed ? { ...base, readwritePaths: readwrite, readonlyPaths: readonly } : undefined;
}

/** hooks config for the spec-context injector and the compact-chat capture (UserPromptSubmit / Stop). */
export function conversationHooksConfig(hooksDir: string): { version: 1; hooks: Record<string, unknown[]> } {
    const q = (file: string) => shellQuote(path.join(hooksDir, file));
    return {
        version: 1,
        hooks: {
            UserPromptSubmit: [copilotCommandHook(`node ${q('spec-context-inject.cjs')}`, 5)],
            Stop: [copilotCommandHook(`node ${q('compact-chat-capture.cjs')}`, 10)],
        },
    };
}
