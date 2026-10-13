// One safe markdown renderer for AITalk message bodies: HTML is escaped first, then a small,
// fixed markdown subset is applied. Links only allow http(s) URLs.
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// `decorate` receives escaped text outside code spans (e.g. to highlight @mentions).
export function inlineMarkdown(text, decorate = value => value) {
    const codes = [];
    let html = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
    html = decorate(html)
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

export const hasBlockMarkdown = text => /\n|^\s*(?:[-*•] |\d+[.)] |#{1,6} |> |```)/.test(String(text || ''));

// Paragraphs, "- " / "1. " lists, "#" headings, "> " quotes and ``` fences.
export function markdownHtml(text, decorate) {
    const out = [];
    let paragraph = [], list;
    const inline = line => inlineMarkdown(line, decorate);
    const flushParagraph = () => { if (paragraph.length) out.push(`<p>${paragraph.join('<br>')}</p>`); paragraph = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${item}</li>`).join('')}</${list.tag}>`); list = undefined; };
    const flush = () => { flushParagraph(); flushList(); };
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
            flush();
            const code = [];
            while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
            out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            continue;
        }
        const bullet = line.match(/^\s*[-*•] +(.*)$/), numbered = line.match(/^\s*\d+[.)] +(.*)$/);
        if (bullet || numbered) {
            flushParagraph();
            const tag = bullet ? 'ul' : 'ol';
            if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
            list.items.push(inline((bullet || numbered)[1]));
            continue;
        }
        flushList();
        const heading = line.match(/^\s*#{1,6} +(.*)$/);
        if (heading) { flushParagraph(); out.push(`<p class="talk-md-heading"><strong>${inline(heading[1])}</strong></p>`); continue; }
        const quote = line.match(/^\s*&gt; ?(.*)$|^\s*> ?(.*)$/);
        if (quote) { flushParagraph(); out.push(`<blockquote>${inline(quote[2] ?? quote[1])}</blockquote>`); continue; }
        if (!line.trim()) { flushParagraph(); continue; }
        paragraph.push(inline(line));
    }
    flush();
    return out.join('');
}
