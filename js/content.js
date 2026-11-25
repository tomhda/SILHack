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
        'button[data-testid="chat-input-send"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="送信" i]',
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
        'button[aria-label*="send" i]',
        'button[aria-label*="送信" i]'
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
        'button[aria-label="送信"]',
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
  const FALLBACK_SITE_KEYS = { enter: 'newline', shift: 'newline', ctrl: 'send' };
  let runtimeSettings = settingsHelper?.normalizeSettings
    ? settingsHelper.normalizeSettings()
    : {
        sites: { chatgpt: true, claude: true, gemini: true, perplexity: true, messenger: true },
        keys: {},
        geminiModel: 'keep',
        geminiThinkingLevel: 'keep',
        messengerCompositionGuardMs: 160,
        chatworkMarkdownAutoPaste: false
      };
  let listenersRegistered = false;
  let settingsLoaded = false;
  let config = SITE_CONFIGS[site];
  let editableSelectorList = config.editableSelectors.join(',');
  let ignoreSynthetic = false;
  let enterHandledOnKeydown = false;
  let messengerLastComposingEnterAt = 0;
  let messengerCompositionEnterGuardUntil = 0;
  let messengerCompositionEnterGuardTimerId = 0;
  let geminiRouteTimerId = 0;
  let geminiLastHref = '';
  let geminiSelectionRunning = false;
  let geminiSelectionQueued = false;

  const MESSENGER_COMPOSING_ENTER_PROCESSED_WINDOW_MS = 50;
  const GEMINI_ROUTE_CHECK_MS = 800;
  const GEMINI_TRIGGER_WAIT_MS = 15000;
  const GEMINI_MENU_WAIT_MS = 2500;
  const GEMINI_MODEL_PATTERNS = {
    auto: /^(auto\b|自動)/i,
    hydrogen: /hydrogen/i,
    neon: /\bneon\b/i,
    carbon: /carbon/i
  };
  const GEMINI_MODEL_DESCRIPTION_PATTERNS = {
    hydrogen: /everyday help|日々の暮らし/i,
    neon: /deeper analysis|詳細な分析/i,
    carbon: /code\s*&\s*complex|コードと複雑/i
  };
  const GEMINI_THINKING_PATTERNS = {
    low: /^(low|低)$/i,
    medium: /^(medium|標準)$/i,
    high: /^(high|高)$/i
  };

  boot();

  function boot() {
    // Register before the page's own scripts so our capture listeners run first.
    registerKeyListeners();
    const settingsPromise = settingsHelper?.loadSettings
      ? settingsHelper.loadSettings()
      : Promise.resolve(runtimeSettings);
    settingsPromise
      .then((settings) => {
        runtimeSettings = normalizeRuntimeSettings(settings);
        settingsLoaded = true;
        registerEventListeners();
      })
      .catch(() => {
        runtimeSettings = normalizeRuntimeSettings(runtimeSettings);
        settingsLoaded = true;
        registerEventListeners();
      });
  }

  function registerKeyListeners() {
    // Listen on window, not document: sites such as ChatGPT bind their own shortcuts
    // (e.g. Ctrl+Enter = send in background) on window, which fires before document.
    window.addEventListener('keydown', handleKeydown, true);
    if (site === 'messenger' || site === 'perplexity' || site === 'chatgpt' || site === 'claude') {
      window.addEventListener('keyup', handleKeyup, true);
    }
    window.addEventListener('blur', () => {
      enterHandledOnKeydown = false;
    }, true);
  }

  function registerEventListeners() {
    if (listenersRegistered) {
      return;
    }
    listenersRegistered = true;
    if (site === 'messenger') {
      document.addEventListener('compositionend', handleCompositionEnd, true);
    }
    if (site === 'gemini') {
      startGeminiModelSelection();
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
      const previous = runtimeSettings;
      runtimeSettings = normalizeRuntimeSettings(changes[settingsHelper.STORAGE_KEY].newValue);
      enterHandledOnKeydown = false;
      if (site === 'gemini' && (
        previous?.sites?.gemini !== runtimeSettings.sites?.gemini ||
        previous?.geminiModel !== runtimeSettings.geminiModel ||
        previous?.geminiThinkingLevel !== runtimeSettings.geminiThinkingLevel
      )) {
        requestGeminiModelSelection();
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

  function isPlainEnter(event) {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  }

  // Returns which assignable key was pressed: 'enter', 'shift' (Shift+Enter),
  // 'ctrl' (Ctrl+Enter, or Cmd+Enter on macOS), or null for any other combination.
  function getEnterCombo(event) {
    if (event.altKey) {
      return null;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.shiftKey) {
      return null;
    }
    if (command) {
      return 'ctrl';
    }
    if (event.shiftKey) {
      return 'shift';
    }
    return 'enter';
  }

  function getKeyAction(combo) {
    const siteKeys = runtimeSettings?.keys?.[site] || FALLBACK_SITE_KEYS;
    return siteKeys[combo] === 'send' ? 'send' : 'newline';
  }

  function getMessengerCompositionGuardMs() {
    const guardMs = Number(runtimeSettings?.messengerCompositionGuardMs);
    if (Number.isFinite(guardMs)) {
      return Math.max(0, Math.min(1000, Math.round(guardMs)));
    }
    return 160;
  }

  function handleKeydown(event) {
    if (ignoreSynthetic || !settingsLoaded) {
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
    const combo = getEnterCombo(event);
    if (!combo) {
      return;
    }

    const editable = findEditableFromEvent(event, editableSelectorList);
    if (!editable) {
      return;
    }
    if (config.editableGuard && !config.editableGuard(editable)) {
      return;
    }
    if (site === 'messenger' && combo === 'enter' && shouldConsumeMessengerCompositionEnter()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      return;
    }

    // If an autocomplete/mention picker is open, let the site handle Enter to confirm the selection.
    if (combo === 'enter' && isAutocompletePickerOpen(editable)) {
      return;
    }

    if (getKeyAction(combo) === 'send') {
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      triggerSend(editable);
      return;
    }

    handleNewlineKey(event, editable, combo);
  }

  function handleNewlineKey(event, editable, combo) {
    // Every supported editor already inserts a line break on Shift+Enter.
    if (combo === 'shift') {
      return;
    }

    if (site === 'messenger') {
      // Messenger's native beforeinput fallback is unreliable immediately after IME composition.
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      insertNewline(editable);
      return;
    }

    if (site === 'chatgpt') {
      event.preventDefault();
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      insertNewline(editable, { editorShortcut: true });
      return;
    }

    // Claude, Perplexity and Gemini: keep the browser's own line break for plain Enter
    // and only hide the key from the site's send handler.
    if (combo !== 'enter') {
      event.preventDefault();
      // Let the editor add the break through its own Shift+Enter handling, so the line
      // matches Shift+Enter. A browser-inserted break replaces the text in Perplexity (Lexical),
      // adds an extra break in Claude (ProseMirror) and bypasses Gemini's editor (Quill).
      insertNewline(editable, { editorShortcut: true });
    }
    event.stopImmediatePropagation();
    enterHandledOnKeydown = true;
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

  // ---- Gemini: pick the preferred model and thinking level -------------------------------
  //
  // The mode picker is the button [data-test-id="bard-mode-menu-button"] next to the prompt.
  // Its text shows the current model and, unless it is Low, the thinking level
  // ("Neon", "Neon 標準", "Carbon High"). The menu lists the models as menuitemradio items and a
  // "思考レベル / Thinking level" item that opens a submenu with Low / Medium / High.
  // Gemini remembers the choice, so the picker is only opened when the button shows something
  // other than the saved preference.

  function startGeminiModelSelection() {
    geminiLastHref = window.location.href;
    if (!geminiRouteTimerId) {
      geminiRouteTimerId = window.setInterval(checkGeminiRoute, GEMINI_ROUTE_CHECK_MS);
    }
    requestGeminiModelSelection();
  }

  function checkGeminiRoute() {
    const href = window.location.href;
    if (href === geminiLastHref) {
      return;
    }
    geminiLastHref = href;
    // Apply again when a new chat opens, but not when a sent message turns /app into /app/<chat id>:
    // the person may have switched the model by hand for that conversation.
    if (isGeminiNewChatPath(window.location.pathname)) {
      requestGeminiModelSelection();
    }
  }

  function isGeminiNewChatPath(pathname) {
    return /^(\/u\/\d+)?\/(app|gem\/[^/]+)\/?$/.test(pathname || '');
  }

  function requestGeminiModelSelection() {
    if (geminiSelectionRunning) {
      geminiSelectionQueued = true;
      return;
    }
    geminiSelectionRunning = true;
    runGeminiModelSelection()
      .catch(() => {})
      .finally(() => {
        geminiSelectionRunning = false;
        if (geminiSelectionQueued) {
          geminiSelectionQueued = false;
          requestGeminiModelSelection();
        }
      });
  }

  function getGeminiTarget() {
    if (!isCurrentSiteEnabled()) {
      return null;
    }
    const model = runtimeSettings?.geminiModel || 'keep';
    const thinking = runtimeSettings?.geminiThinkingLevel || 'keep';
    if (model === 'keep' && thinking === 'keep') {
      return null;
    }
    return { model, thinking };
  }

  async function runGeminiModelSelection() {
    if (!getGeminiTarget()) {
      return;
    }
    const trigger = await waitForValue(findGeminiModeTrigger, GEMINI_TRIGGER_WAIT_MS);
    const target = getGeminiTarget();
    if (!trigger || !target) {
      return;
    }

    const focusedComposer = getFocusedGeminiComposer();
    let changed = false;

    if (target.model !== 'keep' && readGeminiTriggerState(trigger).model !== target.model) {
      changed = (await selectGeminiModel(target.model)) || changed;
    }

    const current = readGeminiTriggerState(findGeminiModeTrigger() || trigger);
    const thinkingAvailable = current.model !== 'auto';
    if (target.thinking !== 'keep' && thinkingAvailable && current.thinking !== target.thinking) {
      changed = (await selectGeminiThinkingLevel(target.thinking)) || changed;
    }

    if (changed && focusedComposer && focusedComposer.isConnected) {
      focusedComposer.focus({ preventScroll: true });
    }
  }

  function findGeminiModeTrigger() {
    const trigger = document.querySelector('[data-test-id="bard-mode-menu-button"]');
    if (trigger && isVisible(trigger) && trigger.getAttribute('aria-disabled') !== 'true' && !trigger.disabled) {
      return trigger;
    }
    return null;
  }

  function getFocusedGeminiComposer() {
    const active = document.activeElement;
    if (active && active.matches && active.matches(editableSelectorList)) {
      return active;
    }
    return null;
  }

  // Reads "Neon", "Neon 標準", "Carbon High" or "自動" from the picker button.
  function readGeminiTriggerState(trigger) {
    const text = (trigger?.innerText || trigger?.textContent || '').replace(/\s+/g, ' ').trim();
    const state = { model: null, thinking: null };
    if (!text) {
      return state;
    }
    for (const [model, pattern] of Object.entries(GEMINI_MODEL_PATTERNS)) {
      if (pattern.test(text)) {
        state.model = model;
        break;
      }
    }
    const words = text.split(' ');
    if (words.length === 1) {
      state.thinking = 'low';
      return state;
    }
    const levelText = words.slice(1).join(' ');
    for (const [level, pattern] of Object.entries(GEMINI_THINKING_PATTERNS)) {
      if (pattern.test(levelText)) {
        state.thinking = level;
        break;
      }
    }
    return state;
  }

  async function selectGeminiModel(model) {
    const items = await openGeminiModeMenu();
    if (!items) {
      return false;
    }
    const option = items.find((item) => item.getAttribute('role') === 'menuitemradio' && matchesGeminiModel(item, model));
    if (!option) {
      closeGeminiModeMenu();
      return false;
    }
    const alreadySelected = option.getAttribute('aria-checked') === 'true';
    option.click();
    await waitForValue(() => !isGeminiModeMenuOpen(), GEMINI_MENU_WAIT_MS);
    if (isGeminiModeMenuOpen()) {
      closeGeminiModeMenu();
    }
    return !alreadySelected;
  }

  async function selectGeminiThinkingLevel(level) {
    const items = await openGeminiModeMenu();
    if (!items) {
      return false;
    }
    const submenuOpener = items.find((item) => item.getAttribute('aria-haspopup') === 'true');
    if (!submenuOpener) {
      closeGeminiModeMenu();
      return false;
    }
    submenuOpener.click();
    const option = await waitForValue(() => findVisibleGeminiThinkingOption(level), GEMINI_MENU_WAIT_MS);
    if (!option) {
      closeGeminiModeMenu();
      return false;
    }
    const alreadySelected = option.getAttribute('aria-checked') === 'true';
    option.click();
    await waitForValue(() => !isGeminiModeMenuOpen(), GEMINI_MENU_WAIT_MS);
    if (isGeminiModeMenuOpen()) {
      closeGeminiModeMenu();
    }
    return !alreadySelected;
  }

  async function openGeminiModeMenu() {
    if (!isGeminiModeMenuOpen()) {
      const trigger = findGeminiModeTrigger();
      if (!trigger) {
        return null;
      }
      trigger.click();
    }
    return waitForValue(() => {
      const items = getGeminiModeMenuItems();
      return items.some((item) => item.getAttribute('role') === 'menuitemradio' && isVisible(item)) ? items : null;
    }, GEMINI_MENU_WAIT_MS);
  }

  function closeGeminiModeMenu() {
    const trigger = document.querySelector('[data-test-id="bard-mode-menu-button"]');
    if (trigger && isGeminiModeMenuOpen()) {
      trigger.click();
    }
  }

  function isGeminiModeMenuOpen() {
    const trigger = document.querySelector('[data-test-id="bard-mode-menu-button"]');
    return trigger?.getAttribute('aria-expanded') === 'true' || getGeminiModeMenuItems().some((item) => isVisible(item));
  }

  function getGeminiModeMenuItems() {
    return Array.from(document.querySelectorAll('gem-menu gem-menu-item, .cdk-overlay-pane [role="menuitemradio"], .cdk-overlay-pane [role="menuitem"]'))
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  function readGeminiItemTitle(item) {
    const text = (item.innerText || item.textContent || '').trim();
    return (text.split('\n')[0] || '').trim();
  }

  function matchesGeminiModel(item, model) {
    const text = (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim();
    if (model === 'auto') {
      return GEMINI_MODEL_PATTERNS.auto.test(readGeminiItemTitle(item));
    }
    if (GEMINI_MODEL_PATTERNS[model]?.test(text)) {
      return true;
    }
    return Boolean(GEMINI_MODEL_DESCRIPTION_PATTERNS[model]?.test(text));
  }

  function findVisibleGeminiThinkingOption(level) {
    const pattern = GEMINI_THINKING_PATTERNS[level];
    if (!pattern) {
      return null;
    }
    return getGeminiModeMenuItems().find((item) => (
      item.getAttribute('role') === 'menuitemradio' &&
      isVisible(item) &&
      pattern.test(readGeminiItemTitle(item))
    )) || null;
  }

  function waitForValue(read, timeoutMs, intervalMs = 120) {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const tick = () => {
        let value = null;
        try {
          value = read();
        } catch (err) {
          value = null;
        }
        if (value) {
          resolve(value);
          return;
        }
        if (performance.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }
        window.setTimeout(tick, intervalMs);
      };
      tick();
    });
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
      const formClass = typeof form.className === 'string' ? form.className.toLowerCase() : '';
      if (formClass.includes('composer')) {
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

    // Claude's own composer. The send button only appears after text is typed,
    // so it cannot be the only sign that this is the message box.
    if ((el.getAttribute('data-testid') || '') === 'chat-input') {
      return true;
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
      const keydownHandled = !editable.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      if (keydownHandled || editable.innerHTML !== beforeHtml) {
        // The editor already added the break; a second event would add another one.
        editable.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        return true;
      }
      editable.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      const lineBreakEvent = new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true
      });
      const lineBreakHandled = !editable.dispatchEvent(lineBreakEvent);
      if (lineBreakHandled || editable.innerHTML !== beforeHtml) {
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
    addUniqueElement(scopes, editable.closest('fieldset'));
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
