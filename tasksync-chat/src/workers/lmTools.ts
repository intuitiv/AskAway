import * as vscode from 'vscode';
import { invokeDefinition, ToolDefinition } from './workerTools';

/** VS Code adapter for shared tool definitions; package.json must declare the same names (checked by test-lm-tool-manifest.cjs). */
export function registerLmToolDefinitions(definitions: ToolDefinition[]): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    for (const definition of definitions) {
        try {
            disposables.push(vscode.lm.registerTool(definition.name, {
                invoke: async (options) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(await invokeDefinition(definition, options.input)),
                ]),
            }));
        } catch (error) {
            console.warn(`[AskAway] ${definition.name} tool registration failed:`, error);
        }
    }
    return disposables;
}
