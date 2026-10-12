const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
async function sample({ request, write }) {
    const me = (await request('/people/me')).data.id;
    const rooms = (await request('/rooms?sortBy=lastactivity&max=100')).data.items || [];
    const messages = [], seen = new Set();
    for (const room of rooms) {
        let next = `/messages?roomId=${encodeURIComponent(room.id)}&max=100`, pages = 0;
        while (next && messages.length < 200 && pages++ < 20) {
            const result = await request(next);
            for (const row of result.data.items || []) {
                if (row.personId !== me || seen.has(row.id) || messages.length >= 200) continue;
                seen.add(row.id);
                const text = String(row.text || row.markdown || '').split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join('\n').split(/\n(?:--\s*\n|Sent from |On .+wrote:)/)[0].trim();
                if (text) messages.push({ id: row.id, roomId: room.id, created: row.created, text });
            }
            next = result.next;
        }
        if (messages.length >= 200) break;
    }
    const result = { sampledAt: new Date().toISOString(), messages }; await write(result); return result;
}
async function main() {
    const token = execFileSync('security', ['find-generic-password', '-a', 'vibecoding', '-s', 'webex-access-token', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!token) throw Error('No credential');
    await sample({ request: async endpoint => {
        const url = endpoint.startsWith('/') ? new URL(`https://webexapis.com/v1${endpoint}`) : new URL(endpoint);
        if (url.origin !== 'https://webexapis.com' || !url.pathname.startsWith('/v1/')) throw Error('Invalid paging URL');
        const response = await fetch(url, { redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw Error('Request failed');
        const text = await response.text(); if (text.includes(token)) throw Error('Unsafe response');
        return { data: JSON.parse(text), next: /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') || '')?.[1] };
    }, write: async data => {
        const cache = path.join(__dirname, '../.webex-cache'); await fs.mkdir(cache, { recursive: true });
        await fs.writeFile(path.join(cache, 'style-sample.json'), JSON.stringify(data, null, 2), { mode: 0o600 });
    } });
    console.log('Webex style sample saved.');
}
module.exports = { sample };
if (require.main === module) main().catch(() => { console.error('Webex style sampling failed.'); process.exitCode = 1; });
