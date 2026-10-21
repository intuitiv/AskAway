import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkerProfile, WorkerProfile, SHARED_VOICE, withSelection } from '../workers/workerProfiles';
import { MEMBERS_FILE, memberSelections } from '../team/roster';

/**
 * The read-only validator worker profile (portable spec, R-5/A18): purpose, model, prompt, MCP tool policy, file scope,
 * stop condition, evidence contract. No tool that sends anything to the agent: beta output only reaches Commentary.
 * Lives here (not in workerProfiles.ts) so the validator owns its definition; the OpenCode adapter is `toOpenCodeAgent`.
 */
export const VALIDATOR_PROFILE_MARKDOWN = `---
name: validator
description: "Read-only observer: answers the agent's question from the project's own sources, or says no source answers. Output goes to Commentary only."
tier: light
model: github-copilot/gpt-5.6-luna
thinking: low
models: [github-copilot/gpt-5.6-luna]
thinkingOptions: [low]
edit: deny
bash: deny
webfetch: deny
mcp: [askaway_copilot_memory, askaway_code_nav]
steps: 12
---
Purpose: decide what the reviewer would answer to the observed response, from GOALS.md, the active spec's Goal.md, Rules.md and spec.md, ADRs and stored knowledge. Cite the source of every claim, or say "no source answers".
${SHARED_VOICE}
Apply this voice to answer, summary, observations and impact; keep the required JSON schema and source citations unchanged.
File scope: read-only; no file is changed.
Stop condition: one answer, or "no source answers", or the step limit.
Evidence contract: emit exactly ONE JSON object on ONE line with these exact keys: {"answer":string|null,"sources":string[],"observations":string,"summary":string,"impact":string,"risk":"low"|"high","reversible":boolean,"confidence":number}. All keys are required. No prose, headings or Markdown fences around the object. Then emit Result: PASS on a separate line for the worker runtime. Confidence is 0..1. Cite supplied source ids exactly. Assess whether answering authorizes a low-risk reversible decision; destructive, irreversible, uncertain or unsourced decisions are high risk and must be held for the reviewer. Never include a secret. Never address or message the agent. Live answers require confidence >= 0.8; delivery is only via a requested tool result while enabled and Away.
`;

/** Priya's agent file: the user's copy of the profile above. Editing it changes the validator's prompt, model and thinking. */
export const VALIDATOR_AGENT_FILE = path.join(os.homedir(), '.askaway', 'validator', 'validator.md');

export function validatorProfile(file = VALIDATOR_AGENT_FILE, membersFile = MEMBERS_FILE): WorkerProfile {
    // Priya's Team dropdowns choose her model and thinking, in every workspace.
    const chosen = (profile: WorkerProfile) => withSelection(profile, memberSelections(membersFile).priya);
    try {
        if (fs.existsSync(file)) { return chosen(parseWorkerProfile(fs.readFileSync(file, 'utf8'), file)); }
    } catch { /* A broken edit never stops the validator: the built-in profile applies. */ }
    return chosen(parseWorkerProfile(VALIDATOR_PROFILE_MARKDOWN, 'validator-profile'));
}

/** Writes the default agent file on first use so the Team card's Agent file link always opens something. */
export function ensureValidatorAgentFile(file = VALIDATOR_AGENT_FILE): string {
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, VALIDATOR_PROFILE_MARKDOWN);
    }
    return file;
}
