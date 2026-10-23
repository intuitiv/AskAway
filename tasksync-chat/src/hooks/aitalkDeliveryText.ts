/** The one text format for queued reviewer messages: used by AskAway tool results (delivery.ts) and by the PostToolUse hook spool. */
export const AITALK_QUEUE_LABEL = 'ADDITIONAL MESSAGES FROM THE USER. These are NOT part of the tool result above; the user sent them while you were working. They take priority: answer each one by calling the aitalk tool (action say) with replyTo set to the message id. If a message needs no answer, react with a thumbs-up instead (aitalk action react, text 👍, replyTo the message id).';

/** Tells the main agent its AITalk roster name; `name` comes from the roster, never a literal. */
export function aitalkNameLine(name: string): string {
    return `You are ${name}, the main agent in the AITalk room; messages addressed @${name} are for you.`;
}

/** The block appended after a tool result (or printed by the hook): optional name line, the label, then the messages as JSON. */
export function aitalkDeliveryBlock(received: unknown[], agentName?: string): string {
    return `${agentName ? `${aitalkNameLine(agentName)}\n\n` : ''}${AITALK_QUEUE_LABEL}\n${JSON.stringify(received)}`;
}
