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
        'button[aria-label="Send message"]'
      ],
      editableGuard: (el) => isChatGPTComposer(el)
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

  const config = SITE_CONFIGS[site];
  const editableSelectorList = config.editableSelectors.join(',');
  let ignoreSynthetic = false;
  let enterHandledOnKeydown = false;
  let messengerJustComposed = false;
  let geminiModeTimerId = 0;
  let geminiModeRouteKey = '';
  let geminiModeAttempts = 0;
  let geminiModeSettled = false;
  let geminiModeMenuPending = false;

  const GEMINI_MODE_MAX_ATTEMPTS = 12;
  const GEMINI_MODE_RETRY_DELAY_MS = 900;
  const GEMINI_MODE_MENU_DELAY_MS = 220;
  const GEMINI_MODE_CONFIRM_DELAY_MS = 700;

  document.addEventListener('keydown', handleKeydown, true);
  if (site === 'messenger' || site === 'perplexity' || site === 'chatgpt') {
    document.addEventListener('keyup', handleKeyup, true);
  }
  if (site === 'messenger') {
    document.addEventListener('compositionend', handleCompositionEnd, true);
  }
  if (site === 'gemini') {
    startGeminiModeAutoSelect();
  }

  function handleKeydown(event) {
    if (ignoreSynthetic) {
      return;
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
    if (site === 'messenger' && messengerJustComposed) {
      messengerJustComposed = false;
      return;
    }

    if (site === 'messenger' || site === 'perplexity' || site === 'chatgpt') {
      // If an autocomplete/mention picker is open, let Messenger handle Enter to confirm selection.
      if (!event.ctrlKey && !event.metaKey && isMessengerAutocompleteOpen(editable)) {
        return;
      }

      // Messenger/Perplexity/ChatGPT use JS handlers for Enter-to-send. We block those handlers but keep the browser's
      // native Enter behavior (newline/paragraph) to avoid fighting editor state management.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        enterHandledOnKeydown = true;
        triggerSend(editable);
        return;
      }

      // Plain Enter => newline (native), so do NOT preventDefault.
      event.stopImmediatePropagation();
      enterHandledOnKeydown = true;
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      triggerSend(editable);
      return;
    }

    if (site === 'gemini') {
      event.stopImmediatePropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    insertNewline(editable);
  }

  function handleKeyup(event) {
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

  function handleCompositionEnd() {
    messengerJustComposed = true;
    requestAnimationFrame(() => {
      messengerJustComposed = false;
    });
  }

  function startGeminiModeAutoSelect() {
    const observer = new MutationObserver(() => {
      scheduleGeminiModeSelection(450);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('focus', () => scheduleGeminiModeSelection(400), true);
    window.addEventListener('pageshow', () => scheduleGeminiModeSelection(500), true);
    window.addEventListener('popstate', () => scheduleGeminiModeSelection(500), true);
    document.addEventListener('focusin', () => scheduleGeminiModeSelection(300), true);
    scheduleGeminiModeSelection(800);
  }

  function scheduleGeminiModeSelection(delayMs = 250) {
    if (site !== 'gemini') {
      return;
    }
    if (geminiModeTimerId) {
      clearTimeout(geminiModeTimerId);
    }
    geminiModeTimerId = window.setTimeout(runGeminiModeSelection, delayMs);
  }

  function runGeminiModeSelection() {
    geminiModeTimerId = 0;
    const routeKey = `${window.location.pathname}${window.location.search}`;
    if (routeKey !== geminiModeRouteKey) {
      geminiModeRouteKey = routeKey;
      geminiModeAttempts = 0;
      geminiModeSettled = false;
      geminiModeMenuPending = false;
    }

    if (geminiModeSettled || geminiModeAttempts >= GEMINI_MODE_MAX_ATTEMPTS) {
      return;
    }

    geminiModeAttempts += 1;
    const status = applyBestGeminiMode();

    if (status === 'done') {
      geminiModeSettled = true;
      geminiModeMenuPending = false;
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
    const options = findGeminiModeOptions();
    if (options && options.length > 0) {
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

    const trigger = findGeminiModeTrigger();
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

  function findGeminiModeTrigger() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const composer = document.querySelector(editableSelectorList);
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
      const candidateText = (candidate.innerText || '').trim();
      if (score < 0 && !hasPopupMenu && !hasTouchTarget && !isLikelyModeTrigger) {
        continue;
      }
      // Avoid selecting unrelated PRO badges.
      if (!isLikelyModeTrigger && /^pro$/i.test(candidateText)) {
        continue;
      }

      let rank = Math.max(0, score);
      if (isLikelyModeTrigger) {
        rank += 2400;
      }
      if (hasPopupMenu) {
        rank += 600;
      }
      if (hasTouchTarget) {
        rank += 250;
      }
      if (composer) {
        const proximity = scoreElementProximity(candidate, composer);
        if (score < 0 && hasTouchTarget && !isLikelyModeTrigger && proximity <= 0) {
          continue;
        }
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

      if (scored.length < 2) {
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

    let tier = -1;
    if (hasPro) {
      tier = 3;
    } else if (hasThinking) {
      tier = 2;
    } else if (hasFast) {
      tier = 1;
    } else if (hasModelWord) {
      tier = 0;
    } else {
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
      if (form.querySelector('button[data-testid="send-button"], button[aria-label*="send" i], button[aria-label*="送信" i]')) {
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
        return true;
      }
    }

    const main = el.closest('main');
    if (main) {
      return true;
    }

    return false;
  }

  function isMessengerAutocompleteOpen(editable) {
    try {
      if (editable && editable.getAttribute && editable.getAttribute('aria-activedescendant')) {
        return true;
      }

      const main = editable?.closest?.('[role="main"]') || document;
      const listboxes = Array.from(
        main.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"] [role="listbox"]')
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
    } catch (err) {
      return false;
    }
    return false;
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

  function insertNewline(editable) {
    const tag = editable.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      insertText(editable, '\n');
      return;
    }

    if (editable.isContentEditable) {
      const inserted = document.execCommand('insertLineBreak') ||
        document.execCommand('insertText', false, '\n');
      if (!inserted) {
        insertTextContentEditable(editable, '\n');
      }
    }
  }

  function insertText(editable, text) {
    const value = editable.value || '';
    const start = Number.isInteger(editable.selectionStart) ? editable.selectionStart : value.length;
    const end = Number.isInteger(editable.selectionEnd) ? editable.selectionEnd : value.length;
    const nextValue = value.slice(0, start) + text + value.slice(end);
    const nextPos = start + text.length;

    editable.value = nextValue;
    editable.selectionStart = nextPos;
    editable.selectionEnd = nextPos;
    dispatchInput(editable);
  }

  function insertTextContentEditable(editable, text) {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editable.appendChild(document.createTextNode(text));
    }
  }

  function dispatchInput(editable) {
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }


  function triggerSend(editable) {
    const button = findSendButton(config.sendButtonSelectors);
    if (button) {
      button.click();
      return;
    }

    const form = editable.closest('form');
    if (form) {
      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitButton && !submitButton.disabled) {
        submitButton.click();
        return;
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    dispatchEnter(editable);
  }

  function findSendButton(selectors) {
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (!button) {
        continue;
      }
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
        continue;
      }
      return button;
    }
    return null;
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
