/**
 * Centralized branding constants for the AskAway fork.
 * 
 * This file is the ONLY place where fork-specific naming differs from upstream (TaskSync).
 * When merging upstream changes, if new code uses `getConfiguration('tasksync')` or
 * references `taskSyncView`, update it to use these constants instead.
 * 
 * Upstream equivalents:
 *   CONFIG_NAMESPACE = 'tasksync'
 *   VIEW_TYPE = 'taskSyncView'
 *   VIEW_FOCUS_COMMAND = 'taskSyncView.focus'
 *   MCP_SERVER_NAME = 'tasksync-chat'
 *   EXTENSION_DISPLAY_NAME = 'TaskSync'
 *   OUTPUT_CHANNEL_NAME = 'TaskSync'
 *   DEBUG_LOG_FILENAME = 'tasksync-debug.log'
 */

/** VS Code configuration namespace — must match package.json settings prefix */
export const CONFIG_NAMESPACE = 'askaway';

/** Webview view type — must match package.json contributes.views id */
export const VIEW_TYPE = 'askAwayView';

/** Command to focus the sidebar view */
export const VIEW_FOCUS_COMMAND = 'askAwayView.focus';

/** MCP server registration name */
export const MCP_SERVER_NAME = 'askaway';

/** Display name shown in UI */
export const EXTENSION_DISPLAY_NAME = 'AskAway';

/** VS Code Output Channel name */
export const OUTPUT_CHANNEL_NAME = 'AskAway';

/** Debug log filename (written to user's home directory) */
export const DEBUG_LOG_FILENAME = 'askaway-debug.log';

/** Log prefix for console messages */
export const LOG_PREFIX = '[AskAway]';
