# Async Sub-agent Runner

Track a sub-agent the way the `gradle` tool tracks a build: return a handle immediately, report
progress, and let the main agent continue while the worker runs.

## Problem

`runSubagent` blocks its caller for the entire child run. While it is in flight the main agent cannot
start a second exploration, answer a question, or make an unrelated edit. Sub-agents also start cold
every time, so accumulated context and prompt-cache prefixes are not reused.

## Goals

- **Fan-out.** Launch several sub-agents at once instead of one after another.
- **Progress.** Report what each worker is doing while it works.
- **Platform-neutral runtime.** Keep runtime-facing contracts independent of any agentic platform,
  with OpenCode as the first worker runtime adapter.
- **Task-appropriate execution.** Let each worker mode/profile declare its agentic-platform adapter,
  model, and thinking budget/tier options so users or the orchestrator can choose among the configured
  options for that mode.
- **Session reuse.** Dispatch repeatedly into a warm logical worker for short, bounded jobs without
  assuming an interrupted provider request can be resumed.
- **Cost visibility.** Attribute worker usage to the main-agent turn that dispatched it.
- **Side-channel extensibility.** Leave an extension point for Spec 003 messaging without routing
  messages in this feature.
- **Durable worker identity.** Track checkpoints, last update, source revision, context freshness,
  validity, and relevance.
- **Bounded delegation.** Keep implementation jobs short enough to preserve prompt-cache economics and
  prevent the main orchestrator from accumulating detailed task context.
- **Deliberate routing.** Require the main orchestrator to choose the worker mode/profile, model, and
  thinking budget for each bounded task before dispatch.
- **Self-contained delegation.** Give each worker all context, objective, constraints, expected
  evidence, and the stop condition needed to complete its task independently.
- **Layered knowledge.** Keep high-level product, architecture, skills, and decision knowledge with the
  main orchestrator while workers own detailed code investigation and implementation.
- **Live-provider confidence.** Exercise dispatch and usage attribution against actual provider
  responses with an explicitly configured cheaper model, separately from deterministic contract tests.

## Clarifications

### Session 2026-09-04

- Q: Which worker runtime and contract boundary does Spec 001 use? → A: All workers use OpenCode now;
  runtime-facing contracts remain platform-neutral for future agentic-platform adapters.
- Q: Which lifecycle/control operations does Spec 001 own? → A: Exactly eight: `worker_start`,
  `worker_submit`, `worker_list`, `worker_status`, `worker_wait`, `worker_cancel`, `worker_resume`, and
  `worker_logs`.
- Q: Who owns side-channel messaging? → A: Spec 003 owns `worker_ask`, `worker_respond`, sender and
  recipient identity, central routing, deferred injection, and human chat interactions.
- Q: Are worker transcript compaction and long-lived retention in scope? → A: No; both are deferred.
- Q: What is the main agent's role? → A: It orchestrates, scopes, verifies, retains high-level
  knowledge, and communicates outcomes; worker profiles perform implementation.
- Q: How long should worker jobs run? → A: Jobs are short and bounded for prompt-cache economics.
- Q: How is worker usage presented and attributed? → A: Attribute it to the dispatching main-agent
  turn; retain expandable total time, cost, and token metrics, with per-run elapsed time and cost reset.
- Q: How are stale open questions represented? → A: Resolved decisions are requirements; genuine
  future work is explicitly deferred rather than left open.
- Q: How are model and thinking budgets selected for different task types? → A: Each worker
  mode/profile declares its agentic-platform adapter, model, and thinking budget/tier options; users
  or the orchestrator choose among the configured options per mode, and every run records the
  effective selection.

### Session 2026-09-06

- Q: What planning and routing decisions must the main orchestrator make? → A: Decompose the goal into
  small bounded tasks and explicitly select each worker mode/profile, model, and thinking budget.
- Q: What must every delegation contain? → A: A self-contained packet with all context, objective,
  constraints, expected evidence, and stop condition.
- Q: How is insufficient evidence handled? → A: Dispatch research or data-collection workers as needed,
  then synthesize their high-level findings before planning or verification continues.
- Q: What knowledge and tools belong to the main orchestrator? → A: Retain high-level product,
  architecture, skills, and decisions; allow planning, research, SharePoint, architecture, worker
  control, skill/memory, and verification tools while disabling code inspection and editing tools.
- Q: What live testing is required? → A: Bounded real-LLM end-to-end tests use an explicitly configured
  cheaper model to verify dispatch and provider-derived budget/cost calculation and attribution.

## Non-goals

- Making the sub-agent itself return early. Only the caller-facing operation returns early.
- Replacing `runSubagent` for the simple one-shot case.
- Unattended auto-approval of tool permissions.
- Treating an interrupted provider request as resumable. Resume starts a new request from a checkpoint.
- Replacing native Copilot's private conversation compactor without a supported API.
- Side-channel message routing or `worker_ask`/`worker_respond` semantics; Spec 003 owns them.
- Worker transcript compaction or long-lived worker retention.
- Having the main orchestrator perform coding or other implementation tasks.

## Worker shape

AskAway exposes a platform-neutral logical worker registry. OpenCode is the first runtime adapter for
all workers; future external agentic platforms can implement the same runtime-facing contracts. A
worker has a stable `workerId`, and each submission creates a new `runId`. The runtime records worker
metadata, checkpoints, and terminal results. After extension reload, a worker may be marked `PAUSED`
or `ORPHANED`; `resume` starts a new model request from its latest checkpoint rather than resuming an
interrupted provider request.

Spec 001 owns exactly these eight lifecycle/control operations:

```text
worker_start   worker_submit   worker_list   worker_status
worker_wait    worker_cancel   worker_resume worker_logs
```

The main orchestrator coordinates fan-out through `worker_list`, `worker_status`, and `worker_wait`;
Spec 001 does not add a separate wait-for-all operation.

Each worker mode/profile declares the agentic-platform/provider adapter, model, and thinking
budget/tier options suitable for its task type. Users or the orchestrator can choose among the
configured model and thinking options for that mode. The profile contract remains adapter-neutral;
OpenCode is the current adapter.

Each worker stores its role, tool policy, workspace/spec identity, created and last-used timestamps,
last checkpoint, source revision, context source timestamps, transcript summary, relevance score,
and validity state: `VALID`, `STALE`, `ORPHANED`, or `INVALID`. Each dispatched run records the
effective adapter, model, and thinking budget/tier selection for observability and reproducibility.

Reuse is allowed only when workspace identity, tool policy, task relationship, and context validity
pass checks. File snapshots, diagnostics, terminal output, and task instructions become stale when
their source changes. The exact relevance threshold and forced-new-worker mismatch policy are deferred.
For a reused worker, historical and cached input context remains visible, while elapsed time and cost
reset for each run.

## Orchestration boundary

The main orchestrator must be excellent at planning and decomposition. For each goal, it creates small,
bounded tasks; identifies the appropriate worker mode/profile; explicitly selects the worker model and
thinking budget from that profile's configured options; and dispatches a self-contained packet containing
all required context, objective, constraints, expected evidence, and stop condition. Routing quality is a
core correctness concern because a worker's usefulness depends on receiving the right mode, resources,
and task boundary.

When current evidence is insufficient, the main orchestrator may dispatch research or data-collection
workers, including workers that use internet research or SharePoint exploration, and then synthesize their
high-level findings. It understands worker results, verifies their evidence against acceptance criteria,
and reports high-level outcomes. Workers perform implementation and detailed code investigation.

The main orchestrator retains high-level product, architecture, skills, and decision knowledge without
inspecting or editing implementation code. Its code-related tools may be disabled. Its tool policy instead
allows the capabilities needed for orchestration: skill and memory access, internet research, SharePoint
exploration, architecture tools and MCPs, worker-control tools, planning, and verification/evidence tools.
Worker jobs remain short and bounded for prompt-cache economics.

When a reusable pattern is proven, the main orchestrator records it in the appropriate durable form: a
skill for a repeatable procedure or domain knowledge, memory for concise learned facts, an ADR only for a
durable decision approved by the user, or documentation for product and operational behavior. It must not
create an ADR merely from implementation details.

Real-LLM end-to-end worker tests use an explicitly configured cheaper model and actual provider responses.
They cover worker dispatch plus budget and cost calculation and attribution from provider-reported usage.
These tests are bounded and kept separate from deterministic, no-network contract tests. Credentials are
never hardcoded; when live-test prerequisites are absent, the tests skip or fail explicitly according to
the documented live-test policy.

## Deferred side channel: Spec 003

Spec 001 carries lifecycle facts only and exposes extension points for later messaging; it does not
route messages. Spec 003 will define `worker_ask` and `worker_respond`. Messages identify sender and
recipient, and a central router routes among the main agent, workers, and human. Agent delivery is
injected after an ongoing tool call completes. The recipient answers through a dedicated side-channel
command; replies route back and are injected on the same boundary. Humans use a chat box that displays
the asker and permits answers, new questions, tips, and steering. Immediate-direction, approval, and
authentication-provider policies belong to Spec 003 and its security design.

Worker transcript compaction and long-lived worker retention are deferred. This feature instead
targets short, bounded delegated jobs that keep detailed task context out of the main orchestrator.

## Cache and model continuity

The safest cache-preserving rule is to keep the same model, thinking budget/tier, worker identity,
stable prompt prefix, tool policy, and conversation chain. Switching models or thinking budgets/tiers,
or rebuilding the prompt, is a cache boundary. Jobs remain short and bounded rather than depending on
transcript compaction or indefinite retention.

Worker usage is attributed to the main-agent turn that dispatched the run. The existing expandable
subagent trace continues to show total time, cost, input tokens, and output tokens. When a worker is
reused, its historical and cached input context remains visible, but elapsed time and cost reset for
the new run. OpenCode owns its runtime permission prompts; Spec 001 does not auto-approve them.

## Value test

The idea pays for itself only if the parent has real work during the child's run. Fan-out, side-channel
availability, and session reuse pass that test; a trigger that still blocks the parent does not.
