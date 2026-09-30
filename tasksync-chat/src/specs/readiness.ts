import type { CheckStatus, ReadinessResult } from './runRecords';

export function normalizeReadiness(result: ReadinessResult): ReadinessResult {
    return {
        checks: (result.checks ?? []).map(check => check.status === 'PASS' && !(check.evidence ?? '').trim()
            ? { ...check, status: 'BLOCKED' as CheckStatus, reason: 'no evidence' }
            : { ...check }),
        openFindings: [...(result.openFindings ?? [])],
        residualRisk: [...(result.residualRisk ?? [])]
    };
}

export function readinessLines(result: ReadinessResult): string[] {
    const normalized = normalizeReadiness(result);
    const count = (status: CheckStatus) => normalized.checks.filter(check => check.status === status).length;
    const lines = [`Readiness: ${count('PASS')} PASS · ${count('FAIL')} FAIL · ${count('BLOCKED')} BLOCKED · ${count('N/A')} N/A`];
    for (const check of normalized.checks) {
        lines.push(`${check.status} ${check.name}${check.reason ? ` — ${check.reason}` : ''}${check.evidence ? ` (evidence: ${check.evidence})` : ''}`);
    }
    const list = (title: string, items: string[]) => {
        if (items.length === 0) { lines.push(`${title}: none`); return; }
        lines.push(`${title}:`, ...items.map(item => `- ${item}`));
    };
    list('Open findings', normalized.openFindings);
    list('Residual risk', normalized.residualRisk);
    return lines;
}
