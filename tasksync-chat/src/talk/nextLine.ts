import { redactOrDrop } from '../validator/redact';

/** The `Next:` line inside the `## Response Handoff` section of a final response, or undefined when there is none. */
export function extractNextLine(finalResponse: string): string | undefined {
    const heading = /^#{1,6}\s*Response\s+Handoff\s*$/im.exec(finalResponse);
    if (!heading) { return undefined; }
    const rest = finalResponse.slice(heading.index + heading[0].length);
    const end = rest.search(/\r?\n#{1,6}\s/);
    const line = (end < 0 ? rest : rest.slice(0, end)).split(/\r?\n/).map(item => item.trim()).find(item => /^Next:/i.test(item));
    const question = line?.replace(/^Next:\s*/i, '').trim();
    return question || undefined;
}

/** Dollars of a turn, the same figure the Telegram handoff banner shows. */
export function turnCostDollars(turnNanoAiu: number): string {
    return `$${((Number(turnNanoAiu) || 0) / 1_000_000_000 / 100).toFixed(2)}`;
}

/** R-AITALK-60: the one short AITalk message at turn end; undefined (post nothing) without a Next line or when it holds a credential. */
export function nextHandoffMessage(finalResponse: string, turnNanoAiu?: number): { text: string; meta?: { cost: string } } | undefined {
    const question = extractNextLine(finalResponse);
    if (!question) { return undefined; }
    const text = redactOrDrop(`Next: ${question}`);
    if (!text) { return undefined; }
    // The turn cost is a message field shown in the time row, never part of the text.
    return { text, ...(turnNanoAiu === undefined ? {} : { meta: { cost: turnCostDollars(turnNanoAiu) } }) };
}
