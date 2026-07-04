(() => {
  'use strict';

  const SITE_CONFIGS = {
    chatgpt: {
      editableSelectors: [
        'textarea#prompt-textarea',
        'textarea[data-testid="prompt-textarea"]',
        'div[contenteditable="true"][data-testid="prompt-textarea"]',
        'div#prompt-textarea[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-placeholder]'
      ],
      sendButtonSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="送信" i]'
      ],
      editableGuard: (el) => isChatGPTComposer(el)
    },
    claude: {
      editableSelectors: [
        'div[contenteditable="true"][data-testid*="chat-input" i]',
        'div[contenteditable="true"][aria-label*="message" i]',
        'div[contenteditable="true"][aria-label*="prompt" i]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="message" i]',
        'textarea[placeholder*="message" i]'
      ],
      sendButtonSelectors: [
        'button[aria-label*="send" i]',
        'button[data-testid*="send" i]',
        'button[type="submit"]'
      ],
      editableGuard: (el) => isClaudeComposer(el)
    },
    gemini: {
      editableSelectors: [
        'textarea[aria-label*="prompt" i]',
        'textarea[aria-label*="message" i]',
        'div[contenteditable="true"][role="textbox"][aria-label]'
      ],
      sendButtonSelectors: [
        'button[aria-label*="send" i]'
      ]
    },
    perplexity: {
      editableSelectors: [
        'textarea[aria-label*="ask" i]',
        'textarea[placeholder*="ask" i]',
        'textarea[aria-label*="message" i]',
        'textarea[placeholder*="message" i]',
        'textarea[aria-label*="search" i]',
        'textarea[placeholder*="search" i]',
        'div[contenteditable="true"][role="textbox"]'
      ],
      sendButtonSelectors: [
        'button[aria-label*="send" i]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="ask" i]',
        'button[type="submit"]'
      ]
    },
    messenger: {
      editableSelectors: [
        'div[role="textbox"][contenteditable="true"]'
      ],
      sendButtonSelectors: [
        '[role="button"][aria-label*="send" i]',
        'button[aria-label*="send" i]',
        '[role="button"][aria-label*="送信" i]',
        'button[aria-label*="送信" i]',
        'div[aria-label*="Press Enter to send" i]'
      ],
      editableGuard: (el) => isMessengerComposer(el)
    }
  };

  const site = detectSite();
  if (!site) {
    return;
  }

  const settingsHelper = globalThis.SILHackSettings;
  let runtimeSettings = settingsHelper?.normalizeSettings
    ? settingsHelper.normalizeSettings()
    : {
        sites: { chatgpt: true, claude: true, gemini: true, perplexity: true, messenger: true, chatwork: true },
        sendMode: 'newline',
        geminiPreferredMode: 'pro',
        messengerCompositionGuardMs: 160,
        chatworkMarkdownAutoPaste: false
      };
  let listenersRegistered = false;
  let config = SITE_CONFIGS[site];
  let editableSelectorList = config.editableSelectors.join(',');
  let ignoreSynthetic = false;
  let enterHandledOnKeydown = false;
  let messengerLastComposingEnterAt = 0;
  let messengerCompositionEnterGuardUntil = 0;
  let messengerCompositionEnterGuardTimerId = 0;
  let geminiModeObserver = null;
  let geminiModeTimerId = 0;
  let geminiModeRouteKey = '';
  let geminiModeAttempts = 0;
  let geminiModeSettled = false;
  let geminiModeMenuPending = false;

  const GEMINI_MODE_MAX_ATTEMPTS = 12;
  const GEMINI_MODE_RETRY_DELAY_MS = 900;
  const GEMINI_MODE_MENU_DELAY_MS = 220;
  const GEMINI_MODE_CONFIRM_DELAY_MS = 700;
  const MESSENGER_COMPOSING_ENTER_PROCESSED_WINDOW_MS = 50;

  boot();

  function boot() {
    const settingsPromise = settingsHelper?.loadSettings
      ? settingsHelper.loadSettings()
      : Promise.resolve(runtimeSettings);
    settingsPromise
      .then((settings) => {
        runtimeSettings = normalizeRuntimeSettings(settings);
        registerEventListeners();
      })
      .catch(() => {
        runtimeSettings = normalizeRuntimeSettings(runtimeSettings);
        registerEventListeners();
      });
  }

  function registerEventListeners() {
    if (listenersRegistered) {
      return;
    }
    listenersRegistered = true;
    document.addEventListener('keydown', handleKeydown, true);
    if (site === 'messenger' || site === 'perplexity' || site === 'chatgpt' || site === 'claude') {
      document.addEventListener('keyup', handleKeyup, true);
    }
    window.addEventListener('blur', () => {
      enterHandledOnKeydown = false;
    }, true);
    if (site === 'messenger') {
      document.addEventListener('compositionend', handleCompositionEnd, true);
    }
    if (site === 'gemini' && isCurrentSiteEnabled()) {
      startGeminiModeAutoSelect();
    }
    registerSettingsChangeListener();
  }

  function registerSettingsChangeListener() {
    if (!globalThis.chrome?.storage?.onChanged || !settingsHelper?.STORAGE_KEY) {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[settingsHelper.STORAGE_KEY]) {
        return;
      }
      runtimeSettings = normalizeRuntimeSettings(changes[settingsHelper.STORAGE_KEY].newValue);
      enterHandledOnKeydown = false;
      if (site === 'gemini') {
        if (isCurrentSiteEnabled()) {
          geminiModeSettled = false;
          geminiModeAttempts = 0;
          resumeGeminiModeSelection(250);
        } else {
          settleGeminiModeSelection();
        }
      }
    });
  }

  function normalizeRuntimeSettings(settings) {
    if (settingsHelper?.normalizeSettings) {
      return settingsHelper.normalizeSettings(settings);
    }
    return settings || runtimeSettings;
  }

  function isCurrentSiteEnabled() {
    return runtimeSettings?.sites?.[site] !== false;
  }

  function isSendModeEnterSends() {
    return runtimeSettings?.sendMode === 'send';
  }

  function isPlainEnter(event) {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  }

  function isSendShortcut(event) {
    return event.ctrlKey || event.metaKey;
  }

  function isNativeNewlineShortcut(event) {
    return event.shiftKey || event.altKey;
  }

  function shouldSendOnEnter(event) {
    if (isNativeNewlineShortcut(event)) {
      return false;
    }
    return isSendModeEnterSends() ? isPlainEnter(event) : isSendShortcut(event);
  }

  function getMessengerCompositionGuardMs() {
    const guardMs = Number(runtimeSettings?.messengerCompositionGuardMs);
    if (Number.isFinite(guardMs)) {
      return Math.max(0, Math.min(1000, Math.round(guardMs)));
    }
    return 160;
  }

  function handleKeydown(event) {
    if (ignoreSynthetic) {
      return;
    }
    if (!isCurrentSiteEnabled()) {
      return;
    }
    if (site === 'messenger' && (event.key === 'Enter' || event.code === 'Enter') && (event.isComposing || event.keyCode === 229)) {
      noteMessengerComposingEnter(event);
    }
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) {
      return;
    }

    const editable = findEditableFromEvent(event, editableSelectorList);
    if (!editable) {
      return;
    }
    if (config.editableGuard && !config.editableGuard(editable)) {
      return;
    }
    if (site === 'messenger' && isPlainEnter(event) && shouldConsumeMessengerCompositionEnter()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      return;
    }

    if (site === 'messenger') {
      // If an autocomplete/mention picker is open, let Messenger handle Enter to confirm selection.
      if (isPlainEnter(event) && isAutocompletePickerOpen(editable)) {
        return;
      }

      if (shouldSendOnEnter(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        enterHandledOnKeydown = true;
        triggerSend(editable);
        return;
      }

      if (isNativeNewlineShortcut(event)) {
        return;
      }

      // Messenger's native beforeinput fallback is unreliable immediately after IME composition.
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      insertNewline(editable);
      return;
    }

    if (site === 'perplexity' || site === 'chatgpt' || site === 'claude') {
      if (isPlainEnter(event) && isAutocompletePickerOpen(editable)) {
        return;
      }

      // These editors use JS handlers for Enter-to-send. ChatGPT needs an explicit newline now;
      // Perplexity/Claude still keep native plain-Enter editing unless the shortcut is inverted.
      if (shouldSendOnEnter(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        enterHandledOnKeydown = true;
        triggerSend(editable);
        return;
      }

      if (isNativeNewlineShortcut(event)) {
        return;
      }

      if (site === 'chatgpt' || !isPlainEnter(event)) {
        event.preventDefault();
        insertNewline(editable, { editorShortcut: site === 'chatgpt' });
      }
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      return;
    }

    if (site === 'gemini') {
      if (isPlainEnter(event) && isAutocompletePickerOpen(editable)) {
        return;
      }
      if (shouldSendOnEnter(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        triggerSend(editable);
        return;
      }
      if (isNativeNewlineShortcut(event)) {
        return;
      }
      if (!isPlainEnter(event)) {
        event.preventDefault();
        insertNewline(editable);
      }
      event.stopImmediatePropagation();
      return;
    }

    if (shouldSendOnEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      triggerSend(editable);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    insertNewline(editable);
  }

  function handleKeyup(event) {
    if (ignoreSynthetic) {
      return;
    }
    if (!enterHandledOnKeydown) {
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    // Some handlers run on keyup; block them only when we handled the keydown.
    event.preventDefault();
    event.stopImmediatePropagation();
    enterHandledOnKeydown = false;
  }

  function handleCompositionEnd(event) {
    if (!isCurrentSiteEnabled()) {
      return;
    }
    const editable = findEditableFromEvent(event, editableSelectorList);
    if (!editable || (config.editableGuard && !config.editableGuard(editable))) {
      return;
    }
    if (wasMessengerCompositionEnterAlreadyHandled()) {
      clearMessengerCompositionEnterGuard();
      return;
    }

    const guardMs = getMessengerCompositionGuardMs();
    if (guardMs <= 0) {
      clearMessengerCompositionEnterGuard();
      return;
    }
    messengerCompositionEnterGuardUntil = performance.now() + guardMs;
    if (messengerCompositionEnterGuardTimerId) {
      window.clearTimeout(messengerCompositionEnterGuardTimerId);
    }
    messengerCompositionEnterGuardTimerId = window.setTimeout(() => {
      messengerCompositionEnterGuardTimerId = 0;
      if (performance.now() >= messengerCompositionEnterGuardUntil) {
        messengerCompositionEnterGuardUntil = 0;
      }
    }, guardMs + 20);
  }

  function noteMessengerComposingEnter(event) {
    const editable = findEditableFromEvent(event, editableSelectorList);
    if (!editable || (config.editableGuard && !config.editableGuard(editable))) {
      return;
    }
    messengerLastComposingEnterAt = performance.now();
  }

  function wasMessengerCompositionEnterAlreadyHandled() {
    const lastComposingEnterAt = messengerLastComposingEnterAt;
    messengerLastComposingEnterAt = 0;
    return Boolean(
      lastComposingEnterAt &&
      performance.now() - lastComposingEnterAt <= MESSENGER_COMPOSING_ENTER_PROCESSED_WINDOW_MS
    );
  }

  function shouldConsumeMessengerCompositionEnter() {
    const guardUntil = messengerCompositionEnterGuardUntil;
    if (!guardUntil) {
      return false;
    }

    clearMessengerCompositionEnterGuard();
    return performance.now() <= guardUntil;
  }

  function clearMessengerCompositionEnterGuard() {
    messengerCompositionEnterGuardUntil = 0;
    if (messengerCompositionEnterGuardTimerId) {
      window.clearTimeout(messengerCompositionEnterGuardTimerId);
      messengerCompositionEnterGuardTimerId = 0;
    }
  }

  function startGeminiModeAutoSelect() {
    armGeminiModeObserver();
    window.addEventListener('focus', () => resumeGeminiModeSelection(400), true);
    window.addEventListener('pageshow', () => resumeGeminiModeSelection(500), true);
    window.addEventListener('popstate', () => resumeGeminiModeSelection(500), true);
    document.addEventListener('focusin', () => resumeGeminiModeSelection(300), true);
    scheduleGeminiModeSelection(800);
  }

  function armGeminiModeObserver() {
    if (geminiModeObserver || !document.documentElement) {
      return;
    }
    geminiModeObserver = new MutationObserver(() => {
      scheduleGeminiModeSelection(450);
    });
    geminiModeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function disconnectGeminiModeObserver() {
    if (!geminiModeObserver) {
      return;
    }
    geminiModeObserver.disconnect();
    geminiModeObserver = null;
  }

  function resumeGeminiModeSelection(delayMs) {
    armGeminiModeObserver();
    scheduleGeminiModeSelection(delayMs);
  }

  function settleGeminiModeSelection() {
    geminiModeSettled = true;
    geminiModeMenuPending = false;
    disconnectGeminiModeObserver();
  }

  function scheduleGeminiModeSelection(delayMs = 250) {
    if (site !== 'gemini' || !isCurrentSiteEnabled()) {
      return;
    }
    if (geminiModeTimerId) {
      clearTimeout(geminiModeTimerId);
    }
    geminiModeTimerId = window.setTimeout(runGeminiModeSelection, delayMs);
  }

  function runGeminiModeSelection() {
    geminiModeTimerId = 0;
    if (!isCurrentSiteEnabled()) {
      settleGeminiModeSelection();
      return;
    }
    const routeKey = `${window.location.pathname}${window.location.search}`;
    if (routeKey !== geminiModeRouteKey) {
      geminiModeRouteKey = routeKey;
      geminiModeAttempts = 0;
      geminiModeSettled = false;
      geminiModeMenuPending = false;
      armGeminiModeObserver();
    }

    if (geminiModeSettled) {
      disconnectGeminiModeObserver();
      return;
    }
    if (geminiModeAttempts >= GEMINI_MODE_MAX_ATTEMPTS) {
      settleGeminiModeSelection();
      return;
    }

    geminiModeAttempts += 1;
    const status = applyBestGeminiMode();

    if (status === 'done') {
      settleGeminiModeSelection();
      return;
    }

    if (status === 'confirm') {
      geminiModeMenuPending = false;
      scheduleGeminiModeSelection(GEMINI_MODE_CONFIRM_DELAY_MS);
      return;
    }

    if (status === 'wait-menu') {
      geminiModeMenuPending = true;
      scheduleGeminiModeSelection(GEMINI_MODE_MENU_DELAY_MS);
      return;
    }

    if (geminiModeMenuPending) {
      geminiModeMenuPending = false;
    }
    scheduleGeminiModeSelection(GEMINI_MODE_RETRY_DELAY_MS);
  }

  function applyBestGeminiMode() {
    const composer = findGeminiComposer();
    if (!composer) {
      return 'retry';
    }

    const options = findGeminiModeOptions();
    if (options && options.length > 0) {
      if (!geminiModeMenuPending) {
        return 'done';
      }
      const best = findBestGeminiModeOption(options);
      if (!best) {
        return 'retry';
      }
      const selected = options.find((option) => isGeminiModeOptionSelected(option.element));
      if (selected && selected.element === best.element) {
        if (geminiModeMenuPending) {
          selected.element.click();
        }
        return 'done';
      }
      best.element.click();
      return 'confirm';
    }

    const trigger = findGeminiModeTrigger(composer);
    if (!trigger) {
      return 'retry';
    }

    const triggerLabel = readElementLabel(trigger);
    const triggerScore = scoreGeminiModeText(triggerLabel);
    if (isLikelyGeminiModeTrigger(trigger, triggerLabel) && triggerScore >= 3000) {
      return 'done';
    }

    trigger.click();
    return 'wait-menu';
  }

  function findGeminiModeTrigger(composer) {
    if (!composer) {
      return null;
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    let bestCandidate = null;

    for (const candidate of candidates) {
      if (!isVisible(candidate)) {
        continue;
      }
      const label = readElementLabel(candidate);
      const score = scoreGeminiModeText(label);
      if (isGeminiSendButton(candidate, label)) {
        continue;
      }
      if (isGeminiNonModeControl(candidate, label)) {
        continue;
      }
      const hasPopup = candidate.getAttribute('aria-haspopup');
      const hasPopupMenu = hasPopup === 'menu' || hasPopup === 'listbox';
      const hasTouchTarget = Boolean(candidate.querySelector('.mat-mdc-button-touch-target'));
      const isLikelyModeTrigger = isLikelyGeminiModeTrigger(candidate, label);
      // Strictly limit auto-click targets to likely mode switchers only.
      if (!isLikelyModeTrigger) {
        continue;
      }

      let rank = Math.max(0, score);
      rank += 2400;
      if (hasPopupMenu) {
        rank += 600;
      }
      if (hasTouchTarget) {
        rank += 250;
      }
      if (composer) {
        const proximity = scoreElementProximity(candidate, composer);
        rank += proximity;
        const candidateForm = candidate.closest('form');
        const composerForm = composer.closest('form');
        if (candidateForm && composerForm && candidateForm === composerForm) {
          rank += 300;
        }
      }

      if (!bestCandidate || rank > bestCandidate.rank) {
        bestCandidate = { element: candidate, rank };
      }
    }

    return bestCandidate ? bestCandidate.element : null;
  }

  function findGeminiModeOptions() {
    const containers = Array.from(document.querySelectorAll(
      '[role="menu"], [role="listbox"], .cdk-overlay-pane, .mat-mdc-select-panel'
    ));
    let bestSet = null;

    for (const container of containers) {
      if (!isVisible(container)) {
        continue;
      }

      let optionElements = Array.from(container.querySelectorAll(
        '[role="menuitemradio"], [role="option"], [role="menuitem"], mat-option, .mat-mdc-option'
      ));
      if (optionElements.length === 0) {
        optionElements = Array.from(container.querySelectorAll('button, [role="button"]'));
      }
      const scored = [];
      for (const optionElement of optionElements) {
        if (!isVisible(optionElement)) {
          continue;
        }
        if (optionElement.getAttribute('aria-disabled') === 'true') {
          continue;
        }
        if ('disabled' in optionElement && optionElement.disabled) {
          continue;
        }
        const label = readElementLabel(optionElement);
        const score = scoreGeminiModeText(label);
        if (score < 0) {
          continue;
        }
        scored.push({ element: optionElement, label, score });
      }

      if (scored.length < 1) {
        continue;
      }

      const maxScore = Math.max(...scored.map((item) => item.score));
      if (maxScore < 1000) {
        continue;
      }

      const ranking = maxScore * 100 + scored.length;
      if (!bestSet || ranking > bestSet.ranking) {
        bestSet = { ranking, options: scored };
      }
    }

    return bestSet ? bestSet.options : null;
  }

  function findGeminiComposer() {
    const composer = document.querySelector(editableSelectorList);
    if (!composer || !isVisible(composer)) {
      return null;
    }
    return composer;
  }

  function isLikelyGeminiModeTrigger(element, labelText) {
    if (!element) {
      return false;
    }
    const aria = (element.getAttribute('aria-label') || '').trim();
    const raw = `${labelText || ''} ${aria}`.trim();
    if (!raw) {
      return false;
    }
    const hasSwitcherWord = hasGeminiModeSwitcherWord(raw);
    const hasOpenWord = /open|select|開く|選択|selector|switch|切替/i.test(raw);
    const hasModeNameWord = /thinking|reason(?:ing)?|flash|fast|\bpro\b|思考|高速|プロ/i.test(raw);
    if (hasSwitcherWord && hasOpenWord) {
      return true;
    }
    if (hasModeNameWord && hasSwitcherWord) {
      return true;
    }
    if (/モード選択/.test(raw)) {
      return true;
    }
    return false;
  }

  function hasGeminiModeSwitcherWord(text) {
    if (!text) {
      return false;
    }
    return /mode|model|モード|モデル/i.test(text);
  }

  function isGeminiSendButton(element, labelText) {
    if (!element) {
      return false;
    }
    const text = (labelText || readElementLabel(element)).toLowerCase();
    if (text.includes('send') || text.includes('送信')) {
      return true;
    }
    if (element.getAttribute('data-testid') === 'send-button') {
      return true;
    }
    if (element.getAttribute('aria-keyshortcuts') === 'Enter') {
      return true;
    }
    return false;
  }

  function isGeminiNonModeControl(element, labelText) {
    if (!element) {
      return false;
    }
    const label = (labelText || '').trim();
    if (!label) {
      return false;
    }
    if (hasGeminiModeSwitcherWord(label)) {
      return false;
    }

    const lower = label.toLowerCase();
    if (
      lower.includes('main menu') || label.includes('メインメニュー') ||
      lower.includes('search') || label.includes('検索') || label.includes('チャットを検索') ||
      lower.includes('setting') || label.includes('設定') || lower.includes('help') || label.includes('ヘルプ') ||
      lower.includes('upload') || label.includes('アップロード') ||
      lower.includes('microphone') || label.includes('マイク')
    ) {
      return true;
    }
    return false;
  }

  function findBestGeminiModeOption(options) {
    let best = null;
    for (const option of options) {
      if (!best || option.score > best.score) {
        best = option;
      }
    }
    return best;
  }

  function isGeminiModeOptionSelected(optionElement) {
    if (!optionElement || !optionElement.getAttribute) {
      return false;
    }
    if (optionElement.getAttribute('aria-checked') === 'true') {
      return true;
    }
    if (optionElement.getAttribute('aria-selected') === 'true') {
      return true;
    }
    const className = typeof optionElement.className === 'string' ? optionElement.className.toLowerCase() : '';
    if (className.includes('selected') || className.includes('active') || className.includes('checked')) {
      return true;
    }
    if (optionElement.querySelector('.mdc-list-item--selected, .mat-mdc-option-active, .mat-pseudo-checkbox-checked')) {
      return true;
    }
    return false;
  }

  function readElementLabel(element) {
    if (!element) {
      return '';
    }
    const parts = [
      element.getAttribute && element.getAttribute('aria-label'),
      element.getAttribute && element.getAttribute('title'),
      element.getAttribute && element.getAttribute('data-value'),
      element.innerText,
      element.textContent
    ].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function scoreGeminiModeText(text) {
    if (!text) {
      return -1;
    }

    const hasPro = /\bpro\b/i.test(text) || text.includes('プロ');
    const hasThinking =
      /\bthinking\b/i.test(text) ||
      /\breason(?:ing)?\b/i.test(text) ||
      text.includes('思考');
    const hasFast =
      /\bflash\b/i.test(text) ||
      /\bfast\b/i.test(text) ||
      text.includes('高速');
    const hasModelWord = /\bmodel\b/i.test(text) || text.includes('モデル');

    let mode = '';
    if (hasPro) {
      mode = 'pro';
    } else if (hasThinking) {
      mode = 'thinking';
    } else if (hasFast) {
      mode = 'fast';
    } else if (hasModelWord) {
      mode = 'model';
    } else {
      return -1;
    }
    const modeRanks = getGeminiModeRanks();
    const tier = modeRanks[mode] ?? -1;
    if (tier < 0) {
      return -1;
    }

    const versionMatches = text.match(/[0-9]+(?:\.[0-9]+)?/g);
    let versionBonus = 0;
    if (versionMatches && versionMatches.length > 0) {
      const versions = versionMatches
        .map((value) => Number.parseFloat(value))
        .filter((value) => Number.isFinite(value));
      if (versions.length > 0) {
        versionBonus = Math.max(...versions);
      }
    }

    return tier * 1000 + versionBonus;
  }

  function getGeminiModeRanks() {
    const preferred = runtimeSettings?.geminiPreferredMode || 'pro';
    if (preferred === 'fast') {
      return { fast: 3, pro: 2, thinking: 1, model: 0 };
    }
    if (preferred === 'thinking') {
      return { thinking: 3, pro: 2, fast: 1, model: 0 };
    }
    return { pro: 3, thinking: 2, fast: 1, model: 0 };
  }

  function scoreElementProximity(a, b) {
    if (!a || !b || !a.getBoundingClientRect || !b.getBoundingClientRect) {
      return 0;
    }
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    if (aRect.width === 0 || aRect.height === 0 || bRect.width === 0 || bRect.height === 0) {
      return 0;
    }
    const ax = aRect.left + (aRect.width / 2);
    const ay = aRect.top + (aRect.height / 2);
    const bx = bRect.left + (bRect.width / 2);
    const by = bRect.top + (bRect.height / 2);
    const distance = Math.hypot(ax - bx, ay - by);
    return Math.max(0, 900 - distance);
  }

  function detectSite() {
    const host = window.location.hostname;
    if (host === 'chat.openai.com' || host === 'chatgpt.com') {
      return 'chatgpt';
    }
    if (host === 'claude.ai') {
      return 'claude';
    }
    if (host === 'gemini.google.com') {
      return 'gemini';
    }
    if (host === 'www.perplexity.ai' || host === 'perplexity.ai') {
      return 'perplexity';
    }
    if (host === 'www.messenger.com' || host === 'messenger.com') {
      return 'messenger';
    }
    return null;
  }

  function isMessengerComposer(el) {
    if (!el || !el.getAttribute) {
      return false;
    }

    const main = el.closest('[role="main"]');
    if (!main) {
      return false;
    }

    const label = (el.getAttribute('aria-label') || el.getAttribute('aria-placeholder') || '').trim();
    const lower = label.toLowerCase();
    if (lower.includes('message') || label.includes('メッセージ') || label.includes('メッセ') || label.includes('訊息')) {
      return true;
    }

    // Messenger search fields often have "Search" in label/placeholder; avoid those.
    if (lower.includes('search') || label.includes('検索')) {
      return false;
    }

    // If we're in the main thread view and it looks like a composer (contenteditable textbox), accept.
    return true;
  }

  function isChatGPTComposer(el) {
    if (!el || !el.getAttribute) {
      return false;
    }

    const form = el.closest('form');
    if (form) {
      const testid = (form.getAttribute('data-testid') || '').toLowerCase();
      if (testid.includes('conversation') || testid.includes('composer') || testid.includes('prompt')) {
        return true;
      }
      if (findUsableSendButtonInScope(form, SITE_CONFIGS.chatgpt.sendButtonSelectors)) {
        return true;
      }
    }

    const labelRaw = (el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || '').trim();
    const label = labelRaw.toLowerCase();
    if (label) {
      if (label.includes('search') || label.includes('検索')) {
        return false;
      }
      if (label.includes('message') || label.includes('prompt') || label.includes('send') || label.includes('chatgpt')) {
        return isLikelyChatGPTPromptEditable(el) || hasChatGPTComposerSendButton(el);
      }
    }

    return isLikelyChatGPTPromptEditable(el) || hasChatGPTComposerSendButton(el);
  }

  function isClaudeComposer(el) {
    if (!el || !el.getAttribute) {
      return false;
    }

    const labelRaw = (
      el.getAttribute('aria-label') ||
      el.getAttribute('data-placeholder') ||
      el.getAttribute('placeholder') ||
      ''
    ).trim();
    const label = labelRaw.toLowerCase();
    if (label.includes('search') || label.includes('検索')) {
      return false;
    }

    const form = el.closest('form');
    if (form && findUsableSendButtonInScope(form, SITE_CONFIGS.claude.sendButtonSelectors)) {
      return true;
    }

    if (label.includes('message') || label.includes('prompt') || label.includes('claude')) {
      return hasClaudeComposerSendButton(el) || Boolean(el.closest('form'));
    }

    return hasClaudeComposerSendButton(el);
  }

  function isLikelyChatGPTPromptEditable(el) {
    if (!el || !el.getAttribute) {
      return false;
    }
    const id = (el.getAttribute('id') || '').toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    return id === 'prompt-textarea' || testid === 'prompt-textarea';
  }

  function hasChatGPTComposerSendButton(el) {
    const scopes = getEditableLocalScopes(el);
    return scopes.some((scope) => findUsableSendButtonInScope(scope, SITE_CONFIGS.chatgpt.sendButtonSelectors));
  }

  function hasClaudeComposerSendButton(el) {
    const scopes = getEditableLocalScopes(el);
    return scopes.some((scope) => findUsableSendButtonInScope(scope, SITE_CONFIGS.claude.sendButtonSelectors));
  }

  function isAutocompletePickerOpen(editable) {
    try {
      if (editable && editable.getAttribute && editable.getAttribute('aria-activedescendant')) {
        return true;
      }

      for (const scope of getAutocompletePickerScopes(editable)) {
        const listboxes = Array.from(
          scope.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"] [role="listbox"]')
        );
        for (const box of listboxes) {
          if (!isVisible(box)) {
            continue;
          }
          // Many pickers use options/menuitems.
          if (box.querySelector('[role="option"], [role="menuitem"], [role="menuitemradio"]')) {
            return true;
          }
        }
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  function getAutocompletePickerScopes(editable) {
    const scopes = getEditableLocalScopes(editable);
    if (site === 'messenger') {
      addUniqueElement(scopes, editable?.closest?.('[role="main"]'));
    }
    return scopes;
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function findEditableFromEvent(event, selectorList) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const candidates = [event.target, ...path];

    for (const node of candidates) {
      if (!isElement(node)) {
        continue;
      }
      if (node.matches(selectorList)) {
        return node;
      }
      const closest = node.closest(selectorList);
      if (closest) {
        return closest;
      }
    }

    return null;
  }

  function isElement(node) {
    return node && node.nodeType === Node.ELEMENT_NODE;
  }

  function insertNewline(editable, options = {}) {
    const tag = editable.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      insertText(editable, '\n');
      return;
    }

    if (editable.isContentEditable) {
      if (options.editorShortcut) {
        dispatchEditorNewlineShortcut(editable);
        return;
      }

      const inserted = document.execCommand('insertLineBreak') ||
        document.execCommand('insertText', false, '\n');
      if (!inserted) {
        insertLineBreakContentEditable(editable);
      }
      dispatchInput(editable);
    }
  }

  function insertText(editable, text) {
    const value = editable.value || '';
    const start = Number.isInteger(editable.selectionStart) ? editable.selectionStart : value.length;
    const end = Number.isInteger(editable.selectionEnd) ? editable.selectionEnd : value.length;
    const nextValue = value.slice(0, start) + text + value.slice(end);
    const nextPos = start + text.length;

    setNativeTextControlValue(editable, nextValue);
    editable.selectionStart = nextPos;
    editable.selectionEnd = nextPos;
    dispatchInput(editable);
  }

  function setNativeTextControlValue(editable, value) {
    const tag = editable.tagName;
    const prototype = tag === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : tag === 'INPUT'
        ? HTMLInputElement.prototype
        : null;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(editable, value);
      return;
    }
    editable.value = value;
  }

  function insertLineBreakContentEditable(editable) {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      range.setStartAfter(br);
      range.setEndAfter(br);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editable.appendChild(document.createElement('br'));
    }
  }

  function dispatchEditorNewlineShortcut(editable) {
    ignoreSynthetic = true;
    try {
      const beforeHtml = editable.innerHTML;
      editable.focus({ preventScroll: true });
      const eventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      };
      const lineBreakEvent = new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true
      });
      const keydownHandled = !editable.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      editable.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      const lineBreakHandled = !editable.dispatchEvent(lineBreakEvent);
      if (keydownHandled || lineBreakHandled || editable.innerHTML !== beforeHtml) {
        editable.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        return true;
      }
      const paragraphEvent = new InputEvent('beforeinput', {
        inputType: 'insertParagraph',
        bubbles: true,
        cancelable: true
      });
      const paragraphHandled = !editable.dispatchEvent(paragraphEvent);
      editable.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      return paragraphHandled || editable.innerHTML !== beforeHtml;
    } finally {
      ignoreSynthetic = false;
    }
  }

  function dispatchInput(editable) {
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }


  function triggerSend(editable) {
    const button = findSendButton(config.sendButtonSelectors, editable);
    if (button) {
      button.click();
      return;
    }

    const form = editable.closest('form');
    if (form) {
      const submitButton = findUsableSendButtonInScope(form, ['button[type="submit"], input[type="submit"]']);
      if (submitButton) {
        submitButton.click();
        return;
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return;
    }

    dispatchEnter(editable);
  }

  function findSendButton(selectors, editable) {
    const scopedButton = findSendButtonInScopes(selectors, getSendButtonScopes(editable));
    if (scopedButton) {
      return scopedButton;
    }

    const candidates = [];
    for (const selector of selectors) {
      for (const button of document.querySelectorAll(selector)) {
        if (isUsableButton(button)) {
          candidates.push(button);
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }
    if (!editable) {
      return candidates[0];
    }

    let nearest = null;
    for (const candidate of candidates) {
      const rank = scoreElementProximity(candidate, editable);
      if (!nearest || rank > nearest.rank) {
        nearest = { element: candidate, rank };
      }
    }
    return nearest ? nearest.element : candidates[0];
  }

  function findSendButtonInScopes(selectors, scopes) {
    for (const scope of scopes) {
      const button = findUsableSendButtonInScope(scope, selectors);
      if (button) {
        return button;
      }
    }
    return null;
  }

  function findUsableSendButtonInScope(scope, selectors) {
    if (!scope || !scope.querySelectorAll) {
      return null;
    }
    for (const selector of selectors) {
      for (const button of scope.querySelectorAll(selector)) {
        if (isUsableButton(button)) {
          return button;
        }
      }
    }
    return null;
  }

  function getSendButtonScopes(editable) {
    const scopes = getEditableLocalScopes(editable);
    if (site === 'messenger') {
      addUniqueElement(scopes, editable?.closest?.('[role="main"]'));
    }
    return scopes;
  }

  function getEditableLocalScopes(editable) {
    const scopes = [];
    if (!editable || !editable.closest) {
      return scopes;
    }
    addUniqueElement(scopes, editable.closest('form'));
    addUniqueElement(scopes, editable.closest('[role="form"]'));
    addUniqueElement(scopes, editable.closest('[data-testid*="composer" i]'));
    addUniqueElement(scopes, editable.closest('[data-testid*="prompt" i]'));
    addUniqueElement(scopes, editable.closest('[data-testid*="chat-input" i]'));
    addUniqueElement(scopes, editable.closest('[class*="composer" i]'));
    addUniqueElement(scopes, editable.parentElement);
    return scopes;
  }

  function addUniqueElement(elements, element) {
    if (element && !elements.includes(element)) {
      elements.push(element);
    }
  }

  function isUsableButton(button) {
    if (!button || !isVisible(button)) {
      return false;
    }
    if ('disabled' in button && button.disabled) {
      return false;
    }
    if (button.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    return true;
  }

  function dispatchEnter(editable) {
    ignoreSynthetic = true;
    try {
      editable.focus({ preventScroll: true });
      const eventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      };
      editable.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      editable.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      editable.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    } finally {
      ignoreSynthetic = false;
    }
  }
})();
