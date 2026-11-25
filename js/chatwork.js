(() => {
  'use strict';

  const CHAT_EDITABLE_SELECTORS = [
    'textarea#_chatText',
    'textarea#_message',
    'textarea[name="message"]'
  ].join(',');

  const settingsHelper = globalThis.SILHackSettings;
  let runtimeSettings = settingsHelper?.normalizeSettings
    ? settingsHelper.normalizeSettings()
    : {
        chatworkSidebarScrollLock: true,
        chatworkMarkdownAutoPaste: false
      };

  boot();
  document.addEventListener('wheel', containSidebarScrollChain, { capture: true, passive: false });
  document.addEventListener('paste', handlePaste, true);

  function boot() {
    const settingsPromise = settingsHelper?.loadSettings
      ? settingsHelper.loadSettings()
      : Promise.resolve(runtimeSettings);
    settingsPromise
      .then((settings) => {
        runtimeSettings = normalizeRuntimeSettings(settings);
      })
      .catch(() => {
        runtimeSettings = normalizeRuntimeSettings(runtimeSettings);
      });
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
    });
  }

  function normalizeRuntimeSettings(settings) {
    if (settingsHelper?.normalizeSettings) {
      return settingsHelper.normalizeSettings(settings);
    }
    return settings || runtimeSettings;
  }

  function isSidebarScrollLockEnabled() {
    return runtimeSettings?.chatworkSidebarScrollLock !== false;
  }

  function isMarkdownAutoPasteEnabled() {
    return runtimeSettings?.chatworkMarkdownAutoPaste === true;
  }

  // Keep wheel scrolling inside the room list instead of scrolling the whole page at its ends.
  function containSidebarScrollChain(event) {
    if (!isSidebarScrollLockEnabled() || event.defaultPrevented || !event.deltaY) {
      return;
    }
    const scrollable = findScrollableAncestor(event.target);
    if (!scrollable || !isLikelySidebarPane(scrollable)) {
      return;
    }

    const maxScrollTop = scrollable.scrollHeight - scrollable.clientHeight;
    const scrollTop = scrollable.scrollTop;
    const scrollingUpAtTop = event.deltaY < 0 && scrollTop <= 0;
    const scrollingDownAtBottom = event.deltaY > 0 && scrollTop >= maxScrollTop - 1;

    if (scrollingUpAtTop || scrollingDownAtBottom) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function findScrollableAncestor(startNode) {
    let node = startNode && startNode.nodeType === Node.ELEMENT_NODE
      ? startNode
      : startNode?.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      if (isVerticallyScrollable(node)) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function isVerticallyScrollable(element) {
    if (!element || element.scrollHeight - element.clientHeight <= 1) {
      return false;
    }
    const overflowY = getComputedStyle(element).overflowY;
    return overflowY !== 'visible' && overflowY !== 'clip';
  }

  function isLikelySidebarPane(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }
    const sidebarLimit = Math.min(560, window.innerWidth * 0.5);
    return rect.left < sidebarLimit && rect.width <= 560;
  }

  function handlePaste(event) {
    if (!isMarkdownAutoPasteEnabled()) {
      return;
    }
    const editable = findTextareaFromEvent(event);
    if (!editable || !isSupportedChatworkTextarea(editable)) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!looksLikeMarkdownForChatwork(text)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    replaceTextRange(editable, editable.selectionStart, editable.selectionEnd, markdownToChatwork(text));
  }

  function findTextareaFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node && node.nodeType === Node.ELEMENT_NODE && node.matches?.('textarea')) {
        return node;
      }
    }
    return null;
  }

  function isSupportedChatworkTextarea(editable) {
    if (editable.matches(CHAT_EDITABLE_SELECTORS) || editable.id === '_roomInfoDescription') {
      return true;
    }
    return findOverviewTextarea() === editable;
  }

  // The room overview editor ("概要の編集") has no stable id, so find it from its heading.
  function findOverviewTextarea() {
    const header = Array.from(document.querySelectorAll('h1')).find(
      (h) => h.textContent.trim() === '概要の編集'
    );
    const dialog = header?.closest('div[class]');
    return dialog?.parentElement?.querySelector('textarea') || null;
  }

  function replaceTextRange(editable, start, end, insert) {
    const value = editable.value || '';
    const safeStart = Number.isInteger(start) ? start : value.length;
    const safeEnd = Number.isInteger(end) ? end : safeStart;
    setNativeTextAreaValue(editable, value.slice(0, safeStart) + insert + value.slice(safeEnd));
    const nextPos = safeStart + insert.length;
    editable.selectionStart = nextPos;
    editable.selectionEnd = nextPos;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    editable.focus();
  }

  function markdownToChatwork(markdown) {
    let text = String(markdown || '').replace(/\r\n?/g, '\n');
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => {
      const body = code.replace(/\n$/, '');
      return `[code]\n${body}\n[/code]`;
    });
    text = text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_match, title) => {
      return `[title]${title.trim()}[/title]`;
    });
    text = text.replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '[hr]');
    return text;
  }

  function looksLikeMarkdownForChatwork(text) {
    return /```|^\s{0,3}#{1,6}\s+|^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(text || '');
  }

  function setNativeTextAreaValue(editable, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(editable, value);
      return;
    }
    editable.value = value;
  }
})();
