(() => {
  'use strict';

  const TAGS = [
    { label: 'Info', prefix: '[info]\n', suffix: '\n[/info]' },
    { label: 'Title', prefix: '[title]', suffix: '[/title]', placeholder: 'title' },
    {
      label: 'Code',
      prefix: '[code]\n',
      suffix: '\n[/code]',
      placeholder: 'code',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
    },
    {
      label: 'Hr',
      prefix: '[hr]',
      suffix: '',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="2" y1="12" x2="22" y2="12"/></svg>`
    },
    {
      label: 'MD',
      action: 'markdown',
      title: 'Markdown to Chatwork',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><path d="M6 15V9l3 4 3-4v6"/><path d="M17 9v6"/><path d="m14 12 3 3 3-3"/></svg>`
    }
  ];

  const CHAT_EDITABLE_SELECTORS = [
    'textarea#_chatText',
    'textarea#_message',
    'textarea[name="message"]'
  ].join(',');

  const TOOLBAR_ID_CHAT = 'silhack-chatwork-tags';
  const TOOLBAR_ID_OVERVIEW = 'silhack-chatwork-tags-overview';

  const settingsHelper = globalThis.SILHackSettings;
  let runtimeSettings = settingsHelper?.normalizeSettings
    ? settingsHelper.normalizeSettings()
    : {
        sites: { chatwork: true },
        chatworkMarkdownAutoPaste: false
      };
  let currentEditable = null;
  let rafId = null;

  const scheduleAttach = () => {
    if (rafId) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!isChatworkEnabled()) {
        removeToolbars();
        return;
      }
      attachToolbar();
      attachOverviewToolbar();
    });
  };

  boot();
  const observer = new MutationObserver(scheduleAttach);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleAttach);
  document.addEventListener('paste', handlePaste, true);
  scheduleAttach();

  function boot() {
    const settingsPromise = settingsHelper?.loadSettings
      ? settingsHelper.loadSettings()
      : Promise.resolve(runtimeSettings);
    settingsPromise
      .then((settings) => {
        runtimeSettings = normalizeRuntimeSettings(settings);
        scheduleAttach();
      })
      .catch(() => {
        runtimeSettings = normalizeRuntimeSettings(runtimeSettings);
        scheduleAttach();
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
      scheduleAttach();
    });
  }

  function normalizeRuntimeSettings(settings) {
    if (settingsHelper?.normalizeSettings) {
      return settingsHelper.normalizeSettings(settings);
    }
    return settings || runtimeSettings;
  }

  function isChatworkEnabled() {
    return runtimeSettings?.sites?.chatwork !== false;
  }

  function isMarkdownAutoPasteEnabled() {
    return runtimeSettings?.chatworkMarkdownAutoPaste === true;
  }

  function removeToolbars() {
    document.getElementById(TOOLBAR_ID_CHAT)?.remove();
    document.getElementById(TOOLBAR_ID_OVERVIEW)?.remove();
  }

  function attachToolbar() {
    const editable = document.querySelector(CHAT_EDITABLE_SELECTORS);
    if (!editable) {
      return;
    }
    currentEditable = editable;
    ensureStyles();

    const container = findToolbarContainer(editable);
    if (!container) {
      return;
    }

    let toolbar = document.getElementById(TOOLBAR_ID_CHAT);
    if (!toolbar) {
      toolbar = buildToolbar(TOOLBAR_ID_CHAT);
    }

    if (toolbar.parentElement !== container) {
      container.appendChild(toolbar);
    }
  }

  function attachOverviewToolbar() {
    const overviewContext = findOverviewContext();
    if (!overviewContext) {
      return;
    }
    const { textarea, container, insertAfter, marginLeft } = overviewContext;

    ensureStyles();

    let toolbar = document.getElementById(TOOLBAR_ID_OVERVIEW);
    if (!toolbar) {
      toolbar = buildToolbar(TOOLBAR_ID_OVERVIEW);
    }
    toolbar._silhackTargetEditable = textarea;

    if (!toolbar.dataset.silhackOverviewBound) {
      toolbar.addEventListener('click', (e) => {
        if (!e.target.closest('.silhack-chatwork-tag-btn')) {
          return;
        }
        const target = toolbar._silhackTargetEditable;
        if (target) {
          currentEditable = target;
        }
      }, true);
      toolbar.dataset.silhackOverviewBound = '1';
    }

    toolbar.style.marginLeft = marginLeft || '12px';

    if (insertAfter && insertAfter.parentElement === container) {
      if (insertAfter.nextSibling !== toolbar) {
        container.insertBefore(toolbar, insertAfter.nextSibling);
      }
      return;
    }

    if (toolbar.parentElement !== container) {
      container.appendChild(toolbar);
    }
  }

  function findOverviewContext() {
    const roomInfoTextarea = document.querySelector('textarea#_roomInfoDescription');
    const roomInfoLabel = document.querySelector('label[for="_roomInfoDescription"]');
    if (roomInfoTextarea && roomInfoLabel) {
      return {
        textarea: roomInfoTextarea,
        container: roomInfoLabel.parentElement || roomInfoLabel,
        insertAfter: roomInfoLabel,
        marginLeft: '8px'
      };
    }

    const header = Array.from(document.querySelectorAll('h1')).find(
      (h) => h.textContent.trim() === '概要の編集'
    );
    if (!header) {
      return null;
    }

    const dialog = header.closest('div[class]');
    if (!dialog) {
      return null;
    }

    const textarea = dialog.parentElement?.querySelector('textarea');
    if (!textarea) {
      return null;
    }

    return {
      textarea,
      container: header.parentElement || dialog,
      insertAfter: header,
      marginLeft: '12px'
    };
  }

  function buildToolbar(id) {
    const toolbar = document.createElement('div');
    toolbar.id = id;
    toolbar.className = 'silhack-chatwork-tags';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Chatwork tags');

    for (const tag of TAGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'silhack-chatwork-tag-btn';
      button.title = tag.title || tag.label;
      if (tag.icon) {
        button.innerHTML = tag.icon;
      } else {
        button.textContent = tag.label;
      }
      button.addEventListener('click', async () => {
        const editable = currentEditable || document.querySelector(CHAT_EDITABLE_SELECTORS);
        if (!editable) {
          return;
        }
        if (tag.action === 'markdown') {
          await applyMarkdownConversion(editable);
          return;
        }
        applyTag(editable, tag);
      });
      toolbar.appendChild(button);
    }

    return toolbar;
  }

  function findToolbarContainer(editable) {
    const toolbarIds = ['_emoticon', '_to', '_file', '_groupCall'];
    for (const id of toolbarIds) {
      const button = document.getElementById(id);
      if (!button) {
        continue;
      }
      const list = button.closest('ul');
      if (list) {
        return list;
      }
    }

    if (!editable) {
      return null;
    }
    return editable.closest('form') || editable.closest('[role="form"]') || editable.parentElement;
  }

  function applyTag(editable, tag) {
    if (!editable || editable.tagName !== 'TEXTAREA') {
      return;
    }

    const value = editable.value || '';
    const start = Number.isInteger(editable.selectionStart) ? editable.selectionStart : value.length;
    const end = Number.isInteger(editable.selectionEnd) ? editable.selectionEnd : value.length;
    const selected = value.slice(start, end);
    const body = selected || tag.placeholder || '';
    const insert = `${tag.prefix || ''}${body}${tag.suffix || ''}`;

    setNativeTextAreaValue(editable, value.slice(0, start) + insert + value.slice(end));
    const cursorStart = start + (tag.prefix || '').length;
    const cursorEnd = cursorStart + body.length;
    editable.selectionStart = cursorStart;
    editable.selectionEnd = cursorEnd;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    editable.focus();
  }

  async function applyMarkdownConversion(editable) {
    if (!editable || editable.tagName !== 'TEXTAREA') {
      return;
    }

    const value = editable.value || '';
    const start = Number.isInteger(editable.selectionStart) ? editable.selectionStart : value.length;
    const end = Number.isInteger(editable.selectionEnd) ? editable.selectionEnd : value.length;
    const selected = value.slice(start, end);
    let source = selected;

    if (!source && navigator.clipboard?.readText) {
      try {
        source = await navigator.clipboard.readText();
      } catch (err) {
        source = '';
      }
    }

    if (!source) {
      source = value;
      replaceTextRange(editable, 0, value.length, markdownToChatwork(source));
      return;
    }

    replaceTextRange(editable, start, end, markdownToChatwork(source));
  }

  function handlePaste(event) {
    if (!isChatworkEnabled() || !isMarkdownAutoPasteEnabled()) {
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
    const overviewContext = findOverviewContext();
    return overviewContext?.textarea === editable;
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

  function ensureStyles() {
    if (document.getElementById('silhack-chatwork-style')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'silhack-chatwork-style';
    style.textContent = `
      .silhack-chatwork-tags {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        margin-left: 6px;
      }
      .silhack-chatwork-tag-btn {
        font: 12px/1.2 sans-serif;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid #2f3e4f;
        background: #1f2a36;
        color: #e7edf3;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
      }
      .silhack-chatwork-tag-btn svg {
        display: block;
      }
      .silhack-chatwork-tag-btn:hover {
        background: #2b3b4f;
      }
      @media (prefers-color-scheme: light) {
        .silhack-chatwork-tag-btn {
          border-color: #c7d0dc;
          background: #f7f9fc;
          color: #243040;
        }
        .silhack-chatwork-tag-btn:hover {
          background: #edf2f7;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
