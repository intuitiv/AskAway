/** The context lead-in of a Validator post, written by code so every Priya bubble says what it answers. Pure: Storybook and tests reuse it. */
export type ValidatorContextKind = 'turnEnd' | 'turnEndNoGuess' | 'observation' | 'message';
export interface ValidatorContextParent { authorName: string; authorKind?: string; text?: string; kind?: string }

const QUOTE_MAX = 60;

function quote(text: string | undefined): string {
    const plain = String(text ?? '').replace(/^\s*@\S+\s*/, '').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    return ` "${plain.length > QUOTE_MAX ? plain.slice(0, QUOTE_MAX - 1).trimEnd() + '…' : plain}"`;
}

/**
 * `turnEnd`: the Validator predicts the reviewer's reply to the main agent's final response (`parent` is that agent).
 * `message`: it answers the replied-to message by `parent`. `observation`: nothing to answer.
 */
export function validatorContextLine(parent: ValidatorContextParent | undefined, kind: ValidatorContextKind): string {
    if (kind === 'turnEnd') return 'My take would be:';
    if (kind === 'turnEndNoGuess') return "Honestly, I've got nothing solid on this one.";
    if (kind === 'observation' || !parent) return 'Observation:';
    const name = parent.authorName || 'someone';
    const fromAgent = parent.authorKind === 'agent' || parent.authorKind === 'worker';
    if (fromAgent && parent.kind === 'heads-up') return `Answering ${name}'s heads-up:${quote(parent.text)}`;
    return /\?/.test(parent.text ?? '') ? `Re: ${name}'s question:${quote(parent.text)}` : `Re: ${name}:${quote(parent.text)}`;
}

/** Puts the lead-in on the first line; the model's answer body follows. A body that already starts with the lead-in is left alone. */
export function withValidatorContext(line: string, body: string): string {
    return body.startsWith(line) ? body : `${line}\n${body}`;
}
