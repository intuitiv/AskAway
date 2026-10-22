'use strict';
// Transport adapter only: forward agy's original JSON-RPC, including params._meta.
let session;
let chain = Promise.resolve();
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    chain = chain.then(async () => {
        const response = await fetch(process.argv[2], { method: 'POST', headers: {
            'content-type': 'application/json', accept: 'application/json, text/event-stream',
            ...(session ? { 'mcp-session-id': session } : {}),
        }, body: line });
        session = response.headers.get('mcp-session-id') || session;
        const text = await response.text();
        if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
        if (!text.trim()) return;
        if (/^data:/m.test(text)) {
            for (const part of text.split('\n')) if (part.startsWith('data:')) process.stdout.write(part.slice(5).trim() + '\n');
        } else process.stdout.write(text.trim() + '\n');
    }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
});
