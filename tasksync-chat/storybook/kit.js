// Turns the real webview sources into Storybook-ready pieces. Pure: no Vite, no DOM. Also used by test-commentary-ui.cjs.
function slice(text, start, end, label) {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from);
    if (from < 0 || to < 0) { throw new Error(`storybook kit: cannot find ${label}`); }
    return text.slice(from, to + end.length);
}

export function buildCommentaryKit({ webviewSrc, providerSrc }) {
    const code = slice(webviewSrc, '// ── Commentary tab: pure render', '// ── end Commentary pure render ──', 'render block')
        + '\n' + slice(webviewSrc, '// ── Commentary typewriter', '// ── end Commentary typewriter ──', 'typewriter block');
    const fns = new Function(`${code}\nreturn { renderCommentaryHtml, commentaryOpenCount, commentaryTypewrite, commentaryAnimateNew };`)();
    const panelHtml = slice(providerSrc, '<div class="tab-panel" id="panel-commentary">', '</div><!-- End panel-commentary -->', 'panel markup')
        .replace('class="tab-panel"', 'class="tab-panel active"');
    return { ...fns, panelHtml };
}

// VS Code Dark Modern values, so stories look like the real sidebar.
export const VSCODE_DARK_THEME = `:root{--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-editor-font-family:Menlo,monospace;
--vscode-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;
--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-charts-green:#89d185;--vscode-charts-blue:#3794ff;--vscode-charts-yellow:#cca700;
--vscode-charts-red:#f14c4c;--vscode-list-hoverBackground:#2a2d2e;}
.aa-sidebar{width:380px;min-height:560px;padding:10px;box-sizing:border-box;background:#181818;color:var(--vscode-foreground);
font-family:var(--vscode-font-family);font-size:13px;border:1px solid #2b2b2b}`;
