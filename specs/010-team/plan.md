# Implementation Plan: Team

**Branch**: `010-team` | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)
**Input**: `/specs/010-team/spec.md`; standard `.specify/templates` spec/plan/tasks structure.

## Summary
Separate member identity from task/run and runtime/model. First runtime lane verifies agy/Argon for any profile; then prototype Team/AITalk in Storybook, obtain approval, only then implement production UI. This packet records plans only.

## Technical Context
- Language/platform: existing TypeScript VS Code extension and JavaScript webview/Storybook.
- Dependencies: existing worker runtime boundary, shared AITalk actor widget and usage banner, spec 003 side-channel.
- Storage: retain existing workspace task/turn ledgers and profile identity; no new store chosen in this packet.
- Identity boundary: derive name/avatar/join banner/Team profile from the selected native agent, not a static Manager name. AA.Orchestrator → Mahesh; AskAway Build → approved configurable Build Bhaskar (technical lead distinct from TPM); unknown agent → its actual display name, no guessed alias.
- Mention boundary: every member has a selectable short-name alias (for example @Bhaskar, @Mahesh). Autocomplete shows member identity and binds selection to stable member ID, not literal display-name matching. Only current-turn active members are suggested; renamed labels retain identity; duplicate short names require role/stable-ID disambiguation. Existing reply/mention routing priority remains unchanged.
- CPO photo: real user-uploaded image in a user-owned folder; suggested user-scoped reference `~/.askaway/profile/avatar.png` shared across workspaces and retained through extension upgrades. Never copy into extension install/media, repo or distributed bundles; packaging privacy checks must exclude the actual user photo. This is a storage plan only: create no directory/file here.
- Testing: outside-in dispatch and UI interaction tests before implementation; docs guards check document structure, not behavior.
- Constraints: preserve internal worker APIs, OpenCode ownership of transcript/approvals, workspace isolation, cost attribution and secret handling. No agy persona or claim of zero cost without evidence.
- Scope: documentation now; runtime lane owns implementation and package metadata; Team is deferred behind runtime proof and Storybook approval.

## Constitution Check
Before implementation, recheck repo constitution and all linked requirements. Current documentation preserves G3/G17, explicit gaps and Proposed ADR status; implementation gate remains pending. Caller-view tests, shared components, no regressions and approval evidence are mandatory; no implementation waiver is granted.

## Project Structure
- Documentation: `specs/010-team/{spec,plan,tasks}.md`; GOALS.md, docs/adr/0023-agy-first-team-members.md and requirements/team.md are the decision sources.
- Future production locations: existing `tasksync-chat/src/`, `tasksync-chat/media/`, `tasksync-chat/storybook/` and `tasksync-chat/test-*.cjs`; exact implementation files require a later scoped packet.
- No speculative research/contracts/data-model artifacts: runtime proof and Storybook decisions must inform them if needed.

## Dependencies and delivery
1. T001–T003: recheck discovered Argon variants, headless permissions and full runtime proof; do not bypass approval/security to clear the historical blocker.
2. T004–T007: after runtime is green, roster/grouping and shared profile/face/task prototype, scenarios and GIF. Reviewer approval is a hard gate.
3. T008–T014: caller-view tests then production wiring, existing AITalk regression verification and truthful release docs.
4. Future add-member UI stays BACKLOG TEAM-FUTURE. Benchmark work remains deferred by reviewer.

## Verification
### 2026-10-16 explicitly approved Argon capability checks
The reviewer authorized full Argon approval. Public worker dispatch reports runtime/model `agy/gemini-4-argon-high`, `agyPermissions: skip` and `costStatus: unreported`; no persistent permission settings were changed. The first prototype run encountered an `unsandboxed` command denial, so the retry limits Argon authoring to file tools and delegates validation externally.

Independent native checks with `--model=gemini-4-argon-high --mode=accept-edits --dangerously-skip-permissions` read the local package and wrote `ARGON_HIGH_FILE_APPROVAL_OK` to a disposable file inside the CLI working directory. Main read back the exact text, deleted the fixture and verified removal. An independent command-only check with the same flags plus `--sandbox` executed `node -e "console.log(123456789)"` and returned exactly `123456789`. Earlier probes with a destination outside that working directory or different mode/sandbox combinations were denied; do not generalize successful scoped checks to unrestricted access or MCP availability.

Argon completed the prototype and no-ping/cache-age task. Main independently passed EV-TEAM-STORYBOOK after shared-banner contract corrections and final initials/copy cleanup. The verifier passed 30 existing Storybook tests, build, desktop 1200 by 900 and mobile 390 by 844 checks: no browser errors or horizontal overflow, no overlap among checked regions, mobile scrolling to profile, and working tabs, mentions, profile, selected-agent switch and replay controls. Fresh final-source captures are .askaway/storybook-review/team-desktop.png and team-mobile.png; team-replay.gif has 44 unique frames of 44, 5.51 seconds and 1,754,577 bytes. Preview: http://127.0.0.1:6006/iframe.html?id=prototypes-team--active-turn-team-and-talk&viewMode=story. Initials are honest placeholders; real portraits and reviewer approval remain pending. No private photo resources are included. The existing missing-Commentary-pattern build warning is non-blocking.

The production no-ping/cache-age policy passed `BATCH ok=3 failed=0 skipped=0` for the full worker suite, TypeScript and webview syntax checks before build/deployment. Main independently confirmed matching installed/source hashes: extension.js `a02ffa3e769641c3245b4b69ccd6529687cff7d53920c4759b87c240490b5ba7`, package.json `8e9d095db00cc8bd2327aa2b90271f94305b99135e500b73391a2f99001c29b1`, webview.js `0c207c4b5393507386b13779bac68069d8dcccbf90f65cee77ad253cd5b311af`. Reload VS Code to activate that policy. Team remains Storybook-only and monetary cost remains unreported rather than assumed zero.

### 2026-10-15 installed avatar and Argon prototype attempt
The built minified bundle contains the `.askaway/profile/avatar.png` fallback; the installed `intuitiv.askaway-1.0.35` bundle lacks it. The global photo override is unset and the external PNG is readable. This establishes a stale installed artifact, not an incorrect user name. `test-aitalk-user-name.cjs` additionally asserts that the external photo reaches the shared header as an `<img>` rather than M. Deployment and visual acceptance after reload remain distinct requirements under T021.

Gate failures repaired in isolated test harnesses: presence and Webex-draft VM contexts now supply the new photo helper. The Webex prompt profile expectation and stale-profile fixture now reflect the reviewer-approved Argon High/high default while retaining all existing recipient, approval and tool-permission checks. Each exact failing test passed after repair. The verifier then completed `npm run test:workers`, focused agy/profile/avatar/actors/replay checks, TypeScript, JavaScript syntax and build checks and deployed the bundle/package/media. Independent main confirmation printed `DEPLOYED OK` with matching source/installed extension.js SHA-256 `3ad7a38a5eba256bb0c70c33ef42fd27b626c4b246a146df91c5efb2836cb064` and the installed avatar fallback present. User reload and visual acceptance remain open; no private photo was copied.

The installed worker path sent an `agy/gemini-4-argon-high` selection to OpenCode and failed. A native Argon High launcher attempt timed out without modifying Storybook files. A subsequent bounded native `agy --model=gemini-4-argon-high --mode=accept-edits --output-format=json` attempt returned an empty response with `denied_actions: read_file`; CLI SUCCESS alone is not task success. Temporary repository-read and exact-single-story-write allow rules did not resolve the denial and were removed, restoring the previous settings. No Storybook implementation or screenshots exist from these attempts. T006/T020 are blocked on interactive file approval or explicit authorization of a supported broader permission mode; no blanket permission bypass was enabled and no substitute model authored the prototype.

`node tasksync-chat/test-agy-runtime.cjs` passes the fake-CLI lifecycle, denied-action failure, explicit permission opt-in, raw-usage-once and independent reload tests. This is not live proof that headless file/MCP permissions work on the current login.

### 2026-10-15 configured defaults and avatar helper (partial evidence)
Eight user-level worker profiles and the repo Webex profile are reported configured to `agy/gemini-4-argon-high` with high thinking, replacing Sol 6.1 defaults while preserving Opus assignments. `tasksync-chat/test-worker-profile-refresh.cjs` EV-WORKER-ARGON-HIGH-DEFAULT verifies profile parsing and preservation of existing workers. A real Argon High task and deployment proof remain open under T020.

The reviewer-supplied `~/.askaway/profile/avatar.png` exists (1254×1254). The shared AITalk identity helper uses it as the external default, allows explicit photo override and falls back to initials when unavailable; `tasksync-chat/test-aitalk-user-name.cjs` EV-AITALK-USER-PHOTO checks two workspace fixtures and no workspace copy. This does not prove Team UI integration, extension-upgrade continuity or package privacy; Storybook approval remains pending.

### Authorized agy completion inventory — 2026-10-15
The adapter reportedly has fake-CLI tests plus live scoped file edit, compile/build and `test:workers` green. This is attributed prior evidence, not a fresh run by this documentation packet; MCP, shell/permissions, reload independence, accounting and deployment are NOT thereby done.

US1 T015–T019 expand T001–T003: prove actual MCP results; actual allowed shell and denied-command outcome; reload/status/submit with no OpenCode prerequisite; raw-to-task/turn/workspace token/cache reconciliation without replay duplication; finally full nonzero tests, compile/build, deploy artifact and post-deploy reload/dispatch. Keep every subtask open until exact commands, observed output and live evidence are supplied by the runtime lane; update closure here later without waiting in this docs-only run.

Usage target: optional runtime `agy` for any existing profile, configured default `agy/gemini-4-argon-high` with high thinking; medium/low remain model alternatives, and no agy member. Unreported monetary cost remains unknown, never 0/free; reported token totals do not establish price. A live High trial and deployment remain unverified. Package description/keywords belong to runtime lane. Public closure must state separately what passed, what was deployed and what was verified after reload, with remaining limitations; Team remains unshipped behind runtime-first/Storybook gates.

Documentation packet: `rtk node tasksync-chat/test-requirements-docs.cjs` and `rtk node tasksync-chat/test-goals-docs.cjs` immediately after first substantive edit and at final state. Runtime/Team delivery must additionally pass its actual caller-view tests and `npm run test:workers`; no zero-test pass and no tick based on discovery alone.

T006/T008/T013 must cover switching Orchestrator→Build→unknown native agent with consistent name/avatar/join banner/Team profile and configurable overrides, plus CPO photo continuity across two workspaces and an extension upgrade; inspect packaging to prove the private uploaded image is excluded. These tests are planned, not executed in this docs-only clarification; agy-first and Storybook approval gates still apply.

T006/T010 also plan caller-view checks for @Bhaskar selection/routing and equivalent aliases for every other member, label-renaming identity stability, duplicate-name role/ID disambiguation and inactive-member suggestion exclusion. No alias tests are implemented or claimed passed by these documentation guards.
