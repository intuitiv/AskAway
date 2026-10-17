import * as fs from 'fs';
import * as path from 'path';
import { CLAUDE_ASKAWAY_BUILD_AGENT, CLAUDE_SPEC_KIT_COMMANDS, SPEC_KIT_PROMPTS } from './specKitPromptAssets';

export interface SpecKitInstallTargets {
    /** VS Code user `prompts` folder: the Local harness reads `sk.*.prompt.md` here. */
    promptsDir: string;
    /** `~/.copilot`: the Copilot harness reads `skills/<name>/SKILL.md` here. */
    copilotHome: string;
    /** `~/.claude`: Claude Code reads `commands/*.md` and `agents/*.md` here. */
    claudeHome: string;
}

export interface SpecKitInstallResult {
    prompts: number;
    skills: number;
    claudeCommands: number;
    claudeAgent: boolean;
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

/**
 * The `sk.*` command names belong to AskAway, so they are kept current on every activation.
 * A reviewer-created file with any other name is never touched.
 */
export async function installSpecKitCommands(targets: SpecKitInstallTargets): Promise<SpecKitInstallResult> {
    const result: SpecKitInstallResult = { prompts: 0, skills: 0, claudeCommands: 0, claudeAgent: false };
    for (const [name, content] of Object.entries(SPEC_KIT_PROMPTS)) {
        if (await writeIfChanged(path.join(targets.promptsDir, name), content)) { result.prompts++; }
        const skillFile = path.join(targets.copilotHome, 'skills', skillNameFor(name), 'SKILL.md');
        if (await writeIfChanged(skillFile, promptToSkill(name, content))) { result.skills++; }
    }
    for (const [name, content] of Object.entries(CLAUDE_SPEC_KIT_COMMANDS)) {
        if (await writeIfChanged(path.join(targets.claudeHome, 'commands', name), content)) { result.claudeCommands++; }
    }
    const claudeAgent = path.join(targets.claudeHome, 'agents', 'askaway-build.md');
    if (await fs.promises.readFile(claudeAgent, 'utf8').catch(() => undefined) === undefined) {
        await writeIfChanged(claudeAgent, CLAUDE_ASKAWAY_BUILD_AGENT);
        result.claudeAgent = true;
    }
    return result;
}
