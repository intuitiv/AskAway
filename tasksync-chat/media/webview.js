/**
 * TaskSync Extension - Webview Script
 * Handles tool call history, prompt queue, attachments, and file autocomplete
 */
(function () {
    const vscode = acquireVsCodeApi();
    window.askawayPostMessage = function (message) { vscode.postMessage(message); };
    const WEBVIEW_UI_VERSION = 'specs-health-telegram-v9';

    // Settings state
    let soundEnabled = true;
    let interactiveApprovalEnabled = true;
    let sendWithCtrlEnter = false;
    let webexEnabled = false;
    let telegramEnabled = false;
    let remotePollingStatuses = {};
    let remotePollingTimer = null;
    let autopilotEnabled = false;
    let autopilotText = '';
    let autopilotPrompts = [];
    let responseTimeout = 60;
    let sessionWarningHours = 2;
    let maxConsecutiveAutoResponses = 5;
    let turnBudgetAiu = 0;
    let debugLoggingEnabled = true;
    let rtkCompressionEnabled = false;
    let rtkInstalled = true;
    let autoCompactionDisabled = false;
    let extendedCacheTtl = false;
    let extendedCacheTtlMessages = false;
    let cacheKeepWarmEnabled = false;
    let cacheKeepWarmProbes = 1;
    let workersKeepWarmEnabled = true; // askaway.workers.keepWarm (package.json default true)
    let workersKeepWarmToggle;
    let toolScopeMode = 'month'; // 'month' | 'turn' — toggles the tool-call table scope
    let observabilityMetrics = {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        nanoAiu: 0,
        lastRequest: { requestCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, nanoAiu: 0 },
        workspace: { requestCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, nanoAiu: 0 },
        overall: { requestCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, nanoAiu: 0 },
        perModel: [],
        overallCompaction: { count: 0, nanoAiu: 0 },
        turnRequests: [],
        turnEvents: [],
        turnSubagents: [],
        rtkCommandCount: 0,
        rtkSavedTokens: 0,
        rtkSavingsPct: 0,
        gradle: { runs: 0, optimizedRuns: 0, tasksAvoided: 0, configCacheReuses: 0, savedTokens: 0 },
        toolCalls: { totalCalls: 0, totalOutputTokens: 0, byTool: [], turn: { totalCalls: 0, totalOutputTokens: 0, byTool: [] } },
        lastRequestTs: 0,
        source: 'unavailable',
        updatedAt: 0
    };
    // Keep timeout options aligned with select values to avoid invalid UI state.
    var RESPONSE_TIMEOUT_ALLOWED_VALUES = new Set([0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240]);
    var RESPONSE_TIMEOUT_DEFAULT = 60;
    // Human-like delay: random jitter simulates natural reading/typing time
    let humanLikeDelayEnabled = true;
    let humanLikeDelayMin = 2;  // minimum seconds
    let humanLikeDelayMax = 6;  // maximum seconds
    let autopilotTextDebounceTimer = null;

    // Tracks local edits to prevent stale settings overwriting user input mid-typing.
    let autopilotTextEditVersion = 0;
    let autopilotTextLastSentVersion = 0;
    let reusablePrompts = [];
    let audioUnlocked = false; // Track if audio playback has been unlocked by user gesture

    // ── Voice Mode State ──
    let voiceMode = false;
    let voiceTaskId = null;
    let voiceRecognition = null;   // SpeechRecognition instance
    let voiceAudioContext = null;  // AudioContext for waveform
    let voiceAnalyser = null;      // AnalyserNode for waveform data
    let voiceStream = null;        // MediaStream from mic
    let voiceAnimationFrame = null;
    let voiceTranscript = '';      // Accumulated transcript
    let voiceInterimTranscript = ''; // Current interim result

    // Settings modal elements
    let settingsModal, settingsModalOverlay, settingsModalClose;
    let soundToggle, interactiveApprovalToggle, sendShortcutToggle, webexToggle, telegramToggle, autopilotEditBtn, autopilotToggle, autopilotTextInput, promptsList, addPromptBtn, addPromptForm;
    let debugLoggingToggle, rtkCompressionToggle, autoCompactionToggle;
    let extendedCacheTtlToggle, cacheKeepWarmToggle, cacheKeepWarmProbesInput;
    let extendedCacheTtlMessagesToggle;
    let autopilotPromptsList, autopilotAddBtn, addAutopilotPromptForm, autopilotPromptInput, saveAutopilotPromptBtn, cancelAutopilotPromptBtn;
    let responseTimeoutSelect, sessionWarningHoursSelect, maxAutoResponsesInput;
    let turnBudgetInput;
    let humanDelayToggle, humanDelayRangeContainer, humanDelayMinInput, humanDelayMaxInput;
    let observabilityRtkLine;
    let obsLastReqs, obsLastCredits, obsLastInput, obsLastOutput, obsLastCached;
    let obsWsReqs, obsWsCredits, obsWsInput, obsWsOutput, obsWsCached;

    // ── Worker tab state ──
    var workerTasks = []; // [{id, role, task, status, createdAt}]
    var availableModels = []; // [{id, name, vendor, family, maxInputTokens}]
    var availableTools = []; // [{name, description}]
    var activeWorkerTaskId = { command: null, subagent: null };
    var currentTab = 'aitalk';

    // Mirror backend minimal worker tool allowlist to prevent oversized/stale payloads.
    var MINIMAL_WORKER_TOOL_NAMES = new Set([
        'execution_subagent',
        'search_subagent',
        'explore_subagent',
        'skill',
        'copilot_findFiles',
        'copilot_findTextInFiles',
        'copilot_readFile',
        'copilot_listDirectory',
        'copilot_getErrors',
        'copilot_getChangedFiles',
        'copilot_searchCodebase',
        'copilot_searchWorkspaceSymbols',
        'copilot_applyPatch',
        'copilot_createFile',
        'copilot_createDirectory',
        'copilot_replaceString',
        'copilot_multiReplaceString',
        'copilot_viewImage',
        'copilot_fetchWebPage',
        'copilot_runVscodeCommand',
        'copilot_getVSCodeAPI'
    ]);

    function filterMinimalWorkerTools(tools) {
        var list = Array.isArray(tools) ? tools : [];
        return list.filter(function (t) {
            return t && typeof t.name === 'string' && MINIMAL_WORKER_TOOL_NAMES.has(t.name);
        });
    }

    function init() {
        try {
            console.log('[TaskSync Webview] init() starting...');
            createSettingsModal();
            createObservabilityTab();
            bindEventListeners();
            initVoiceControls();
            initWorkerTabs();
            initSpecsTab();
            initWorkersTab();
            unlockAudioOnInteraction(); // Enable audio after first user interaction
            // Signal to extension that webview is ready to receive messages
            console.log('[TaskSync Webview] Sending webviewReady message');
            vscode.postMessage({ type: 'webviewReady', uiVersion: WEBVIEW_UI_VERSION });
        } catch (err) {
            console.error('[TaskSync] Init error:', err);
        }
    }

    function createSettingsModal() {
        var settingsHost = document.getElementById('settings-tab-shell');
        if (!settingsHost) return;

        settingsModalOverlay = null;

        settingsModal = document.createElement('div');
        settingsModal.className = 'settings-tab-content';
        settingsModal.id = 'settings-modal';
        settingsModal.setAttribute('role', 'region');
        settingsModal.setAttribute('aria-labelledby', 'settings-modal-title');

        // Modal header
        var modalHeader = document.createElement('div');
        modalHeader.className = 'settings-modal-header';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'settings-modal-title';
        titleSpan.id = 'settings-modal-title';
        titleSpan.textContent = 'Settings';
        modalHeader.appendChild(titleSpan);

        // Header buttons container
        var headerButtons = document.createElement('div');
        headerButtons.className = 'settings-modal-header-buttons';

        // Report Issue button
        var reportBtn = document.createElement('button');
        reportBtn.className = 'settings-modal-header-btn';
        reportBtn.innerHTML = '<span class="codicon codicon-report"></span>';
        reportBtn.title = 'Report Issue';
        reportBtn.setAttribute('aria-label', 'Report an issue on GitHub');
        reportBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'openExternal', url: 'https://github.com/intuitiv/TaskSync/issues/new' });
        });
        headerButtons.appendChild(reportBtn);

        settingsModalClose = null;

        modalHeader.appendChild(headerButtons);

        // Modal content
        var modalContent = document.createElement('div');
        modalContent.className = 'settings-modal-content';

        // Copilot Debug Logging — observability prerequisite (must be ON for Metrics to work),
        // so it sits above the Optimization group.
        var debugLoggingSection = document.createElement('div');
        debugLoggingSection.className = 'settings-section';
        debugLoggingSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-bug"></span> Copilot Debug Logging</div>' +
            '<div class="toggle-switch active" id="debug-logging-toggle" role="switch" aria-checked="true" aria-label="Enable Copilot debug logging" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(debugLoggingSection);

        // Optimization controls
        var optimizationHeader = document.createElement('div');
        optimizationHeader.className = 'settings-section';
        optimizationHeader.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title" style="font-size:12px;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;"><span class="codicon codicon-graph"></span> Optimization</div>' +
            '</div>';
        modalContent.appendChild(optimizationHeader);

        var rtkSection = document.createElement('div');
        rtkSection.className = 'settings-section';
        rtkSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-server-process"></span> RTK Command Compression</div>' +
            '<div class="toggle-switch" id="rtk-compression-toggle" role="switch" aria-checked="false" aria-label="Enable RTK command compression" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(rtkSection);

        // Disable Auto Compaction — inverts Copilot's summarizeAgentConversationHistory.enabled.
        // Checked = auto-compaction OFF (conversation history is not auto-summarized when the
        // context window fills). Sits in the Optimization group next to RTK.
        var autoCompactionSection = document.createElement('div');
        autoCompactionSection.className = 'settings-section';
        autoCompactionSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-fold"></span> Disable Auto Compaction' +
            '<span class="settings-info-icon" title="When enabled, VS Code Copilot will NOT auto-compact (summarize) agent conversation history once the context window fills. Turns off github.copilot.chat.summarizeAgentConversationHistory.enabled.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch" id="auto-compaction-toggle" role="switch" aria-checked="false" aria-label="Disable Copilot auto compaction" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(autoCompactionSection);

        // Extended prompt-cache TTL — Anthropic 1-hour cache instead of the default ~5 min.
        // Directly buys more time before a cache goes cold (e.g. while composing a reply).
        var extendedTtlSection = document.createElement('div');
        extendedTtlSection.className = 'settings-section';
        extendedTtlSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-clock"></span> Extended prompt cache (1 hour)' +
            '<span class="settings-info-icon" title="Enables Anthropic 1-hour prompt-cache TTL instead of the default ~5 minutes, so your cached context stays warm far longer (cache hits stay cheap). Sets github.copilot.chat.anthropic.promptCaching.extendedTtl (+ extendedTtlMessages). Requires a Claude model / plan that supports extended caching.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch" id="extended-cache-ttl-toggle" role="switch" aria-checked="false" aria-label="Extended prompt cache TTL" tabindex="0"></div>' +
            '</div>' +
            '<div class="settings-subrow"><label for="extended-cache-ttl-messages-toggle" title="Also apply the 1-hour TTL to the conversation MESSAGES (the bulk of the tokens), not just the tool definitions. Sets github.copilot.chat.anthropic.promptCaching.extendedTtlMessages. Only takes effect when the Extended prompt cache toggle above is also ON (Copilot applies 1h to messages only when both flags are set).">Also extend messages (bulk)</label>' +
            '<div class="toggle-switch" id="extended-cache-ttl-messages-toggle" role="switch" aria-checked="false" aria-label="Extend messages TTL" tabindex="0"></div></div>';
        modalContent.appendChild(extendedTtlSection);

        // Keep cache warm during long sub-agent calls — native Copilot keep-alive probes.
        var keepWarmSection = document.createElement('div');
        keepWarmSection.className = 'settings-section';
        keepWarmSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-pulse"></span> Keep cache warm (sub-agent probes)' +
            '<span class="settings-info-icon" title="Sends lightweight keep-alive probe requests (billed at the cheap cached-input rate) to preserve the prompt cache while a long sub-agent tool call runs. Sets github.copilot.chat.agent.longToolCallCachePreservation.enabled. Note: Copilot only probes during execution_subagent calls, not during ask_user waits.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch" id="cache-keep-warm-toggle" role="switch" aria-checked="false" aria-label="Keep cache warm" tabindex="0"></div>' +
            '</div>' +
            '<div class="settings-subrow"><label for="cache-keep-warm-probes">Max probes</label>' +
            '<input type="number" id="cache-keep-warm-probes" min="0" max="10" step="1" class="settings-number-input" /></div>';
        modalContent.appendChild(keepWarmSection);

        // Keep idle workers warm — askaway.workers.keepWarm (one minimal ping before a worker's cache expires).
        var workersKeepWarmSection = document.createElement('div');
        workersKeepWarmSection.className = 'settings-section';
        workersKeepWarmSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-flame"></span> Keep workers warm' +
            '<span class="settings-info-icon" title="While the main chat is active, send one minimal ping to an idle worker whose prompt cache is about to expire, so it stays warm for reuse. A ping is a real request (cost shown in worker spend). Sets askaway.workers.keepWarm.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch" id="workers-keep-warm-toggle" role="switch" aria-checked="true" aria-label="Keep workers warm" tabindex="0"></div>' +
            '</div>';
        modalContent.appendChild(workersKeepWarmSection);
        var runtimeSection = document.createElement('div');
        runtimeSection.className = 'settings-section';
        runtimeSection.innerHTML = runtimeSettingsHtml();
        modalContent.appendChild(runtimeSection);
        initRuntimeSettings(runtimeSection);
        var approvalSection = document.createElement('div');
        approvalSection.className = 'settings-section';
        approvalSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-checklist"></span> Interactive Approvals</div>' +
            '<div class="toggle-switch active" id="interactive-approval-toggle" role="switch" aria-checked="true" aria-label="Enable interactive approval and choice buttons" tabindex="0"></div>' +
            '</div>';

        // Turn budget (AIU) — soft per-turn credit limit the turn_budget tool checks against.
        var turnBudgetSection = document.createElement('div');
        turnBudgetSection.className = 'settings-section';
        turnBudgetSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-credit-card"></span> Turn Budget (AIU)' +
            '<span class="settings-info-icon" title="Soft per-turn credit budget in AIU. When the agent calls the turn_budget tool and the turn spend exceeds this, it is advised to wrap up. 0 = disabled (no soft limit). Advisory only — nothing is blocked.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<input type="number" class="form-input" id="turn-budget-input" min="0" max="1000000" step="100" placeholder="0 = disabled">' +
            '</div>';
        modalContent.appendChild(turnBudgetSection);

        // Autopilot section with cycling prompts list
        var autopilotSection = document.createElement('div');
        autopilotSection.className = 'settings-section';
        autopilotSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-rocket"></span> Autopilot Prompts' +
            '<span class="settings-info-icon" title="Prompts cycle in order (1→2→3→1...) with human-like delay.\n\nHow it works:\n• The agent calls ask_user → Autopilot sends the next prompt in sequence\n• Add multiple prompts to alternate between different instructions\n• Drag to reorder, edit or delete individual prompts\n\nQueue Priority:\n• Queued prompts ALWAYS take priority over Autopilot\n• Autopilot only activates when the queue is empty">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<button class="add-prompt-btn-inline" id="autopilot-add-btn" title="Add Autopilot prompt" aria-label="Add Autopilot prompt"><span class="codicon codicon-add"></span></button>' +
            '</div>' +
            '<div class="autopilot-prompts-list" id="autopilot-prompts-list"></div>' +
            '<div class="add-autopilot-prompt-form hidden" id="add-autopilot-prompt-form">' +
            '<div class="form-row">' +
            '<textarea class="form-input form-textarea" id="autopilot-prompt-input" placeholder="Enter Autopilot prompt text..." maxlength="2000"></textarea>' +
            '</div>' +
            '<div class="form-actions">' +
            '<button class="form-btn form-btn-cancel" id="cancel-autopilot-prompt-btn">Cancel</button>' +
            '<button class="form-btn form-btn-save" id="save-autopilot-prompt-btn">Save</button>' +
            '</div>' +
            '</div>';

        // Response Timeout section - dropdown for timeout minutes
        var timeoutSection = document.createElement('div');
        timeoutSection.className = 'settings-section';
        timeoutSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-clock"></span> Response Timeout' +
            '<span class="settings-info-icon" title="If no response is received within this time, it will automatically send the session termination message.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<select class="form-input form-select" id="response-timeout-select">' +
            '<option value="0">Disabled</option>' +
            '<option value="5">5 minutes</option>' +
            '<option value="10">10 minutes</option>' +
            '<option value="20">20 minutes</option>' +
            '<option value="30">30 minutes</option>' +
            '<option value="40">40 minutes</option>' +
            '<option value="50">50 minutes</option>' +
            '<option value="60">60 minutes (default)</option>' +
            '<option value="70">70 minutes</option>' +
            '<option value="80">80 minutes</option>' +
            '<option value="90">90 minutes</option>' +
            '<option value="100">100 minutes</option>' +
            '<option value="110">110 minutes</option>' +
            '<option value="120">120 minutes (2h)</option>' +
            '<option value="150">150 minutes (2.5h)</option>' +
            '<option value="180">180 minutes (3h)</option>' +
            '<option value="210">210 minutes (3.5h)</option>' +
            '<option value="240">240 minutes (4h)</option>' +
            '</select>' +
            '</div>';

        // Session Warning section - warning threshold in hours
        var sessionWarningSection = document.createElement('div');
        sessionWarningSection.className = 'settings-section';
        sessionWarningSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-watch"></span> Session Warning' +
            '<span class="settings-info-icon" title="Show a one-time warning after this many hours in the same session. Set to 0 to disable.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<select class="form-input form-select" id="session-warning-hours-select">' +
            '<option value="0">Disabled</option>' +
            '<option value="1">1 hour</option>' +
            '<option value="2">2 hours</option>' +
            '<option value="3">3 hours</option>' +
            '<option value="4">4 hours</option>' +
            '<option value="5">5 hours</option>' +
            '<option value="6">6 hours</option>' +
            '<option value="7">7 hours</option>' +
            '<option value="8">8 hours</option>' +
            '</select>' +
            '</div>';

        // Max Consecutive Auto-Responses section - number input
        var maxAutoSection = document.createElement('div');
        maxAutoSection.className = 'settings-section';
        maxAutoSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-stop-circle"></span> Max Auto-Responses' +
            '<span class="settings-info-icon" title="Maximum consecutive auto-responses using Autopilot before pausing and requiring manual input. Prevents infinite loops.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '</div>' +
            '<div class="form-row">' +
            '<input type="number" class="form-input" id="max-auto-responses-input" min="1" max="50" value="5" />' +
            '</div>';

        // Human-Like Delay section - toggle + min/max inputs
        var humanDelaySection = document.createElement('div');
        humanDelaySection.className = 'settings-section';
        humanDelaySection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title">' +
            '<span class="codicon codicon-pulse"></span> Human-Like Delay' +
            '<span class="settings-info-icon" title="Add random delays (2-6s by default) before auto-responses. Simulates natural pacing for automated responses.">' +
            '<span class="codicon codicon-info"></span></span>' +
            '</div>' +
            '<div class="toggle-switch active" id="human-delay-toggle" role="switch" aria-checked="true" aria-label="Toggle Human-Like Delay" tabindex="0"></div>' +
            '</div>' +
            '<div class="form-row human-delay-range" id="human-delay-range">' +
            '<label class="form-label-inline">Min (s):</label>' +
            '<input type="number" class="form-input form-input-small" id="human-delay-min-input" min="1" max="30" value="2" />' +
            '<label class="form-label-inline">Max (s):</label>' +
            '<input type="number" class="form-input form-input-small" id="human-delay-max-input" min="2" max="60" value="6" />' +
            '</div>';

        // Integrations header
        var integrationsHeader = document.createElement('div');
        integrationsHeader.className = 'settings-section';
        integrationsHeader.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title" style="font-size:12px;opacity:0.6;text-transform:uppercase;letter-spacing:0.5px;"><span class="codicon codicon-plug"></span> Integrations</div>' +
            '</div>';
        modalContent.appendChild(integrationsHeader);

        // Webex integration toggle
        var webexSection = document.createElement('div');
        webexSection.className = 'settings-section';
        webexSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-broadcast"></span> Webex</div>' +
            '<div class="toggle-switch" id="webex-toggle" role="switch" aria-checked="false" aria-label="Enable Webex integration" tabindex="0"></div>' +
            '</div>' +
            '<div class="settings-status" id="webex-status"></div>';
        modalContent.appendChild(webexSection);

        // Telegram integration toggle
        var telegramSection = document.createElement('div');
        telegramSection.className = 'settings-section';
        telegramSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-comment-discussion"></span> Telegram</div>' +
            '<div class="toggle-switch" id="telegram-toggle" role="switch" aria-checked="false" aria-label="Enable Telegram integration" tabindex="0"></div>' +
            '</div>' +
            '<div class="settings-status" id="telegram-status"></div>';
        modalContent.appendChild(telegramSection);

        // Reusable Prompts section - plus button next to title
        var promptsSection = document.createElement('div');
        promptsSection.className = 'settings-section';
        promptsSection.innerHTML = '<div class="settings-section-header">' +
            '<div class="settings-section-title"><span class="codicon codicon-symbol-keyword"></span> Reusable Prompts</div>' +
            '<button class="add-prompt-btn-inline" id="add-prompt-btn" title="Add Prompt" aria-label="Add reusable prompt"><span class="codicon codicon-add"></span></button>' +
            '</div>' +
            '<div class="prompts-list" id="prompts-list"></div>' +
            '<div class="add-prompt-form hidden" id="add-prompt-form">' +
            '<div class="form-row"><label class="form-label" for="prompt-name-input">Name (used as /command)</label>' +
            '<input type="text" class="form-input" id="prompt-name-input" placeholder="e.g., fix, test, refactor" maxlength="30"></div>' +
            '<div class="form-row"><label class="form-label" for="prompt-text-input">Prompt Text</label>' +
            '<textarea class="form-input form-textarea" id="prompt-text-input" placeholder="Enter the full prompt text..." maxlength="2000"></textarea></div>' +
            '<div class="form-actions">' +
            '<button class="form-btn form-btn-cancel" id="cancel-prompt-btn">Cancel</button>' +
            '<button class="form-btn form-btn-save" id="save-prompt-btn">Save</button></div></div>';

        // Assemble settings panel
        settingsModal.appendChild(modalHeader);
        settingsModal.appendChild(modalContent);
        settingsHost.innerHTML = '';
        settingsHost.appendChild(settingsModal);

        // Cache inner elements
        soundToggle = document.getElementById('sound-toggle');
        interactiveApprovalToggle = document.getElementById('interactive-approval-toggle');
        sendShortcutToggle = document.getElementById('send-shortcut-toggle');
        webexToggle = document.getElementById('webex-toggle');
        telegramToggle = document.getElementById('telegram-toggle');
        autopilotPromptsList = document.getElementById('autopilot-prompts-list');
        autopilotAddBtn = document.getElementById('autopilot-add-btn');
        addAutopilotPromptForm = document.getElementById('add-autopilot-prompt-form');
        autopilotPromptInput = document.getElementById('autopilot-prompt-input');
        saveAutopilotPromptBtn = document.getElementById('save-autopilot-prompt-btn');
        cancelAutopilotPromptBtn = document.getElementById('cancel-autopilot-prompt-btn');
        responseTimeoutSelect = document.getElementById('response-timeout-select');
        sessionWarningHoursSelect = document.getElementById('session-warning-hours-select');
        maxAutoResponsesInput = document.getElementById('max-auto-responses-input');
        turnBudgetInput = document.getElementById('turn-budget-input');
        humanDelayToggle = document.getElementById('human-delay-toggle');
        humanDelayRangeContainer = document.getElementById('human-delay-range');
        humanDelayMinInput = document.getElementById('human-delay-min-input');
        humanDelayMaxInput = document.getElementById('human-delay-max-input');
        promptsList = document.getElementById('prompts-list');
        addPromptBtn = document.getElementById('add-prompt-btn');
        addPromptForm = document.getElementById('add-prompt-form');
        debugLoggingToggle = document.getElementById('debug-logging-toggle');
        rtkCompressionToggle = document.getElementById('rtk-compression-toggle');
        autoCompactionToggle = document.getElementById('auto-compaction-toggle');
        extendedCacheTtlToggle = document.getElementById('extended-cache-ttl-toggle');
        extendedCacheTtlMessagesToggle = document.getElementById('extended-cache-ttl-messages-toggle');
        cacheKeepWarmToggle = document.getElementById('cache-keep-warm-toggle');
        cacheKeepWarmProbesInput = document.getElementById('cache-keep-warm-probes');
        workersKeepWarmToggle = document.getElementById('workers-keep-warm-toggle');
    }

    // Build the Metrics turn trace and RTK/Gradle savings, separate from Settings.
    function createObservabilityTab() {
        var host = document.getElementById('observability-tab-shell');
        if (!host) return;

        var container = document.createElement('div');
        container.className = 'settings-tab-content';

        var content = document.createElement('div');
        content.className = 'settings-modal-content';

        var observabilitySection = document.createElement('div');
        observabilitySection.className = 'settings-section';
        observabilitySection.innerHTML = '<div class="observability-rtk-line" id="obs-workspace-month"></div>' +
            '<div id="obs-turn-view">' +
            '<div class="obs-turn-summary" id="obs-turn-summary">No requests yet this turn</div>' +
            '<div class="obs-cache-row">' +
            '<div class="obs-cache-age" id="obs-cache-age" title="Time since the last model request. The prompt prefix cache stays warm for ~5 min; past that a new message likely incurs a cache MISS (more expensive). A long-running tool ages this clock too.">Prompt cache age: \u2013</div>' +
            '<button type="button" class="obs-cache-ping-btn" id="obs-cache-ping-btn" title="Keep-warm ping: fills the CURRENT chat input and submits it in the SAME agent/mode (identical system prompt \u2192 cache HIT at the cheap cached rate), refreshing the ~5-min TTL. Use it while the agent is idle and this chat is the active one. For automatic keep-warm, enable the native settings below (Keep cache warm + Extended prompt cache).">\u26a1 Ping</button>' +
            '</div>' +
            '<div id="obs-trace-groups"></div>' +
            '<div class="observability-model-note">Timeline this turn \u2014 LLM requests in columns \u00b7 expand a tool row for input/output \u00b7 ask me to investigate any <b>ID</b></div>' +
            '<table class="observability-table observability-model-table obs-timeline-table">' +
            '<thead><tr><th>ID</th><th>Model / Tool</th><th>Credits</th><th>Input</th><th>Output</th><th>Cached</th><th title="cached / input">Hit%</th></tr></thead>' +
            '<tbody id="obs-turn-event-tbody"><tr><td colspan="7" class="obs-na">No events yet</td></tr></tbody>' +
            '</table>' +
            '</div>';
        content.appendChild(observabilitySection);
        container.appendChild(content);

        host.innerHTML = '';
        host.appendChild(container);

        observabilityRtkLine = document.getElementById('observability-rtk-line');
    }

    function bindEventListeners() {

        // Settings modal events
        if (settingsModalClose) settingsModalClose.addEventListener('click', closeSettingsModal);
        if (settingsModalOverlay) {
            settingsModalOverlay.addEventListener('click', function (e) {
                if (e.target === settingsModalOverlay) closeSettingsModal();
            });
        }
        if (soundToggle) {
            soundToggle.addEventListener('click', toggleSoundSetting);
            soundToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSoundSetting();
                }
            });
        }
        if (interactiveApprovalToggle) {
            interactiveApprovalToggle.addEventListener('click', toggleInteractiveApprovalSetting);
            interactiveApprovalToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleInteractiveApprovalSetting();
                }
            });
        }
        if (sendShortcutToggle) {
            sendShortcutToggle.addEventListener('click', toggleSendWithCtrlEnterSetting);
            sendShortcutToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSendWithCtrlEnterSetting();
                }
            });
        }
        if (debugLoggingToggle) {
            debugLoggingToggle.addEventListener('click', toggleDebugLoggingSetting);
            debugLoggingToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleDebugLoggingSetting();
                }
            });
        }
        if (rtkCompressionToggle) {
            rtkCompressionToggle.addEventListener('click', toggleRtkCompressionSetting);
            rtkCompressionToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleRtkCompressionSetting();
                }
            });
        }
        if (autoCompactionToggle) {
            autoCompactionToggle.addEventListener('click', toggleAutoCompactionSetting);
            autoCompactionToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleAutoCompactionSetting();
                }
            });
        }
        if (extendedCacheTtlToggle) {
            extendedCacheTtlToggle.addEventListener('click', toggleExtendedCacheTtl);
            extendedCacheTtlToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExtendedCacheTtl(); }
            });
        }
        if (extendedCacheTtlMessagesToggle) {
            extendedCacheTtlMessagesToggle.addEventListener('click', toggleExtendedCacheTtlMessages);
            extendedCacheTtlMessagesToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExtendedCacheTtlMessages(); }
            });
        }
        if (cacheKeepWarmToggle) {
            cacheKeepWarmToggle.addEventListener('click', toggleCacheKeepWarm);
            cacheKeepWarmToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCacheKeepWarm(); }
            });
        }
        if (workersKeepWarmToggle) {
            workersKeepWarmToggle.addEventListener('click', toggleWorkersKeepWarm);
            workersKeepWarmToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWorkersKeepWarm(); }
            });
        }
        if (cacheKeepWarmProbesInput) {
            cacheKeepWarmProbesInput.addEventListener('change', function () {
                var v = Math.max(0, Math.min(10, Math.round(Number(cacheKeepWarmProbesInput.value) || 0)));
                cacheKeepWarmProbes = v;
                cacheKeepWarmProbesInput.value = String(v);
                vscode.postMessage({ type: 'updateCacheKeepWarmProbes', value: v });
            });
        }
        if (webexToggle) {
            webexToggle.addEventListener('click', toggleWebexSetting);
            webexToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleWebexSetting();
                }
            });
        }
        if (telegramToggle) {
            telegramToggle.addEventListener('click', toggleTelegramSetting);
            telegramToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleTelegramSetting();
                }
            });
        }
        if (autopilotToggle) {
            autopilotToggle.addEventListener('click', toggleAutopilotSetting);
            autopilotToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleAutopilotSetting();
                }
            });
        }
        // Autopilot prompts list event listeners
        if (autopilotAddBtn) {
            autopilotAddBtn.addEventListener('click', showAddAutopilotPromptForm);
        }
        if (saveAutopilotPromptBtn) {
            saveAutopilotPromptBtn.addEventListener('click', saveAutopilotPrompt);
        }
        if (cancelAutopilotPromptBtn) {
            cancelAutopilotPromptBtn.addEventListener('click', hideAddAutopilotPromptForm);
        }
        if (autopilotPromptsList) {
            autopilotPromptsList.addEventListener('click', handleAutopilotPromptsListClick);
            // Drag and drop for reordering
            autopilotPromptsList.addEventListener('dragstart', handleAutopilotDragStart);
            autopilotPromptsList.addEventListener('dragover', handleAutopilotDragOver);
            autopilotPromptsList.addEventListener('dragend', handleAutopilotDragEnd);
            autopilotPromptsList.addEventListener('drop', handleAutopilotDrop);
        }
        if (responseTimeoutSelect) {
            responseTimeoutSelect.addEventListener('change', handleResponseTimeoutChange);
        }
        if (sessionWarningHoursSelect) {
            sessionWarningHoursSelect.addEventListener('change', handleSessionWarningHoursChange);
        }
        if (maxAutoResponsesInput) {
            maxAutoResponsesInput.addEventListener('change', handleMaxAutoResponsesChange);
            maxAutoResponsesInput.addEventListener('blur', handleMaxAutoResponsesChange);
        }
        if (turnBudgetInput) {
            turnBudgetInput.addEventListener('change', handleTurnBudgetChange);
            turnBudgetInput.addEventListener('blur', handleTurnBudgetChange);
        }
        if (humanDelayToggle) {
            humanDelayToggle.addEventListener('click', toggleHumanDelaySetting);
            humanDelayToggle.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHumanDelaySetting();
                }
            });
        }
        if (humanDelayMinInput) {
            humanDelayMinInput.addEventListener('change', handleHumanDelayMinChange);
            humanDelayMinInput.addEventListener('blur', handleHumanDelayMinChange);
        }
        if (humanDelayMaxInput) {
            humanDelayMaxInput.addEventListener('change', handleHumanDelayMaxChange);
            humanDelayMaxInput.addEventListener('blur', handleHumanDelayMaxChange);
        }
        if (addPromptBtn) addPromptBtn.addEventListener('click', showAddPromptForm);
        // Add prompt form events (deferred - bind after modal created)
        var cancelPromptBtn = document.getElementById('cancel-prompt-btn');
        var savePromptBtn = document.getElementById('save-prompt-btn');
        if (cancelPromptBtn) cancelPromptBtn.addEventListener('click', hideAddPromptForm);
        if (savePromptBtn) savePromptBtn.addEventListener('click', saveNewPrompt);

        window.addEventListener('message', handleExtensionMessage);
    }

    function handleExtensionMessage(event) {
        var message = event.data;
        console.log('[TaskSync Webview] Received message:', message.type, message);
        switch (message.type) {
            case 'specsData':
                applySpecsData(message.data);
                break;
            case 'workersState':
                applyWorkersState(message.data);
                break;
            case 'runtimeHealth':
                applyRuntimeHealth(message.health);
                break;
            case 'workerTrace':
                if (message.data && message.data.workerId) { workersTraces[message.data.workerId] = message.data; paintWorkers(); }
                break;
            case 'availabilityState':
                presenceStates = message.states || presenceStates;
                applyAvailabilityState(message.data);
                break;
            case 'openPresence':
                openPresence();
                break;
            case 'openSettingsModal':
                openSettingsModal();
                break;
            case 'remotePollingStatus':
                webexEnabled = message.webexEnabled === true;
                telegramEnabled = message.telegramEnabled === true;
                updateWebexStatusUI(message.webexStatus);
                updateTelegramStatusUI(message.telegramStatus);
                break;
            case 'updateSettings':
                soundEnabled = message.soundEnabled !== false;
                interactiveApprovalEnabled = message.interactiveApprovalEnabled !== false;
                sendWithCtrlEnter = message.sendWithCtrlEnter === true;
                webexEnabled = message.webexEnabled === true;
                telegramEnabled = message.telegramEnabled === true;
                autopilotEnabled = message.autopilotEnabled === true;
                autopilotText = typeof message.autopilotText === 'string' ? message.autopilotText : '';
                autopilotPrompts = Array.isArray(message.autopilotPrompts) ? message.autopilotPrompts : [];
                reusablePrompts = message.reusablePrompts || [];
                responseTimeout = normalizeResponseTimeout(message.responseTimeout);
                sessionWarningHours = typeof message.sessionWarningHours === 'number' ? message.sessionWarningHours : 2;
                maxConsecutiveAutoResponses = typeof message.maxConsecutiveAutoResponses === 'number' ? message.maxConsecutiveAutoResponses : 5;
                turnBudgetAiu = typeof message.turnBudgetAiu === 'number' ? message.turnBudgetAiu : 0;
                humanLikeDelayEnabled = message.humanLikeDelayEnabled !== false;
                humanLikeDelayMin = typeof message.humanLikeDelayMin === 'number' ? message.humanLikeDelayMin : 2;
                humanLikeDelayMax = typeof message.humanLikeDelayMax === 'number' ? message.humanLikeDelayMax : 6;
                debugLoggingEnabled = message.debugLoggingEnabled !== false;
                rtkCompressionEnabled = message.rtkCompressionEnabled === true;
                rtkInstalled = message.rtkInstalled !== false;
                autoCompactionDisabled = message.autoCompactionDisabled === true;
                extendedCacheTtl = message.extendedCacheTtl === true;
                extendedCacheTtlMessages = message.extendedCacheTtlMessages === true;
                cacheKeepWarmEnabled = message.cacheKeepWarmEnabled === true;
                workersKeepWarmEnabled = message.workersKeepWarm !== false;
                cacheKeepWarmProbes = Number(message.cacheKeepWarmProbes);
                if (!isFinite(cacheKeepWarmProbes)) { cacheKeepWarmProbes = 1; }
                if (message.observabilityMetrics && typeof message.observabilityMetrics === 'object') {
                    observabilityMetrics = {
                        requestCount: Number(message.observabilityMetrics.requestCount) || 0,
                        inputTokens: Number(message.observabilityMetrics.inputTokens) || 0,
                        outputTokens: Number(message.observabilityMetrics.outputTokens) || 0,
                        cachedTokens: Number(message.observabilityMetrics.cachedTokens) || 0,
                        nanoAiu: Number(message.observabilityMetrics.nanoAiu) || 0,
                        rtkCommandCount: Number(message.observabilityMetrics.rtkCommandCount) || 0,
                        rtkSavedTokens: Number(message.observabilityMetrics.rtkSavedTokens) || 0,
                        rtkSavingsPct: Number(message.observabilityMetrics.rtkSavingsPct) || 0,
                        source: typeof message.observabilityMetrics.source === 'string' ? message.observabilityMetrics.source : 'unavailable',
                        updatedAt: Number(message.observabilityMetrics.updatedAt) || 0
                    };
                }
                updateSoundToggleUI();
                updateInteractiveApprovalToggleUI();
                updateSendWithCtrlEnterToggleUI();
                updateDebugLoggingToggleUI();
                updateRtkCompressionToggleUI();
                updateAutoCompactionToggleUI();
                updateCacheSettingsUI();
                updateWebexToggleUI();
                updateWebexStatusUI(message.webexStatus);
                updateTelegramToggleUI();
                updateTelegramStatusUI(message.telegramStatus);
                updateAutopilotToggleUI();
                renderAutopilotPromptsList();
                updateResponseTimeoutUI();
                updateSessionWarningHoursUI();
                updateMaxAutoResponsesUI();
                updateTurnBudgetUI();
                updateHumanDelayUI();
                renderPromptsList();
                updateObservabilityUI();
                break;
            case 'updateObservabilityMetrics':
                if (message.metrics && typeof message.metrics === 'object') {
                    var sanitizeScope = function (s) {
                        s = s || {};
                        return {
                            requestCount: Number(s.requestCount) || 0,
                            inputTokens: Number(s.inputTokens) || 0,
                            outputTokens: Number(s.outputTokens) || 0,
                            cachedTokens: Number(s.cachedTokens) || 0,
                            nanoAiu: Number(s.nanoAiu) || 0,
                            cacheMisses: Number(s.cacheMisses) || 0
                        };
                    };
                    observabilityMetrics = {
                        requestCount: Number(message.metrics.requestCount) || 0,
                        inputTokens: Number(message.metrics.inputTokens) || 0,
                        outputTokens: Number(message.metrics.outputTokens) || 0,
                        cachedTokens: Number(message.metrics.cachedTokens) || 0,
                        nanoAiu: Number(message.metrics.nanoAiu) || 0,
                        monthCredits: message.metrics.monthCredits || null,
                        traceGroups: message.metrics.traceGroups || [],
                        lastRequest: sanitizeScope(message.metrics.lastRequest),
                        workspace: sanitizeScope(message.metrics.workspace),
                        overall: sanitizeScope(message.metrics.overall),
                        overallCompaction: (function (c) {
                            c = c || {};
                            return { count: Number(c.count) || 0, nanoAiu: Number(c.nanoAiu) || 0 };
                        })(message.metrics.overallCompaction),
                        perModel: Array.isArray(message.metrics.perModel) ? message.metrics.perModel.map(function (m) {
                            var sc = sanitizeScope(m);
                            sc.model = typeof m.model === 'string' ? m.model : 'unknown';
                            return sc;
                        }) : [],
                        turnRequests: Array.isArray(message.metrics.turnRequests) ? message.metrics.turnRequests.map(function (r) {
                            return {
                                id: typeof r.id === 'string' ? r.id : '?????',
                                model: typeof r.model === 'string' ? r.model : 'unknown',
                                nanoAiu: Number(r.nanoAiu) || 0,
                                inputTokens: Number(r.inputTokens) || 0,
                                outputTokens: Number(r.outputTokens) || 0,
                                cachedTokens: Number(r.cachedTokens) || 0,
                                cacheHitPct: Number(r.cacheHitPct) || 0,
                                kindTag: typeof r.kindTag === 'string' ? r.kindTag : 'normal',
                                subagent: (typeof r.subagent === 'string' && r.subagent) ? r.subagent : null,
                                subagentId: typeof r.subagentId === 'string' ? r.subagentId : null
                            };
                        }) : [],
                        turnEvents: Array.isArray(message.metrics.turnEvents) ? message.metrics.turnEvents.map(function (event) {
                            if (event && event.kind === 'tool') {
                                return {
                                    kind: 'tool',
                                    ts: Number(event.ts) || 0,
                                    id: typeof event.id === 'string' ? event.id : '?????',
                                    tool: typeof event.tool === 'string' ? event.tool : 'unknown',
                                    status: typeof event.status === 'string' ? event.status : 'ok',
                                    durMs: Number(event.durMs) || 0,
                                    inputTokens: Number(event.inputTokens) || 0,
                                    outputTokens: Number(event.outputTokens) || 0,
                                    group: typeof event.group === 'string' ? event.group : 'default',
                                    inputPreview: typeof event.inputPreview === 'string' ? event.inputPreview : '',
                                    outputPreview: typeof event.outputPreview === 'string' ? event.outputPreview : '',
                                    subagent: (typeof event.subagent === 'string' && event.subagent) ? event.subagent : null,
                                    subagentId: (typeof event.subagentId === 'string' && event.subagentId) ? event.subagentId : null
                                };
                            }
                            return {
                                kind: 'request',
                                ts: Number(event && event.ts) || 0,
                                id: event && typeof event.id === 'string' ? event.id : '?????',
                                model: event && typeof event.model === 'string' ? event.model : 'unknown',
                                nanoAiu: Number(event && event.nanoAiu) || 0,
                                inputTokens: Number(event && event.inputTokens) || 0,
                                outputTokens: Number(event && event.outputTokens) || 0,
                                cachedTokens: Number(event && event.cachedTokens) || 0,
                                cacheHitPct: Number(event && event.cacheHitPct) || 0,
                                kindTag: (event && typeof event.kindTag === 'string') ? event.kindTag : 'normal',
                                subagent: (event && typeof event.subagent === 'string' && event.subagent) ? event.subagent : null,
                                subagentId: (event && typeof event.subagentId === 'string' && event.subagentId) ? event.subagentId : null,
                                firstOfTurn: !!(event && event.firstOfTurn),
                                split: (event && event.split && typeof event.split === 'object') ? {
                                    systemTokens: Number(event.split.systemTokens) || 0,
                                    toolsTokens: Number(event.split.toolsTokens) || 0,
                                    conversationTokens: Number(event.split.conversationTokens) || 0,
                                    newMessageTokens: Number(event.split.newMessageTokens) || 0,
                                    cachedPriorTokens: Number(event.split.cachedPriorTokens) || 0,
                                    userTokens: Number(event.split.userTokens) || 0,
                                    totalInputTokens: Number(event.split.totalInputTokens) || 0,
                                    skillsCount: Number(event.split.skillsCount) || 0,
                                    toolsCount: Number(event.split.toolsCount) || 0,
                                    messageCount: Number(event.split.messageCount) || 0,
                                    cachedTokens: Number(event.split.cachedTokens) || 0,
                                    composition: (event.split.composition && typeof event.split.composition === 'object') ? {
                                        totalTokens: Number(event.split.composition.totalTokens) || 0,
                                        baseTokens: Number(event.split.composition.baseTokens) || 0,
                                        segments: Array.isArray(event.split.composition.segments) ? event.split.composition.segments.map(function (s) {
                                            return {
                                                label: typeof s.label === 'string' ? s.label : '',
                                                kind: typeof s.kind === 'string' ? s.kind : 'attachment',
                                                path: (typeof s.path === 'string' && s.path) ? s.path : null,
                                                workspaceFolder: (typeof s.workspaceFolder === 'string' && s.workspaceFolder) ? s.workspaceFolder : null,
                                                tokens: Number(s.tokens) || 0,
                                                children: Array.isArray(s.children) ? s.children.map(function (c) {
                                                    return {
                                                        label: typeof c.label === 'string' ? c.label : '',
                                                        path: (typeof c.path === 'string' && c.path) ? c.path : null,
                                                        tokens: Number(c.tokens) || 0
                                                    };
                                                }) : null
                                            };
                                        }) : []
                                    } : null,
                                    contributors: (event.split.contributors && typeof event.split.contributors === 'object') ? {
                                        totalInputTokens: Number(event.split.contributors.totalInputTokens) || 0,
                                        cachedTokens: Number(event.split.contributors.cachedTokens) || 0,
                                        accountedTokens: Number(event.split.contributors.accountedTokens) || 0,
                                        items: Array.isArray(event.split.contributors.items) ? event.split.contributors.items.map(function (it) {
                                            return {
                                                label: typeof it.label === 'string' ? it.label : '',
                                                kind: typeof it.kind === 'string' ? it.kind : 'dialogue',
                                                tokens: Number(it.tokens) || 0,
                                                path: (typeof it.path === 'string' && it.path) ? it.path : null,
                                                count: Number(it.count) || 0
                                            };
                                        }) : [],
                                        files: Array.isArray(event.split.contributors.files) ? event.split.contributors.files.filter(function (f) { return typeof f === 'string'; }) : [],
                                        memoryFiles: Array.isArray(event.split.contributors.memoryFiles) ? event.split.contributors.memoryFiles.filter(function (f) { return typeof f === 'string'; }) : []
                                    } : null
                                } : null
                            };
                        }) : [],
                        turnSubagents: Array.isArray(message.metrics.turnSubagents) ? message.metrics.turnSubagents.map(function (s) {
                            return {
                                subagentId: typeof s.subagentId === 'string' ? s.subagentId : '',
                                label: typeof s.label === 'string' ? s.label : 'sub-agent',
                                done: !!s.done,
                                durMs: Number(s.durMs) || 0,
                                startedTs: Number(s.startedTs) || 0,
                                outputTokens: Number(s.outputTokens) || 0,
                                status: typeof s.status === 'string' ? s.status : 'running'
                            };
                        }) : [],
                        rtkCommandCount: Number(message.metrics.rtkCommandCount) || 0,
                        rtkSavedTokens: Number(message.metrics.rtkSavedTokens) || 0,
                        rtkSavingsPct: Number(message.metrics.rtkSavingsPct) || 0,
                        lastRequestTs: Number(message.metrics.lastRequestTs) || 0,
                        turnStartedAt: Number(message.metrics.turnStartedAt) || 0,
                        workers: (function (w) {
                            w = w || {};
                            var out = { requests: Number(w.requests) || 0, dollars: Number(w.dollars) || 0, runs: Number(w.runs) || 0,
                                workers: Number(w.workers) || 0, workerIds: Array.isArray(w.workerIds) ? w.workerIds.filter(function (id) { return typeof id === 'string'; }) : [],
                                inputTokens: Number(w.inputTokens) || 0, outputTokens: Number(w.outputTokens) || 0,
                                cachedTokens: Number(w.cachedTokens) || 0, cacheMisses: Number(w.cacheMisses) || 0,
                                perModel: w.perModel || {}, toolCalls: Array.isArray(w.toolCalls) ? w.toolCalls : [] };
                            // Present only when a runtime reported no billed cost (agy), like the provider's field.
                            if (Number(w.unreportedCostRequests) > 0) out.unreportedCostRequests = Number(w.unreportedCostRequests);
                            return out;
                        })(message.metrics.workers),
                        gradle: (function (g) {
                            g = g || {};
                            return {
                                runs: Number(g.runs) || 0,
                                optimizedRuns: Number(g.optimizedRuns) || 0,
                                tasksAvoided: Number(g.tasksAvoided) || 0,
                                configCacheReuses: Number(g.configCacheReuses) || 0,
                                savedTokens: Number(g.savedTokens) || 0
                            };
                        })(message.metrics.gradle),
                        toolCalls: (function (t) {
                            t = t || {};
                            function mapScope(s) {
                                s = s || {};
                                return {
                                    totalCalls: Number(s.totalCalls) || 0,
                                    totalOutputTokens: Number(s.totalOutputTokens) || 0,
                                    byTool: Array.isArray(s.byTool) ? s.byTool.map(function (r) {
                                        return {
                                            tool: typeof r.tool === 'string' ? r.tool : 'unknown',
                                            calls: Number(r.calls) || 0,
                                            outputTokens: Number(r.outputTokens) || 0,
                                            avgMs: Number(r.avgMs) || 0,
                                            minMs: Number(r.minMs) || 0,
                                            maxMs: Number(r.maxMs) || 0,
                                            errors: Number(r.errors) || 0,
                                            cacheRisk: !!r.cacheRisk,
                                            groups: Array.isArray(r.groups) ? r.groups.map(function (gg) {
                                                return { group: typeof gg.group === 'string' ? gg.group : '?', calls: Number(gg.calls) || 0 };
                                            }) : []
                                        };
                                    }) : []
                                };
                            }
                            var month = mapScope(t);
                            month.turn = mapScope(t.turn);
                            return month;
                        })(message.metrics.toolCalls),
                        source: typeof message.metrics.source === 'string' ? message.metrics.source : 'unavailable',
                        updatedAt: Number(message.metrics.updatedAt) || 0
                    };
                }
                updateObservabilityUI();
                break;
            case 'playNotificationSound':
                playNotificationSound();
                break;
            case 'updateSessionTimer':
                // Timer is displayed in the view title bar by the extension host
                // No webview UI to update
                break;
            case 'voiceStart':
                handleVoiceStart(message.taskId, message.question);
                break;
            case 'voiceSpeakingDone':
                handleVoiceSpeakingDone(message.taskId);
                break;
            case 'voiceStop':
                handleVoiceStop();
                break;
            case 'updateWorkerQueue':
                handleWorkerQueueUpdate(message.tasks);
                break;
            case 'availableModels':
                availableModels = message.models || [];
                initWorkerModelDefault('command');
                initWorkerModelDefault('subagent');
                break;
            case 'availableTools':
                availableTools = filterMinimalWorkerTools(message.tools);
                ['command', 'subagent'].forEach(function(role) {
                    var lbl = document.getElementById(role + '-tools-label');
                    var total = availableTools.length;
                    var sel = workerSelectedTools[role];
                    var cnt = sel ? sel.size : total;
                    if (lbl) lbl.textContent = cnt + '/' + total + ' tools selected';
                    if (workerToolsExpanded[role]) renderToolsPicker(role);
                });
                break;
        }
    }

    // Constants for security and performance limits
    var MARKDOWN_MAX_LENGTH = 100000; // Max markdown input length to prevent ReDoS
    var MAX_TABLE_ROWS = 100; // Max table rows to process

    // Mermaid rendering - lazy load and render
    var mermaidLoaded = false;
    var mermaidLoading = false;

    // ===== SETTINGS MODAL FUNCTIONS =====

    function openSettingsModal() {
        switchTab('settings');
        vscode.postMessage({ type: 'openSettingsModal' });
    }

    function closeSettingsModal() {
        hideAddPromptForm();
        hideAddAutopilotPromptForm();
    }

    function toggleSoundSetting() {
        soundEnabled = !soundEnabled;
        updateSoundToggleUI();
        vscode.postMessage({ type: 'updateSoundSetting', enabled: soundEnabled });
    }

    function updateSoundToggleUI() {
        if (!soundToggle) return;
        soundToggle.classList.toggle('active', soundEnabled);
        soundToggle.setAttribute('aria-checked', soundEnabled ? 'true' : 'false');
    }

    function toggleInteractiveApprovalSetting() {
        interactiveApprovalEnabled = !interactiveApprovalEnabled;
        updateInteractiveApprovalToggleUI();
        vscode.postMessage({ type: 'updateInteractiveApprovalSetting', enabled: interactiveApprovalEnabled });
    }

    function updateInteractiveApprovalToggleUI() {
        if (!interactiveApprovalToggle) return;
        interactiveApprovalToggle.classList.toggle('active', interactiveApprovalEnabled);
        interactiveApprovalToggle.setAttribute('aria-checked', interactiveApprovalEnabled ? 'true' : 'false');
    }

    function toggleWebexSetting() {
        webexEnabled = !webexEnabled;
        updateWebexToggleUI();
        vscode.postMessage({ type: 'updateWebexSetting', enabled: webexEnabled });
    }

    function updateWebexToggleUI() {
        if (!webexToggle) return;
        webexToggle.classList.toggle('active', webexEnabled);
        webexToggle.setAttribute('aria-checked', webexEnabled ? 'true' : 'false');
    }

    function updateWebexStatusUI(status) {
        updateRemoteStatusUI('webex', 'Webex', webexEnabled, status);
    }

    function toggleTelegramSetting() {
        telegramEnabled = !telegramEnabled;
        updateTelegramToggleUI();
        vscode.postMessage({ type: 'updateTelegramSetting', enabled: telegramEnabled });
    }

    function updateTelegramToggleUI() {
        if (!telegramToggle) return;
        telegramToggle.classList.toggle('active', telegramEnabled);
        telegramToggle.setAttribute('aria-checked', telegramEnabled ? 'true' : 'false');
    }

    function updateTelegramStatusUI(status) {
        updateRemoteStatusUI('telegram', 'Telegram', telegramEnabled, status);
    }

    function remotePollingStatusHtml(label, status, now) {
        var icon = status.status === 'connected' ? '✅' : status.status === 'disabled' ? '⏸' : '⚠️';
        var html = '<span class="remote-connection-status">' + escapeHtml(label) + ': ' + icon + ' ' + escapeHtml(status.message || '') + '</span>';
        var polling = status.isPolling === true;
        html += '<span class="remote-polling-status"> · ' + (polling ? 'Polling for replies' : 'Polling idle') + ' · ' + (Number(status.activeTasks) || 0) + ' tracked replies</span>';
        if (polling) {
            var next = Number(status.nextPollAt);
            html += '<span class="remote-poll-countdown"> · ' + (isFinite(next) && next > 0
                ? 'Next poll in ' + Math.max(0, Math.ceil((next - now) / 1000)) + 's'
                : 'Next poll timing unavailable') + '</span>';
            var last = Number(status.lastPollAt);
            if (isFinite(last) && last > 0) {
                html += '<span class="remote-last-poll"> · Last poll ' + Math.max(0, Math.floor((now - last) / 1000)) + 's ago</span>';
            }
        }
        return html;
    }

    function updateRemoteStatusUI(channel, label, enabled, status) {
        remotePollingStatuses[channel] = enabled && status ? { label: label, status: status } : null;
        renderRemoteStatuses();
        var polling = Object.keys(remotePollingStatuses).some(function (key) {
            return remotePollingStatuses[key] && remotePollingStatuses[key].status.isPolling === true;
        });
        if (polling && remotePollingTimer === null) {
            remotePollingTimer = setInterval(renderRemoteStatuses, 1000);
        } else if (!polling && remotePollingTimer !== null) {
            clearInterval(remotePollingTimer);
            remotePollingTimer = null;
        }
    }

    function renderRemoteStatuses() {
        Object.keys(remotePollingStatuses).forEach(function (channel) {
            var el = document.getElementById(channel + '-status');
            if (!el) return;
            var entry = remotePollingStatuses[channel];
            if (!entry) { el.innerHTML = ''; el.title = ''; return; }
            var status = entry.status;
            el.innerHTML = remotePollingStatusHtml(entry.label, status, Date.now());
            el.title = status.hint || '';
            el.className = 'settings-status settings-status-' + status.status;
        });
    }

    function toggleAutopilotSetting() {
        autopilotEnabled = !autopilotEnabled;
        updateAutopilotToggleUI();
        vscode.postMessage({ type: 'updateAutopilotSetting', enabled: autopilotEnabled });
    }

    function updateAutopilotToggleUI() {
        if (autopilotToggle) {
            autopilotToggle.classList.toggle('active', autopilotEnabled);
            autopilotToggle.setAttribute('aria-checked', autopilotEnabled ? 'true' : 'false');
        }
    }

    function toggleSendWithCtrlEnterSetting() {
        sendWithCtrlEnter = !sendWithCtrlEnter;
        updateSendWithCtrlEnterToggleUI();
        vscode.postMessage({ type: 'updateSendWithCtrlEnterSetting', enabled: sendWithCtrlEnter });
    }

    function updateSendWithCtrlEnterToggleUI() {
        if (!sendShortcutToggle) return;
        sendShortcutToggle.classList.toggle('active', sendWithCtrlEnter);
        sendShortcutToggle.setAttribute('aria-checked', sendWithCtrlEnter ? 'true' : 'false');
    }

    function toggleDebugLoggingSetting() {
        debugLoggingEnabled = !debugLoggingEnabled;
        updateDebugLoggingToggleUI();
        vscode.postMessage({ type: 'updateDebugLoggingSetting', enabled: debugLoggingEnabled });
    }

    function updateDebugLoggingToggleUI() {
        if (!debugLoggingToggle) return;
        debugLoggingToggle.classList.toggle('active', debugLoggingEnabled);
        debugLoggingToggle.setAttribute('aria-checked', debugLoggingEnabled ? 'true' : 'false');
    }

    function toggleAutoCompactionSetting() {
        autoCompactionDisabled = !autoCompactionDisabled;
        updateAutoCompactionToggleUI();
        vscode.postMessage({ type: 'updateAutoCompactionDisabled', disabled: autoCompactionDisabled });
    }

    function updateAutoCompactionToggleUI() {
        if (!autoCompactionToggle) return;
        autoCompactionToggle.classList.toggle('active', autoCompactionDisabled);
        autoCompactionToggle.setAttribute('aria-checked', autoCompactionDisabled ? 'true' : 'false');
    }

    function toggleExtendedCacheTtl() {
        extendedCacheTtl = !extendedCacheTtl;
        updateCacheSettingsUI();
        vscode.postMessage({ type: 'updateExtendedCacheTtl', enabled: extendedCacheTtl });
    }

    function toggleExtendedCacheTtlMessages() {
        extendedCacheTtlMessages = !extendedCacheTtlMessages;
        updateCacheSettingsUI();
        vscode.postMessage({ type: 'updateExtendedCacheTtlMessages', enabled: extendedCacheTtlMessages });
    }

    function toggleCacheKeepWarm() {
        cacheKeepWarmEnabled = !cacheKeepWarmEnabled;
        updateCacheSettingsUI();
        vscode.postMessage({ type: 'updateCacheKeepWarm', enabled: cacheKeepWarmEnabled });
    }

    function toggleWorkersKeepWarm() {
        workersKeepWarmEnabled = !workersKeepWarmEnabled;
        updateCacheSettingsUI();
        vscode.postMessage({ type: 'updateWorkersKeepWarm', enabled: workersKeepWarmEnabled });
    }

    function updateCacheSettingsUI() {
        if (workersKeepWarmToggle) {
            workersKeepWarmToggle.classList.toggle('active', workersKeepWarmEnabled);
            workersKeepWarmToggle.setAttribute('aria-checked', workersKeepWarmEnabled ? 'true' : 'false');
        }
        if (extendedCacheTtlToggle) {
            extendedCacheTtlToggle.classList.toggle('active', extendedCacheTtl);
            extendedCacheTtlToggle.setAttribute('aria-checked', extendedCacheTtl ? 'true' : 'false');
        }
        if (extendedCacheTtlMessagesToggle) {
            extendedCacheTtlMessagesToggle.classList.toggle('active', extendedCacheTtlMessages);
            extendedCacheTtlMessagesToggle.setAttribute('aria-checked', extendedCacheTtlMessages ? 'true' : 'false');
        }
        if (cacheKeepWarmToggle) {
            cacheKeepWarmToggle.classList.toggle('active', cacheKeepWarmEnabled);
            cacheKeepWarmToggle.setAttribute('aria-checked', cacheKeepWarmEnabled ? 'true' : 'false');
        }
        if (cacheKeepWarmProbesInput && document.activeElement !== cacheKeepWarmProbesInput) {
            cacheKeepWarmProbesInput.value = String(cacheKeepWarmProbes);
        }
    }

    function toggleRtkCompressionSetting() {
        if (!rtkInstalled) { return; }
        rtkCompressionEnabled = !rtkCompressionEnabled;
        updateRtkCompressionToggleUI();
        vscode.postMessage({ type: 'updateRtkCompressionSetting', enabled: rtkCompressionEnabled });
    }

    function updateRtkCompressionToggleUI() {
        if (!rtkCompressionToggle) return;
        rtkCompressionToggle.classList.toggle('active', rtkCompressionEnabled && rtkInstalled);
        rtkCompressionToggle.setAttribute('aria-checked', (rtkCompressionEnabled && rtkInstalled) ? 'true' : 'false');
        rtkCompressionToggle.classList.toggle('toggle-disabled', !rtkInstalled);
        var section = rtkCompressionToggle.closest('.settings-section');
        if (section) {
            var titleEl = section.querySelector('.settings-section-title');
            if (titleEl) {
                titleEl.innerHTML = '<span class="codicon codicon-server-process"></span> RTK Command Compression' +
                    (rtkInstalled ? '' : ' <span class="obs-na" style="font-size:10px">(rtk not installed)</span>');
            }
        }
    }

    // ── Usage banner: pure, shared by the chat banner and every worker card ──
    function formatObservabilityCompact(value) {
        var n = Number(value);
        if (!isFinite(n)) {
            return '0';
        }
        var sign = n < 0 ? '-' : '';
        var abs = Math.abs(n);
        var suffixed = function (v, suffix) { return v.toFixed(v >= 100 ? 0 : 2).replace(/\.0+$/, '') + suffix; };
        if (abs >= 1000000) { return sign + suffixed(abs / 1000000, 'M'); }
        if (abs >= 1000) { return sign + suffixed(abs / 1000, 'K'); }
        return sign + Math.round(abs).toLocaleString();
    }
    // b: { requests, dollars, lastIn (full prompt of the last request), lastCached, turnOut, workers?: { runs, dollars } }
    // `workers` (chat banner only) shows what the worker part of the totals is; worker cards omit it.
    function bannerDollars(dollars) {
        dollars = Number(dollars) || 0;
        return '$' + dollars.toFixed(dollars > 0 && dollars < 0.01 ? 4 : 2);
    }
    var EFFICIENCY_SCORE_SCALE = 100;
    var EFFICIENCY_CONTEXT_BASE = 64000;
    // Calibrated from 2026-10-10 observed well-cached main turns (~$0.31/1M tokens); revised by 008 benchmark data.
    const SCORE_REF_USD_PER_MTOK = 0.30;
    function efficiencyScore(b) {
        var input = Number(b.cacheInput) || 0;
        var cost = Number(b.dollars) || 0;
        var cacheHit = input > 0 ? Math.min(1, Math.max(0, (Number(b.lastCached) || 0) / input)) : 0;
        var contextFactor = EFFICIENCY_CONTEXT_BASE / Math.max(EFFICIENCY_CONTEXT_BASE, Number(b.averagePrompt) || 0);
        var priceFactor = cost > 0 ? Math.min(1, SCORE_REF_USD_PER_MTOK * (input + (Number(b.turnOut) || 0)) / 1000000 / cost) : 0;
        return { value: cost > 0 && input > 0 ? Math.round(EFFICIENCY_SCORE_SCALE * cacheHit * contextFactor * priceFactor) : null,
            cacheHit: cacheHit, contextFactor: contextFactor, priceFactor: priceFactor };
    }
    function usageBannerHtml(b) {
        var score = efficiencyScore(b);
        var scoreLabel = score.value === null ? '\u2013' : String(score.value);
        var scoreTitle = 'Score = round(100 × CacheHit × ContextFactor × PriceFactor); ' +
            'CacheHit=' + score.cacheHit.toFixed(4) + '; ContextFactor=' + score.contextFactor.toFixed(4) +
            ' (EFFICIENCY_CONTEXT_BASE=' + EFFICIENCY_CONTEXT_BASE + '); PriceFactor=' + score.priceFactor.toFixed(4) +
            ' (SCORE_REF_USD_PER_MTOK=' + SCORE_REF_USD_PER_MTOK + '); cost=$' + (Number(b.dollars) || 0) +
            '; cache misses=' + (Number(b.cacheMisses) || 0) + '; input=' + (Number(b.cacheInput) || 0) +
            '; output=' + (Number(b.turnOut) || 0) + '; requests=' + (Number(b.requests) || 0) +
            '; ' + (b.mainContext ? 'main context' : 'worker context') + ' (average prompt)=' + (Number(b.averagePrompt) || 0);
        var requests = Number(b.requests) || 0;
        var dollars = Number(b.dollars) || 0;
        var lastIn = Number(b.lastIn) || 0;
        var cacheInput = b.cacheInput === undefined ? lastIn : Number(b.cacheInput) || 0;
        var hit = cacheInput > 0 ? Math.round((Number(b.lastCached) || 0) / cacheInput * 100) + '%' : '\u2013';
        var w = b.workers || {};
        var workerRuns = Number(w.workers) || 0;
        var workerDollars = Number(w.dollars) || 0;
        var workerRequests = Number(w.requests) || 0;
        var workerReqPart = w.requests === undefined ? '' : ' &middot; ' + workerRequests + ' req' + (workerRequests === 1 ? '' : 's');
        var workerPart = workerRuns > 0
            ? ' <span class="health-workers" title="Distinct workers that ran this turn, their requests and cost (included in the total)">(' + workerRuns + ' worker' + (workerRuns === 1 ? '' : 's') + workerReqPart + ' &middot; ' + bannerDollars(workerDollars) + ')</span>'
            : '';
        var flag = b.flagContext ? workerContextFlag(lastIn) : { over: false };
        var lastInHtml = flag.over
            ? '<span class="' + flag.cls.trim() + '" title="' + flag.title + '">' + formatObservabilityCompact(lastIn) + '</span>'
            : b.mainContext ? '<span title="Main agent own context length">' + formatObservabilityCompact(lastIn) + '</span>' : formatObservabilityCompact(lastIn);
        return (b.timer ? '<span class="health-turn-timer" title="Time since this turn started">' + b.timer + '</span> &middot; ' : '') +
            '<span title="' + scoreTitle + '">Score ' + scoreLabel + '</span> &middot; ' +
            requests + ' req' + (requests === 1 ? '' : 's') +
            ' &middot; <strong class="health-cost">' + bannerDollars(dollars) + '</strong>' + workerPart +
            ' &middot; ' + lastInHtml + ' last in / ' + formatObservabilityCompact(b.turnOut) + ' turn out' +
            ' &middot; ' + hit + ' cache';
    }
    // Live turn timer: '' when no turn is running (turnStartedAt 0), else m:ss or h:mm:ss.
    // A turn is finished once its prompt cache went cold (no request for 5 minutes): the timer then shows the final
    // duration (turn start -> last request of the turn) instead of growing forever.
    var TURN_IDLE_MS = 300000;
    function turnTimerActive(startedAt, lastRequestTs, now) {
        var started = Number(startedAt) || 0;
        if (started <= 0) { return false; }
        var last = Number(lastRequestTs) || 0;
        return (Number(now) || Date.now()) - Math.max(started, last) < TURN_IDLE_MS;
    }
    function turnTimerLabel(startedAt, now, lastRequestTs) {
        var started = Number(startedAt) || 0;
        if (started <= 0) { return ''; }
        var at = Number(now) || Date.now();
        if (lastRequestTs !== undefined && !turnTimerActive(started, lastRequestTs, at)) {
            at = Math.max(started, Number(lastRequestTs) || 0);
        }
        var secs = Math.max(0, Math.floor((at - started) / 1000));
        var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return 'Turn ' + (h ? h + ':' + pad(m) : m) + ':' + pad(s);
    }
    // Chat banner: this turn's own requests, its workers' count and dollars, with the worker part and the turn timer.
    function chatBannerHtml(metrics, now) {
        var turn = metrics.lastRequest || {};
        var turnRequests = Array.isArray(metrics.turnRequests) ? metrics.turnRequests : [];
        var mainRequests = turnRequests.filter(function (r) { return !r.subagent && !r.subagentId; });
        var latest = mainRequests.length ? mainRequests[mainRequests.length - 1] : turn;
        var w = metrics.workers || {};
        var totals = turnTotalsLead(turn, w);
        var workerRuns = Number(w.workers) || 0;
        var workerDollars = Number(w.dollars) || 0;
        var workerRequests = Number(w.requests) || 0;
        var timer = turnTimerLabel(metrics.turnStartedAt, now, Number(metrics.lastRequestTs) || 0);
        return usageBannerHtml({
            requests: (Number(turn.requestCount) || 0) + workerRequests,
            dollars: (Number(turn.nanoAiu) || 0) / 1000000000 / 100 + workerDollars,
            mainContext: true, lastIn: latest.inputTokens, lastCached: totals.cachedTokens,
            cacheInput: totals.inputTokens, turnOut: totals.outputTokens,
            workers: { workers: workerRuns, requests: workerRequests, dollars: workerDollars },
            timer: timer,
            averagePrompt: mainRequests.length ? mainRequests.reduce(function (sum, r) { return sum + (Number(r.inputTokens) || 0); }, 0) / mainRequests.length : 0,
            cacheMisses: (Number(turn.cacheMisses) || 0) + (Number(w.cacheMisses) || 0),
        });
    }
    function cacheAgeLabel(secs) {
        var capped = Math.min(Math.max(0, secs), 300);
        var mm = Math.floor(capped / 60), ss = capped % 60;
        var clock = mm + ':' + (ss < 10 ? '0' : '') + ss;
        return { clock: clock, state: secs < 285 ? 'warm' : secs < 300 ? 'cooling' : 'cold', text: 'Age: ' + clock + (secs >= 300 ? ' cold' : ' warm') };
    }
    // Observability "This turn" line: the same totals as the banner (main + worker requests and dollars), with the split.
    // Returns { text, usd } where text is "79 requests (main 41 · workers 38)" and usd is main + worker dollars.
    function turnTotalsLead(scope, workers) {
        var main = Number(scope && scope.requestCount) || 0;
        var wReq = Number(workers && workers.requests) || 0;
        var total = main + wReq;
        var text = total + ' request' + (total === 1 ? '' : 's') + (wReq > 0 ? ' (main ' + main + ' \u00b7 workers ' + wReq + ')' : '');
        return { total: total, text: text, usd: (Number(scope && scope.nanoAiu) || 0) / 1e9 / 100 + (Number(workers && workers.dollars) || 0),
            inputTokens: (Number(scope && scope.inputTokens) || 0) + (Number(workers && workers.inputTokens) || 0),
            outputTokens: (Number(scope && scope.outputTokens) || 0) + (Number(workers && workers.outputTokens) || 0),
            cachedTokens: (Number(scope && scope.cachedTokens) || 0) + (Number(workers && workers.cachedTokens) || 0) };
    }
    // Worker card: a last prompt this large is re-sent on every step, so the figure is flagged (observability only).
    var WORKER_CONTEXT_WARN_TOKENS = 100000;
    function workerContextFlag(lastPromptTokens) {
        var over = (Number(lastPromptTokens) || 0) >= WORKER_CONTEXT_WARN_TOKENS;
        return { over: over, cls: over ? ' obs-cache-risk' : '', title: over ? 'over 100K: each step re-sends this context' : '' };
    }
    // ── end Usage banner ──

    // ── Turn trace rows: pure render (Metrics timeline and Workers trace; tested in test-workers-control-plane.cjs) ──
    // events: Metrics turnEvents shape (kind request|tool). ctx: { openIds, subagents: {id: summary}, splitHtml(split), now }.
    // A request carries nanoAiu (Copilot) or dollars (OpenCode); everything else is the same row.
    var TRACE_HEAD = '<thead><tr><th>ID</th><th>Model / Tool</th><th>Credits</th><th>Input</th><th>Output</th><th>Cached</th><th title="cached / input">Hit%</th></tr></thead>';
    function traceEsc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function isValidatorTraceEvent(ev) {
        return !!(ev && (ev.kind === 'validator' || /validator/i.test(String(ev.group || ev.subagent || ev.actor || ''))));
    }
    function traceGroupsHtml(main, ctx) {
        var events = (main || []).filter(function (ev) { return !isValidatorTraceEvent(ev); }).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        return '<table class="observability-table obs-timeline-table">' + TRACE_HEAD + '<tbody>' + traceRowsHtml(events, ctx) + '</tbody></table>';
    }

    function traceRowsHtml(events, ctx) {
        ctx = ctx || {};
        var openIds = ctx.openIds || {};
        var now = ctx.now || Date.now();
        var tok = formatObservabilityCompact;
        // One unit everywhere: credits. Copilot reports nano-AIU (1e9 = 1 credit); OpenCode reports dollars (1 credit = $0.01).
        var fmtCredits = function (c) { c = Number(c) || 0; return c >= 10 ? String(Math.round(c)) : String(+c.toFixed(2)); };
        var nanoCredits = function (nano) { return (Number(nano) || 0) / 1000000000; };
        var sec = function (ms) { return ((Number(ms) || 0) / 1000).toFixed(2); };
        var credits = function (ev) { return fmtCredits(ev.dollars != null ? ev.dollars * 100 : nanoCredits(ev.nanoAiu)); };
        var eventId = function (kind, ev, k) { return (ctx.idPrefix || '') + kind + ':' + String(ev.id || ('at-' + (ev.ts || k))); };
        var toolLabel = function (ev) { var name = String(ev.tool || '').replace(/^mcp__[^_]+__/, ''); return !name || name === ev.id || /^(?:call_|toolu_|[a-f0-9]{24,}|[a-f0-9-]{36}$)/i.test(name) ? String(ev.toolName || ev.action || 'Tool') : name; };
        var buildToolRow = function (ev, k) {
            var eid = eventId('t', ev, k);
            var openAttr = openIds[eid] ? ' open' : '';
            var statusOk = !(ev.status && ev.status !== 'ok' && ev.status !== 'success');
            var timeCls = statusOk ? 'obs-tl-time' : 'obs-tl-time obs-cache-risk';
            // Heavy tool output is re-sent (billed) on every later request until compaction.
            var inHeavy = (Number(ev.inputTokens) || 0) > 1000;
            var outHeavy = (Number(ev.outputTokens) || 0) > 4000;
            var isSubagent = String(ev.tool || '') === 'runSubagent';
            var toolRowCls = 'obs-event-tool' + ((inHeavy || outHeavy) ? ' obs-row-flag' : '') + (isSubagent ? ' obs-row-subagent' : '');
            var subagentBadge = isSubagent ? '<span class="obs-kind-tag obs-tag-subagent" title="Sub-agent invocation \u2014 its nested model calls are billed as regular requests">sub-agent</span> ' : '';
            return '<tr class="' + toolRowCls + '"><td colspan="7" class="obs-tool-cell">' +
                '<details class="obs-tl-item obs-tl-tool" data-eid="' + traceEsc(eid) + '"' + openAttr + '>' +
                '<summary class="obs-tl-head">' +
                '<span class="obs-tl-kind">tool</span>' +
                '<span class="obs-tl-name" title="' + traceEsc(String(ev.id || '?')) + '">' + subagentBadge + workerRefBadge(workerRefsFromPreview(ev.outputPreview)) + '<span class="obs-tool-name">' + traceEsc(toolLabel(ev)) + '</span></span>' +
                '<span class="obs-tl-metric" title="input tokens">\u2193' + tok(ev.inputTokens) + '</span>' +
                '<span class="obs-tl-metric' + (outHeavy ? ' obs-cache-risk' : '') + '" title="output tokens \u2014 large tool output is re-billed in history until compaction">\u2191' + tok(ev.outputTokens) + '</span>' +
                '<span class="' + timeCls + '" title="duration">' + sec(ev.durMs) + 's</span>' +
                '</summary>' +
                '<div class="obs-tl-body">' +
                '<div class="obs-tl-field"><span class="obs-tl-label">Input</span><pre class="obs-tl-pre">' + traceEsc(String(ev.inputPreview || '\u2013')) + '</pre></div>' +
                '<div class="obs-tl-field"><span class="obs-tl-label">Output</span><pre class="obs-tl-pre">' + traceEsc(String(ev.outputPreview || '\u2013')) + '</pre></div>' +
                '<div class="obs-tl-meta">status ' + traceEsc(String(ev.status || 'ok')) + ' \u00b7 group ' + traceEsc(String(ev.group || 'default')) + '</div>' +
                '</div></details>' +
                '</td></tr>';
        };
        var buildRequestRow = function (ev, k) {
            var reid = eventId('r', ev, k);
            var isOpen = !!openIds[reid];
            var inp = Number(ev.inputTokens) || 0;
            var pct = inp > 0 ? Math.round((Number(ev.cachedTokens) || 0) / inp * 100) : 100;
            var missed = (inp > 0 && pct < 50);
            var bigOut = (Number(ev.outputTokens) || 0) > 1000;
            var bigCredit = ((Number(ev.nanoAiu) || 0) / 1e9) > 100;
            var hitCls = missed ? ' class="obs-cache-risk"' : '';
            var outCls = bigOut ? ' class="obs-cache-risk"' : '';
            var credCls = bigCredit ? ' class="obs-cache-risk"' : '';
            var hasSplit = !!(ev.split && ctx.splitHtml);
            var reqRowCls = 'obs-event-request' +
                ((missed || bigOut || bigCredit) ? ' obs-row-flag' : '') +
                (ev.subagent ? ' obs-row-subagent-req' : '') +
                (hasSplit ? ' obs-clickable' : '') +
                (isOpen ? ' obs-expanded' : '');
            var caret = hasSplit ? '<span class="obs-caret">\u25B8</span>' : '<span class="obs-caret-spacer"></span>';
            var subTag = ev.firstOfTurn ? '<span class="obs-sub-tag" title="This turn\u2019s initiating request \u2014 your submission">submission</span> ' : '';
            var kindTag = '';
            if (ev.kindTag === 'compaction') { kindTag = '<span class="obs-kind-tag obs-tag-compaction" title="Context compaction (summarizeConversationHistory) \u2014 billed as a request">compaction</span> '; }
            else if (ev.kindTag === 'retry') { kindTag = '<span class="obs-kind-tag obs-tag-retry" title="Retried request \u2014 billed again">retry</span> '; }
            var html = '<tr class="' + reqRowCls + '" data-eid="' + traceEsc(reid) + '">' +
                '<td>' + caret + '<span class="obs-req-id">' + traceEsc(String(ev.id || '?')) + '</span></td>' +
                '<td class="obs-scope">' + subTag + kindTag + traceEsc(String(ev.model || 'unknown')) + '</td>' +
                '<td' + credCls + '>' + credits(ev) + '</td>' +
                '<td>' + tok(ev.inputTokens) + '</td>' +
                '<td' + outCls + '>' + tok(ev.outputTokens) + '</td>' +
                '<td>' + tok(ev.cachedTokens) + '</td>' +
                '<td' + hitCls + '>' + pct + '%</td></tr>';
            if (hasSplit) {
                html += '<tr class="obs-detail-row' + (isOpen ? ' obs-open' : '') + '" data-for="' + traceEsc(reid) + '"' +
                    (isOpen ? '' : ' style="display:none"') + '>' +
                    '<td colspan="7">' + ctx.splitHtml(ev.split) + '</td></tr>';
            }
            return html;
        };
        var buildAnyRow = function (ev, k) {
            return ev.kind === 'tool' ? buildToolRow(ev, k) : buildRequestRow(ev, k);
        };

        // Sub-agent events collapse into one group anchored where the group's first event sits.
        var saSummary = ctx.subagents || {};
        var renderItems = [];
        var groups = {};
        for (var k = 0; k < events.length; k++) {
            var ev = events[k];
            var said = ev.subagentId;
            if (said) {
                if (!groups[said]) {
                    groups[said] = { id: said, items: [], reqCount: 0, toolCount: 0, nano: 0, inTok: 0, outTok: 0, minTs: Number(ev.ts) || 0, maxTs: Number(ev.ts) || 0, models: {} };
                    renderItems.push({ type: 'group', id: said });
                }
                var g = groups[said];
                g.items.push({ ev: ev, k: k });
                if (ev.kind === 'tool') { g.toolCount++; g.outTok += Number(ev.outputTokens) || 0; }
                else {
                    g.reqCount++; g.nano += Number(ev.nanoAiu) || 0; g.inTok += Number(ev.inputTokens) || 0; g.outTok += Number(ev.outputTokens) || 0;
                    var mdl = String(ev.model || 'unknown');
                    g.models[mdl] = (g.models[mdl] || 0) + 1;
                }
                var ets = Number(ev.ts) || 0;
                if (ets && (!g.minTs || ets < g.minTs)) { g.minTs = ets; }
                if (ets > g.maxTs) { g.maxTs = ets; }
            } else {
                renderItems.push({ type: 'event', ev: ev, k: k });
            }
        }

        var eventRows = '';
        for (var ri = 0; ri < renderItems.length; ri++) {
            var item = renderItems[ri];
            if (item.type === 'event') {
                eventRows += buildAnyRow(item.ev, item.k);
                continue;
            }
            var grp = groups[item.id];
            var sum = saSummary[item.id] || null;
            var gLabel = (sum && sum.label) ? sum.label : 'sub-agent';
            var done = !!(sum && sum.done);
            var gid = 'sa:' + item.id;
            var gOpenAttr = openIds[gid] ? ' open' : '';
            // While running, wall time from the first observed activity is the honest live number.
            var gDurMs = done
                ? Number(sum.durMs) || 0
                : Math.max(0, (grp.maxTs - grp.minTs), (sum && sum.startedTs) ? (now - sum.startedTs) : 0);
            var gCold = !done && gDurMs >= 240000;
            var gOut = done ? (Number(sum.outputTokens) || grp.outTok) : grp.outTok;
            var statusBad = sum && sum.status && sum.status !== 'ok' && sum.status !== 'success';
            var stateBadge = done
                ? (statusBad ? '<span class="obs-kind-tag obs-tag-retry" title="Sub-agent ended with an error">failed</span>' : '<span class="obs-sub-tag" title="Sub-agent completed">done</span>')
                : (gCold
                    ? '<span class="obs-kind-tag obs-tag-retry obs-sa-running" title="Past the ~5m prompt-cache window \u2014 this sub-agent is now being re-billed at full price">running\u2026 cache cold</span>'
                    : '<span class="obs-kind-tag obs-tag-subagent obs-sa-running" title="Sub-agent still running \u2014 totals update live">running\u2026</span>');
            var nestedRows = '';
            grp.items.sort(function (a, b) { return (Number(a.ev.ts) || 0) - (Number(b.ev.ts) || 0); });
            for (var gi = 0; gi < grp.items.length; gi++) { nestedRows += buildAnyRow(grp.items[gi].ev, grp.items[gi].k); }
            var domModel = '', domN = -1;
            for (var mk in grp.models) { if (grp.models[mk] > domN) { domN = grp.models[mk]; domModel = mk; } }
            var modelBadge = domModel ? '<span class="obs-tl-metric" title="model this sub-agent ran on \u2014 delegate to a cheaper model to cut cost">' + traceEsc(domModel) + '</span>' : '';
            eventRows += '<tr class="obs-event-tool obs-row-subagent"><td colspan="7" class="obs-tool-cell">' +
                '<details class="obs-tl-item obs-tl-subagent" data-eid="' + traceEsc(gid) + '"' + gOpenAttr + '>' +
                '<summary class="obs-tl-head">' +
                '<span class="obs-tl-kind obs-tag-subagent">sub-agent</span>' +
                '<span class="obs-tl-name"><span class="obs-req-id">' + traceEsc(String(item.id)) + '</span> ' + traceEsc(String(gLabel)) + ' ' + stateBadge + '</span>' +
                modelBadge +
                '<span class="obs-tl-metric" title="nested LLM requests / tool calls">' + grp.reqCount + ' req \u00b7 ' + grp.toolCount + ' tools</span>' +
                '<span class="obs-tl-metric" title="cost (credits)">' + fmtCredits(nanoCredits(grp.nano)) + '</span>' +
                '<span class="obs-tl-metric" title="output tokens">\u2191' + tok(gOut) + '</span>' +
                '<span class="obs-tl-time' + (gCold ? ' obs-cache-risk' : '') + '" title="total wall time">' + sec(gDurMs) + 's</span>' +
                '</summary>' +
                '<div class="obs-tl-body obs-tl-subagent-body">' +
                '<table class="observability-table obs-timeline-table obs-subagent-nested"><tbody>' + nestedRows + '</tbody></table>' +
                '</div></details>' +
                '</td></tr>';
        }
        return eventRows;
    }
    // Expanded rows survive a re-render: collect them before replacing innerHTML.
    function traceOpenIds(root) {
        var ids = {};
        if (!root) return ids;
        root.querySelectorAll('details[open][data-eid]').forEach(function (n) { ids[n.getAttribute('data-eid')] = true; });
        root.querySelectorAll('tr.obs-detail-row.obs-open').forEach(function (n) { ids[n.getAttribute('data-for')] = true; });
        return ids;
    }
    function workspaceMonthHtml(month) {
        var amount = function (value) { return '<span class="obs-month-amount">$' + Number(value).toFixed(2) + '</span>'; };
        return escapeHtml(month.label) + ' · this workspace: ' + amount(month.totalDollars) + ' (' + amount(month.workerDollars) + ' workers' + (Number(month.cloudDollars) > 0 ? ' · ' + amount(month.cloudDollars) + ' cloud est.' : '') + ')';
    }
    // ── end Turn trace rows ──

    function renderConversationHealth() {
        var summary = document.getElementById('common-turn-summary');
        if (summary) {
            summary.innerHTML = chatBannerHtml(observabilityMetrics, Date.now());
        }
        var attribution = document.getElementById('cost-attribution-toggle');
        if (attribution) {
            var active = (specsState.specs || []).filter(function(spec) { return spec.active; })[0];
            attribution.textContent = active ? 'Cost to: Spec ' + (active.id || active.slug) : 'Cost to: Ad hoc';
            attribution.title = active
                ? 'Open Metrics for Spec ' + (active.id || active.slug) + ' cost details'
                : 'Open Metrics for ad hoc cost details';
        }
    }

    function renderCacheAge() {
        // The live turn timer is part of the chat banner; the 1s cache tick refreshes it while a turn runs.
        // Ticks while the turn is active; the render right after it goes cold freezes the final duration.
        if (Number(observabilityMetrics.turnStartedAt) > 0 && Date.now() - Math.max(Number(observabilityMetrics.turnStartedAt), Number(observabilityMetrics.lastRequestTs) || 0) < TURN_IDLE_MS + 1500) { renderConversationHealth(); }
        var el = document.getElementById('obs-cache-age');
        var common = document.getElementById('common-cache-age');
        var ts = Number(observabilityMetrics.lastRequestTs) || 0;
        if (!ts) {
            if (el) { el.textContent = 'Prompt cache age: \u2013'; el.className = 'obs-cache-age'; }
            if (common) { common.textContent = 'Age: \u2013'; common.className = 'health-cache'; }
            return;
        }
        var secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        var age = cacheAgeLabel(secs);
        var clock = age.clock;
        var state, cls;
        if (secs < 285) { state = 'warm \u2014 a new message should hit cache'; cls = 'obs-cache-age obs-cache-warm'; }
        else if (secs < 300) { state = 'cooling \u2014 send within 15s to keep the cache hit'; cls = 'obs-cache-age obs-cache-cooling'; }
        else { state = 'likely COLD \u2014 next message may be a cache MISS (pricier)'; cls = 'obs-cache-age obs-cache-cold'; }
        if (el) {
            el.className = cls;
            el.innerHTML = 'Prompt cache age: <b>' + clock + '</b> / 5:00 \u00b7 ' + state;
        }
        if (common) {
            common.className = 'health-cache ' + age.state;
            common.textContent = age.text;
        }
        // Sound alert once per request-cycle when the cache is about to expire (~4:45), so the
        // user can hit Ping in time. Re-arms whenever a new request resets the clock (ts changes).
        if (soundEnabled && secs >= 285 && secs < 300) {
            if (window._obsCacheWarnedTs !== ts) {
                window._obsCacheWarnedTs = ts;
                try { playNotificationSound(); } catch (e) { /* ignore */ }
            }
        } else if (secs < 285 && window._obsCacheWarnedTs === ts) {
            // clock reset below the threshold for this cycle — allow a future re-arm
            window._obsCacheWarnedTs = null;
        }
    }

    function updateObservabilityUI() {
        renderConversationHealth();
        var validatorEvents = [];
        if (Array.isArray(observabilityMetrics.traceGroups)) {
            observabilityMetrics.traceGroups.forEach(function (g) {
                if (g && /validator/i.test(String(g.id || g.label || '')) && Array.isArray(g.events)) {
                    validatorEvents = validatorEvents.concat(g.events);
                }
            });
        }
        (observabilityMetrics.turnEvents || []).forEach(function (ev) {
            if (isValidatorTraceEvent(ev)) validatorEvents.push(ev);
        });
        if (observabilityMetrics.monthCredits || validatorEvents.length) {
            workersState = Object.assign({}, workersState || { workers: [], generatedAt: Date.now() }, {
                monthCredits: observabilityMetrics.monthCredits || (workersState && workersState.monthCredits),
                validatorTrace: validatorEvents.length ? validatorEvents : (workersState && workersState.validatorTrace)
            });
            paintWorkers();
        }
        var monthLine = document.getElementById('obs-workspace-month');
        var month = observabilityMetrics.monthCredits;
        if (monthLine && month) {
            monthLine.textContent = month.label + ' · this workspace: $' + Number(month.totalDollars).toFixed(2) + ' ($' + Number(month.workerDollars).toFixed(2) + ' workers' + (Number(month.cloudDollars) > 0 ? ' · $' + Number(month.cloudDollars).toFixed(2) + ' cloud est.' : '') + ')';
            monthLine.innerHTML = workspaceMonthHtml(month);
            monthLine.style.color = '';
            monthLine.title = 'All-time this workspace: $' + Number(month.allTimeDollars).toFixed(2);
        }
        var aiu = function (nano) { return formatObservabilityCompact((Number(nano) || 0) / 1000000000); };
        var num = formatObservabilityNumber;
        var tok = formatObservabilityCompact;

        var hitPct = function (s) {
            var inp = Number(s.inputTokens) || 0;
            if (inp <= 0) return '\u2013';
            return Math.round((Number(s.cachedTokens) || 0) / inp * 100) + '%';
        };
        // Renders the per-request input breakdown shown inside an expandable detail row.
        function renderSplitDetail(split) {
            var sysT = Number(split.systemTokens) || 0;
            var toolsT = Number(split.toolsTokens) || 0;
            var convT = Number(split.conversationTokens) || 0;
            var userT = Number(split.userTokens) || 0;
            var msgs = Number(split.messageCount) || 0;
            var total = Number(split.totalInputTokens) || (sysT + toolsT + convT);
            // Plain-language label for what this request actually is.
            var kind = convT <= Math.max(50, sysT * 0.02)
                ? 'Start of conversation'
                : (userT > 0 ? 'Your message + history' : 'Follow-up after tool calls');
            var bar = '';
            if (total > 0) {
                var pctOf = function (v) { return v > 0 ? Math.max(2, Math.round(v / total * 100)) : 0; };
                var seg = function (cls, v, label) {
                    return v > 0 ? '<span class="obs-split-seg ' + cls + '" style="width:' + pctOf(v) + '%" title="' + label + ': ' + tok(v) + ' tok (' + Math.round(v / total * 100) + '%)"></span>' : '';
                };
                bar = '<div class="obs-split-bar">' +
                    seg('obs-split-sys', sysT, 'System prompt') +
                    seg('obs-split-tools', toolsT, 'Tool definitions') +
                    seg('obs-split-hist', convT, 'Conversation history') +
                    '</div>';
            }
            var line = function (cls, label, val, extra) {
                return '<div class="obs-split-line"><i class="' + cls + '"></i>' +
                    '<span class="obs-split-k">' + label + '</span>' +
                    '<span class="obs-split-v">' + val + '</span>' +
                    (extra ? '<span class="obs-split-x">' + extra + '</span>' : '') + '</div>';
            };
            return '<div class="obs-split">' +
                '<div class="obs-split-title">' + kind + ' \u2014 ' + tok(total) + ' tok total input</div>' +
                bar +
                '<div class="obs-split-lines">' +
                line('obs-split-sys', 'System prompt', tok(sysT) + ' tok', 'exact') +
                line('obs-split-tools', 'Tool definitions', tok(toolsT) + ' tok', (Number(split.toolsCount) || 0) + ' tools') +
                line('obs-split-hist', 'Conversation history', tok(convT) + ' tok', msgs + ' msgs \u00b7 derived') +
                line('obs-split-user', 'Latest message', tok(userT) + ' tok', 'exact') +
                '</div>' +
                '<div class="obs-split-note">Conversation = total \u2212 system \u2212 tools (cached history + this step\u2019s tool responses). Per-tool response sizes are the \u2191 output tokens on the tool rows above.</div>' +
                renderRequestContributors(split.contributors) +
                renderPromptComposition(split.composition) +
                '</div>';
        }

        // Full-request breakdown: everything that literally contributed to THIS request's input —
        // system prompt, tool defs, user memory, each attached file, context framing, tool results
        // and dialogue. Parsed from the request's own inputMessages, so it is exact (not a guess).
        function renderRequestContributors(c) {
            if (!c || !Array.isArray(c.items) || !c.items.length) { return ''; }
            var total = Number(c.totalInputTokens) || 0;
            var accounted = Number(c.accountedTokens) || 0;
            var cached = Number(c.cachedTokens) || 0;
            var hitPct = total > 0 ? Math.round(cached / total * 100) : 0;
            function row(it) {
                var t = Number(it.tokens) || 0;
                var pct = total > 0 ? Math.round(t / total * 100) : 0;
                var nameHtml = (it.kind === 'attachment' && it.path)
                    ? '<a href="#" class="obs-comp-file" data-path="' + escapeHtml(String(it.path)) + '" title="' + escapeHtml(String(it.path)) + '">' + escapeHtml(String(it.label)) + '</a>'
                    : '<span class="obs-comp-block">' + escapeHtml(String(it.label)) + '</span>';
                return '<div class="obs-comp-row obs-comp-' + escapeHtml(String(it.kind)) + '">' +
                    '<span class="obs-comp-tok">' + tok(t) + '</span>' +
                    '<span class="obs-comp-name">' + nameHtml + ' <span class="obs-comp-pct">' + pct + '%</span></span></div>';
            }
            var rows = '';
            for (var i = 0; i < c.items.length; i++) { rows += row(c.items[i]); }
            var missing = total - accounted;
            if (missing > 50) { rows += '<div class="obs-comp-row obs-comp-base"><span class="obs-comp-tok">' + tok(missing) + '</span><span class="obs-comp-name"><span class="obs-comp-block">Unattributed (Copilot base framing + provider-tokenizer variance)</span></span></div>'; }
            return '<div class="obs-comp">' +
                '<div class="obs-comp-header">Full request \u2014 ' + tok(total) + ' tok input \u00b7 ' + hitPct + '% cached</div>' +
                '<div class="obs-comp-list">' + rows + '</div></div>';
        }

        // Reverse-engineered "what files make up the system prompt" breakdown.
        // Flat + always visible (shown on the request row's initial expansion, no extra clicks),
        // left-aligned so long file paths read from the left with no horizontal scroll.
        function renderPromptComposition(comp) {
            if (!comp || !Array.isArray(comp.segments) || !comp.segments.length) { return ''; }
            var totalC = Number(comp.totalTokens) || 0;
            var baseC = Number(comp.baseTokens) || 0;
            var fileN = comp.segments.filter(function (s) { return s.kind === 'attachment' || s.kind === 'instruction'; }).length;
            function fileLink(pathStr, labelStr) {
                var name = escapeHtml(String(labelStr || ''));
                return (pathStr)
                    ? '<a href="#" class="obs-comp-file" data-path="' + escapeHtml(String(pathStr)) + '" title="' + escapeHtml(String(pathStr)) + '">' + name + '</a>'
                    : '<span class="obs-comp-block">' + name + '</span>';
            }
            function row(cls, tokVal, nameHtml) {
                return '<div class="obs-comp-row ' + cls + '">' +
                    '<span class="obs-comp-tok">' + tok(Number(tokVal) || 0) + '</span>' +
                    '<span class="obs-comp-name">' + nameHtml + '</span></div>';
            }
            var rows = '';
            for (var i = 0; i < comp.segments.length; i++) {
                var s = comp.segments[i];
                var ws = s.workspaceFolder ? '<span class="obs-comp-ws">' + escapeHtml(String(s.workspaceFolder)) + '</span>' : '';
                rows += row('obs-comp-' + escapeHtml(String(s.kind)), s.tokens, fileLink(s.path, s.label) + ws);
                // Itemized catalog children (skills/agents) shown inline — no nested expansion.
                var kids = Array.isArray(s.children) ? s.children : null;
                if (kids && kids.length && (s.kind === 'skills' || s.kind === 'agents')) {
                    for (var j = 0; j < kids.length; j++) {
                        var c = kids[j];
                        rows += row('obs-comp-child', c.tokens, fileLink(c.path, c.label));
                    }
                }
            }
            // Copilot's own base instructions + framing (closed) — accounted by size only.
            rows += row('obs-comp-base', baseC, '<span class="obs-comp-block">Copilot base + framing (injected)</span>');
            return '<div class="obs-comp">' +
                '<div class="obs-comp-header">System prompt composition \u2014 ' + fileN + ' file' + (fileN === 1 ? '' : 's') +
                ' \u00b7 ' + tok(totalC) + ' tok</div>' +
                '<div class="obs-comp-list">' + rows + '</div></div>';
        }

        // ── This turn: chronological timeline — LLM rows in columns, tool rows expandable ──
        var groupHost = document.getElementById('obs-trace-groups');
        if (groupHost) {
            groupHost.innerHTML = traceGroupsHtml(observabilityMetrics.turnEvents, { openIds: traceOpenIds(groupHost), splitHtml: renderSplitDetail });
            if (!groupHost._traceClickBound) {
                groupHost._traceClickBound = true;
                groupHost.addEventListener('click', function (event) {
                    var row = event.target.closest('tr.obs-clickable');
                    if (!row) return;
                    var detail = row.parentNode.querySelector('tr.obs-detail-row[data-for="' + row.getAttribute('data-eid') + '"]');
                    if (detail) { detail.style.display = detail.style.display === 'none' ? '' : 'none'; detail.classList.toggle('obs-open', detail.style.display !== 'none'); row.classList.toggle('obs-expanded', detail.style.display !== 'none'); }
                });
            }
        }
        var eventTbody = document.getElementById('obs-turn-event-tbody');
        if (eventTbody) {
            var events = (observabilityMetrics.turnEvents || []).filter(function (ev) { return !isValidatorTraceEvent(ev); });
            if (!events.length && observabilityMetrics.turnRequests && observabilityMetrics.turnRequests.length) {
                events = observabilityMetrics.turnRequests.map(function (req) {
                    var copy = Object.assign({}, req);
                    copy.kind = 'request';
                    return copy;
                });
            }
            if (!events.length) {
                eventTbody.innerHTML = '<tr><td colspan="7" class="obs-na">No events yet</td></tr>';
            } else {
                // Sub-agent summaries (authoritative totals once the parent runSubagent finishes).
                var saSummary = {};
                var saList = observabilityMetrics.turnSubagents || [];
                for (var si = 0; si < saList.length; si++) { saSummary[saList[si].subagentId] = saList[si]; }
                eventTbody.innerHTML = traceRowsHtml(events, { openIds: traceOpenIds(eventTbody), subagents: saSummary, splitHtml: renderSplitDetail });
            }
            // Delegated click: toggle a request row's detail row (bound once).
            if (!eventTbody._obsClickBound) {
                eventTbody._obsClickBound = true;
                eventTbody.addEventListener('click', function (e) {
                    var fileLink = e.target && e.target.closest ? e.target.closest('a.obs-comp-file') : null;
                    if (fileLink && eventTbody.contains(fileLink)) {
                        e.preventDefault();
                        var fp = fileLink.getAttribute('data-path');
                        if (fp) { vscode.postMessage({ type: 'openFile', path: fp }); }
                        return;
                    }
                    var row = e.target && e.target.closest ? e.target.closest('tr.obs-clickable') : null;
                    if (!row || !eventTbody.contains(row)) { return; }
                    var forId = row.getAttribute('data-eid');
                    var detail = eventTbody.querySelector('tr.obs-detail-row[data-for="' + forId + '"]');
                    if (!detail) { return; }
                    var nowOpen = detail.style.display === 'none';
                    detail.style.display = nowOpen ? '' : 'none';
                    detail.classList.toggle('obs-open', nowOpen);
                    row.classList.toggle('obs-expanded', nowOpen);
                });
            }
        }
        var turnSummary = document.getElementById('obs-turn-summary');
        if (turnSummary) {
            var lastScope = observabilityMetrics.lastRequest || {};
            var turnTotals = turnTotalsLead(lastScope, observabilityMetrics.workers);
            var n = turnTotals.total;
            var usd = turnTotals.usd;
            var usdStr = '<span style="color:#f14c4c">($' + usd.toFixed(2) + ')</span>';
            // Derive compaction / sub-agent counts from this turn's timeline events.
            var turnEvts = observabilityMetrics.turnEvents || [];
            var compactN = 0;
            for (var te = 0; te < turnEvts.length; te++) {
                var tev = turnEvts[te];
                if (tev.kind === 'request' && tev.kindTag === 'compaction') { compactN++; }
            }
            var subagentN = (observabilityMetrics.turnSubagents || []).length;
            var extra = '';
            if (compactN) { extra += ' \u00b7 <span class="obs-tag-compaction">' + compactN + ' compaction' + (compactN === 1 ? '' : 's') + '</span>'; }
            if (subagentN) { extra += ' \u00b7 <span class="obs-tag-subagent">' + subagentN + ' sub-agent' + (subagentN === 1 ? '' : 's') + '</span>'; }
            turnSummary.innerHTML = n
                ? (turnTotals.text + ' \u00b7 ' + aiu(usd * 100 * 1e9) + ' AIU ' + usdStr + ' \u00b7 ' +
                    tok(turnTotals.inputTokens) + ' in / ' + tok(turnTotals.outputTokens) + ' out \u00b7 ' + hitPct(turnTotals) + ' cache hit' + extra)
                : 'No requests yet this turn';
        }
        // Live prompt-cache age clock: ticks up client-side from the last request ts. The Anthropic
        // prefix cache stays warm ~5 min; once cold, the next message likely pays a cache MISS. A
        // long-running tool also ages this (no new request logged), so it doubles as a "is the tool
        // taking so long the cache will be cold?" signal.
        if (!window._obsCacheAgeTimer) {
            window._obsCacheAgeTimer = setInterval(renderCacheAge, 1000);
        }
        renderCacheAge();
        var pingBtn = document.getElementById('obs-cache-ping-btn');
        if (pingBtn && !pingBtn._bound) {
            pingBtn._bound = true;
            pingBtn.addEventListener('click', function () {
                pingBtn.disabled = true;
                pingBtn.textContent = '\u26a1 Pinging\u2026';
                vscode.postMessage({ type: 'pingCache' });
                setTimeout(function () { pingBtn.disabled = false; pingBtn.textContent = '\u26a1 Ping'; }, 4000);
            });
        }

        if (observabilityRtkLine) {
            observabilityRtkLine.textContent = 'RTK: ' + num(observabilityMetrics.rtkCommandCount) +
                ' calls \u00b7 ' + tok(observabilityMetrics.rtkSavedTokens) + ' saved \u00b7 ' +
                formatPercent(observabilityMetrics.rtkSavingsPct);
        }

        var gradleLine = document.getElementById('observability-gradle-line');
        if (gradleLine) {
            var g = observabilityMetrics.gradle || {};
            gradleLine.textContent = 'Gradle: ' + num(g.runs) + ' runs \u00b7 ' + num(g.optimizedRuns) +
                ' optimized \u00b7 ~' + tok(g.savedTokens) + ' tokens saved' +
                (g.tasksAvoided ? ' \u00b7 ' + num(g.tasksAvoided) + ' tasks cached' : '') +
                (g.configCacheReuses ? ' \u00b7 ' + num(g.configCacheReuses) + ' cfg-cache reuse' : '');
        }
    }

    function formatObservabilityNumber(value) {
        var n = Number(value);
        if (!isFinite(n)) {
            return '0';
        }
        return Math.round(n).toLocaleString();
    }

    function formatPercent(value) {
        var n = Number(value);
        if (!isFinite(n)) {
            return '0%';
        }
        var rounded = (Math.round(n * 100) / 100).toFixed(2).replace(/\.0+$/, '');
        return rounded + '%';
    }

    function normalizeResponseTimeout(value) {
        if (!Number.isFinite(value)) {
            return RESPONSE_TIMEOUT_DEFAULT;
        }
        if (!RESPONSE_TIMEOUT_ALLOWED_VALUES.has(value)) {
            return RESPONSE_TIMEOUT_DEFAULT;
        }
        return value;
    }

    function handleResponseTimeoutChange() {
        if (!responseTimeoutSelect) return;
        var value = parseInt(responseTimeoutSelect.value, 10);
        console.log('[AskAway] Response timeout changed to:', value);
        if (!isNaN(value)) {
            responseTimeout = value;
            vscode.postMessage({ type: 'updateResponseTimeout', value: value });
        }
    }

    function updateResponseTimeoutUI() {
        if (!responseTimeoutSelect) return;
        responseTimeoutSelect.value = String(responseTimeout);
    }

    function handleSessionWarningHoursChange() {
        if (!sessionWarningHoursSelect) return;
        var value = parseInt(sessionWarningHoursSelect.value, 10);
        if (!isNaN(value) && value >= 0 && value <= 8) {
            sessionWarningHours = value;
            vscode.postMessage({ type: 'updateSessionWarningHours', value: value });
        }
        sessionWarningHoursSelect.value = String(sessionWarningHours);
    }

    function updateSessionWarningHoursUI() {
        if (!sessionWarningHoursSelect) return;
        sessionWarningHoursSelect.value = String(sessionWarningHours);
    }

    function handleMaxAutoResponsesChange() {
        if (!maxAutoResponsesInput) return;
        var value = parseInt(maxAutoResponsesInput.value, 10);
        if (!isNaN(value) && value >= 1 && value <= 50) {
            maxConsecutiveAutoResponses = value;
            vscode.postMessage({ type: 'updateMaxConsecutiveAutoResponses', value: value });
        } else {
            // Reset to valid value
            maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
        }
    }

    function updateMaxAutoResponsesUI() {
        if (!maxAutoResponsesInput) return;
        maxAutoResponsesInput.value = maxConsecutiveAutoResponses;
    }

    function handleTurnBudgetChange() {
        if (!turnBudgetInput) return;
        var value = parseInt(turnBudgetInput.value, 10);
        if (isNaN(value) || value < 0) { value = 0; }
        turnBudgetAiu = value;
        turnBudgetInput.value = value;
        vscode.postMessage({ type: 'updateTurnBudgetAiu', value: value });
    }

    function updateTurnBudgetUI() {
        if (!turnBudgetInput) return;
        turnBudgetInput.value = turnBudgetAiu;
    }

    function toggleHumanDelaySetting() {
        humanLikeDelayEnabled = !humanLikeDelayEnabled;
        vscode.postMessage({ type: 'updateHumanDelaySetting', enabled: humanLikeDelayEnabled });
        updateHumanDelayUI();
    }

    function handleHumanDelayMinChange() {
        if (!humanDelayMinInput) return;
        var value = parseInt(humanDelayMinInput.value, 10);
        if (!isNaN(value) && value >= 1 && value <= 30) {
            if (value > humanLikeDelayMax) {
                value = humanLikeDelayMax;
            }
            humanLikeDelayMin = value;
            vscode.postMessage({ type: 'updateHumanDelayMin', value: value });
        }
        humanDelayMinInput.value = humanLikeDelayMin;
    }

    function handleHumanDelayMaxChange() {
        if (!humanDelayMaxInput) return;
        var value = parseInt(humanDelayMaxInput.value, 10);
        if (!isNaN(value) && value >= 2 && value <= 60) {
            if (value < humanLikeDelayMin) {
                value = humanLikeDelayMin;
            }
            humanLikeDelayMax = value;
            vscode.postMessage({ type: 'updateHumanDelayMax', value: value });
        }
        humanDelayMaxInput.value = humanLikeDelayMax;
    }

    function updateHumanDelayUI() {
        if (humanDelayToggle) {
            humanDelayToggle.classList.toggle('active', humanLikeDelayEnabled);
            humanDelayToggle.setAttribute('aria-checked', humanLikeDelayEnabled ? 'true' : 'false');
        }
        if (humanDelayRangeContainer) {
            humanDelayRangeContainer.style.display = humanLikeDelayEnabled ? 'flex' : 'none';
        }
        if (humanDelayMinInput) {
            humanDelayMinInput.value = humanLikeDelayMin;
        }
        if (humanDelayMaxInput) {
            humanDelayMaxInput.value = humanLikeDelayMax;
        }
    }

    // ========== Autopilot Prompts Array Functions ==========

    // Track which autopilot prompt is being edited (-1 = adding new, >= 0 = editing index)
    var editingAutopilotPromptIndex = -1;
    // Track drag state
    var draggedAutopilotIndex = -1;

    function renderAutopilotPromptsList() {
        if (!autopilotPromptsList) return;

        if (autopilotPrompts.length === 0) {
            autopilotPromptsList.innerHTML = '<div class="empty-prompts-hint">No prompts added. Add prompts to cycle through during Autopilot.</div>';
            return;
        }

        autopilotPromptsList.innerHTML = autopilotPrompts.map(function (prompt, index) {
            var truncated = prompt.length > 80 ? prompt.substring(0, 80) + '...' : prompt;
            var tooltipText = prompt.length > 300 ? prompt.substring(0, 300) + '...' : prompt;
            tooltipText = tooltipText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="autopilot-prompt-item" draggable="true" data-index="' + index + '" title="' + tooltipText + '">' +
                '<span class="autopilot-prompt-drag-handle codicon codicon-grabber"></span>' +
                '<span class="autopilot-prompt-number">' + (index + 1) + '.</span>' +
                '<span class="autopilot-prompt-text">' + escapeHtml(truncated) + '</span>' +
                '<div class="autopilot-prompt-actions">' +
                '<button class="prompt-item-btn edit" data-index="' + index + '" title="Edit"><span class="codicon codicon-edit"></span></button>' +
                '<button class="prompt-item-btn delete" data-index="' + index + '" title="Delete"><span class="codicon codicon-trash"></span></button>' +
                '</div></div>';
        }).join('');
    }

    function showAddAutopilotPromptForm() {
        if (!addAutopilotPromptForm || !autopilotPromptInput) return;
        editingAutopilotPromptIndex = -1;
        autopilotPromptInput.value = '';
        addAutopilotPromptForm.classList.remove('hidden');
        addAutopilotPromptForm.removeAttribute('data-editing-index');
        autopilotPromptInput.focus();
    }

    function hideAddAutopilotPromptForm() {
        if (!addAutopilotPromptForm || !autopilotPromptInput) return;
        addAutopilotPromptForm.classList.add('hidden');
        autopilotPromptInput.value = '';
        editingAutopilotPromptIndex = -1;
        addAutopilotPromptForm.removeAttribute('data-editing-index');
    }

    function saveAutopilotPrompt() {
        if (!autopilotPromptInput) return;
        var prompt = autopilotPromptInput.value.trim();
        if (!prompt) return;

        var editingIndex = addAutopilotPromptForm.getAttribute('data-editing-index');
        if (editingIndex !== null) {
            vscode.postMessage({ type: 'editAutopilotPrompt', index: parseInt(editingIndex, 10), prompt: prompt });
        } else {
            vscode.postMessage({ type: 'addAutopilotPrompt', prompt: prompt });
        }
        hideAddAutopilotPromptForm();
    }

    function handleAutopilotPromptsListClick(e) {
        var target = e.target.closest('.prompt-item-btn');
        if (!target) return;

        var index = parseInt(target.getAttribute('data-index'), 10);
        if (isNaN(index)) return;

        if (target.classList.contains('edit')) {
            editAutopilotPrompt(index);
        } else if (target.classList.contains('delete')) {
            deleteAutopilotPrompt(index);
        }
    }

    function editAutopilotPrompt(index) {
        if (index < 0 || index >= autopilotPrompts.length) return;
        if (!addAutopilotPromptForm || !autopilotPromptInput) return;

        var prompt = autopilotPrompts[index];
        editingAutopilotPromptIndex = index;
        autopilotPromptInput.value = prompt;
        addAutopilotPromptForm.setAttribute('data-editing-index', index);
        addAutopilotPromptForm.classList.remove('hidden');
        autopilotPromptInput.focus();
    }

    function deleteAutopilotPrompt(index) {
        if (index < 0 || index >= autopilotPrompts.length) return;
        vscode.postMessage({ type: 'removeAutopilotPrompt', index: index });
    }

    function handleAutopilotDragStart(e) {
        var item = e.target.closest('.autopilot-prompt-item');
        if (!item) return;
        draggedAutopilotIndex = parseInt(item.getAttribute('data-index'), 10);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedAutopilotIndex);
    }

    function handleAutopilotDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var item = e.target.closest('.autopilot-prompt-item');
        if (!item || !autopilotPromptsList) return;

        autopilotPromptsList.querySelectorAll('.autopilot-prompt-item').forEach(function (el) {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        var rect = item.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
            item.classList.add('drag-over-top');
        } else {
            item.classList.add('drag-over-bottom');
        }
    }

    function handleAutopilotDragEnd(e) {
        draggedAutopilotIndex = -1;
        if (!autopilotPromptsList) return;
        autopilotPromptsList.querySelectorAll('.autopilot-prompt-item').forEach(function (el) {
            el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        });
    }

    function handleAutopilotDrop(e) {
        e.preventDefault();
        var item = e.target.closest('.autopilot-prompt-item');
        if (!item || draggedAutopilotIndex < 0) return;

        var toIndex = parseInt(item.getAttribute('data-index'), 10);
        if (isNaN(toIndex) || draggedAutopilotIndex === toIndex) {
            handleAutopilotDragEnd(e);
            return;
        }

        var rect = item.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        var insertBelow = e.clientY >= midY;

        var targetIndex = toIndex;
        if (insertBelow && toIndex < autopilotPrompts.length - 1) {
            targetIndex = toIndex + 1;
        }

        if (draggedAutopilotIndex < targetIndex) {
            targetIndex--;
        }

        if (draggedAutopilotIndex !== targetIndex) {
            vscode.postMessage({ type: 'reorderAutopilotPrompts', fromIndex: draggedAutopilotIndex, toIndex: targetIndex });
        }

        handleAutopilotDragEnd(e);
    }

    // ========== End Autopilot Prompts Functions ==========

    function showAddPromptForm() {
        if (!addPromptForm || !addPromptBtn) return;
        addPromptForm.classList.remove('hidden');
        addPromptBtn.classList.add('hidden');
        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (nameInput) { nameInput.value = ''; nameInput.focus(); }
        if (textInput) textInput.value = '';
        // Clear edit mode
        addPromptForm.removeAttribute('data-editing-id');
    }

    function hideAddPromptForm() {
        if (!addPromptForm || !addPromptBtn) return;
        addPromptForm.classList.add('hidden');
        addPromptBtn.classList.remove('hidden');
        addPromptForm.removeAttribute('data-editing-id');
    }

    function saveNewPrompt() {
        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (!nameInput || !textInput) return;

        var name = nameInput.value.trim();
        var prompt = textInput.value.trim();

        if (!name || !prompt) {
            return;
        }

        var editingId = addPromptForm.getAttribute('data-editing-id');
        if (editingId) {
            // Editing existing prompt
            vscode.postMessage({ type: 'editReusablePrompt', id: editingId, name: name, prompt: prompt });
        } else {
            // Adding new prompt
            vscode.postMessage({ type: 'addReusablePrompt', name: name, prompt: prompt });
        }

        hideAddPromptForm();
    }

    function renderPromptsList() {
        if (!promptsList) return;

        if (reusablePrompts.length === 0) {
            promptsList.innerHTML = '';
            return;
        }

        // Compact list - show only name, full prompt on hover via title
        promptsList.innerHTML = reusablePrompts.map(function (p) {
            // Truncate very long prompts for tooltip to prevent massive tooltips
            var tooltipText = p.prompt.length > 300 ? p.prompt.substring(0, 300) + '...' : p.prompt;
            // Escape for HTML attribute
            tooltipText = tooltipText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="prompt-item compact" data-id="' + escapeHtml(p.id) + '" title="' + tooltipText + '">' +
                '<div class="prompt-item-content">' +
                '<span class="prompt-item-name">/' + escapeHtml(p.name) + '</span>' +
                '</div>' +
                '<div class="prompt-item-actions">' +
                '<button class="prompt-item-btn edit" data-id="' + escapeHtml(p.id) + '" title="Edit"><span class="codicon codicon-edit"></span></button>' +
                '<button class="prompt-item-btn delete" data-id="' + escapeHtml(p.id) + '" title="Delete"><span class="codicon codicon-trash"></span></button>' +
                '</div></div>';
        }).join('');

        // Bind edit/delete events
        promptsList.querySelectorAll('.prompt-item-btn.edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                editPrompt(id);
            });
        });

        promptsList.querySelectorAll('.prompt-item-btn.delete').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                deletePrompt(id);
            });
        });
    }

    function editPrompt(id) {
        var prompt = reusablePrompts.find(function (p) { return p.id === id; });
        if (!prompt) return;

        var nameInput = document.getElementById('prompt-name-input');
        var textInput = document.getElementById('prompt-text-input');
        if (!nameInput || !textInput) return;

        // Show form with existing values
        addPromptForm.classList.remove('hidden');
        addPromptBtn.classList.add('hidden');
        addPromptForm.setAttribute('data-editing-id', id);

        nameInput.value = prompt.name;
        textInput.value = prompt.prompt;
        nameInput.focus();
    }

    function deletePrompt(id) {
        vscode.postMessage({ type: 'removeReusablePrompt', id: id });
    }

    // ===== SLASH COMMAND FUNCTIONS =====

    // ===== NOTIFICATION SOUND FUNCTION =====

    /**
     * Unlock audio playback after first user interaction
     * Required due to browser autoplay policy
     */
    function unlockAudioOnInteraction() {
        function unlock() {
            if (audioUnlocked) return;
            var audio = document.getElementById('notification-sound');
            if (audio) {
                // Play and immediately pause to unlock
                audio.volume = 0;
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        audio.pause();
                        audio.currentTime = 0;
                        audio.volume = 0.5;
                        audioUnlocked = true;
                        console.log('[TaskSync] Audio unlocked successfully');
                    }).catch(function () {
                        // Still locked, will try again on next interaction
                    });
                }
            }
            // Remove listeners after first attempt
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
        }
        document.addEventListener('click', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
    }

    function playNotificationSound() {
        console.log('[TaskSync] playNotificationSound called, audioUnlocked:', audioUnlocked);
        // Play the preloaded audio element
        try {
            var audio = document.getElementById('notification-sound');
            console.log('[TaskSync] Audio element found:', !!audio);
            if (audio) {
                audio.currentTime = 0; // Reset to beginning
                audio.volume = 0.5;
                console.log('[TaskSync] Attempting to play audio...');
                var playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(function () {
                        console.log('[TaskSync] Audio playback started successfully');
                    }).catch(function (e) {
                        console.log('[TaskSync] Could not play audio:', e.message);
                        console.log('[TaskSync] Error name:', e.name);
                        // If autoplay blocked, show visual feedback
                        flashNotification();
                    });
                }
            } else {
                console.log('[TaskSync] No audio element found, showing visual notification');
                flashNotification();
            }
        } catch (e) {
            console.log('[TaskSync] Could not play notification sound:', e);
            flashNotification();
        }
    }

    function flashNotification() {
        // Visual flash when audio fails
        var body = document.body;
        body.style.transition = 'background-color 0.1s ease';
        var originalBg = body.style.backgroundColor;
        body.style.backgroundColor = 'var(--vscode-textLink-foreground, #3794ff)';
        setTimeout(function () {
            body.style.backgroundColor = originalBg || '';
        }, 150);
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ══════════════════════════════════════════════════════════
    // ═══  Voice Mode Functions  ═══════════════════════════════
    // ══════════════════════════════════════════════════════════

    var voiceRecording = false; // true while mic is actively recording

    /**
     * Entry point: extension sends voiceStart → show overlay with waveform animation
     * TTS is handled by the extension host (macOS `say` command) — not in the webview.
     */
    async function handleVoiceStart(taskId, question) {
        voiceMode = true;
        voiceTaskId = taskId;
        voiceTranscript = '';
        voiceInterimTranscript = '';
        voiceRecording = false;

        showVoiceOverlay(question);

        // Show speaking animation while extension host speaks via macOS
        updateVoiceStatus('speaking', 'Speaking…');
        startSpeakingAnimation();
        // The extension host will send 'voiceSpeakingDone' when TTS finishes
    }

    /**
     * Extension host finished speaking → show input area for user's response
     */
    function handleVoiceSpeakingDone(taskId) {
        if (!voiceMode || voiceTaskId !== taskId) return;

        stopVoiceAnimation();
        updateVoiceStatus('listening', 'Your turn — speak (Fn+Fn) or type below');

        // Hide skip button, show input area
        var skipBtn = document.getElementById('voice-skip-btn');
        if (skipBtn) skipBtn.classList.add('hidden');

        showVoiceInputArea();

        // Focus the text input immediately
        var textInput = document.getElementById('voice-text-input');
        if (textInput) {
            textInput.focus();
        }
    }

    /**
     * Cleanup: stop everything and hide overlay
     */
    function handleVoiceStop() {
        if (!voiceMode) return;
        cleanupVoiceResources();
        hideVoiceOverlay();
        voiceMode = false;
        voiceTaskId = null;
        voiceRecording = false;
    }

    // ── Voice Overlay UI ──────────────────────────────────────

    function showVoiceOverlay(question) {
        var overlay = document.getElementById('voice-overlay');
        var questionEl = document.getElementById('voice-question');
        var transcriptEl = document.getElementById('voice-transcript');
        var inputArea = document.getElementById('voice-input-area');
        var recordBtn = document.getElementById('voice-record-btn');
        var textInput = document.getElementById('voice-text-input');
        var skipBtn = document.getElementById('voice-skip-btn');

        if (questionEl) questionEl.textContent = question;
        if (transcriptEl) transcriptEl.textContent = '';
        if (inputArea) inputArea.classList.add('hidden');
        if (recordBtn) recordBtn.classList.add('hidden');
        if (textInput) textInput.value = '';
        if (skipBtn) skipBtn.classList.remove('hidden'); // Show skip during speaking
        if (overlay) overlay.classList.remove('hidden');
    }

    function hideVoiceOverlay() {
        var overlay = document.getElementById('voice-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function showVoiceInputArea() {
        var inputArea = document.getElementById('voice-input-area');
        var textInput = document.getElementById('voice-text-input');

        // Don't show record button — mic access doesn't work in VS Code webview
        if (inputArea) inputArea.classList.remove('hidden');
        if (textInput) textInput.focus();
    }

    function updateVoiceStatus(phase, text) {
        var statusEl = document.getElementById('voice-status');
        if (!statusEl) return;
        statusEl.textContent = text || phase;
        statusEl.className = 'voice-status voice-status-' + phase;
    }

    function updateTranscriptDisplay() {
        var el = document.getElementById('voice-transcript');
        if (!el) return;
        var full = voiceTranscript + (voiceInterimTranscript ? ' ' + voiceInterimTranscript : '');
        el.textContent = full.trim() || '';
    }

    function sendVoiceResponse(text) {
        if (!voiceTaskId) return;
        vscode.postMessage({
            type: 'voiceResponse',
            taskId: voiceTaskId,
            transcription: text
        });
        handleVoiceStop();
    }

    function sendVoiceError(errorMsg) {
        if (!voiceTaskId) return;
        vscode.postMessage({
            type: 'voiceError',
            taskId: voiceTaskId,
            error: errorMsg
        });
        handleVoiceStop();
    }

    // ── Record Button Logic ───────────────────────────────────

    async function toggleRecording() {
        if (voiceRecording) {
            stopRecording();
        } else {
            await startRecording();
        }
    }

    async function startRecording() {
        var recordBtn = document.getElementById('voice-record-btn');

        // Try SpeechRecognition first (works in some environments)
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            try {
                voiceRecognition = new SpeechRecognition();
                voiceRecognition.continuous = true;
                voiceRecognition.interimResults = true;
                voiceRecognition.lang = 'en-US';

                voiceRecognition.onresult = function(event) {
                    var interim = '';
                    var finalText = '';
                    for (var i = event.resultIndex; i < event.results.length; i++) {
                        var transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalText += transcript;
                        } else {
                            interim += transcript;
                        }
                    }
                    if (finalText) {
                        voiceTranscript += (voiceTranscript ? ' ' : '') + finalText.trim();
                    }
                    voiceInterimTranscript = interim;
                    updateTranscriptDisplay();
                    // Also populate the text input with transcript
                    var textInput = document.getElementById('voice-text-input');
                    if (textInput) {
                        textInput.value = (voiceTranscript + ' ' + voiceInterimTranscript).trim();
                    }
                };

                voiceRecognition.onerror = function(event) {
                    console.warn('[Voice] STT error:', event.error);
                    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                        stopRecording();
                        updateVoiceStatus('typing', 'Mic access denied. Type your response or use dictation (Fn Fn)');
                    }
                };

                voiceRecognition.onend = function() {
                    if (voiceRecording) {
                        // Recognition ended but we're still "recording" — try to restart
                        try { voiceRecognition.start(); } catch (e) { stopRecording(); }
                    }
                };

                voiceRecognition.start();
                voiceRecording = true;
                if (recordBtn) recordBtn.classList.add('recording');
                updateVoiceStatus('listening', 'Listening… tap mic to stop');

                // Try to get mic waveform (even if STT handles the transcription separately)
                startMicWaveformAnimation();
                return;
            } catch (e) {
                console.warn('[Voice] SpeechRecognition failed to start:', e);
                voiceRecognition = null;
            }
        }

        // Fallback: try getUserMedia for audio recording + waveform only
        // (no transcription — user sees waveform and types/uses dictation)
        try {
            voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceRecording = true;
            if (recordBtn) recordBtn.classList.add('recording');
            updateVoiceStatus('listening', 'Recording… (no auto-transcription — type what you said below)');
            startMicWaveformAnimation();
        } catch (e) {
            console.warn('[Voice] getUserMedia failed:', e.message);
            updateVoiceStatus('typing', 'Mic not available. Type your response or use dictation (Fn Fn)');
        }
    }

    function stopRecording() {
        voiceRecording = false;
        var recordBtn = document.getElementById('voice-record-btn');
        if (recordBtn) recordBtn.classList.remove('recording');

        if (voiceRecognition) {
            try { voiceRecognition.stop(); } catch (e) { /* ignore */ }
            voiceRecognition = null;
        }

        stopVoiceAnimation();

        if (voiceStream) {
            voiceStream.getTracks().forEach(function(t) { t.stop(); });
            voiceStream = null;
        }
        if (voiceAudioContext) {
            try { voiceAudioContext.close(); } catch (e) { /* ignore */ }
            voiceAudioContext = null;
        }
        voiceAnalyser = null;

        // If we got some transcript, put it in the text input
        var textInput = document.getElementById('voice-text-input');
        if (textInput && voiceTranscript.trim()) {
            textInput.value = voiceTranscript.trim();
        }

        updateVoiceStatus('ready', 'Review and send, or tap mic to record again');
    }

    // ── TTS (Text-to-Speech) ──────────────────────────────────

    function speakText(text) {
        return new Promise(function(resolve) {
            if (!window.speechSynthesis) {
                console.warn('[Voice] SpeechSynthesis not available');
                resolve();
                return;
            }

            // Cancel any ongoing speech
            window.speechSynthesis.cancel();

            var utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.05;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            // Try to pick a good voice
            var voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                var preferred = voices.find(function(v) {
                    return v.lang.startsWith('en') && v.name.toLowerCase().includes('natural');
                }) || voices.find(function(v) {
                    return v.lang.startsWith('en') && !v.name.toLowerCase().includes('google');
                }) || voices.find(function(v) {
                    return v.lang.startsWith('en');
                });
                if (preferred) utterance.voice = preferred;
            }

            utterance.onend = function() { resolve(); };
            utterance.onerror = function(e) {
                console.warn('[Voice] TTS error:', e.error);
                resolve();
            };

            window.speechSynthesis.speak(utterance);
        });
    }

    // ── Waveform Animation ────────────────────────────────────

    /**
     * Synthetic "speaking" animation — smooth sine wave bars (no mic needed)
     */
    function startSpeakingAnimation() {
        var canvas = document.getElementById('voice-waveform');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var width = canvas.width;
        var height = canvas.height;
        var phase = 0;

        function draw() {
            if (!voiceMode) return;
            voiceAnimationFrame = requestAnimationFrame(draw);
            ctx.clearRect(0, 0, width, height);

            phase += 0.06;
            var barCount = 32;
            var gap = 3;
            var barWidth = (width - (barCount - 1) * gap) / barCount;
            var centerY = height / 2;

            for (var i = 0; i < barCount; i++) {
                var v1 = Math.sin(phase + i * 0.25) * 0.5 + 0.5;
                var v2 = Math.sin(phase * 1.3 + i * 0.18) * 0.3 + 0.5;
                var v3 = Math.sin(phase * 0.7 + i * 0.35) * 0.2 + 0.5;
                var value = (v1 + v2 + v3) / 3;
                var barHeight = Math.max(3, value * centerY * 0.75);

                var alpha = 0.35 + value * 0.65;
                ctx.fillStyle = 'hsla(210, 85%, 62%, ' + alpha + ')';
                var x = i * (barWidth + gap);
                var radius = barWidth / 2;
                roundedRect(ctx, x, centerY - barHeight, barWidth, barHeight * 2, radius);
            }
        }
        draw();
    }

    /**
     * Real mic-driven waveform animation
     */
    async function startMicWaveformAnimation() {
        var canvas = document.getElementById('voice-waveform');
        if (!canvas) return;

        try {
            // If we already have a stream from recording, reuse it
            if (!voiceStream) {
                voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            var source = voiceAudioContext.createMediaStreamSource(voiceStream);
            voiceAnalyser = voiceAudioContext.createAnalyser();
            voiceAnalyser.fftSize = 128;
            voiceAnalyser.smoothingTimeConstant = 0.75;
            source.connect(voiceAnalyser);

            stopVoiceAnimation();

            var ctx = canvas.getContext('2d');
            var width = canvas.width;
            var height = canvas.height;
            var bufferLength = voiceAnalyser.frequencyBinCount;
            var dataArray = new Uint8Array(bufferLength);

            function draw() {
                if (!voiceMode || !voiceAnalyser) return;
                voiceAnimationFrame = requestAnimationFrame(draw);

                voiceAnalyser.getByteFrequencyData(dataArray);
                ctx.clearRect(0, 0, width, height);

                var barCount = 32;
                var gap = 3;
                var barWidth = (width - (barCount - 1) * gap) / barCount;
                var centerY = height / 2;

                for (var i = 0; i < barCount; i++) {
                    var dataIndex = Math.floor(i * bufferLength / barCount);
                    var value = dataArray[dataIndex] / 255;
                    var barHeight = Math.max(3, value * centerY * 0.85);

                    var hue = 210 + value * 40;
                    var alpha = 0.4 + value * 0.6;
                    ctx.fillStyle = 'hsla(' + hue + ', 85%, 60%, ' + alpha + ')';

                    var x = i * (barWidth + gap);
                    var radius = barWidth / 2;
                    roundedRect(ctx, x, centerY - barHeight, barWidth, barHeight * 2, radius);
                }
            }
            draw();
        } catch (err) {
            console.log('[Voice] Mic waveform not available:', err.message);
            // Show a small idle animation instead
            startSpeakingAnimation();
        }
    }

    /**
     * Helper: draw a rounded rectangle (used for waveform bars)
     */
    function roundedRect(ctx, x, y, w, h, r) {
        if (h < 0) { y += h; h = -h; }
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
    }

    function stopVoiceAnimation() {
        if (voiceAnimationFrame) {
            cancelAnimationFrame(voiceAnimationFrame);
            voiceAnimationFrame = null;
        }
    }

    function cleanupVoiceResources() {
        if (voiceRecognition) {
            try { voiceRecognition.abort(); } catch (e) { /* ignore */ }
            voiceRecognition = null;
        }
        stopVoiceAnimation();

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        if (voiceStream) {
            voiceStream.getTracks().forEach(function(t) { t.stop(); });
            voiceStream = null;
        }
        if (voiceAudioContext) {
            try { voiceAudioContext.close(); } catch (e) { /* ignore */ }
            voiceAudioContext = null;
        }
        voiceAnalyser = null;
        voiceTranscript = '';
        voiceInterimTranscript = '';
        voiceRecording = false;

        var canvas = document.getElementById('voice-waveform');
        if (canvas) {
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    /**
     * Wire up voice overlay button events — called from init()
     */
    function initVoiceControls() {
        var sendBtn = document.getElementById('voice-send-btn');
        var cancelBtn = document.getElementById('voice-cancel-btn');
        var recordBtn = document.getElementById('voice-record-btn');
        var micBtn = document.getElementById('mic-btn');
        var textInput = document.getElementById('voice-text-input');
        var skipBtn = document.getElementById('voice-skip-btn');

        if (sendBtn) {
            sendBtn.addEventListener('click', function() {
                var input = document.getElementById('voice-text-input');
                var text = (input && input.value.trim()) || voiceTranscript.trim();
                if (text) {
                    sendVoiceResponse(text);
                }
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                sendVoiceError('User cancelled voice input');
            });
        }
        if (recordBtn) {
            recordBtn.addEventListener('click', function() {
                toggleRecording();
            });
        }
        if (micBtn) {
            micBtn.addEventListener('click', function() {
                vscode.postMessage({ type: 'micButtonClicked' });
            });
        }
        if (skipBtn) {
            skipBtn.addEventListener('click', function() {
                // Interrupt TTS and skip to input
                vscode.postMessage({ type: 'voiceInterrupt' });
            });
        }
        if (textInput) {
            textInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    var text = textInput.value.trim();
                    if (text) {
                        sendVoiceResponse(text);
                    }
                }
            });
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── Plan Board Functions (sidebar: just Open Board button) ──
    // ══════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════
    // ── Worker Tabs (Commands + Sub-Agents) ──
    // ══════════════════════════════════════════════════════════

    // Per-panel autopilot state (independent from global autopilotEnabled)
    var workerAutopilotEnabled = { command: false, subagent: false };
    // Per-panel selected model id — set when user picks via native model picker or on models load
    var workerSelectedModelId = { command: '', subagent: '' };
    // Per-panel tool selection: null = all tools, Set<string> = selected subset
    var workerSelectedTools = { command: null, subagent: null };
    // Track which tool groups are expanded
    var workerToolsExpanded = { command: false, subagent: false };
    // Track which tool groups within a panel are expanded: { command: Set<groupName>, subagent: Set<groupName> }
    var workerGroupsExpanded = { command: new Set(), subagent: new Set() };

    // ---- Spec Kit overview tab ----
    var specsState = { enabled: false, activeSlug: '', specs: [] };
    var specsShowDone = false;
    var specsShowAll = false;
    var specsExpanded = {};
    var specsWorkExpanded = {};

    var SPEC_STAGE_LABEL = {
        'needs-clarify': 'Needs clarify',
        'specified': 'Specified',
        'planned': 'Planned',
        'tasks-ready': 'Tasks ready',
        'in-progress': 'In progress',
        'done': 'Done'
    };

    var presenceStates = [];
    var presenceState = { mode: 'here' };
    function applyAvailabilityState(state) {
        presenceState = state || { mode: 'here' };
        presenceStates.forEach(function (value) {
            document.body.classList.toggle('avail-' + value.id, value.id === presenceState.mode);
            if (value.id === presenceState.mode) {
                document.body.style.setProperty('--presence', 'var(--vscode-' + (value.id === 'here' ? 'testing-iconPassed' : value.id === 'away' ? 'editorWarning-foreground' : value.id === 'awayValidator' ? 'charts-purple' : 'descriptionForeground') + ')');
            }
        });
    }
    function openPresence() {
        document.querySelector('#aitalk-root .presence-trigger')?.click();
    }

    // ── Workers tab: pure render (tested in test-workers-control-plane.cjs) ──
    function workersEsc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function workersDuration(ms) {
        var s = Math.round((ms || 0) / 1000);
        return s >= 60 ? Math.floor(s / 60) + 'm' + (s % 60) + 's' : s + 's';
    }
    function workersMatch(worker, filter) {
        var needle = String(filter || '').trim().toLowerCase();
        if (!needle) return true;
        return [worker.workerId, worker.profile, worker.model, worker.state, worker.thinking].join(' ').toLowerCase().indexOf(needle) >= 0;
    }
    function workersPendingApprovals(state) {
        return state && state.workers ? state.workers.filter(function (w) { return w.state === 'WAITING_APPROVAL'; }).length : 0;
    }
    // Same banner and Age label as the chat's own, for this worker's current run.
    function workerBannerHtml(worker, now) {
        var b = worker.banner || {};
        var runs = worker.runs || [];
        var terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
        var current = runs.find(function (r) { return r.queuePosition === 0 && terminal.indexOf(r.state) < 0; }) ||
            runs.slice().reverse().find(function (r) { return r.reason !== 'cancelled before start'; });
        var usage = current ? current.usage || {} : {};
        var input = (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0);
        b = Object.assign({}, b, { cacheInput: input, lastCached: Number(usage.cacheRead) || 0,
            averagePrompt: b.requests > 0 ? input / b.requests : 0 });
        var agy = worker.adapter === 'agy';
        var age = agy ? null : cacheAgeLabel(Math.floor((now - (b.lastActivityAt || now)) / 1000));
        var title = 'Requests, cost, full prompt of the last request / output this run, cache hit of the last request' +
            (agy ? '' : ', time since last activity (cache is cold after 5:00)');
        return '<div class="worker-banner" title="' + title + '">' +
            '<span class="worker-banner-metrics">' + usageBannerHtml(Object.assign({}, b, { flagContext: true })) + '</span>' +
            (age ? '<strong class="health-cache ' + age.state + '">' + age.text + '</strong>' : '') +
            (!agy && worker.cacheExpiresAt > now ? '<span> warm for ' + workersDuration(worker.cacheExpiresAt - now) + '</span>' : '') +
            (!agy && worker.lastPingAt ? '<span> · pinged ' + Math.floor(Math.max(0, now - worker.lastPingAt) / 60000) + 'm ago</span>' : '') + '</div>';
    }
    // Worker tools return JSON with workerId/runId; the turn trace shows them as a link to the Workers tab.
    function workerRefsFromPreview(text) {
        var s = String(text || '');
        var w = s.match(/"workerId"\s*:\s*"(worker-[A-Za-z0-9-]+)"/);
        var r = s.match(/"runId"\s*:\s*"(run-[A-Za-z0-9-]+)"/);
        return w ? { workerId: w[1], runId: r ? r[1] : '' } : null;
    }
    function workerRefBadge(refs) {
        if (!refs) return '';
        return '<span class="obs-worker-tag" data-worker-ref="' + workersEsc(refs.workerId) + '" title="Show this worker in the Workers tab">' +
            workersEsc(refs.workerId) + (refs.runId ? ' · ' + workersEsc(refs.runId) : '') + '</span> ';
    }
    // One trace for the worker's conversation: the Metrics rows, with a partition line per run.
    // trace: loaded on expand, from the OpenCode session or, when it cannot answer, the ledger's facts (no tool text).
    function workerTraceHtml(worker, openIds, now, trace) {
        var rows = (trace && trace.source !== 'opencode')
            ? '<tr><td colspan="7" class="obs-na">Tool input and output unavailable: ' + workersEsc(trace.reason) + '</td></tr>'
            : '';
        (worker.runs || []).forEach(function (r) {
            var ru = r.usage || {};
            var events = trace ? (trace.runs[r.runId] || []) : null;
            rows += '<tr class="worker-run-partition" data-run-id="' + workersEsc(r.runId) + '"><td colspan="7">' +
                '<span class="worker-state worker-state-' + workersEsc(r.state).toLowerCase() + '">' + workersEsc(r.state) + (r.queuePosition ? ' #' + r.queuePosition : '') + '</span> ' +
                '<span class="obs-req-id">' + workersEsc(r.runId) + '</span>' + (worker.cloud ? '' : ' · turn ' + workersEsc(r.dispatchTurnId)) + ' · ' + workersDuration(r.elapsedMs) +
                (worker.cloud ? '' : ' · $' + (ru.cost || 0).toFixed(4) + ' · ' + (ru.steps || 0) + ' req') + (r.reason ? ' · ' + workersEsc(r.reason) : '') +
                (r.queuePosition && r.state === 'STARTING' ? ' <button class="worker-cancel-run" data-worker-action="cancel-run" data-run-id="' + workersEsc(r.runId) + '" title="Cancel before it starts">Cancel</button>' : '') + '</td></tr>';
            rows += (events && events.length)
                ? traceRowsHtml(events, { openIds: openIds, now: now })
                : '<tr><td colspan="7" class="obs-na">' + (r.queuePosition ? 'Queued' : events ? 'No events yet' : 'Loading trace…') + '</td></tr>';
        });
        return '<table class="observability-table observability-model-table obs-timeline-table worker-trace">' + (worker.cloud ? '' : TRACE_HEAD) + '<tbody>' + rows + '</tbody></table>';
    }
    function workerShortModel(model) { return String(model || '').split('/').pop(); }
    function workerIsWarm(w, now) { return w.adapter !== 'agy' && !w.expired && w.state !== 'RUNNING' && w.state !== 'STARTING' && w.state !== 'WAITING_APPROVAL' && w.cacheExpiresAt > now; }
    function teamTaskActive(w) { return w.state === 'RUNNING' || w.state === 'STARTING' || w.state === 'WAITING_APPROVAL'; }
    function teamTaskQueuedRuns(w) { return (w.runs || []).filter(function (r) { return r.queuePosition > 0 && r.state === 'STARTING'; }).length; }
    function teamTaskDone(w) { return ['COMPLETED', 'FAILED', 'CANCELLED', 'RETIRED', 'ORPHANED'].indexOf(w.state) !== -1 || !!w.expired; }
    // This turn's spend of one task: the ledger's checkpoints since the turn started (projectWorkersState turnCost); agy is free.
    function teamTaskTurnCost(w) {
        if (w.adapter === 'agy' || w.cloud) return 0;
        return typeof w.turnCost === 'number' ? w.turnCost : (Number(w.usage && w.usage.cost) || 0);
    }
    // The one Team money format (summary, member Turn/Month, cost summaries): $0.00, or 4 decimals below a cent.
    function teamMoney(value) {
        var n = Math.max(0, Number(value) || 0);
        return '$' + n.toFixed(n > 0 && n < 0.01 ? 4 : 2);
    }
    // Headline for "how many are there": counted from the same task list the member rows display.
    function workersSummaryHtml(state, tasks) {
        var now = state.generatedAt;
        var list = tasks || state.workers || [];
        var running = list.filter(teamTaskActive).length;
        var warm = list.filter(function (w) { return workerIsWarm(w, now); }).length;
        var queued = list.reduce(function (n, w) { return n + teamTaskQueuedRuns(w); }, 0);
        var completed = list.filter(teamTaskDone).length;
        var dollars = list.reduce(function (n, w) { return n + teamTaskTurnCost(w); }, 0);
        return '<div class="workers-summary"><strong>' + list.length + '</strong> task' + (list.length === 1 ? '' : 's') + ' this turn' +
            ' &middot; ' + running + ' running &middot; ' + queued + ' queued &middot; ' + warm + ' warm &middot; ' + completed + ' completed' +
            (list.some(function (w) { return !w.cloud; }) ? ' &middot; <strong class="health-cost">' + teamMoney(dollars) + '</strong> this turn' : '') + '</div>';
    }
    var TEAM_DEFAULT_VALIDATOR = {
        id: 'priya', name: 'Priya', role: 'Validator', pinned: true, initials: 'PR', avatarSrc: '', avatar: '',
        creativeStatus: 'Reviewing spec compliance', agentFile: '.github/agents/validator.agent.md',
        model: 'github-copilot/claude-sonnet-4.6', defaultModel: 'github-copilot/claude-sonnet-4.6',
        thinking: 'medium', defaultThinking: 'medium',
        turnCost: 0, monthCost: 0, taskIds: [], workerIds: []
    };
    var TEAM_MODELS = [
        { id: 'github-copilot/claude-opus-5.5', label: 'github-copilot/claude-opus-5.5', efforts: ['high', 'medium', 'low'] },
        { id: 'github-copilot/claude-sonnet-5.5', label: 'github-copilot/claude-sonnet-5.5', efforts: ['high', 'medium', 'low'] },
        { id: 'github-copilot/gpt-6.1-sol', label: 'github-copilot/gpt-6.1-sol', efforts: ['high', 'medium', 'low'] },
        { id: 'github-copilot/gpt-6-luna', label: 'github-copilot/gpt-6-luna', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-4-argon-medium', label: 'agy/gemini-4-argon-medium', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-4-argon-low', label: 'agy/gemini-4-argon-low', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-3.8-flash-high', label: 'agy/gemini-3.8-flash-high', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-3.8-flash-medium', label: 'agy/gemini-3.8-flash-medium', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-3.8-flash-low', label: 'agy/gemini-3.8-flash-low', efforts: ['high', 'medium', 'low'] },
        { id: 'agy/gemini-3.1-pro-high', label: 'agy/gemini-3.1-pro-high', efforts: ['high', 'low'] },
        { id: 'agy/gemini-3.1-pro-low', label: 'agy/gemini-3.1-pro-low', efforts: ['high', 'low'] },
        { id: 'agy/gemini-4-argon-high', label: 'Gemini 4 Argon High (agy)', efforts: ['medium', 'high'] },
        { id: 'github-copilot/claude-opus-4.6', label: 'Claude Opus 4.6', efforts: ['low', 'medium', 'high'] },
        { id: 'github-copilot/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', efforts: ['low', 'medium', 'high'] },
        { id: 'github-copilot/gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high', 'max'] },
        { id: 'github-copilot/gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['low', 'medium', 'high'] }
    ];
    function effortsForModel(modelId) {
        var found = TEAM_MODELS.find(function (m) { return m.id === modelId; });
        return found ? found.efforts.slice() : ['low', 'medium', 'high'];
    }
    function isValidatorWorker(w) {
        return !!(w && (w.kind === 'validator' || w.profile === 'validator' || w.track === 'validator'));
    }
    function memberInitials(name, id) {
        var parts = String(name || id || '?').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    function normalizeTeamMember(m) {
        var id = String((m && m.id) || 'priya');
        var pinned = !!(m && m.pinned) || id === 'priya' || id === 'validator';
        var role = (m && m.role) || (pinned ? 'Validator' : id);
        var name = (m && m.name) || (pinned ? 'Priya' : id);
        var rawAvatar = (m && m.avatarSrc !== undefined) ? m.avatarSrc : (m && m.avatar !== undefined ? m.avatar : '');
        var avatarSrc = String(rawAvatar || '');
        var model = (m && (m.model || m.defaultModel)) || 'github-copilot/claude-sonnet-4.6';
        var thinking = (m && (m.thinking || m.defaultThinking)) || 'medium';
        var rawIds = Array.isArray(m && m.taskIds) ? m.taskIds : (Array.isArray(m && m.workerIds) ? m.workerIds : []);
        var kind = (m && m.kind) || (pinned ? 'validator' : 'worker');
        return {
            id: id,
            name: name,
            role: role,
            kind: kind,
            active: !!(m && m.active),
            profile: (m && m.profile) || String(role).toLowerCase(),
            pinned: pinned,
            initials: (m && m.initials) || memberInitials(name, id),
            avatarSrc: avatarSrc,
            avatar: avatarSrc,
            creativeStatus: (m && m.creativeStatus) || (pinned ? 'Reviewing spec compliance' : 'Ready for next packet'),
            agentFile: (m && m.agentFile) || (pinned ? '.github/agents/validator.agent.md' : '.opencode/agent/askaway-' + String(role).toLowerCase() + '.md'),
            model: model,
            defaultModel: model,
            thinking: thinking,
            defaultThinking: thinking,
            turnCost: Number(m && m.turnCost) || 0,
            monthCost: Number(m && m.monthCost) || 0,
            taskIds: rawIds.slice(),
            workerIds: rawIds.slice()
        };
    }
    function stateMembersList(state) {
        var raw = (state && Array.isArray(state.members) && state.members.length) ? state.members : [TEAM_DEFAULT_VALIDATOR];
        var list = raw.map(normalizeTeamMember);
        if (!list.some(function (m) { return m.pinned; })) list.unshift(normalizeTeamMember(TEAM_DEFAULT_VALIDATOR));
        return list.sort(function (a, b) { return Number(b.pinned) - Number(a.pinned); });
    }
    function matchWorkerMember(w, members) {
        // The main agent (chat mode) never owns worker tasks; a `build` task belongs to its roster worker member.
        var list = (members || [ normalizeTeamMember(TEAM_DEFAULT_VALIDATOR) ]).filter(function (m) { return m.kind !== 'main'; });
        var wid = w && w.workerId;
        if (wid) {
            var byWorkerId = list.find(function (m) { return m.workerIds.indexOf(wid) !== -1 || m.taskIds.indexOf(wid) !== -1; });
            if (byWorkerId) return byWorkerId;
        }
        if (isValidatorWorker(w)) return list.find(function (m) { return m.pinned; }) || list[0];
        var p = String((w && w.profile) || '').toLowerCase();
        var byRole = list.find(function (m) {
            return !m.pinned && (String(m.role || '').toLowerCase() === p || String(m.profile || '').toLowerCase() === p || String(m.id || '').toLowerCase() === p);
        });
        if (byRole) return byRole;
        var raw = String((w && (w.profile || w.workerId)) || 'member');
        return normalizeTeamMember({
            id: raw, name: raw, role: (w && w.profile) || 'Member', profile: raw, pinned: false, avatarSrc: '',
            creativeStatus: 'Running tasks', agentFile: '.opencode/agent/askaway-' + raw + '.md',
            model: (w && w.model) || 'github-copilot/gpt-5.6-luna',
            thinking: (w && w.thinking) || 'medium',
            turnCost: (w && w.adapter === 'agy') ? 0 : Number(w && w.usage && w.usage.cost) || 0,
            monthCost: (w && w.adapter === 'agy') ? 0 : Number(w && w.usage && w.usage.cost) || 0,
            taskIds: wid ? [wid] : []
        });
    }
    function resolveTeamMemberId(raw, state) {
        var key = String(raw || '').trim().toLowerCase();
        if (!key) return '';
        var list = stateMembersList(state);
        var pinned = list.find(function (m) { return m.pinned; }) || list[0];
        if (key === 'validator' || key === 'priya' || key === 'review-po') return pinned.id;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.id.toLowerCase() === key || m.name.toLowerCase() === key || m.role.toLowerCase() === key || m.profile.toLowerCase() === key ||
                m.workerIds.some(function (wid) { return String(wid).toLowerCase() === key; })) {
                return m.id;
            }
        }
        var workers = (state && state.workers) || [];
        for (var j = 0; j < workers.length; j++) {
            if (String(workers[j].workerId || '').toLowerCase() === key) return matchWorkerMember(workers[j], list).id;
        }
        return key;
    }
    // Turn = the displayed tasks' spend since the turn started; a row without tasks (main agent, Priya between runs)
    // shows its own turn spend from the host.
    function memberCostAmounts(member, memberWorkers) {
        var workerSum = (memberWorkers || []).reduce(function (n, w) {
            return n + (w.adapter === 'agy' ? 0 : (Number(w && w.usage && w.usage.cost) || 0));
        }, 0);
        var turn = (memberWorkers && memberWorkers.length)
            ? memberWorkers.reduce(function (n, w) { return n + teamTaskTurnCost(w); }, 0)
            : Number(member && member.turnCost) || 0;
        var month = (member && typeof member.monthCost === 'number' && !isNaN(member.monthCost) && (member.monthCost > 0 || !workerSum))
            ? member.monthCost : workerSum;
        return { turn: Math.max(0, Number(turn) || 0), month: Math.max(0, Number(month) || 0) };
    }
    function memberCostSummaryHtml(costs) {
        var turnText = teamMoney(costs.turn);
        var monthText = teamMoney(costs.month);
        return '<span class="team-cost-turn">' + turnText + ' turn</span> &middot; <span class="team-cost-month"><span class="obs-month-amount">' + monthText + '</span> month</span>';
    }
    function memberDisplayStatus(member, memberWorkers) {
        var active = (memberWorkers || []).find(function (w) { return w.state === 'RUNNING' || w.state === 'STARTING' || w.state === 'WAITING_APPROVAL'; });
        var stateKey = active ? active.state : ((memberWorkers && memberWorkers.length) ? memberWorkers[0].state : 'IDLE');
        var dotState = (stateKey === 'RUNNING' || stateKey === 'STARTING' || stateKey === 'WAITING_APPROVAL' || (member.kind === 'main' && member.active)) ? 'running' : 'idle';
        var label = member.creativeStatus || (dotState === 'running' ? 'Running task' : 'Idle');
        return { stateKey: stateKey, dotState: dotState, label: label };
    }
    // Inline Remove confirm (one line in the card, no modal): worker ids whose Remove button was clicked once.
    var workersRemoveConfirm = {};
    function workerRemoveHtml(w, labels) {
        var one = labels ? labels.one : 'worker';
        var id = workersEsc(w.workerId);
        if (workersRemoveConfirm[w.workerId]) {
            return '<span class="worker-remove-confirm">Remove this ' + one + ' from rotation? Its past cost stays in the totals. ' +
                '<button class="worker-remove-btn" data-worker-action="remove-confirm" data-worker-id="' + id + '">Remove</button>' +
                '<button class="worker-trace-btn" data-worker-action="remove-cancel" data-worker-id="' + id + '">Keep</button></span>';
        }
        return '<button class="worker-remove-btn" data-worker-action="remove" data-worker-id="' + id + '" title="Take this ' + one + ' out of rotation: cancels it if running; start and submit never use it again">Remove</button>';
    }
    function workerCardHtml(w, open, now, openIds, traces, labels) {
        var label = labels || { one: 'worker', many: 'workers' };
        var html = '<div class="worker-card" data-worker-id="' + workersEsc(w.workerId) + '">' +
            '<div class="worker-card-head">' +
            '<span class="worker-state worker-state-' + workersEsc(w.state).toLowerCase() + '">' + workersEsc(w.state) + '</span>' +
            '<span class="worker-mode">' + workersEsc(w.profile) + '</span>' +
            '<span class="worker-id">' + workersEsc(labels && w.workerId.indexOf('worker-') === 0 ? label.one + w.workerId.slice(6) : w.workerId) + '</span>' +
            '</div>' +
            '<div class="worker-selection">' + workersEsc(w.adapter) + ' · ' + workersEsc(w.model) + ' · ' + workersEsc(w.thinking) + '</div>' +
            (w.cloud ? '' : workerBannerHtml(w, now)) +
            (w.knowledge ? '<div class="worker-knowledge" title="What this ' + label.one + ' says it knows; the orchestrator uses it to pick a ' + label.one + ' to reuse">' + workersEsc(w.knowledge) + '</div>' : '') +
            (w.blocker ? '<div class="worker-blocker">' + workersEsc(w.blocker) + '</div>' : '') +
            '<div class="worker-actions">' +
            (w.sessionId && w.adapter === 'agy' ? '<span class="worker-open-note" title="agy owns its conversation; AskAway shows it through Trace">agy conversation: no viewer</span>' : '') +
            (w.sessionId && w.adapter !== 'agy' ? '<button class="worker-open-btn" data-worker-action="open" data-session-id="' + workersEsc(w.sessionId) + '" title="' + workersEsc(w.sessionOpenAction) + '">Open in VS Code</button>' +
                '<button class="worker-open-ext-btn" data-worker-action="open-external" data-session-id="' + workersEsc(w.sessionId) + '" title="Open in your default terminal app">Terminal app</button>' : '') +
            '<button class="worker-trace-btn" data-worker-action="trace" data-worker-id="' + workersEsc(w.workerId) + '">' + (open ? 'Hide' : 'Trace') + ' (' + (w.runs || []).length + ')</button>' +
            (w.cloud ? '' : workerRemoveHtml(w, label)) +
            '</div>';
        if (open) {
            html += workerTraceHtml(w, openIds || {}, now, w.trace || (traces && traces[w.workerId]));
        }
        html += '</div>';
        return html;
    }
    function teamPortraitHtml(member, state) {
        var unsafe = ((state && state.workers) || []).some(function (w) { return String(w.profile || '').indexOf('<') !== -1; });
        var base = (state && state.avatarBase) ? state.avatarBase.replace(/\/$/, '') : 'avatars';
        var rawAvatar = String(member.avatarSrc || member.avatar || '');
        var src = !rawAvatar ? '' : (/^(https?:|vscode-[a-z-]+:|data:|\/)/i.test(rawAvatar) ? rawAvatar : (base + '/' + rawAvatar));
        var initials = member.initials || memberInitials(member.name, member.id);
        var altText = member.name + ' (' + member.role + ') portrait';
        if (unsafe || !src) {
            return '<div class="team-member-portrait" data-member-id="' + workersEsc(member.id) + '">' +
                '<span class="team-avatar-badge team-portrait-72 has-initials" data-initials="' + workersEsc(initials) + '"><span class="team-avatar-initials team-portrait-initials" role="img" aria-label="' + workersEsc(altText) + '">' + workersEsc(initials) + '</span></span></div>';
        }
        return '<div class="team-member-portrait" data-member-id="' + workersEsc(member.id) + '">' +
            '<span class="team-avatar-badge team-portrait-72 has-image" data-member-id="' + workersEsc(member.id) + '" data-initials="' + workersEsc(initials) + '"><img class="team-avatar-img" src="' + workersEsc(src) + '" alt="' + workersEsc(altText) + '" width="72" height="72" loading="eager" decoding="sync" /></span></div>';
    }
    function effectiveMemberModel(member, memberWorkers, state) {
        var settings = state && state.memberSettings && state.memberSettings[member.id] || {};
        return settings.model || (memberWorkers[0] || {}).model || 'github-copilot/gpt-6.1-sol';
    }
    function teamMemberRowHtml(member, memberWorkers, state, expanded, openIds, traces) {
        var settings = (state && state.memberSettings && state.memberSettings[member.id]) || {};
        var firstWorker = memberWorkers[0] || {};
        var selectedModel = effectiveMemberModel(member, memberWorkers, state);
        var efforts = effortsForModel(selectedModel);
        var rawThinking = settings.thinking || member.thinking || member.defaultThinking || firstWorker.thinking || efforts[0];
        var selectedThinking = efforts.indexOf(rawThinking) !== -1 ? rawThinking : (efforts[efforts.length - 1] || 'medium');
        var modelList = TEAM_MODELS.slice();
        if (selectedModel && !modelList.some(function (m) { return m.id === selectedModel; })) {
            modelList.unshift({ id: selectedModel, label: workerShortModel(selectedModel), efforts: efforts });
        }
        var modelOptions = modelList.map(function (m) {
            var label = m.label.replace(/^github-copilot\//, '').replace(/^agy\//, '').replace(/^claude-opus-/, 'Claude Opus ').replace(/^claude-sonnet-/, 'Claude Sonnet ').replace(/^gpt-6.1-sol$/, 'Sol 6.1').replace(/^gpt-6-luna$/, 'GPT-6 Luna').replace(/^gemini-4-argon-/, 'Argon ').replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ');
            if (m.id.indexOf('agy/') === 0 && label.indexOf('(agy)') === -1) label += ' (agy)';
            return '<option value="' + workersEsc(m.id) + '"' + (m.id === selectedModel ? ' selected' : '') + '>' + workersEsc(label) + '</option>';
        }).join('');
        var thinkingOptions = efforts.map(function (ef) {
            return '<option value="' + workersEsc(ef) + '"' + (ef === selectedThinking ? ' selected' : '') + '>' + workersEsc(ef) + '</option>';
        }).join('');
        var status = memberDisplayStatus(member, memberWorkers);
        var costs = memberCostAmounts(member, memberWorkers);
        var memberKey = 'member:' + member.id;
        var tasksOpen = Boolean(expanded && (expanded[memberKey] === true || expanded[member.id] === true));
        var taskCount = memberWorkers.length;
        var validator = member.pinned ? validatorTraceEvents(memberWorkers, state, traces) : { events: [], loading: false };
        var validatorEvents = validator.events;
        var pillLabel = (member.pinned ? 'Trace (' + validatorEvents.length + ')' : taskCount + ' ' + (taskCount === 1 ? 'task' : 'tasks')) + ' ' + (tasksOpen ? '\u25be' : '\u25b8');
        var highlighted = (expanded && expanded.highlightedMember === member.id) || (state && state.highlightedMember === member.id);
        var cardsHtml = memberWorkers.map(function (w) {
            return workerCardHtml(w, expanded && expanded[w.workerId], state.generatedAt, openIds, traces, { one: 'task', many: 'tasks' });
        }).join('');
        var turnCostText = teamMoney(costs.turn);
        var monthCostText = teamMoney(costs.month);
        var validatorTraceHtml = validatorEvents.length
            ? '<table class="observability-table obs-timeline-table team-validator-trace" data-validator-trace="' + workersEsc(member.id) + '">' +
                TRACE_HEAD + '<tbody>' + traceRowsHtml(validatorEvents, { openIds: openIds || {}, now: state.generatedAt }) + '</tbody></table>'
            : '<div class="workers-empty" data-validator-trace-empty="' + workersEsc(member.id) + '">' + (validator.loading ? 'Loading trace\u2026' : 'No Validator trace this turn.') + '</div>';
        var main = member.kind === 'main';
        var controlsHtml = main
            ? '<span class="team-member-profile">Chat agent: <code class="worker-state">' + workersEsc(member.profile) + '</code></span>' +
                '<span class="team-member-profile" data-main-model="' + workersEsc(member.id) + '">Model: ' + workersEsc(member.model ? workerShortModel(member.model) : 'chat model') + '</span>' +
                '<a href="#" class="team-agent-file-link" data-agent-file="' + workersEsc(member.agentFile) + '" data-open-agent-file="' + workersEsc(member.agentFile) + '" data-member-id="' + workersEsc(member.id) + '" data-member-kind="main" data-profile="" title="Open ' + workersEsc(member.agentFile) + '">Agent file &#8599;</a>'
            : '<span class="team-member-profile">Profile: <code class="worker-state">' + workersEsc(member.profile) + '</code></span>' +
                '<label class="team-control-field"><span class="team-control-label">Model</span>' +
                '<select class="team-model-select" data-member-id="' + workersEsc(member.id) + '" data-member-model="' + workersEsc(member.id) + '" data-profile="' + workersEsc(member.profile) + '" aria-label="' + workersEsc(member.name) + ' model">' + modelOptions + '</select></label>' +
                '<label class="team-control-field"><span class="team-control-label">Thinking</span>' +
                '<select class="team-thinking-select" data-member-id="' + workersEsc(member.id) + '" data-member-thinking="' + workersEsc(member.id) + '" data-profile="' + workersEsc(member.profile) + '" aria-label="' + workersEsc(member.name) + ' thinking effort">' + thinkingOptions + '</select></label>' +
                '<a href="#" class="team-agent-file-link" data-agent-file="' + workersEsc(member.agentFile) + '" data-open-agent-file="' + workersEsc(member.agentFile) + '" data-member-id="' + workersEsc(member.id) + '" data-profile="' + workersEsc(member.profile) + '" title="Open ' + workersEsc(member.agentFile) + '">Agent file &#8599;</a>';
        return '<div class="team-member-row' + (highlighted ? ' team-member-row-highlighted is-highlighted' : '') + (status.dotState === 'running' ? ' is-working' : '') + '" data-member-id="' + workersEsc(member.id) + '" data-member-row="' + workersEsc(member.id) + '"' +
            (member.pinned ? ' data-pinned="true"' : main ? ' data-main-agent="true"' : ' data-active-member-row="' + workersEsc(member.id) + '"') +
            (highlighted ? ' data-highlighted="true"' : '') + '>' +
            '<div class="team-member-row-main">' +
            teamPortraitHtml(member, state) +
            '<div class="team-member-body">' +
            '<div class="team-member-headline">' +
            '<span class="team-member-identity">' +
            '<strong class="team-member-name">' + workersEsc(member.name) + '</strong> &middot; ' +
            '<span class="team-member-role">' + workersEsc(member.role) + '</span>' +
            '</span>' +
            '<span class="team-member-status team-status-' + (status.dotState === 'running' ? 'working' : 'idle') + '" data-status-state="' + (status.dotState === 'running' ? 'working' : 'idle') + '">● ' + workersEsc(status.label) + '</span>' +
            '<span class="team-member-cost" data-member-cost="' + workersEsc(member.id) + '" data-turn-cost="' + turnCostText + '" data-month-cost="' + monthCostText + '">Turn <strong class="team-cost-turn">' + turnCostText + '</strong> &middot; Month <strong class="team-cost-month">' + monthCostText + '</strong></span>' +
            '<button type="button" class="form-btn team-edit-member-btn" data-edit-member="' + workersEsc(member.id) + '" title="Edit ' + workersEsc(member.name) + '">Edit</button>' +
            '</div>' +
            '<div class="team-member-controls">' + controlsHtml + '</div>' +
            '</div>' +
            (main ? '' : '<div class="team-member-tasks-col"><button type="button" class="team-tasks-pill' + (tasksOpen ? ' expanded' : '') + '" data-member-tasks-toggle="' + workersEsc(member.id) + '" data-toggle-tasks="' + workersEsc(member.id) + '" data-toggle-trace="' + workersEsc(member.id) + '" aria-expanded="' + (tasksOpen ? 'true' : 'false') + '">' + pillLabel + '</button></div>') +
            '</div>' +
            (main ? '' : '<div class="team-member-tasks-panel' + (member.pinned ? ' team-member-trace-panel' : '') + '" data-member-tray="' + workersEsc(member.id) + '"' + (tasksOpen ? ' data-member-tasks="' + workersEsc(member.id) + '"' : ' hidden') + '>' + (member.pinned ? validatorTraceHtml : cardsHtml) + '</div>') +
            '</div>';
    }
    // Priya's trace: the Validator events of the turn plus her validator tasks' loaded traces, as shared trace rows.
    function validatorTraceEvents(memberWorkers, state, traces) {
        var events = Array.isArray(state && state.validatorTrace) ? state.validatorTrace.slice() : [];
        var loading = false;
        (memberWorkers || []).forEach(function (w) {
            var t = w.trace || (traces && traces[w.workerId]);
            if (!t) { loading = true; return; }
            (w.runs || []).forEach(function (r) { events = events.concat((t.runs && t.runs[r.runId]) || []); });
        });
        return { events: events, loading: loading };
    }
    function groupWorkersByMember(state, shown, filter) {
        var explicitMembers = state && Array.isArray(state.members) && state.members.length > 0;
        var baseList = stateMembersList(state);
        var groups = [];
        var byId = {};
        baseList.forEach(function (m) {
            if (!explicitMembers && !m.pinned) return;
            byId[m.id] = { member: m, workers: [] };
            groups.push(byId[m.id]);
        });
        (shown || []).forEach(function (w) {
            var m = matchWorkerMember(w, baseList);
            if (!byId[m.id]) {
                byId[m.id] = { member: m, workers: [] };
                groups.push(byId[m.id]);
            }
            byId[m.id].workers.push(w);
        });
        var needle = String(filter || '').trim().toLowerCase();
        if (needle) {
            groups = groups.filter(function (g) {
                if (g.workers.length > 0) return true;
                var m = g.member;
                return [m.id, m.name, m.role, m.profile, m.creativeStatus].join(' ').toLowerCase().indexOf(needle) >= 0;
            });
        }
        // Every member row is always visible, idle ones included: Priya first (with her Trace), then the main agent,
        // then the rest in roster order. Only tasks are filtered (teamDisplayedTasks).
        var rank = function (m) { return m.pinned ? 0 : m.kind === 'main' ? 1 : 2; };
        return groups.sort(function (a, b) { return rank(a.member) - rank(b.member); });
    }
    function teamRuntimeWarning(state, groups) {
        var health = state && state.runtimeHealth || (typeof runtimeHealth !== 'undefined' ? runtimeHealth : null);
        if (!health) return '';
        if (!health.agy.enabled && !health.opencode.enabled) return 'Workers unavailable: enable OpenCode or agy in Settings';
        return ['agy', 'opencode'].map(function (name) {
            var names = groups.filter(function (g) {
                return g.member.kind !== 'main' && (effectiveMemberModel(g.member, g.workers, state).indexOf('agy/') === 0 ? 'agy' : 'opencode') === name;
            }).map(function (g) { return g.member.name; });
            var label = name === 'agy' ? 'agy' : 'OpenCode';
            return names.length && (!health[name].enabled || !health[name].ok) ? (!health[name].enabled ? label + ' is off in Settings' : health[name].reason) + ': ' + names.join(', ') + ' use ' + label + ' models' : '';
        }).filter(Boolean).join(' · ');
    }
    // The turn's displayed tasks: tasks of this turn that are running, queued or warm (Show completed adds the cold,
    // retired and finished ones). Validator tasks always count: they are Priya's trace.
    function teamDisplayedTasks(state, filter, showExpired) {
        var turnIds = Array.isArray(state.turnWorkerIds) ? state.turnWorkerIds : null;
        var now = state.generatedAt;
        return (state.workers || []).filter(function (w) {
            if (turnIds && turnIds.indexOf(w.workerId) === -1) return false;
            // Cloud tasks have no cache warmth: they stay until they expire.
            var live = isValidatorWorker(w) || teamTaskActive(w) || teamTaskQueuedRuns(w) > 0 || workerIsWarm(w, now) || (w.cloud && !w.expired);
            return (showExpired || live) && workersMatch(w, filter);
        }).sort(function (a, b) { return Number(isValidatorWorker(b)) - Number(isValidatorWorker(a)); });
    }
    function renderWorkersHtml(state, filter, expanded, showExpired, openIds, traces) {
        if (!state) return '<div class="workers-empty">Worker runtime not available.</div>';
        state = Object.assign({}, state, { workers: (state.workers || []).concat(state.cloudWorkers || []) });
        var shown = teamDisplayedTasks(state, filter, showExpired);
        var hasMembers = Array.isArray(state.members) && state.members.length > 0;
        var groups = hasMembers ? groupWorkersByMember(state, shown, filter) : [];
        var warning = teamRuntimeWarning(state, groups);
        var html = workersSummaryHtml(state, shown) + '<div class="workers-approval-notice" data-runtime-warning' + (warning ? '' : ' hidden') + '>' + workersEsc(warning) + '</div>';
        var pending = workersPendingApprovals(state);
        if (pending) {
            html += '<div class="workers-approval-notice">' + pending + ' worker' + (pending > 1 ? 's' : '') + ' waiting for approval. Open the session in OpenCode to answer.</div>';
        }
        if (!hasMembers) {
            return html + shown.map(function (w) {
                return workerCardHtml(w, expanded && expanded[w.workerId], state.generatedAt, openIds, traces);
            }).join('') + workersScoreboardHtml(state.scoreboard, openIds) + workersBenchmarkHtml(state.benchmark, openIds);
        }
        var rows = '<div class="team-members-list team-member-list">' + groups.map(function (g) {
            return teamMemberRowHtml(g.member, g.workers, state, expanded, openIds, traces);
        }).join('') + '</div>';
        if (!shown.length) {
            rows += '<div class="workers-empty">' + ((state.workers || []).length && String(filter || '').trim() ? 'No worker matches the filter.' : (state.workers || []).length ? 'No active tasks this turn.' : 'No live workers in this workspace.') + '</div>';
        }
        return html + rows + workersScoreboardHtml(state.scoreboard, openIds) + workersBenchmarkHtml(state.benchmark, openIds);
    }
    // Eval results by mode × model: the evidence for picking a worker tier. Same expander and table as Metrics.
    function workersScoreboardHtml(rows, openIds) {
        if (!rows || !rows.length) return '';
        var runs = rows.reduce(function (n, r) { return n + r.runs; }, 0);
        var body = rows.map(function (r) {
            var pct = Math.round(r.passed / r.runs * 100);
            return '<tr><td class="obs-scope">' + workersEsc(r.mode) + '</td><td>' + workersEsc(r.model) + (r.variant ? ' · ' + workersEsc(r.variant) : '') + '</td>' +
                '<td>' + r.passed + '/' + r.runs + '</td><td' + (pct < 80 ? ' class="obs-cache-risk"' : '') + '>' + pct + '%</td>' +
                '<td>$' + r.avgCost.toFixed(4) + '</td><td>' + (r.avgMs / 1000).toFixed(1) + 's</td></tr>';
        }).join('');
        return '<details class="obs-tl-item workers-scoreboard" data-eid="evals"' + (openIds && openIds.evals ? ' open' : '') + '>' +
            '<summary class="obs-tl-head"><span class="obs-tl-kind">evals</span><span class="obs-tl-name">Eval scoreboard</span><span class="obs-tl-metric">' + runs + ' runs · ' + rows.length + ' mode/model pairs</span></summary>' +
            '<table class="observability-table observability-model-table"><thead><tr><th>Mode</th><th>Model</th><th>Pass</th><th>Rate</th><th>Avg $</th><th>Avg time</th></tr></thead><tbody>' + body + '</tbody></table></details>';
    }
    // 008 benchmark: a stored result row converted into the shared banner's `b` shape (research D5), so the
    // scoreboard (CLI and Workers tab) uses the same efficiencyScore and usageBannerHtml as the live banner.
    function benchmarkBanner(row) {
        var u = (row && row.usage) || {};
        var uncached = (Number(u.input) || 0) + (Number(u.cacheWrite) || 0);
        var w = u.workers || {};
        return { dollars: u.dollars === null ? null : Number(u.dollars) || 0, cacheInput: uncached + (Number(u.cacheRead) || 0),
            lastCached: Number(u.cacheRead) || 0, lastIn: Number(u.mainAveragePrompt) || 0, averagePrompt: Number(u.mainAveragePrompt) || 0,
            turnOut: Number(u.output) || 0, requests: Number(u.requests) || 0, cacheMisses: uncached, mainContext: true,
            workers: { workers: Number(w.workers) || 0, requests: Number(w.requests) || 0, dollars: Number(w.dollars) || 0 } };
    }
    function benchmarkCompletion(row) {
        var tasks = (row && row.tasks) || [];
        return { accepted: tasks.filter(function (t) { return t.outcome === 'accepted'; }).length, total: tasks.length };
    }
    // Gate (research D6): '–' when cost or input is unavailable, 'incomplete k/n' unless every task is accepted.
    function benchmarkScoreLabel(row) {
        var b = benchmarkBanner(row);
        var c = benchmarkCompletion(row);
        if (b.dollars === null || !b.cacheInput) return '\u2013';
        if (!c.total || c.accepted < c.total) return 'incomplete ' + c.accepted + '/' + c.total;
        var value = efficiencyScore(b).value;
        return value === null ? '\u2013' : String(value);
    }
    // Rows are comparable only with the reference benchmark version and pricing basis (default: the newest row's).
    function benchmarkComparable(rows, version, pricingBasis) {
        var last = rows.length ? rows[rows.length - 1] : {};
        var v = version || last.benchmarkVersion;
        var p = pricingBasis || last.pricingBasis;
        return rows.map(function (r) { return String(r.benchmarkVersion || '').indexOf(v) === 0 && r.pricingBasis === p; });
    }
    function workersBenchmarkHtml(rows, openIds) {
        if (!rows || !rows.length) return '';
        var comparable = benchmarkComparable(rows);
        var body = rows.map(function (r, i) {
            var c = benchmarkCompletion(r);
            var label = benchmarkScoreLabel(r);
            var cfg = r.configuration || {};
            var gated = !/^\d+$/.test(label);
            return '<div class="benchmark-row' + (gated ? ' benchmark-incomplete' : '') + (comparable[i] ? '' : ' benchmark-not-comparable') + '" data-run-id="' + workersEsc(r.runId) + '">' +
                '<div class="benchmark-head"><span class="worker-mode">' + workersEsc(cfg.mainAgent) + '</span> ' +
                '<span class="benchmark-models">' + workersEsc((cfg.modelMix && cfg.modelMix.main) || '') + '</span> &middot; ' +
                '<span class="benchmark-completion" title="Accepted by hidden checks / fixed task count">' + c.accepted + '/' + c.total + ' accepted</span> &middot; ' +
                '<span class="benchmark-score">' + workersEsc(label) + '</span>' +
                (r.status && r.status !== 'completed' ? ' &middot; <span class="benchmark-status">' + workersEsc(r.status) + (r.stopReason ? ' (' + workersEsc(r.stopReason) + ')' : '') + '</span>' : '') +
                (r.usage && r.usage.dollars === null ? ' &middot; <span class="benchmark-unavailable">cost unavailable</span>' : '') +
                (comparable[i] ? '' : ' &middot; <span class="benchmark-flag" title="Different benchmark version or pricing basis">not comparable</span>') + '</div>' +
                '<div class="benchmark-banner">' + usageBannerHtml(benchmarkBanner(r)) + '</div></div>';
        }).join('');
        return '<details class="obs-tl-item workers-benchmark" data-eid="benchmark"' + (openIds && openIds.benchmark ? ' open' : '') + '>' +
            '<summary class="obs-tl-head"><span class="obs-tl-kind">benchmark</span><span class="obs-tl-name">Benchmark</span><span class="obs-tl-metric">' + rows.length + ' run' + (rows.length === 1 ? '' : 's') + '</span></summary>' +
            body + '</details>';
    }
    function wireTeamEvents(root, post) {
        root.addEventListener('click', function (event) {
            var target = event.target;
            var pill = target.closest('[data-member-tasks-toggle]');
            if (pill) {
                var id = pill.getAttribute('data-member-tasks-toggle');
                var open = pill.getAttribute('aria-expanded') !== 'true';
                var tray = root.querySelector('[data-member-tray="' + id + '"]');
                if (tray) { if (open) { tray.removeAttribute('hidden'); tray.setAttribute('data-member-tasks', id); } else { tray.setAttribute('hidden', ''); tray.removeAttribute('data-member-tasks'); } }
                pill.setAttribute('aria-expanded', String(open));
                pill.textContent = pill.textContent.replace(/[▸▾]$/, open ? '▾' : '▸');
                post({ type: 'teamTasksToggle', memberId: id, open: open });
                return;
            }
            var edit = target.closest('[data-edit-member]');
            var file = target.closest('[data-open-agent-file]');
            if (edit || file) {
                event.preventDefault();
                var row = (edit || file).closest('[data-member-row]');
                var link = file || row.querySelector('[data-open-agent-file]');
                post({ type: edit ? 'editTeamMember' : 'openAgentFile', memberId: (edit || file).getAttribute(edit ? 'data-edit-member' : 'data-member-id'), profile: link.getAttribute('data-profile'), path: link.getAttribute('data-open-agent-file'), agentFile: link.getAttribute('data-open-agent-file') });
                return;
            }
            var name = target.closest('.team-member-name, #panel-aitalk [data-member-id]');
            if (name && !target.closest('.talk-mentions')) {
                var member = name.closest('[data-member-row]') || name;
                post({ type: 'teamMemberFocus', memberId: member.getAttribute('data-member-id') });
            }
        });
        root.addEventListener('change', function (event) {
            var model = event.target.closest('[data-member-model]');
            var thinking = event.target.closest('[data-member-thinking]');
            var select = model || thinking;
            if (!select) return;
            var row = select.closest('[data-member-row]');
            var modelSelect = row.querySelector('[data-member-model]');
            var effortSelect = row.querySelector('[data-member-thinking]');
            var efforts = effortsForModel(modelSelect.value);
            var effort = effortSelect.value;
            if (efforts.indexOf(effort) === -1) effort = efforts[efforts.length - 1];
            if (model) { effortSelect.innerHTML = efforts.map(function (value) { return '<option value="' + value + '"' + (value === effort ? ' selected' : '') + '>' + value + '</option>'; }).join(''); effortSelect.value = effort; }
            post({ type: 'setMemberModel', memberId: select.getAttribute('data-member-id'), profile: select.getAttribute('data-profile'), model: modelSelect.value, thinking: effort });
        });
    }
    // ── end Workers pure render ──

    var workersState = null;
    var runtimeHealth = null;
    function runtimeSettingsHtml() {
        return ['opencode', 'agy'].map(function (name) {
            var health = runtimeHealth && runtimeHealth[name];
            var label = name === 'agy' ? 'agy' : 'OpenCode';
            return '<div class="settings-section-header"><div class="settings-section-title">' + label + '</div><div class="toggle-switch' + (health && health.enabled ? ' active' : '') + '" role="switch" tabindex="0" aria-label="Enable ' + label + '" aria-checked="' + !!(health && health.enabled) + '" data-runtime-toggle="' + name + '"></div></div><div class="settings-description" data-runtime-health="' + name + '">' + workersEsc(runtimeHealthLabel(health)) + '</div>' + (name === 'opencode' ? '<div class="workers-server" data-settings-server>Shared OpenCode server</div><button type="button" data-restart-opencode>Start / Restart OpenCode</button>' : '');
        }).join('') + '<button type="button" class="form-btn" data-runtime-recheck>Recheck</button>';
    }
    function runtimeHealthLabel(health) {
        return health ? (health.ok ? 'ok' : health.reason) + ' · checked ' + (health.checkedAt ? new Date(health.checkedAt).toLocaleString() : 'not yet') : 'not checked yet';
    }
    function initRuntimeSettings(section) {
        function activate(event) {
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
            var name = event.target.getAttribute('data-runtime-toggle');
            if (name) {
                event.preventDefault();
                vscode.postMessage({ type: 'setRuntimeEnabled', runtime: name, enabled: event.target.getAttribute('aria-checked') !== 'true' });
            } else if (event.target.hasAttribute('data-restart-opencode')) vscode.postMessage({ type: 'restartOpenCodeServer' });
            else if (event.target.hasAttribute('data-runtime-recheck')) vscode.postMessage({ type: 'recheckRuntimeHealth' });
        }
        section.addEventListener('click', activate);
        section.addEventListener('keydown', activate);
    }
    function applyRuntimeHealth(health) {
        runtimeHealth = health;
        ['opencode', 'agy'].forEach(function (name) {
            var toggle = document.querySelector('[data-runtime-toggle="' + name + '"]');
            var line = document.querySelector('[data-runtime-health="' + name + '"]');
            if (toggle) {
                toggle.classList.toggle('active', !!health[name].enabled);
                if (toggle.getAttribute('aria-checked') !== String(health[name].enabled)) toggle.setAttribute('aria-checked', String(health[name].enabled));
            }
            if (line && line.textContent !== runtimeHealthLabel(health[name])) line.textContent = runtimeHealthLabel(health[name]);
        });
        paintWorkers();
    }
    function patchTeamNode(node, fresh) {
        // Text nodes first: a browser Text node has no outerHTML, so comparing it would skip every count change.
        if (!node.tagName) {
            if (node.textContent !== fresh.textContent) node.textContent = fresh.textContent;
            return;
        }
        if (node.outerHTML === fresh.outerHTML) return;
        var attrs = node.attributes ? Array.from(node.attributes).map(function (a) { return a.name; }) : Object.keys(node._attrs || {});
        var nextAttrs = fresh.attributes ? Array.from(fresh.attributes).map(function (a) { return a.name; }) : Object.keys(fresh._attrs || {});
        attrs.forEach(function (name) { if (!fresh.hasAttribute(name)) node.removeAttribute(name); });
        nextAttrs.forEach(function (name) { if (node.getAttribute(name) !== fresh.getAttribute(name)) node.setAttribute(name, fresh.getAttribute(name)); });
        if (node.tagName === 'SELECT' && document.activeElement === node) return;
        var children = Array.from(node.childNodes || node.children);
        var next = Array.from(fresh.childNodes || fresh.children);
        function key(child) {
            return child.getAttribute && (child.getAttribute('data-member-row') || (child.classList.contains('worker-card') && child.getAttribute('data-worker-id')));
        }
        next.forEach(function (child, index) {
            var current = Array.from(node.childNodes || node.children);
            var old = key(child) ? current.find(function (candidate) { return key(candidate) === key(child); }) : current[index];
            if (old && old !== current[index]) node.insertBefore(old, current[index] || null);
            if (!old) node.insertBefore(child, current[index] || null);
            else if (old.tagName === child.tagName) patchTeamNode(old, child);
            else { node.insertBefore(child, old); node.removeChild(old); }
        });
        Array.from(node.childNodes || node.children).slice(next.length).forEach(function (child) { node.removeChild(child); });
        if (node.tagName === 'SELECT' && node.value !== fresh.value) node.value = fresh.value;
    }
    function patchTeamHtml(node, html) {
        if (node._teamHtml === html || node.outerHTML === html) { node._teamHtml = html; return; }
        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        if (wrap.firstChild) patchTeamNode(node, wrap.firstChild);
        node._teamHtml = html;
    }
    var workersExpanded = {};
    var workersPointerDown = false;
    var workersTraces = {};
    var workersShowExpired = false;
    var workersClockSkew = 0;
    var workersTicks = 0;

    function focusTeamMember(rawMember) {
        var targetId = resolveTeamMemberId(rawMember, workersState);
        if (!targetId) return;
        workersExpanded.highlightedMember = targetId;
        switchTab('team');
        paintWorkers();
        var list = document.getElementById('workers-list');
        var row = list && list.querySelector ? list.querySelector('[data-member-row="' + targetId + '"]') : null;
        if (row && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    if (typeof window !== 'undefined') window.focusTeamMember = focusTeamMember;

    function patchTeam(list, state, filter, expanded, showExpired, openIds, traces) {
        if (!list) return;
        var rendered = renderWorkersHtml(state, filter, expanded, showExpired, openIds, traces);
        if (list._teamRendered === rendered) return;
        list._teamRendered = rendered;
        if (!state || typeof list.querySelectorAll !== 'function' || typeof document === 'undefined' || typeof document.createElement !== 'function') {
            list.innerHTML = renderWorkersHtml(state, filter, expanded, showExpired, openIds, traces);
            return;
        }
        patchTeamHtml(list, '<div id="workers-list">' + rendered + '</div>');
    }

    function tickTeamAges() {
        var list = document.getElementById('workers-list');
        if (!list || !workersState || typeof list.querySelector !== 'function') return;
        var now = Date.now() - workersClockSkew;
        var all = (workersState.workers || []).concat(workersState.cloudWorkers || []);
        all.forEach(function (w) {
            if (w.adapter === 'agy' || w.cloud) return;
            var card = list.querySelector('[data-worker-id="' + w.workerId + '"]');
            if (!card || !card.querySelector) return;
            var cacheEl = card.querySelector('.health-cache');
            if (!cacheEl) return;
            var b = w.banner || {};
            var age = cacheAgeLabel(Math.floor((now - (b.lastActivityAt || now)) / 1000));
            if (cacheEl.className !== 'health-cache ' + age.state) cacheEl.className = 'health-cache ' + age.state;
            if (cacheEl.textContent !== age.text) cacheEl.textContent = age.text;
        });
    }

    function paintWorkers() {
        var list = document.getElementById('workers-list');
        if (!list || !workersState) return;
        // Age ticks locally between polls; the skew keeps it on the extension host's clock.
        var ticking = Object.assign({}, workersState, { generatedAt: Date.now() - workersClockSkew });
        // Re-rendering between pointerdown and click drops the click, so the row never toggles.
        if (workersPointerDown) return;
        patchTeam(list, ticking, '', workersExpanded, workersShowExpired, traceOpenIds(list), workersTraces);
        var toggle = document.getElementById('workers-show-expired');
        if (toggle) {
            toggle.setAttribute('aria-checked', workersShowExpired ? 'true' : 'false');
            toggle.classList.toggle('active', workersShowExpired);
        }
        var serverBtn = document.getElementById('workers-server-btn');
        if (serverBtn) {
            var up = !!(workersState.server && workersState.server.state === 'ATTACHED');
            serverBtn.title = up ? 'Restart the shared OpenCode server (reloads OpenCode config; interrupts running workers in every workspace)' : 'Start the shared OpenCode server';
            var icon = serverBtn.querySelector('.codicon');
            if (icon) icon.className = 'codicon ' + (up ? 'codicon-debug-restart' : 'codicon-play');
        }
    }

    function applyWorkersState(data) {
        var prevSettings = workersState && workersState.memberSettings;
        var prevValTrace = (data && data.validatorTrace) || (workersState && workersState.validatorTrace);
        var prevMembers = (data && data.members) || (workersState && workersState.members);
        workersState = Object.assign({}, data || {}, {
            memberSettings: Object.assign({}, prevSettings || {}, (data && data.memberSettings) || {}),
            validatorTrace: prevValTrace,
            members: prevMembers
        });
        if (data && data.generatedAt) workersClockSkew = Date.now() - data.generatedAt;
        paintWorkers();
        requestValidatorTraces(false);
        var badge = document.getElementById('tab-badge-team') || document.getElementById('tab-badge-workers');
        if (badge) {
            var pending = workersPendingApprovals(workersState);
            badge.textContent = String(pending);
            badge.classList.toggle('hidden', pending === 0);
        }
    }

    // Priya's Trace reads her validator tasks of this turn; load each once per change so Trace (n) counts real events.
    var workersTraceStamp = {};
    function requestValidatorTraces(force) {
        if (!workersState) return;
        var turnIds = Array.isArray(workersState.turnWorkerIds) ? workersState.turnWorkerIds : null;
        (workersState.workers || []).forEach(function (w) {
            if (!isValidatorWorker(w) || (turnIds && turnIds.indexOf(w.workerId) === -1)) return;
            var stamp = String(w.lastUpdateAt || 0) + ':' + (w.runs || []).length;
            if (!force && workersTraceStamp[w.workerId] === stamp) return;
            workersTraceStamp[w.workerId] = stamp;
            vscode.postMessage({ type: 'requestWorkerTrace', workerId: w.workerId });
        });
    }

    function initWorkersTab() {
        document.addEventListener('click', function (e) {
            var tag = e.target.closest && e.target.closest('[data-worker-ref]');
            if (!tag) return;
            e.preventDefault();
            var ref = tag.getAttribute('data-worker-ref');
            workersExpanded['member:' + resolveTeamMemberId(ref, workersState)] = true;
            focusTeamMember(ref);
        });
        var refresh = document.getElementById('workers-refresh-btn');
        if (refresh) refresh.addEventListener('click', function () { vscode.postMessage({ type: 'requestWorkersState' }); });
        var archive = document.getElementById('workers-archive-btn');
        if (archive) archive.addEventListener('click', function () { vscode.postMessage({ type: 'archiveWorkers' }); });
        var serverBtn = document.getElementById('workers-server-btn');
        if (serverBtn) serverBtn.addEventListener('click', function () { vscode.postMessage({ type: 'restartOpenCodeServer' }); });
        var showExpired = document.getElementById('workers-show-expired');
        if (showExpired) {
            var toggleExpired = function () { workersShowExpired = !workersShowExpired; paintWorkers(); };
            showExpired.addEventListener('click', toggleExpired);
            showExpired.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpired(); }
            });
        }
        var list = document.getElementById('workers-list');
        if (list) {
            list.addEventListener('pointerdown', function () { workersPointerDown = true; });
            document.addEventListener('pointerup', function () { setTimeout(function () { workersPointerDown = false; }, 0); });
            list.addEventListener('error', function (e) {
                var img = e && e.target;
                if (!img || String(img.tagName || '').toUpperCase() !== 'IMG' || !img.classList || !img.classList.contains('team-avatar-img')) return;
                var parent = img.parentNode;
                if (!parent) return;
                var initials = (img.getAttribute && img.getAttribute('data-initials')) || (parent.getAttribute && parent.getAttribute('data-initials')) || '?';
                var label = (img.getAttribute && img.getAttribute('alt')) || 'Member portrait';
                parent.innerHTML = '<span class="team-avatar-initials team-portrait-initials" role="img" aria-label="' + workersEsc(label) + '">' + workersEsc(initials) + '</span>';
            }, true);
        }
        if (list) wireTeamEvents(list, function (message) {
            if (message.type === 'teamTasksToggle') {
                workersExpanded['member:' + message.memberId] = message.open;
                var toggled = workersState && stateMembersList(workersState).find(function (m) { return m.id === message.memberId; });
                if (message.open && toggled && toggled.pinned) requestValidatorTraces(true);
                return;
            }
            if (message.type === 'teamMemberFocus') { focusTeamMember(message.memberId); return; }
            if (message.type === 'setMemberModel' && workersState) {
                workersState.memberSettings = Object.assign({}, workersState.memberSettings || {});
                workersState.memberSettings[message.memberId] = { model: message.model, thinking: message.thinking };
            }
            vscode.postMessage(message);
        });
        if (list) list.addEventListener('click', function (e) {
            if (e.target.closest('[data-member-tasks-toggle], [data-edit-member], [data-open-agent-file]')) return;
            var toggleBtn = e.target.closest && e.target.closest('[data-member-tasks-toggle]');
            if (toggleBtn) {
                var memberId = toggleBtn.getAttribute('data-member-tasks-toggle');
                workersExpanded['member:' + memberId] = !workersExpanded['member:' + memberId];
                var open = workersExpanded['member:' + memberId];
                var panel = list.querySelector('[data-member-tray="' + memberId + '"]');
                if (panel) { if (open) { panel.removeAttribute('hidden'); panel.setAttribute('data-member-tasks', memberId); } else { panel.setAttribute('hidden', ''); panel.removeAttribute('data-member-tasks'); } }
                toggleBtn.setAttribute('aria-expanded', String(open));
                toggleBtn.textContent = toggleBtn.textContent.replace(/[▸▾]$/, open ? '▾' : '▸');
                return;
            }
            var editBtn = e.target.closest && e.target.closest('[data-edit-member]');
            if (editBtn) {
                var editRow = editBtn.closest('[data-member-row]');
                var link = editRow.querySelector('[data-open-agent-file]');
                vscode.postMessage({ type: 'editTeamMember', memberId: editBtn.getAttribute('data-edit-member'), profile: link.getAttribute('data-profile'), path: link.getAttribute('data-open-agent-file') });
                return;
            }
            var agentFileBtn = e.target.closest && e.target.closest('[data-open-agent-file]');
            if (agentFileBtn) {
                e.preventDefault();
                vscode.postMessage({
                    type: 'openAgentFile',
                    memberId: agentFileBtn.getAttribute('data-member-id') || '',
                    profile: agentFileBtn.getAttribute('data-profile') || '',
                    agentFile: agentFileBtn.getAttribute('data-open-agent-file') || ''
                });
                return;
            }
            var btn = e.target.closest('[data-worker-action]');
            if (!btn) return;
            var action = btn.getAttribute('data-worker-action');
            if (action === 'open' || action === 'open-external') {
                vscode.postMessage({ type: 'openWorkerSession', sessionId: btn.getAttribute('data-session-id'), external: action === 'open-external' });
            } else if (action === 'cancel-run') {
                vscode.postMessage({ type: 'cancelQueuedWorkerRun', runId: btn.getAttribute('data-run-id') });
            } else if (action === 'remove' || action === 'remove-cancel' || action === 'remove-confirm') {
                var removeId = btn.getAttribute('data-worker-id');
                if (action === 'remove') workersRemoveConfirm[removeId] = true;
                else delete workersRemoveConfirm[removeId];
                if (action === 'remove-confirm') vscode.postMessage({ type: 'removeWorker', workerId: removeId });
                paintWorkers();
            } else {
                var id = btn.getAttribute('data-worker-id');
                workersExpanded[id] = !workersExpanded[id];
                if (workersExpanded[id] && id.indexOf('cloud:') !== 0) vscode.postMessage({ type: 'requestWorkerTrace', workerId: id });
                paintWorkers();
            }
        });
        if (list && list.addEventListener) list.addEventListener('change', function (e) {
            return;
            var modelSel = e.target.closest && e.target.closest('[data-member-model]');
            var thinkSel = e.target.closest && e.target.closest('[data-member-thinking]');
            if (!modelSel && !thinkSel) return;
            var sel = modelSel || thinkSel;
            var memberId = sel.getAttribute(modelSel ? 'data-member-model' : 'data-member-thinking');
            var profile = sel.getAttribute('data-profile') || memberId;
            var row = sel.closest && sel.closest('[data-member-row]');
            var mSelect = row && row.querySelector ? row.querySelector('[data-member-model]') : null;
            var tSelect = row && row.querySelector ? row.querySelector('[data-member-thinking]') : null;
            var model = modelSel ? modelSel.value : (mSelect ? mSelect.value : '');
            var efforts = effortsForModel(model);
            var thinking = thinkSel ? thinkSel.value : (tSelect ? tSelect.value : efforts[0]);
            if (efforts.indexOf(thinking) === -1) thinking = efforts[efforts.length - 1] || 'medium';
            if (mSelect && modelSel && tSelect) {
                tSelect.innerHTML = efforts.map(function (ef) {
                    return '<option value="' + workersEsc(ef) + '"' + (ef === thinking ? ' selected' : '') + '>' + workersEsc(ef) + '</option>';
                }).join('');
                tSelect.value = thinking;
            }
            if (workersState) {
                workersState.memberSettings = Object.assign({}, workersState.memberSettings || {});
                workersState.memberSettings[memberId] = { model: model, thinking: thinking };
            }
            vscode.postMessage({ type: 'setMemberModel', memberId: memberId, profile: profile, model: model, thinking: thinking });
            paintWorkers();
        });
        // Runs whenever the panel is visible, however it became visible (click, restore, badge link).
        setInterval(function () {
            var panel = document.getElementById('panel-team') || document.getElementById('panel-workers');
            if (!panel || !panel.classList.contains('active')) return;
            tickTeamAges();
            if (++workersTicks % 3 === 0) {
                vscode.postMessage({ type: 'requestWorkersState' });
                Object.keys(workersExpanded).forEach(function (id) { if (workersExpanded[id] && id.indexOf('member:') !== 0 && id !== 'highlightedMember') vscode.postMessage({ type: 'requestWorkerTrace', workerId: id }); });
            }
        }, 1000);
    }

    function initSpecsTab() {
        var refreshBtn = document.getElementById('specs-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'requestSpecs' }); });
        }
        var showDone = document.getElementById('specs-show-done');
        if (showDone) {
            var toggleCompletedSpecs = function() {
                specsShowDone = !specsShowDone;
                renderSpecs();
            };
            showDone.addEventListener('click', toggleCompletedSpecs);
            showDone.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCompletedSpecs(); }
            });
        }
        var showAll = document.getElementById('specs-show-all');
        if (showAll) {
            var toggleAllSpecs = function() {
                specsShowAll = !specsShowAll;
                renderSpecs();
            };
            showAll.addEventListener('click', toggleAllSpecs);
            showAll.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAllSpecs(); }
            });
        }
        var list = document.getElementById('specs-list');
        if (list) {
            list.addEventListener('click', onSpecsListClick);
            list.addEventListener('toggle', function(e) {
                var details = e.target;
                var key = details && details.getAttribute ? details.getAttribute('data-work-key') : '';
                if (key) { specsWorkExpanded[key] = details.open; }
            }, true);
        }
        vscode.postMessage({ type: 'requestSpecs' });
    }

    function applySpecsData(data) {
        specsState = data || { enabled: false, activeSlug: '', specs: [] };
        var tabBtn = document.getElementById('tab-specs');
        if (tabBtn) tabBtn.classList.toggle('hidden', !specsState.enabled);
        if (!specsState.enabled && currentTab === 'specs') switchTab('aitalk');
        renderSpecs();
        renderConversationHealth();
    }

    function specAgo(ms) {
        if (!ms) return '';
        var days = Math.floor((Date.now() - ms) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        return days + 'd ago';
    }

    function specCostFact(spec) {
        var cost = spec && spec.cost;
        if (!cost || (!cost.requests && !cost.nanoAiu)) return 'No tracked cost';
        return '$' + ((Number(cost.nanoAiu) || 0) / 1000000000 / 100).toFixed(2) +
            ' · ' + (Number(cost.requests) || 0) + ' reqs';
    }

    function formatSpecInline(text) {
        var html = escapeHtml(text || '');
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        return html;
    }

    function renderCloudEligibility(task, specSlug) {
        var tags = Array.isArray(task.tags) ? task.tags : [];
        var local = tags.filter(function(tag) { return /^local:/i.test(tag); })[0];
        if (local) return '<span class="specs-muted" title="' + escapeHtml(local.replace(/^local:\s*/i, '')) + '">Local</span>';
        if (!task.id || !tags.some(function(tag) { return /^cloud$/i.test(tag); })) return '';
        return '<button class="spec-action spec-task-run" data-act="queue-cloud" data-ref="' + escapeHtml(task.id) +
            '" data-spec-slug="' + escapeHtml(specSlug) + '" title="Only queues on an explicit reviewer request">Queue in cloud</button>';
    }

    function renderSpecWork(spec) {
        var tasks = Array.isArray(spec.tasks) ? spec.tasks : [];
        var stories = Array.isArray(spec.stories) ? spec.stories : [];
        var groups = stories.map(function(story) {
            return { id: story.id, name: 'User Story ' + story.id.slice(2) + ' - ' + story.title +
                (story.priority ? ' (Priority: ' + story.priority + ')' : ''), story: story,
                tasks: tasks.filter(function(task) { return task.story === story.id; }) };
        });
        var unlinked = tasks.filter(function(task) { return !stories.some(function(story) { return task.story === story.id; }); });
        if (unlinked.length) groups.push({ id: 'unlinked', name: 'Not linked to a story', tasks: unlinked });
        if (!groups.length) return '';
        return '<div class="spec-work"><div class="spec-section-label">User stories and tasks</div>' + groups.map(function(group, index) {
            var phaseKey = spec.slug + '|story|' + group.id;
            var phaseOpen = Object.prototype.hasOwnProperty.call(specsWorkExpanded, phaseKey)
                ? specsWorkExpanded[phaseKey] : index === 0;
            var phaseTasks = specsShowDone ? group.tasks : group.tasks.filter(function(task) { return !task.done; });
            var story = group.story;
            var storyTest = story && story.independentTest
                ? '<div class="spec-story-test"><strong>Independent Test</strong> ' + formatSpecInline(story.independentTest) +
                  (story.successCriteria && story.successCriteria.length ? ' <span class="specs-muted">· verifies ' + escapeHtml(story.successCriteria.join(', ')) + '</span>' : '') + '</div>'
                : '';
            return '<details class="spec-work-phase" data-work-key="' + escapeHtml(phaseKey) + '"' + (phaseOpen ? ' open' : '') + '>' +
                '<summary class="spec-work-phase-title"><span class="codicon codicon-chevron-right spec-phase-caret"></span>' +
                '<span class="spec-phase-name">' + formatSpecInline(group.name) + '</span>' +
                '<span class="spec-phase-count">' + group.tasks.filter(function(task) { return task.done; }).length + '/' + group.tasks.length + ' tasks</span></summary>' +
                storyTest +
                phaseTasks.map(function(task) {
                    return '<div class="spec-work-row' + (task.done ? ' done' : '') + '"><span class="codicon ' +
                        (task.done ? 'codicon-check' : 'codicon-circle-large-outline') + '"></span><span class="spec-work-id">' +
                        escapeHtml(task.id || '') + '</span><span class="spec-work-text">' + formatSpecInline(task.text || task.id) + '</span>' +
                        (!task.done && task.id ? '<button class="spec-task-run" data-act="implement-ref" data-ref="' + escapeHtml(task.id) +
                            '" title="Implement ' + escapeHtml(task.id) + '" aria-label="Implement ' + escapeHtml(task.id) + '"><span class="codicon codicon-play"></span></button>' : '') +
                        renderCloudEligibility(task, spec.slug) + '</div>' +
                        (task.cloud ? '<table class="obs-event-table"><tbody>' + traceRowsHtml(task.cloud.events) + '</tbody></table>' : '');
                }).join('') + '</details>';
        }).join('') + '</div>';
    }

    var SPEC_STAGE_COMMAND = { Plan: '/sk.plan', Tasks: '/sk.tasks', Implement: '/sk.implement' };

    // One plain line per upstream file: how many later files are affected.
    function staleSummaryHtml(stale) {
        var groups = [];
        stale.forEach(function(entry) {
            var dirty = entry.reason === 'upstream-dirty';
            var group = groups.filter(function(g) { return g.upstream === entry.upstream; })[0];
            if (!group) { group = { upstream: entry.upstream, dirty: dirty, files: [] }; groups.push(group); }
            group.dirty = group.dirty || dirty;
            if (group.files.indexOf(entry.artifact) < 0) group.files.push(entry.artifact);
        });
        return groups.map(function(g) {
            var n = g.files.length;
            var files = n + ' file' + (n === 1 ? '' : 's');
            var upstream = escapeHtml(g.upstream);
            var text = g.dirty
                ? upstream + ' has uncommitted edits; ' + files + ' built on it may be out of date; re-check ' + (n === 1 ? 'it' : 'them') + ' with /sk.check'
                : files + (n === 1 ? ' was' : ' were') + ' written before the last ' + upstream + ' change; re-check ' + (n === 1 ? 'it' : 'them') + ' with /sk.check';
            return '<div class="spec-stale"><span class="codicon codicon-history"></span> ' + text + '</div>';
        }).join('');
    }

    // Always visible on a spec card: the Spec Kit stage, then one button per step (the stage's next action and /sk.check).
    function renderStageBar(spec, stalenessAvailable) {
        var stage = spec.specKitStage || '';
        if (!stage) return '';
        var nextStep = spec.nextStep || '';
        var command = SPEC_STAGE_COMMAND[spec.stageButton] || '';
        var stale = Array.isArray(spec.stale) ? spec.stale : [];
        var button = function(cmd, label, title) {
            return '<button class="spec-action spec-stage-action" data-act="sk" data-cmd="' + escapeHtml(cmd) + '" title="' + escapeHtml(title) + '">' + escapeHtml(label) + '</button>';
        };
        var action = command ? button(command, command, 'Next step: ' + command) : '';
        var checkIsNext = nextStep.indexOf('/sk.check') === 0;
        var check = button('/sk.check', checkIsNext ? nextStep : '/sk.check', 'Check this spec' + (checkIsNext ? ' \u2014 next step' : ''));
        return '<div class="spec-stage-bar">' +
            (checkIsNext ? check + action : action + check) +
            '<a href="#" class="spec-file-link" data-act="open-spec">spec.md</a>' +
            (spec.hasPlan ? '<a href="#" class="spec-file-link" data-act="open-plan">plan.md</a>' : '') +
            (spec.hasTasks ? '<a href="#" class="spec-file-link" data-act="open-tasks">tasks.md</a>' : '') +
            (spec.mismatch ? '<div class="spec-stage-warn"><span class="codicon codicon-warning"></span> Stage mismatch: ' + escapeHtml(spec.mismatch.reason) + '</div>' : '') +
            staleSummaryHtml(stale) +
            (stalenessAvailable === false ? '<div class="spec-stale specs-muted">Staleness unknown: not a git repository</div>' : '') +
            '</div>';
    }

    // The active spec is never hidden: finishing its tasks does not mean the reviewer stopped working on it.
    // Other specs show only with "All" on (or when no spec is active); done ones additionally need "Completed".
    function visibleSpecs(all, showDone, showAll) {
        var hasActive = all.some(function(s) { return s.active; });
        return all.filter(function(s) {
            if (s.active) return true;
            if (hasActive && !showAll) return false;
            return showDone || s.stage !== 'done';
        });
    }

    function renderSpecs() {
        var list = document.getElementById('specs-list');
        if (!list) return;

        var all = specsState.specs || [];
        var doneCount = all.filter(function(s) { return s.stage === 'done'; }).length;
        var completedWorkCount = all.reduce(function(sum, spec) {
            return sum + (spec.tasks || []).filter(function(task) { return task.done; }).length +
                (spec.cycles || []).filter(function(cycle) { return cycle.state === 'complete'; }).length;
        }, doneCount);

        var chip = document.getElementById('specs-active-chip');
        if (chip) {
            var act = all.filter(function(s) { return s.active; })[0];
            chip.innerHTML = act
                ? '<span class="codicon codicon-target"></span> <strong>' + escapeHtml(act.id || act.slug) + '</strong> ' +
                  escapeHtml(act.title)
                : '<span class="specs-muted">No active feature</span>';
            chip.title = act ? act.slug : '';
        }

        var velocity = document.getElementById('specs-workspace-velocity');
        if (velocity) {
            velocity.innerHTML = '<span class="specs-velocity-label">Agent throughput</span> ' +
                '<span class="specs-velocity-muted">Insufficient attributed data</span>';
            velocity.title = 'Agent throughput requires completed tasks joined to attributed provider cost and AI-active time. Excludes human waiting, manual work, and untracked user activity. The current metrics payload does not contain that attribution history.';
        }

        var toggle = document.getElementById('specs-show-done');
        if (toggle) {
            toggle.setAttribute('aria-checked', specsShowDone ? 'true' : 'false');
            toggle.classList.toggle('active', specsShowDone);
            var lbl = toggle.parentElement;
            if (lbl) lbl.classList.toggle('hidden', completedWorkCount === 0);
        }
        var allToggle = document.getElementById('specs-show-all');
        if (allToggle) {
            allToggle.setAttribute('aria-checked', specsShowAll ? 'true' : 'false');
            allToggle.classList.toggle('active', specsShowAll);
            var others = all.filter(function(s) { return !s.active; }).length;
            if (allToggle.parentElement) allToggle.parentElement.title = 'Show the ' + others + ' spec' + (others === 1 ? '' : 's') + ' other than the active one';
        }

        var specs = visibleSpecs(all, specsShowDone, specsShowAll);
        if (!specs.length) {
            list.innerHTML = '<div class="specs-empty">' +
                (all.length ? 'All specs are complete.' : 'No specs found under specs/.') + '</div>';
            return;
        }

        list.innerHTML = specs.map(function(spec) {
            var expanded = !!specsExpanded[spec.slug];
            var pct = spec.total ? spec.percent : 0;

            var next = spec.nextTaskId || spec.nextTaskText
                ? '<div class="spec-next" title="' + escapeHtml(spec.nextTaskText) + '"><span class="spec-next-id">' +
                  escapeHtml(spec.nextTaskId || 'next') + '</span>' + formatSpecInline(spec.nextTaskText) + '</div>'
                : '<div class="spec-next specs-muted">' + (spec.hasTasks ? 'All tasks done' : 'No tasks yet') + '</div>';

            var facts = [];
            if (spec.total) facts.push(spec.done + '/' + spec.total + ' tasks');
            if (spec.clarifications) facts.push(spec.clarifications + ' clarify');
            if (spec.sessions) facts.push(spec.sessions + ' sessions');
            if (spec.lastActivity) facts.push(specAgo(spec.lastActivity));
            facts.push(specCostFact(spec));

            var body = expanded
                ? '<div class="spec-body">' +
                  (facts.length ? '<div class="spec-meta">' + escapeHtml(facts.join(' · ')) + '</div>' : '') +
                                    renderSpecWork(spec) +
                  '</div>'
                : '';

            return '' +
                '<div class="spec-card' + (spec.active ? ' spec-card-active' : '') + (expanded ? ' expanded' : '') + '"' +
                    ' data-slug="' + escapeHtml(spec.slug) + '" data-dir="' + escapeHtml(spec.dir) + '"' +
                    ' data-id="' + escapeHtml(spec.id) + '" data-next="' + escapeHtml(spec.nextTaskId) + '">' +
                '  <div class="spec-card-head" data-act="toggle">' +
                '    <span class="codicon codicon-chevron-right spec-chevron"></span>' +
                '    <span class="spec-id">' + escapeHtml(spec.id) + '</span>' +
                '    <span class="spec-title">' + escapeHtml(spec.title) + '</span>' +
                (spec.clarifications ? '<span class="spec-dot" title="' + spec.clarifications + ' open [NEEDS CLARIFICATION]">!</span>' : '') +
                '    <span class="spec-badge spec-stage-' + escapeHtml(spec.specKitStage || spec.stage) + '">' + escapeHtml(spec.specKitStage || SPEC_STAGE_LABEL[spec.stage] || spec.stage) + '</span>' +
                '    <span class="spec-pct">' + pct + '%</span>' +
                '  </div>' +
                '  <div class="spec-bar"><div class="spec-bar-fill" style="width:' + pct + '%"></div></div>' +
                renderStageBar(spec, specsState.stalenessAvailable) +
                next +
                body +
                '</div>';
        }).join('');
    }

    function onSpecsListClick(e) {
        var btn = e.target.closest('[data-act]');
        var card = e.target.closest('.spec-card');
        if (!btn || !card) return;
        var act = btn.getAttribute('data-act');
        var id = card.getAttribute('data-id');
        var dir = card.getAttribute('data-dir');

        if (act === 'toggle') {
            var slug = card.getAttribute('data-slug');
            specsExpanded[slug] = !specsExpanded[slug];
            renderSpecs();
        } else if (act === 'queue-cloud') {
            e.preventDefault();
            e.stopPropagation();
            vscode.postMessage({ type: 'queueCloudTask', slug: btn.getAttribute('data-spec-slug'), taskId: btn.getAttribute('data-ref') });
        } else if (act === 'implement-ref') {
            e.preventDefault();
            e.stopPropagation();
            prefillChat('/implement ' + btn.getAttribute('data-ref'));
        } else if (act === 'sk') {
            e.preventDefault();
            e.stopPropagation();
            prefillChat(btn.getAttribute('data-cmd') + ' ' + id);
        } else if (act === 'open-spec') {
            e.preventDefault();
            vscode.postMessage({ type: 'openSpecFile', dir: dir, file: 'spec.md' });
        } else if (act === 'open-plan') {
            e.preventDefault();
            vscode.postMessage({ type: 'openSpecFile', dir: dir, file: 'plan.md' });
        } else if (act === 'open-tasks') {
            e.preventDefault();
            vscode.postMessage({ type: 'openSpecFile', dir: dir, file: 'tasks.md' });
        }
    }

    function prefillChat(text) {
        switchTab('aitalk');
        var input = document.querySelector('#aitalk-root textarea');
        if (!input) return;
        input.value = text + ' ';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function initWorkerTabs() {
        // Tab switching
        var tabs = document.querySelectorAll('.widget-tab');
        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                switchTab(tab.getAttribute('data-tab'));
            });
        });
        var health = document.querySelector('.health-metrics');
        if (health) health.addEventListener('click', function() { switchTab('observability'); });
        var attribution = document.getElementById('cost-attribution-toggle');
        if (attribution) attribution.addEventListener('click', function() { switchTab('observability'); });

        ['command', 'subagent'].forEach(function(role) {
            // Run/Autopilot button
            var runBtn = document.getElementById(role + '-autopilot-btn');
            if (runBtn) runBtn.addEventListener('click', function() { workerAutopilot(role); });

            // Submit manual
            var submitBtn = document.getElementById(role + '-submit-btn');
            if (submitBtn) submitBtn.addEventListener('click', function() { workerSubmit(role); });

            // Per-panel autopilot toggle
            var autoToggle = document.getElementById(role + '-autopilot-toggle');
            if (autoToggle) {
                autoToggle.addEventListener('click', function() { toggleWorkerAutopilot(role); });
                autoToggle.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWorkerAutopilot(role); }
                });
            }

            // Model select + effort change → update formed label
            var modelSel = document.getElementById(role + '-model-select');
            if (modelSel) modelSel.addEventListener('change', function() { updateFormedModelLabel(role); });
            var effortSel = document.getElementById(role + '-effort-select');
            if (effortSel) effortSel.addEventListener('change', function() { updateFormedModelLabel(role); });

            // Tools panel header toggle
            var toolsBtn = document.getElementById(role + '-tools-header-btn');
            if (toolsBtn) toolsBtn.addEventListener('click', function() { toggleToolsPanel(role); });
        });

        // Task card click → select it
        document.addEventListener('click', function(e) {
            var card = e.target.closest('.worker-task-card');
            if (!card) return;
            var role = card.getAttribute('data-role');
            var id = card.getAttribute('data-id');
            if (role && id) selectWorkerTask(role, id);
        });

        // Request models from extension
        vscode.postMessage({ type: 'requestModels' });
        updateWorkerManualControlsVisibility('command');
        updateWorkerManualControlsVisibility('subagent');
    }

    function switchTab(tab) {
        if (tab === 'aitalk') vscode.postMessage({ type: 'requestAITalk' });
        currentTab = tab;
        var isTeam = tab === 'team' || tab === 'workers';
        document.querySelectorAll('.widget-tab').forEach(function(btn) {
            var dt = btn.getAttribute('data-tab');
            btn.classList.toggle('active', dt === tab || (isTeam && (dt === 'team' || dt === 'workers')));
        });
        document.querySelectorAll('.tab-panel').forEach(function(panel) {
            panel.classList.toggle('active', panel.id === 'panel-' + tab || (isTeam && (panel.id === 'panel-team' || panel.id === 'panel-workers')));
        });
        if (tab === 'subagents') {
            populateModelSelect('subagent-model-select');
            updateFormedModelLabel('subagent');
            if (workerToolsExpanded.subagent) renderToolsPicker('subagent');
        } else if (tab === 'commands') {
            populateModelSelect('command-model-select');
            updateFormedModelLabel('command');
            if (workerToolsExpanded.command) renderToolsPicker('command');
        } else if (tab === 'settings') {
            vscode.postMessage({ type: 'openSettingsModal' });
        } else if (tab === 'observability') {
            updateObservabilityUI();
        } else if (tab === 'specs') {
            vscode.postMessage({ type: 'requestSpecs' });
        }
        if (isTeam) {
            vscode.postMessage({ type: 'requestWorkersState' });
        }
        if (tab === 'settings') {
            vscode.postMessage({ type: 'requestCommentary' });
        }
    }

    function updateTabBadges() {
        var cmdCount = workerTasks.filter(function(t) { return t.role === 'command' && t.status !== 'done'; }).length;
        var agentCount = workerTasks.filter(function(t) { return t.role === 'subagent' && t.status !== 'done'; }).length;

        var cmdBadge = document.getElementById('tab-badge-commands');
        var agentBadge = document.getElementById('tab-badge-subagents');

        if (cmdBadge) {
            cmdBadge.textContent = cmdCount;
            cmdBadge.classList.toggle('hidden', cmdCount === 0);
        }
        if (agentBadge) {
            agentBadge.textContent = agentCount;
            agentBadge.classList.toggle('hidden', agentCount === 0);
        }
    }

    /** Set default model for a role from the first available model (deduplicated by backend) */
    function initWorkerModelDefault(role) {
        if (!workerSelectedModelId[role] && availableModels.length > 0) {
            workerSelectedModelId[role] = availableModels[0].id;
        }
        populateModelSelect(role + '-model-select');
        updateFormedModelLabel(role);
    }

    /** Populate model select with clean deduplicated names */
    function populateModelSelect(selectId) {
        var sel = document.getElementById(selectId);
        if (!sel) return;
        var role = selectId.replace('-model-select', '');
        var prev = workerSelectedModelId[role] || sel.value;
        sel.innerHTML = '';
        if (availableModels.length === 0) {
            sel.innerHTML = '<option value="">No models available</option>';
            return;
        }
        availableModels.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            sel.appendChild(opt);
        });
        if (prev && Array.from(sel.options).some(function(o) { return o.value === prev; })) {
            sel.value = prev;
            workerSelectedModelId[role] = prev;
        } else if (availableModels.length > 0) {
            sel.value = availableModels[0].id;
            workerSelectedModelId[role] = availableModels[0].id;
        }
        updateFormedModelLabel(role);
    }

    /** Build and display "ModelName · Med" label */
    function updateFormedModelLabel(role) {
        var modelSel = document.getElementById(role + '-model-select');
        var effortSel = document.getElementById(role + '-effort-select');
        var label = document.getElementById(role + '-formed-model');
        if (!label) return;

        var modelName = modelSel && modelSel.selectedOptions[0] ? modelSel.selectedOptions[0].textContent.trim() : '';
        if (modelSel) workerSelectedModelId[role] = modelSel.value;
        var effort = effortSel ? effortSel.value : 'medium';
        var effortDisplay = { low: 'Low ⚡', medium: 'Med', high: 'High 🔥' }[effort] || effort;

        label.textContent = modelName ? modelName + ' · ' + effortDisplay : '—';
    }

    // ── Tool picker ──────────────────────────────────────────

    /** Toggle the tools panel header open/closed */
    function toggleToolsPanel(role) {
        workerToolsExpanded[role] = !workerToolsExpanded[role];
        var body = document.getElementById(role + '-tools-body');
        var chevron = document.getElementById(role + '-tools-chevron');
        var btn = document.getElementById(role + '-tools-header-btn');
        if (body) body.classList.toggle('hidden', !workerToolsExpanded[role]);
        if (btn) btn.setAttribute('aria-expanded', workerToolsExpanded[role] ? 'true' : 'false');
        if (chevron) {
            chevron.classList.toggle('codicon-chevron-right', !workerToolsExpanded[role]);
            chevron.classList.toggle('codicon-chevron-down', workerToolsExpanded[role]);
        }
        if (workerToolsExpanded[role]) renderToolsPicker(role);
    }

    /**
     * Build a picker shape aligned to Copilot's tool picker buckets:
     * - Built-In bucket first
     * - Other buckets derived from tool source tags
     * - Built-In renders direct tool-key rows (agent, browser, edit, execute, ...)
     */
    function groupTools(tools) {
        var builtInToolOrder = ['agent', 'browser', 'edit', 'execute', 'read', 'search', 'todo', 'vscode', 'web', 'memory'];
        var genericTags = new Set(['vscode', 'copilot', 'tool', 'tools', 'built-in', 'builtin', 'mcp', 'internal', 'extension', 'user']);

        function normalizeTags(rawTags) {
            return Array.isArray(rawTags) ? rawTags.map(function(t) { return String(t).toLowerCase(); }) : [];
        }

        function getToolKey(tool) {
            var n = String(tool.name || '').toLowerCase();
            var first = n.split(/[._:/-]/)[0] || n;
            if (builtInToolOrder.indexOf(first) >= 0) return first;
            if (n.indexOf('todo') >= 0) return 'todo';
            if (n.indexOf('browser') >= 0) return 'browser';
            if (n.indexOf('edit') >= 0) return 'edit';
            if (n.indexOf('execute') >= 0 || n.indexOf('terminal') >= 0 || n.indexOf('command') >= 0) return 'execute';
            if (n.indexOf('read') >= 0) return 'read';
            if (n.indexOf('search') >= 0) return 'search';
            if (n.indexOf('agent') >= 0) return 'agent';
            if (n.indexOf('web') >= 0) return 'web';
            if (n.indexOf('vscode') >= 0) return 'vscode';
            return first || 'vscode';
        }

        function inferBucket(tool, tags) {
            var i;

            if (tags.indexOf('built-in') >= 0 || tags.indexOf('builtin') >= 0 || tags.indexOf('internal') >= 0) {
                return { name: 'Built-In', type: 'built-in' };
            }
            if (builtInToolOrder.indexOf(getToolKey(tool)) >= 0) {
                return { name: 'Built-In', type: 'built-in' };
            }

            for (i = 0; i < tags.length; i++) {
                if (tags[i].indexOf('mcp:') === 0) {
                    return { name: tags[i].slice(4) || 'MCP Server', type: 'mcp' };
                }
                if (tags[i].indexOf('server:') === 0) {
                    return { name: tags[i].slice(7) || 'MCP Server', type: 'mcp' };
                }
            }
            if (tags.indexOf('mcp') >= 0) {
                return { name: 'MCP Server', type: 'mcp' };
            }

            for (i = 0; i < tags.length; i++) {
                if (tags[i].indexOf('extension:') === 0) {
                    return { name: tags[i].slice(10) || 'Extension', type: 'extension' };
                }
            }
            if (tags.indexOf('extension') >= 0) {
                return { name: 'Extension', type: 'extension' };
            }

            if (tags.indexOf('user') >= 0 || tags.indexOf('toolset') >= 0) {
                return { name: 'User Defined Tool Sets', type: 'user' };
            }

            for (i = 0; i < tags.length; i++) {
                if (!genericTags.has(tags[i])) {
                    return { name: tags[i], type: 'external' };
                }
            }

            return { name: 'Extension', type: 'extension' };
        }

        var result = {}; // { bucketName: { type, tools, builtInRows } }
        tools.forEach(function(tool) {
            var tags = normalizeTags(tool.tags);
            var bucket = inferBucket(tool, tags);
            if (!result[bucket.name]) {
                result[bucket.name] = {
                    type: bucket.type,
                    tools: [],
                    builtInRows: {}
                };
            }
            result[bucket.name].tools.push(tool);
            if (bucket.type === 'built-in') {
                var key = getToolKey(tool);
                if (!result[bucket.name].builtInRows[key]) result[bucket.name].builtInRows[key] = [];
                result[bucket.name].builtInRows[key].push(tool);
            }
        });

        return result;
    }

    /** Render the grouped per-panel tool picker */
    function renderToolsPicker(role) {
        var body = document.getElementById(role + '-tools-body');
        var headerLabel = document.getElementById(role + '-tools-label');
        if (!body) return;

        var totalTools = availableTools.length;
        var selectedSet = workerSelectedTools[role];
        var selectedCount = selectedSet ? selectedSet.size : totalTools;
        if (headerLabel) {
            headerLabel.textContent = selectedCount + '/' + totalTools + ' tools selected';
        }

        if (totalTools === 0) {
            body.innerHTML = '<div class="worker-tools-empty">No tools registered. Enable MCP servers or VS Code tools first.</div>';
            return;
        }

        var grouped = groupTools(availableTools);
        var html = '<div class="tools-picker">';
        var topGroupNames = Object.keys(grouped).sort(function(a, b) {
            if (a === 'Built-In') return -1;
            if (b === 'Built-In') return 1;
            return a.localeCompare(b);
        });

        topGroupNames.forEach(function(topGroupName) {
            var group = grouped[topGroupName];
            var topTools = group.tools;

            var topAll = topTools.every(function(t) { return !selectedSet || selectedSet.has(t.name); });
            var topSome = !topAll && topTools.some(function(t) { return !selectedSet || selectedSet.has(t.name); });
            var topState = topAll ? 'all' : (topSome ? 'some' : 'none');

            var topKey = topGroupName;
            var topExpanded = workerGroupsExpanded[role].has(topKey);
            var et = escapeHtml(topGroupName);

            html += '<div class="tools-group tools-top-group">';
            html += '<div class="tools-group-header" data-role="' + role + '" data-group="' + escapeHtml(topKey) + '">';
            html += '<span class="tools-group-check ' + topState + '" data-role="' + role + '" data-group="' + escapeHtml(topKey) + '"></span>';
            html += '<span class="tools-group-name">' + et + '</span>';
            html += '<span class="tools-group-count">' + topTools.length + '</span>';
            html += '<span class="codicon ' + (topExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right') + ' tools-group-chevron"></span>';
            html += '</div>';
            html += '<div class="tools-group-items tools-top-items' + (topExpanded ? '' : ' hidden') + '">';

            if (group.type === 'built-in') {
                var order = ['agent', 'browser', 'edit', 'execute', 'read', 'search', 'todo', 'vscode', 'web', 'memory'];
                var rowKeys = Object.keys(group.builtInRows).sort(function(a, b) {
                    var ai = order.indexOf(a);
                    var bi = order.indexOf(b);
                    if (ai === -1 && bi === -1) return a.localeCompare(b);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                });

                rowKeys.forEach(function(rowKey) {
                    var rowTools = group.builtInRows[rowKey];
                    var rowAll = rowTools.every(function(t) { return !selectedSet || selectedSet.has(t.name); });
                    var rowCount = rowTools.length;

                    html += '<div class="tools-item tools-item-builtinkey">';
                    html += '<input type="checkbox" class="tools-item-check" data-role="' + role + '" data-builtinkey="' + escapeHtml(topGroupName + '::' + rowKey) + '" ' + (rowAll ? 'checked' : '') + '>';
                    html += '<div class="tools-item-info"><span class="tools-item-name">' + escapeHtml(rowKey) + '</span>';
                    if (rowCount > 1) html += '<span class="tools-item-desc">' + rowCount + ' tools</span>';
                    html += '</div></div>';
                });
            } else {
                // Copilot-like shape for non-built-ins: top group -> tools directly.
                topTools.forEach(function(t) {
                    var checked = !selectedSet || selectedSet.has(t.name);
                    html += '<div class="tools-item tools-item-external">';
                    html += '<input type="checkbox" class="tools-item-check" data-role="' + role + '" data-name="' + escapeHtml(t.name) + '" ' + (checked ? 'checked' : '') + '>';
                    html += '<div class="tools-item-info"><span class="tools-item-name">' + escapeHtml(t.name) + '</span>';
                    if (t.description) html += '<span class="tools-item-desc">' + escapeHtml(t.description.slice(0, 90)) + '</span>';
                    html += '</div></div>';
                });
            }

            html += '</div></div>';
        });
        html += '</div>';
        body.innerHTML = html;

        body.querySelectorAll('.tools-group-header').forEach(function(header) {
            header.addEventListener('click', function(e) {
                if (e.target.classList.contains('tools-group-check')) return;
                var r = header.getAttribute('data-role');
                var g = header.getAttribute('data-group');
                if (workerGroupsExpanded[r].has(g)) { workerGroupsExpanded[r].delete(g); } else { workerGroupsExpanded[r].add(g); }
                renderToolsPicker(r);
            });
        });
        body.querySelectorAll('.tools-group-check').forEach(function(span) {
            span.addEventListener('click', function(e) {
                e.stopPropagation();
                var r = span.getAttribute('data-role');
                var g = span.getAttribute('data-group');
                var grouped2 = groupTools(availableTools);
                var gl = [];
                if (grouped2[g]) {
                    gl = grouped2[g].tools.slice();
                }
                if (!workerSelectedTools[r]) workerSelectedTools[r] = new Set(availableTools.map(function(t) { return t.name; }));
                var allSel = gl.every(function(t) { return workerSelectedTools[r].has(t.name); });
                gl.forEach(function(t) { if (allSel) { workerSelectedTools[r].delete(t.name); } else { workerSelectedTools[r].add(t.name); } });
                if (workerSelectedTools[r].size === availableTools.length) workerSelectedTools[r] = null;
                renderToolsPicker(r);
            });
        });
        body.querySelectorAll('.tools-item-check').forEach(function(chk) {
            chk.addEventListener('change', function() {
                var r = chk.getAttribute('data-role');
                var n = chk.getAttribute('data-name');
                var builtInKey = chk.getAttribute('data-builtinkey');
                if (!workerSelectedTools[r]) workerSelectedTools[r] = new Set(availableTools.map(function(t) { return t.name; }));
                if (builtInKey) {
                    var bits = builtInKey.split('::');
                    var top = bits[0];
                    var key = bits.slice(1).join('::');
                    var grouped3 = groupTools(availableTools);
                    var rowTools = (grouped3[top] && grouped3[top].builtInRows && grouped3[top].builtInRows[key]) ? grouped3[top].builtInRows[key] : [];
                    rowTools.forEach(function(t) {
                        if (chk.checked) {
                            workerSelectedTools[r].add(t.name);
                        } else {
                            workerSelectedTools[r].delete(t.name);
                        }
                    });
                } else {
                    if (chk.checked) { workerSelectedTools[r].add(n); } else { workerSelectedTools[r].delete(n); }
                }
                if (workerSelectedTools[r].size === availableTools.length) workerSelectedTools[r] = null;
                renderToolsPicker(r);
            });
        });

        // Native checkboxes support indeterminate state only via property, not markup.
        body.querySelectorAll('.tools-item-check[data-builtinkey]').forEach(function(chk) {
            var r = chk.getAttribute('data-role');
            var builtInKey = chk.getAttribute('data-builtinkey');
            if (!builtInKey) return;
            var bits = builtInKey.split('::');
            var top = bits[0];
            var key = bits.slice(1).join('::');
            var grouped4 = groupTools(availableTools);
            var rowTools = (grouped4[top] && grouped4[top].builtInRows && grouped4[top].builtInRows[key]) ? grouped4[top].builtInRows[key] : [];
            var allSel = rowTools.length > 0 && rowTools.every(function(t) { return !workerSelectedTools[r] || workerSelectedTools[r].has(t.name); });
            var someSel = !allSel && rowTools.some(function(t) { return !workerSelectedTools[r] || workerSelectedTools[r].has(t.name); });
            chk.indeterminate = someSel;
        });
    }

    /** Toggle per-panel autopilot on/off */
    function toggleWorkerAutopilot(role) {
        workerAutopilotEnabled[role] = !workerAutopilotEnabled[role];
        var toggle = document.getElementById(role + '-autopilot-toggle');
        if (toggle) {
            toggle.classList.toggle('active', workerAutopilotEnabled[role]);
            toggle.setAttribute('aria-checked', workerAutopilotEnabled[role] ? 'true' : 'false');
        }
        updateWorkerManualControlsVisibility(role);
        // If turning ON and there's a pending task, run it automatically
        if (workerAutopilotEnabled[role]) {
            var pending = workerTasks.find(function(t) { return t.role === role && t.status === 'pending'; });
            if (pending) {
                selectWorkerTask(role, pending.id);
                workerAutopilot(role);
            }
        }
    }

    /** Hide/show manual input+submit per panel based on autopilot state */
    function updateWorkerManualControlsVisibility(role) {
        var hideManual = workerAutopilotEnabled[role];
        var input = document.getElementById(role + '-response-input');
        var submitBtn = document.getElementById(role + '-submit-btn');
        if (input) input.style.display = hideManual ? 'none' : '';
        if (submitBtn) submitBtn.style.display = hideManual ? 'none' : '';
    }

    /** Run worker task with selected model/effort */
    function workerAutopilot(role) {
        var id = activeWorkerTaskId[role];
        if (!id) {
            var pending = workerTasks.find(function(t) { return t.role === role && t.status === 'pending'; });
            if (pending) { selectWorkerTask(role, pending.id); id = pending.id; }
        }
        if (!id) return;

        var modelSel = document.getElementById(role + '-model-select');
        var modelId = modelSel ? modelSel.value : (workerSelectedModelId[role] || '');
        if (!modelId && availableModels.length > 0) modelId = availableModels[0].id;
        if (!modelId) return;

        var opts = getWorkerRunOptions(role);
        vscode.postMessage({
            type: 'workerRunAutopilot',
            taskId: id,
            modelId: modelId,
            agentName: opts.agentName,
            thinkingEffort: opts.thinkingEffort
        });
    }

    function getWorkerRunOptions(role) {
        var agentSel = document.getElementById(role + '-agent-select');
        var effortSel = document.getElementById(role + '-effort-select');
        return {
            agentName: agentSel ? agentSel.value : 'default',
            thinkingEffort: effortSel ? effortSel.value : 'medium'
        };
    }

    // ── Tool count display (config opens native VS Code dialog) ──────────────────────────────────────────

    function updateToolsCount(role) {
        // kept for any legacy call sites — no-op now that count is in renderToolsPicker header
    }

    // groupTools is defined above with two-level hierarchy; keep single source of truth.

    // ── Queue / task rendering ───────────────────────────────

    function renderWorkerQueue(role) {
        var listId = role === 'command' ? 'command-task-list' : 'subagent-task-list';
        var list = document.getElementById(listId);
        if (!list) return;

        var tasks = workerTasks.filter(function(t) { return t.role === role; });
        if (tasks.length === 0) {
            list.innerHTML = '<div class="worker-empty">No pending ' + (role === 'command' ? 'commands' : 'agent tasks') + '</div>';
            return;
        }

        list.innerHTML = tasks.map(function(t) {
            var summary = t.task.length > 120 ? t.task.slice(0, 120) + '…' : t.task;
            var isActive = activeWorkerTaskId[role] === t.id;
            var statusLabel = t.status === 'running' ? 'Running…' : t.status === 'done' ? '✓ Done' : 'Pending';
            return '<div class="worker-task-card' + (isActive ? ' active-task' : '') + '" data-id="' + t.id + '" data-role="' + role + '">' +
                '<div class="worker-task-card-header">' +
                '<span class="worker-task-role">' + (role === 'command' ? 'CMD' : 'AGENT') + '</span>' +
                '<span class="worker-task-status ' + t.status + '">' + statusLabel + '</span>' +
                '</div>' +
                '<div class="worker-task-summary">' + escapeHtml(summary) + '</div>' +
                '</div>';
        }).join('');
    }

    function selectWorkerTask(role, id) {
        activeWorkerTaskId[role] = id;
        var task = workerTasks.find(function(t) { return t.id === id; });
        if (!task) return;

        var displayId = role === 'command' ? 'command-task-display' : 'subagent-task-display';
        var textId = role === 'command' ? 'command-task-text' : 'subagent-task-text';
        var display = document.getElementById(displayId);
        var textEl = document.getElementById(textId);

        if (display) display.classList.remove('hidden');
        if (textEl) textEl.textContent = task.task;

        renderWorkerQueue(role);
    }

    function workerSubmit(role) {
        var id = activeWorkerTaskId[role];
        if (!id) {
            var pending = workerTasks.find(function(t) { return t.role === role && t.status === 'pending'; });
            if (pending) { selectWorkerTask(role, pending.id); id = pending.id; }
        }
        if (!id) return;

        var inputId = role === 'command' ? 'command-response-input' : 'subagent-response-input';
        var input = document.getElementById(inputId);
        var result = input ? input.value.trim() : '';
        if (!result) return;

        vscode.postMessage({ type: 'workerResolveManual', taskId: id, result: result });
        if (input) input.value = '';
        activeWorkerTaskId[role] = null;

        var displayId = role === 'command' ? 'command-task-display' : 'subagent-task-display';
        var display = document.getElementById(displayId);
        if (display) display.classList.add('hidden');
    }

    function handleWorkerQueueUpdate(tasks) {
        workerTasks = tasks || [];
        renderWorkerQueue('command');
        renderWorkerQueue('subagent');
        updateTabBadges();
        updateObservabilityUI();

        ['command', 'subagent'].forEach(function(role) {
            if (!activeWorkerTaskId[role]) {
                var pending = workerTasks.find(function(t) { return t.role === role && t.status === 'pending'; });
                if (pending) selectWorkerTask(role, pending.id);
            }
            // If autopilot is on and a new pending task arrives, run it
            if (workerAutopilotEnabled[role]) {
                var pending = workerTasks.find(function(t) { return t.role === role && t.status === 'pending'; });
                if (pending) {
                    selectWorkerTask(role, pending.id);
                    workerAutopilot(role);
                }
            }
        });
    }

    // ══════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
