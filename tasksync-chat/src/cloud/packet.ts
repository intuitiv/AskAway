const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
    { kind: 'github-token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
    { kind: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: 'slack-token', pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
    { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9]{20,}/ },
    { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

export function knownSecretValues(env: Record<string, string | undefined> = process.env): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(env)) {
        if (value && value.length >= 8 && /TOKEN|SECRET|KEY|PASSWORD/i.test(name)) { values.push(value); }
    }
    return values;
}

export function secretFindings(fields: Record<string, string>, known: string[] = []): Array<{ field: string; kind: string }> {
    const findings: Array<{ field: string; kind: string }> = [];
    const credentials = known.filter((value) => value.length >= 8);
    for (const [field, text] of Object.entries(fields)) {
        for (const { kind, pattern } of SECRET_PATTERNS) {
            if (pattern.test(text)) { findings.push({ field, kind }); }
        }
        if (credentials.some((value) => text.includes(value))) { findings.push({ field, kind: 'known-credential' }); }
    }
    return findings;
}
