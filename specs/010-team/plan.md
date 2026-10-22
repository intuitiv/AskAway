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

## Production lanes (2026-10-16)

Base 83f6d9b. Sources: ADR 0024; R-TEAM-21/22/27/28/29/30/31/32/35; approved prototype `tasksync-chat/storybook/prototypes/team.js` + `media/team/team.css` (EV-TEAM-STORYBOOK, 12 checks pass).

### Root causes
- **Flicker.** `media/webview.js:3562-3565` calls `paintWorkers()` every 1 s. `:3437` then runs `list.innerHTML = renderWorkersHtml(...)`, which rebuilds every `<img>`, `<select>`, task card and the category table on every tick and resets images and open dropdowns. R-TEAM-35.
- **Broken avatars.** `teamPortraitHtml` (`webview.js:3207-3215`) builds `avatars/<file>` from `state.avatarBase`, which the host never sends (no `avatarBase` in `src/`). No member image files exist (`storybook/fixtures/avatars/` has only `machs.svg`, `user.svg`). `localResourceRoots` is the extension folder only (`webviewProvider.ts:3758`). The CSP (`:5232`) blocks inline `onerror` fallbacks like `team.js:865`. Only the user photo works, because `src/aitalk/userName.ts:20-27` sends it as a `data:` image.
- **team.css missing.** `_getHtmlContent` (`webviewProvider.ts:5214-5236`) links `main.css`, `aitalk/talk.css` and codicons only. `media/team/team.css` is imported only by Storybook (`team.js:38,41`).
- **Tab label and wording.** Tab button `data-tab="workers"` with text `Workers`: `webviewProvider.ts:5246`. Panel: `:5406`. Badge `tab-badge-workers`: `webview.js:3463`. Old roster (Priya, Bhaskar, Arjun, Maya, Kavya, Dev): `webview.js:3105-3110`. Category table `monthlyCostTableHtml`: `:2980`, used at `:3298`. `Track …` lanes: `:3311-3328`. Run-together `Name · Role Pinned PO $x this month` and the task button: `:3256-3259`.
- **Old AITalk.** Every AITalk change from the prototype lives in `decorateTalkHtml` (`team.js:816-1010`), which post-processes Storybook HTML only. Production `talkRender.js` still has:
  - the presence/typing header (`:181`, `:195`);
  - initials-only avatars on messages, mentions and the typing row (`:147`, `:171`, `:211`);
  - plain-text join/leave notices (`talkRules.js:32-34`);
  - no Mahesh/Bhaskar mapping (`team.js:1006`);
  - no user + Priya + main agent at start (R-TEAM-32);
  - only a `focusTeamMember` hook (`media/aitalk/extension.js:6`).

### Shared contract (Lane B step 1 lands it; Lanes A and C read it, never edit it)
- `workersState.members[]`: `{ id, name, role, profile, pinned, initials, avatarSrc, creativeStatus, agentFile, model, thinking, adapter, taskIds[], turnCost, monthCost }`. `avatarSrc` is a webview URI or `''` (`''` means render initials). agy cost is `0` (R-TEAM-30).
- `aitalkState.members[]` adds `memberId` and `avatarSrc`. The user keeps `userName` and the `userPhoto` `data:` image.
- Names and ids come from the host roster `src/team/roster.ts`, which mirrors `TEAM_ROSTER_FIXTURES` and `MAIN_AGENT_PERSONAS` (`team.js:119-358`): Mahesh, Bhaskar, Priya, Anika, Diego, Tara, Pavel, Rhea, Paolo, Sana, Shreya, Cathy. `AA.Orchestrator` → Mahesh; `AskAway Build` → Bhaskar; an unknown agent keeps its actual name with initials.
- No UI lane touches the agy-tools lane's files: `src/workers/agyRuntime.ts`, `workerProfiles.ts`, `workerHost.ts`, `openCodeRuntime.ts`.
- After every lane, keep `npm run test:workers` and `node tasksync-chat/test-team-storybook.cjs` green.

### Lane A: Team tab render without flicker
- **Owns:** `tasksync-chat/media/webview.js` only.
- **Do not touch:** `webviewProvider.ts`, any CSS, `media/aitalk/*`, `storybook/*`, `src/*`.
- **Behaviour:**
  1. Delete `TEAM_ROSTER` (`:3105-3110`), `memberForWorker` (`:3126`) and `memberMonthCost` (`:3159`). Read `state.members` instead.
  2. Port `renderMemberRowHtml`, `memberStatusInfo` and `renderTeamTabHtml` (`team.js:651-815`) into `teamMemberRowHtml` (`:3216`), keeping the prototype's row markup and classes.
  3. Use separate fields, not one run-together string: name, role, the pinned badge, turn and month cost, a collapsed `[n tasks ▸]` pill, the prototype's model/effort dropdowns, and the agent-file link.
  4. Avatar: `avatarSrc` gives `<img>`; empty gives an initials `<span>`. The fallback is a delegated `error` listener on the list, never inline `onerror`.
  5. Keyed rendering. First paint builds one `[data-member-row=id]` per member. After that, `patchTeam(state)`:
     - updates only `[data-member-cost]`, `[data-member-status]`, the pill count, `aria-expanded`, and dropdown values when not focused;
     - inserts or removes rows only when a member joins or leaves;
     - patches task cards per `data-worker-id` using the existing `renderWorkersHtml`/`traceRowsHtml` output.
  6. The 1 s timer (`:3562`) updates only age/time text nodes, never `innerHTML`. Keep its state request every 3 ticks.
  7. Rename the tab id to `team`: `switchTab('team')` at `:3420` and `:3479`, `panel-team` at `:3563`, `tab-badge-team` at `:3463`.
  8. Keep the Storybook slice markers `// ── Workers tab: pure render` … `// ── end Workers pure render ──` and every name returned by `getWorkersKit` (`team.js:67-76`).
- **Delete:** `monthlyCostTableHtml` at `:3298` and its Trace use at `:2980` (R-TEAM-29: one cost per member; Trace shows the main agent only). Also delete the Track lanes `:3311-3328`.
- **Reuse:** `renderWorkersHtml` cards, `traceRowsHtml` (Priya's validator trace), the `.obs-month-amount` cost style.
- **Test:** new `tasksync-chat/test-team-production-render.cjs`, using `vm` with the `between()` slicing style of `test-webview-card-timer-settings.cjs` and a minimal DOM stub. Assert:
  - after `applyWorkersState(s1)`, `applyWorkersState(s2)` (only cost changed) and 3 timer ticks, the portrait node and the `<select>` for `bhaskar` are the same nodes (`===`), and the cost text shows the s2 value;
  - output has no `obs-cost-categories`, no `Track `, and none of `>Dev<`, `>Arjun<`, `>Maya<`, `>Kavya<`;
  - the pill is `aria-expanded="false"` by default and stays `"true"` after a toggle plus a repaint;
  - an agy task shows `$0.00`, never "cost unreported".
- **Command:** `node tasksync-chat/test-team-production-render.cjs`

### Lane B: webview shell, styles, roster and data
- **Owns:** `tasksync-chat/src/webview/webviewProvider.ts`, new `tasksync-chat/src/team/roster.ts`, `tasksync-chat/src/workers/workersState.ts`, `tasksync-chat/media/team/team.css`, `tasksync-chat/media/main.css`.
- **Do not touch:** `media/webview.js`, `media/aitalk/*`, `src/aitalk/*`, `storybook/*`, the agy-tools files.
- **Behaviour:**
  1. Land first: `src/team/roster.ts` exports `TEAM_ROSTER`, `resolveMainAgentIdentity(name)` and `initialsOf`, with values identical to the `team.js` fixtures.
  2. In `projectWorkersState` (`workersState.ts`), group workers into `members[]` per the contract, with `turnCost`/`monthCost` per member (agy → 0).
  3. `_refreshWorkersState` (`webviewProvider.ts:1338-1349`) broadcasts `members`. `avatarSrc` = `asWebviewUri(media/team/avatars/<file>)` only when the file exists, else `''`.
  4. At `:5243-5248`, the tabs read exactly `AITalk, Specs, Trace, Team, Settings`. The Team button is `data-tab="team"`, title "Team members in this workspace: state, cost, session links", badge `tab-badge-team`. The panel at `:5406` becomes `id="panel-team"`.
  5. After `:5235`, add `<link href="${asWebviewUri(media/team/team.css)}" rel="stylesheet">`.
  6. Keep the CSP and `localResourceRoots` unchanged; the user photo stays a `data:` image.
  7. In `team.css`/`main.css`, the Team panel uses the same width rule as the other tabs (R-TEAM-31). Scope `team.css` selectors under `#panel-team` so AITalk and Trace are unaffected.
- **Delete:** the per-category month payload, once Lane A no longer reads it.
- **Test:** new `tasksync-chat/test-team-shell.cjs`. Assert:
  - the `_getHtmlContent` source has tab labels in the exact order `AITalk, Specs, Trace, Team, Settings` and no `>Workers<`;
  - it joins `'team', 'team.css'` into a stylesheet link;
  - `TEAM_ROSTER` ids, names and roles deep-equal `TEAM_ROSTER_FIXTURES` from `storybook/prototypes/team.js`;
  - `resolveMainAgentIdentity('AA.Orchestrator').name === 'Mahesh'`, `('AskAway Build')` → `Bhaskar`, `('Foo Agent')` → `Foo Agent` with initials `FA`;
  - `projectWorkersState` with an agy build worker yields member `bhaskar` with `monthCost === 0`.
- **Command:** `node tasksync-chat/test-team-shell.cjs`

### Lane C: AITalk in production
- **Owns:** `tasksync-chat/media/aitalk/talkRender.js`, `talkController.js`, `talkRules.js`, `extension.js`, `presence.js`, `talk.css`; `tasksync-chat/src/aitalk/actors.ts`; and in `tasksync-chat/storybook/prototypes/team.js` only `decorateTalkHtml`.
- **Do not touch:** `media/webview.js`, `webviewProvider.ts`, `team.css`, `src/team/roster.ts` (import only), the agy-tools files.
- **Behaviour** (move the `decorateTalkHtml` rules into the real renderer):
  1. The header (`talkRender.js:181,195`) lists names only, comma-separated, no `<img>`: user first, then Priya, then present members. Each name is `<span class="aitalk-roster-name" data-member-id>`.
  2. Message avatars (`:147`), mention choices (`:171`) and the typing row (`:211`) show the face from `avatarSrc`, falling back to initials. A mention choice shows face + name + role.
  3. Join/leave notices (`talkRules.js:32-34`) keep the exact text "Bhaskar joined" / "Diego left" and add a face plus `data-member-id`.
  4. `talkController.js:19-20`: the user and Priya are present from startup; the main agent joins at turn start as the first notice (R-TEAM-32).
  5. Clicking any `[data-member-id]` or `.talk-mention` calls `window.focusTeamMember(id)` (`extension.js:6`): one visible panel, highlighted row (R-TEAM-28).
  6. `@member` routing and disambiguation (`talkRules.js:16-17`) use roster ids and names (R-TEAM-09).
  7. `actors.ts` maps the native agent through `resolveMainAgentIdentity`.
- **Delete:** the prototype-only regex rewrites in `decorateTalkHtml` that production now renders itself.
- **Test:** extend `tasksync-chat/test-aitalk-ui.cjs`. Assert:
  - the header HTML has no `<img` and contains `Machs, Priya, Mahesh` in order;
  - `Bhaskar joined` carries `data-member-id="bhaskar"` and a `talk-avatar`;
  - a click on `[data-member-id="diego"]` calls the `focusTeamMember` stub with `'diego'`;
  - `@Diego` selects `diego`;
  - `@Di` mention choices include Diego with role `Developer`.
- **Commands:** `node tasksync-chat/test-aitalk-ui.cjs`, then `node tasksync-chat/test-team-storybook.cjs` (must stay at 12/12).

### Order
Lane B step 1 (`roster.ts` + contract) → Lanes A, B, C in parallel → deploy only after all three lane tests, `test-team-storybook.cjs` and `npm run test:workers` pass.

### Decisions pending reviewer
- No generated portraits are shipped. Members show initials (`avatarSrc: ''`) until real portraits are approved (R-TEAM-06 open). Pending reviewer.
- The eval scoreboard and benchmark stay in the Team tab, since no decision removes them. Pending reviewer.

## Built outside the original plan (ledger, 2026-10-22)
Each line: what, rows/ADR, test. Details in [evidence/reconciliation-2026-10-22.md](evidence/reconciliation-2026-10-22.md) and the commits since `deacdcc`.
- Chat tab and `ask_user` retired; autopilot prompt, response-timeout, human-like-delay and max-auto-response settings and the pending-request queue deleted (ADRs 0027–0031; R-LIVE-27, ADR 0032 keeps worker-autopilot, `remoteChannel` and the plan editor).
- Members post only questions in AITalk; a worker `update` is refused (R-AITALK-45; `test-aitalk-members-questions-only.cjs`).
- agy members show $0.00 and appear when active (R-TEAM-72).
- `commentary` tool renamed `aitalk`, with the old names kept as aliases (ADR 0034, R-AITALK-48; `test-aitalk-tool-name.cjs`).
- agy and Claude workers identified like OpenCode workers (agy by MCP `_meta` conversation id, Claude by `X-AskAway-Run`; ADR 0033, R-AITALK-46/47), Claude fork with `--resume --fork-session` (R-WTOOL-48), "Open in terminal" viewer (R-WTOOL-47), worker-tool guard: read-only profiles, at most 2 children, one level (R-WTOOL-45/46). Live proof `npm run test:live-aitalk` S1–S7.
- Cathy's 12 assistant tools with AITalk approval cards and the provider seam (spec 009 US8; ADR 0035, R-CATHY-01..08; `test-webex-no-ids.cjs`).
- AITalk fixes: join/leave flapping (R-AITALK-50), Priya's guess visible (R-AITALK-49), Cathy leaves when answered and presence from the shared store (R-AITALK-51, ADR 0036); `@member` routing by stable id (T044).
- Outside the extension: Grafana login `~/.local/bin/grafana-login` and wrapper `~/.local/bin/grafana-mcp` (user level, not in this repo).
- Webex ideas (daily report, spam, reply watch) → spec 009 US9, R-CATHY-09..14, ADR 0037.
