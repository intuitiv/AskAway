import * as fs from 'fs';
import * as path from 'path';
import { ASKWAY_BUILD_AGENT_FILE, ASKWAY_BUILD_AGENT_CONTENT } from './askawayBuildAgent';

/**
 * Agent files AskAway ships are owned by AskAway (reviewer, 2026-10-23: "All the agent files we ship are owned by us.
 * When we enable feature to add their own members, they are owned by them."). A shipped file is recognised by its file
 * name only and is rewritten whenever its content differs; any other agent file is the user's and is never touched.
 */
export interface ShippedAgent {
    /** File name, e.g. askaway-build.agent.md; the only thing that makes a file "shipped". */
    file: string;
    /** Full file text with the VS Code (native) tool list in its frontmatter. */
    content: string;
    /** Where it is written. The Copilot harness dir is always written; the VS Code prompts dir only when `vscode` is set. */
    vscode: boolean;
    /** Frontmatter lists every AskAway tool from package.json (Build); false keeps the shipped list (Orchestrator). */
    allAskAwayTools: boolean;
}

export const ASKAWAY_TOOL_PREFIX = 'intuitiv.askaway/';
/** Non-AskAway tools of the Copilot harness copy when no earlier copy exists to take them from. */
export const COPILOT_DEFAULT_TOOLS = ['vscode/runCommand', 'execute', 'read/getNotebookSummary', 'read/problems', 'read/readFile', 'read/readNotebookCellOutput', 'read/terminalSelection', 'read/terminalLastCommand', 'read/getTaskOutput', 'edit', 'search/codebase', 'search/fileSearch', 'search/listDirectory', 'search/usages', 'web', 'vscodeTasks/getTaskOutput', 'vscodeTasks/problems', 'vscodeGeneral/usages', 'vscodeNotebooks/getNotebookSummary', 'vscodeNotebooks/readNotebookCellOutput'];

const TOOLS_LINE = /^tools:\s*\[([^\]\n]*)\]\s*$/m;
const toolsOf = (text: string | undefined): string[] => {
    const match = text ? TOOLS_LINE.exec(text) : null;
    return match ? match[1].split(',').map(entry => entry.trim()).filter(Boolean) : [];
};
const withTools = (text: string, tools: string[]): string => text.replace(TOOLS_LINE, () => `tools: [${tools.join(', ')}]`);
const nonAskAway = (tools: string[]) => tools.filter(tool => !tool.startsWith(ASKAWAY_TOOL_PREFIX));

/** The shipped body with the tool list the target harness expects; the body is identical for every target. */
export function agentTextFor(shipped: ShippedAgent, target: 'copilot' | 'vscode', toolReferenceNames: string[], existingCopilotText?: string): string {
    if (!shipped.allAskAwayTools) { return shipped.content; }
    const askaway = toolReferenceNames.map(ref => `${ASKAWAY_TOOL_PREFIX}${ref}`);
    const others = target === 'copilot'
        ? (nonAskAway(toolsOf(existingCopilotText)).length ? nonAskAway(toolsOf(existingCopilotText)) : COPILOT_DEFAULT_TOOLS)
        : nonAskAway(toolsOf(shipped.content));
    return withTools(shipped.content, [...others, ...askaway]);
}

export function shippedAgents(orchestratorContent?: string): ShippedAgent[] {
    const agents: ShippedAgent[] = [{ file: ASKWAY_BUILD_AGENT_FILE, content: ASKWAY_BUILD_AGENT_CONTENT, vscode: true, allAskAwayTools: true }];
    if (orchestratorContent) { agents.push({ file: 'AA.Orchestrator.agent.md', content: orchestratorContent, vscode: false, allAskAwayTools: false }); }
    return agents;
}

export interface InstallOptions {
    agents: ShippedAgent[];
    copilotAgentsDir: string;
    promptsDir: string;
    toolReferenceNames: string[];
    log: (message: string, detail?: unknown) => void;
}

/** Writes every shipped agent to its targets when the content differs; the first replacement keeps one `.bak`. Never throws. */
export async function installShippedAgentFiles(options: InstallOptions): Promise<{ written: string[]; unchanged: string[] }> {
    const written: string[] = [];
    const unchanged: string[] = [];
    for (const agent of options.agents) {
        const targets: Array<{ dir: string; kind: 'copilot' | 'vscode' }> = [{ dir: options.copilotAgentsDir, kind: 'copilot' }];
        if (agent.vscode) { targets.push({ dir: options.promptsDir, kind: 'vscode' }); }
        for (const { dir, kind } of targets) {
            const target = path.join(dir, agent.file);
            try {
                await fs.promises.mkdir(dir, { recursive: true });
                const existing = await fs.promises.readFile(target, 'utf8').catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') { return undefined; } throw err; });
                const wanted = agentTextFor(agent, kind, options.toolReferenceNames, kind === 'copilot' ? existing : undefined);
                if (existing === wanted) { unchanged.push(target); continue; }
                if (existing !== undefined) {
                    await fs.promises.copyFile(target, `${target}.bak`, fs.constants.COPYFILE_EXCL).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'EEXIST') { throw err; } });
                }
                await fs.promises.writeFile(target, wanted, 'utf8');
                written.push(target);
                options.log('Wrote AskAway-owned agent file (it is replaced on every release; copy it to a new name to customise)', { target, replaced: existing !== undefined });
            } catch (err) {
                options.log('Warning: Could not write AskAway agent file', { target, error: err instanceof Error ? err.message : String(err) });
            }
        }
    }
    return { written, unchanged };
}
