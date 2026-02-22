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
    }
  ];

  const CHAT_EDITABLE_SELECTORS = [
    'textarea#_chatText',
    'textarea#_message',
    'textarea[name="message"]'
  ].join(',');

  const TOOLBAR_ID_CHAT = 'silhack-chatwork-tags';
  const TOOLBAR_ID_OVERVIEW = 'silhack-chatwork-tags-overview';

  let currentEditable = null;
  let rafId = null;

  const scheduleAttach = () => {
    if (rafId) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      attachToolbar();
      attachOverviewToolbar();
    });
  };

  const observer = new MutationObserver(scheduleAttach);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleAttach);
  document.addEventListener('scroll', scheduleAttach, true);
  scheduleAttach();

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
      button.title = tag.label;
      if (tag.icon) {
        button.innerHTML = tag.icon;
      } else {
        button.textContent = tag.label;
      }
      button.addEventListener('click', () => {
        const editable = currentEditable || document.querySelector(CHAT_EDITABLE_SELECTORS);
        if (!editable) {
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

    editable.value = value.slice(0, start) + insert + value.slice(end);
    const cursorStart = start + (tag.prefix || '').length;
    const cursorEnd = cursorStart + body.length;
    editable.selectionStart = cursorStart;
    editable.selectionEnd = cursorEnd;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    editable.focus();
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
    `;
    document.head.appendChild(style);
  }
})();
