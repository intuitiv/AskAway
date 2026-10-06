import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The full agent response as a mobile-friendly PDF (reviewer 2026-10-06: send the response as a pdf rather than whole text).
 * Uses the same md-to-pdf converter as share-with-me, without share-with-me's remote push. When the converter is
 * missing or fails, the markdown file itself is returned so the response is never lost.
 */
export interface ResponseFile { file: string; kind: 'pdf' | 'md'; cleanup(): void; }

export interface ResponsePdfOptions { converter?: string; timeoutMs?: number; tmpDir?: string; }

export const DEFAULT_MD_TO_PDF = path.join(os.homedir(), '.local', 'bin', 'md-to-pdf');

export async function renderResponseFile(markdown: string, options: ResponsePdfOptions = {}): Promise<ResponseFile> {
    const dir = fs.mkdtempSync(path.join(options.tmpDir ?? os.tmpdir(), 'askaway-response-'));
    const md = path.join(dir, 'response.md');
    const pdf = path.join(dir, 'response.pdf');
    fs.writeFileSync(md, markdown, 'utf8');
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir; best effort */ } };
    const converter = options.converter ?? process.env.ASKAWAY_MD_TO_PDF ?? DEFAULT_MD_TO_PDF;
    const converted = await new Promise<boolean>(resolve => {
        if (!fs.existsSync(converter)) { resolve(false); return; }
        execFile(converter, [md, pdf], { env: { ...process.env, MD_PDF_LAYOUT: 'mobile' }, timeout: options.timeoutMs ?? 60_000 }, error => {
            resolve(!error && fs.existsSync(pdf) && fs.statSync(pdf).size > 0);
        });
    });
    return converted ? { file: pdf, kind: 'pdf', cleanup } : { file: md, kind: 'md', cleanup };
}
