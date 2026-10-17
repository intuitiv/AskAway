import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_ASKAWAY_BUILD_AGENT, CLAUDE_SPEC_KIT_COMMANDS, SPEC_KIT_PROMPTS } from './specKitPromptAssets';

export interface SpecKitInstallTargets {
    /** VS Code user `prompts` folder. */
    promptsDir: string;
    /** `~/.copilot`. */
    copilotHome: string;
}

/** Skill names allow only lowercase letters, digits and hyphens, so `/sk.plan` is `/sk-plan` in the Copilot harness. */
export function skillNameFor(promptFile: string): string {
    return promptFile.replace(/\.prompt\.md$/, '').replace(/\./g, '-');
}

/** Convert a Local prompt file into a Copilot harness skill that is only run when the user types it. */
export function promptToSkill(promptFile: string, promptText: string): string {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(promptText);
    const frontmatter = match ? match[1] : '';
    const body = (match ? match[2] : promptText).trim();
    const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1].trim().replace(/^["']|["']$/g, '') ?? `AskAway ${skillNameFor(promptFile)}`;
    return `---\nname: ${skillNameFor(promptFile)}\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: true\n---\n${body}\n`;
}

async function writeIfChanged(file: string, content: string): Promise<boolean> {
    const existing = await fs.promises.readFile(file, 'utf8').catch(() => undefined);
    if (existing === content) { return false; }
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, content, 'utf8');
    return true;
}

/** Folder (relative to the extension root) and file for each contributed `/sk-*` skill and `/sk.*` prompt. */
export function contributedSkillPath(promptFile: string): string {
    return `skills/${skillNameFor(promptFile)}/SKILL.md`;
}
export function contributedPromptPath(promptFile: string): string {
    return `prompts/${promptFile}`;
}

/** Every file the extension contributes through `chatSkills` and `chatPromptFiles`, keyed by relative path. */
export function contributedSpecKitFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries(SPEC_KIT_PROMPTS)) {
        files[contributedPromptPath(name)] = content;
        files[contributedSkillPath(name)] = promptToSkill(name, content);
    }
    return files;
}

/**
 * Skills and prompts reach every harness through the `chatSkills` / `chatPromptFiles` contribution points.
 * Copies an earlier version wrote into the user folders would show each command twice, so remove them.
 * Only `sk.*` prompt files and `sk-*` skill folders (AskAway's names) are touched.
 */
export async function removeLegacySpecKitCopies(targets: SpecKitInstallTargets): Promise<number> {
    let removed = 0;
    for (const name of Object.keys(SPEC_KIT_PROMPTS)) {
        const prompt = path.join(targets.promptsDir, name);
        if (await fs.promises.rm(prompt).then(() => true, () => false)) { removed++; }
        const skillDir = path.join(targets.copilotHome, 'skills', skillNameFor(name));
        const entries = await fs.promises.readdir(skillDir).catch(() => undefined);
        if (entries && entries.every(entry => entry === 'SKILL.md')) {
            await fs.promises.rm(skillDir, { recursive: true, force: true });
            removed++;
        }
    }
    return removed;
}

/** Claude Code has no contribution point, so its `/sk.*` commands and agent are written to `~/.claude`. */
export async function installClaudeSpecKitCommands(claudeHome: string): Promise<{ claudeCommands: number; claudeAgent: boolean }> {
    const result = { claudeCommands: 0, claudeAgent: false };
    for (const [name, content] of Object.entries(CLAUDE_SPEC_KIT_COMMANDS)) {
        if (await writeIfChanged(path.join(claudeHome, 'commands', name), content)) { result.claudeCommands++; }
    }
    const claudeAgent = path.join(claudeHome, 'agents', 'askaway-build.md');
    if (await fs.promises.readFile(claudeAgent, 'utf8').catch(() => undefined) === undefined) {
        await writeIfChanged(claudeAgent, CLAUDE_ASKAWAY_BUILD_AGENT);
        result.claudeAgent = true;
    }
    return result;
}
