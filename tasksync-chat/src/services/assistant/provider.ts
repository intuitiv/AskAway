import type { ToolDefinition } from '../../workers/workerTools';

/**
 * Provider seam for Cathy's assistant tools (ADR 0035, spec 009 US8).
 * Webex is the first provider; Outlook can follow without touching the approval card or the tool registry.
 * Types and a tiny registry only: no provider behaviour lives here.
 */

/** A thing a follow-up call can point at: a short opaque `ref` (s3, m12, p4) plus the name the reviewer sees. */
export interface AssistantCandidate { ref: string; label: string; kind: string }

export interface AssistantProvider {
    /** Stable provider id: 'webex', 'outlook', ... */
    id: 'webex' | 'outlook' | (string & {});
    /** Human name shown in approval cards. */
    label: string;
    tools(): ToolDefinition[];
    /** Optional: turn a human name into candidates with refs. Ambiguous names return several, never a guess. */
    resolve?(name: string, kind?: string): Promise<AssistantCandidate[]>;
}

export type ApprovalAction = 'send' | 'reply' | 'edit' | 'delete' | 'upload' | 'create_event' | (string & {});

/** What the reviewer is asked to approve. Every field is human text: there is deliberately no id field. */
export interface ApprovalRequest {
    provider: string;
    action: ApprovalAction;
    /** A space, person or calendar NAME. Never an id. */
    targetLabel: string;
    /** The full text that will be sent, never collapsed. */
    body: string;
    /** Extra human-readable context, e.g. { Thread: 'Release plan' }. */
    details?: Record<string, string>;
    /** File names to upload. */
    files?: string[];
}

export type ApprovalOutcome =
    | { status: 'approved'; result?: Record<string, unknown> }
    | { status: 'rejected' }
    | { status: 'unavailable' };

export type ApprovalHandler = (req: ApprovalRequest) => Promise<ApprovalOutcome>;

const ALLOWED_REQUEST_KEYS = new Set(['provider', 'action', 'targetLabel', 'body', 'details', 'files']);
const WEBEX_ID_PREFIX = 'Y2lzY29zcGFyazov'; // base64 of "ciscospark:/"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_TOKEN = /^[A-Za-z0-9+/_=-]{32,}$/;

/** True when the text looks like a raw Webex id (ciscospark URI, its base64 form, a uuid or a long opaque token). */
export function looksLikeWebexId(text: string): boolean {
    if (text.includes(WEBEX_ID_PREFIX) || /ciscospark:\/\//i.test(text)) { return true; }
    return text.split(/\s+/).some(token => UUID.test(token) || (LONG_TOKEN.test(token) && /\d/.test(token) && /[A-Za-z]/.test(token)));
}

/** Refuses empty text and anything that looks like a raw Webex id; returns the label so it can be used inline. */
export function assertHumanLabel(label: string, field = 'label'): string {
    if (typeof label !== 'string' || !label.trim()) { throw new Error(`${field} must be a human name.`); }
    if (looksLikeWebexId(label)) { throw new Error(`${field} looks like a raw id; use the space or person name.`); }
    return label;
}

/** The plain answer when a tool argument is a raw Webex id (R-CATHY-03): tools take names and short refs only. */
export const ID_ARGUMENT_MESSAGE = 'That looks like an id. Use the space or person name, or a short ref such as s3.';

/** A short opaque reference such as s3, m12 or p4. */
export const isOpaqueRef = (value: string): boolean => /^[a-z]{1,2}\d{1,6}$/.test(value);

/** Throws unless the request carries only human text: no id-like fields, labels or detail values. */
export function assertApprovalRequest(req: ApprovalRequest): ApprovalRequest {
    for (const key of Object.keys(req)) {
        if (!ALLOWED_REQUEST_KEYS.has(key)) { throw new Error(`Approval request has no "${key}" field.`); }
    }
    assertHumanLabel(req.provider, 'provider');
    assertHumanLabel(req.action, 'action');
    assertHumanLabel(req.targetLabel, 'targetLabel');
    if (typeof req.body !== 'string' || !req.body.trim()) { throw new Error('body must hold the full text.'); }
    for (const [key, value] of Object.entries(req.details ?? {})) { assertHumanLabel(value, `details.${key}`); }
    for (const file of req.files ?? []) { assertHumanLabel(file, 'files'); }
    return req;
}

let approvalHandler: ApprovalHandler | undefined;
/** The AITalk draft-card code registers the one generic implementation here. */
export function setApprovalHandler(handler?: ApprovalHandler): void { approvalHandler = handler; }
/** Fails closed: with no handler nothing is approved and nothing may be sent. */
export async function requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    assertApprovalRequest(req);
    return approvalHandler ? approvalHandler(req) : { status: 'unavailable' };
}

const providers = new Map<string, AssistantProvider>();
/** Registers a provider and returns its unregister function. Duplicate provider ids or tool names throw. */
export function registerAssistantProvider(provider: AssistantProvider): () => void {
    if (providers.has(provider.id)) { throw new Error(`Assistant provider "${provider.id}" is already registered.`); }
    const taken = new Set(assistantTools().map(tool => tool.name));
    for (const tool of provider.tools()) {
        if (taken.has(tool.name)) { throw new Error(`Assistant tool "${tool.name}" is already registered.`); }
    }
    providers.set(provider.id, provider);
    return () => { if (providers.get(provider.id) === provider) { providers.delete(provider.id); } };
}
export function assistantProviders(): AssistantProvider[] { return [...providers.values()]; }
/** Every registered provider's tools, in registration order. */
export function assistantTools(): ToolDefinition[] { return assistantProviders().flatMap(provider => provider.tools()); }
