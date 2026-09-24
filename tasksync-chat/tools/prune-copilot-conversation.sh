#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "Usage: $0 --input <conversation.jsonl> --title <title> --output <handoff.json>" >&2
    exit 64
}

input=""
title=""
output=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --input) input="${2:-}"; shift 2 ;;
        --title) title="${2:-}"; shift 2 ;;
        --output) output="${2:-}"; shift 2 ;;
        *) usage ;;
    esac
done

[[ -n "$input" && -n "$title" && -n "$output" ]] || usage
[[ -f "$input" ]] || { echo "Input does not exist: $input" >&2; exit 66; }

node - "$input" "$title" "$output" <<'NODE'
const fs = require('fs');
const readline = require('readline');
const [input, title, output] = process.argv.slice(2);
let malformedLines = 0;
let matchedSnapshots = 0;
let selected;

function titleOf(record) {
  return record.title ?? record.conversationTitle ?? record.attrs?.title ?? record.attrs?.conversationTitle;
}

function messagesOf(record) {
  let messages = record.attrs?.inputMessages;
  if (typeof messages === 'string') {
    try {
      messages = JSON.parse(messages);
    } catch {
      return null;
    }
  }
  return Array.isArray(messages) ? messages : null;
}

function visibleText(message) {
  return (message.parts || [])
    .filter(part => part?.type === 'text')
    .map(part => String(part.content ?? ''))
    .join('\n')
    .trim();
}

(async () => {
  for await (const line of readline.createInterface({ input: fs.createReadStream(input) })) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    const messages = messagesOf(record);
    const matches = titleOf(record) === title || (messages && JSON.stringify(messages).includes(title));
    if (!messages || !matches) continue;
    matchedSnapshots += 1;
    const bytes = Buffer.byteLength(JSON.stringify(messages));
    if (!selected || bytes > selected.bytes) selected = { messages, bytes };
  }
  if (!selected) {
    console.error(`No request snapshot matched title: ${title}`);
    process.exit(65);
  }

  const visible = selected.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({ role: message.role, text: visibleText(message) }))
    .filter(message => message.text);
  const lastUser = visible.slice().reverse().find(message => message.role === 'user');
  const lastAssistant = visible.slice().reverse().find(message => message.role === 'assistant');
  if (!lastUser || !lastAssistant) {
    console.error(`Matched title has no visible user/assistant handoff pair: ${title}`);
    process.exit(65);
  }

  const toolResponsesPruned = selected.messages.filter(message => message.role === 'tool').length;
  const toolCallsPruned = selected.messages.reduce((count, message) => count + (message.parts || []).filter(part => part?.type === 'tool_call').length, 0);
  const handoff = {
    format: 'askaway-pruned-handoff-v2',
    title,
    strategy: 'largest-title-matched-snapshot, newest-visible-user-assistant-pair',
    messages: [lastUser, lastAssistant],
    toolCallsPruned,
    toolResponsesPruned,
    toolResponses: toolResponsesPruned > 0 ? 'Pruned' : 'None',
    malformedLinesSkipped: malformedLines,
    matchedSnapshots
  };
  const serialized = JSON.stringify(handoff, null, 2) + '\n';
  fs.writeFileSync(output, serialized);
  const outputBytes = Buffer.byteLength(serialized);
  console.log(`Matched snapshots: ${matchedSnapshots}`);
  console.log(`Tool calls pruned: ${toolCallsPruned}`);
  console.log(`Tool responses pruned: ${toolResponsesPruned}`);
  console.log(`Snapshot: ${selected.bytes} B -> ${outputBytes} B (${((1 - outputBytes / selected.bytes) * 100).toFixed(1)}% reduction)`);
  console.log(`Approx tokens: ${Math.round(selected.bytes / 4)} -> ${Math.round(outputBytes / 4)}`);
})();
NODE