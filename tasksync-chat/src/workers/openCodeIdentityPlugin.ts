import * as fs from 'fs';
import * as path from 'path';

/** The only file AskAway writes into OpenCode's plugin folder. */
export const IDENTITY_PLUGIN_FILE = 'askaway-identity.js';

/**
 * Real OpenCode workers send no `_meta` on MCP calls. This plugin runs inside OpenCode and, before every AskAway MCP tool
 * (OpenCode names them `askaway_<tool>`), puts the calling OpenCode session id into the call's arguments as
 * `_meta.openCodeSessionId`. The AskAway MCP server removes `_meta` again and maps the session to the worker it started.
 */
export function identityPluginSource(): string {
    return `// AskAway generated OpenCode plugin: tells the AskAway MCP server which OpenCode session made a tool call.
// Rewritten by AskAway on start-up; edit nothing here.
export const AskAwayIdentity = async () => ({
    'tool.execute.before': async (input, output) => {
        if (typeof input?.tool !== 'string' || !input.tool.startsWith('askaway_') || !input.sessionID) return;
        if (!output.args || typeof output.args !== 'object') return;
        // Replaced whole: whatever the model put in _meta (a forged recipient or workspace) is thrown away.
        output.args._meta = { openCodeSessionId: input.sessionID };
    },
});
`;
}

/** Writes the plugin into `pluginDir` only when it differs, atomically (temp file + rename). Returns true when it wrote. */
export function syncOpenCodeIdentityPlugin(pluginDir: string): boolean {
    const file = path.join(pluginDir, IDENTITY_PLUGIN_FILE);
    const source = identityPluginSource();
    try { if (fs.readFileSync(file, 'utf8') === source) return false; } catch { /* missing: write it */ }
    const temp = `${file}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(temp, source);
        fs.renameSync(temp, file);
    } catch (error) {
        try { fs.rmSync(temp, { force: true }); } catch { /* nothing to remove */ }
        throw error;
    }
    return true;
}
