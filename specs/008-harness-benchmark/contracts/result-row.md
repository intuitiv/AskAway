# Contract: benchmark result row

One JSON object per line, appended (store location: plan Q5). Never rewritten.

```json
{
  "suite": "benchmark",
  "runId": "uuid",
  "benchmarkVersion": "sha256",
  "pricingBasis": "opencode step_finish cost",
  "configId": "sha256",
  "configuration": { "mainAgent": "orchestrator", "promptHash": "sha256", "harness": "opencode", "modelMix": { "main": "github-copilot/...", "workers": { "build": "github-copilot/..." } } },
  "startedAt": "ISO-8601",
  "status": "completed | interrupted | skipped",
  "stopReason": "spend cap $2 | total spend cap $5 | model unavailable | null",
  "tasks": [{ "id": "simple-1", "level": "simple", "outcome": "accepted | failed | skipped | interrupted", "failedChecks": ["name"] }],
  "usage": { "requests": 0, "toolCalls": 0, "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0, "dollars": 0.0, "mainAveragePrompt": 0, "workers": { "workers": 0, "requests": 0, "dollars": 0.0 } }
}
```

Rules: `dollars` is `null` when any step lacks cost (never 0); no prompt text, transcript text or secrets; hidden check names may appear only after grading.
