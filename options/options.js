(() => {
  'use strict';

  const SITE_LABELS = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    messenger: 'Messenger'
  };
  const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const KEY_LABELS = {
    enter: 'Enter',
    shift: 'Shift+Enter',
    ctrl: IS_MAC ? '⌘+Enter' : 'Ctrl+Enter'
  };
  const ACTION_LABELS = [
    ['newline', '改行'],
    ['send', '送信']
  ];

  const settingsHelper = globalThis.SILHackSettings;
  const updateNoticeHelper = globalThis.SILHackUpdateNotice;
  const KEY_SITES = settingsHelper.KEY_SITES;
  const KEY_COMBOS = settingsHelper.KEY_COMBOS;
  let settings = settingsHelper.normalizeSettings();
  let saveTimerId = 0;

  const keyTable = document.getElementById('keyTable');
  const status = document.getElementById('status');
  const geminiSection = document.getElementById('geminiSection');
  const geminiModel = document.getElementById('geminiModel');
  const geminiThinkingField = document.getElementById('geminiThinkingField');
  const geminiThinkingLevel = document.getElementById('geminiThinkingLevel');
  const messengerSection = document.getElementById('messengerSection');
  const messengerCompositionGuardMs = document.getElementById('messengerCompositionGuardMs');
  const chatworkSidebarScrollLock = document.getElementById('chatworkSidebarScrollLock');
  const chatworkMarkdownAutoPaste = document.getElementById('chatworkMarkdownAutoPaste');
  const resetButton = document.getElementById('reset');
  const openOptionsButton = document.getElementById('openOptions');
  const updateNotice = document.getElementById('updateNotice');
  const updateNoticeLabel = document.getElementById('updateNoticeLabel');
  const updateNoticeTitle = document.getElementById('updateNoticeTitle');
  const updateNoticeVersion = document.getElementById('updateNoticeVersion');
  const updateNoticeList = document.getElementById('updateNoticeList');
  const dismissUpdateNotice = document.getElementById('dismissUpdateNotice');

  initialize();

  async function initialize() {
    buildKeyTable();
    settings = await settingsHelper.loadSettings();
    render();
    bindEvents();
    await renderUpdateNotice();
  }

  function buildKeyTable() {
    keyTable.textContent = '';

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.className = 'site-col';
    headRow.appendChild(corner);
    for (const combo of KEY_COMBOS) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = KEY_LABELS[combo];
      headRow.appendChild(th);
    }
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    for (const site of KEY_SITES) {
      const row = document.createElement('tr');
      row.dataset.site = site;

      const siteCell = document.createElement('th');
      siteCell.scope = 'row';
      siteCell.className = 'site-col';
      const siteToggle = document.createElement('label');
      siteToggle.className = 'site-toggle';
      const siteInput = document.createElement('input');
      siteInput.type = 'checkbox';
      siteInput.dataset.site = site;
      const siteName = document.createElement('span');
      siteName.textContent = SITE_LABELS[site];
      siteToggle.append(siteInput, siteName);
      siteCell.appendChild(siteToggle);
      row.appendChild(siteCell);

      for (const combo of KEY_COMBOS) {
        const cell = document.createElement('td');
        const group = document.createElement('div');
        group.className = 'seg';
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', `${SITE_LABELS[site]} ${KEY_LABELS[combo]}`);
        for (const [action, label] of ACTION_LABELS) {
          const option = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = `key-${site}-${combo}`;
          input.value = action;
          input.dataset.site = site;
          input.dataset.combo = combo;
          const text = document.createElement('span');
          text.textContent = label;
          option.append(input, text);
          group.appendChild(option);
        }
        cell.appendChild(group);
        row.appendChild(cell);
      }
      body.appendChild(row);
    }

    keyTable.append(head, body);
  }

  function bindEvents() {
    keyTable.addEventListener('change', (event) => {
      const input = event.target;
      const site = input?.dataset?.site;
      if (!site) {
        return;
      }
      if (input.type === 'checkbox') {
        settings.sites[site] = input.checked;
      } else if (input.type === 'radio' && input.checked) {
        settings.keys[site][input.dataset.combo] = input.value;
      }
      renderAvailability();
      queueSave();
    });

    geminiModel.addEventListener('change', () => {
      settings.geminiModel = geminiModel.value;
      renderAvailability();
      queueSave();
    });

    geminiThinkingLevel.addEventListener('change', () => {
      settings.geminiThinkingLevel = geminiThinkingLevel.value;
      queueSave();
    });

    if (messengerCompositionGuardMs) {
      messengerCompositionGuardMs.addEventListener('input', () => {
        settings.messengerCompositionGuardMs = Number(messengerCompositionGuardMs.value);
        queueSave();
      });
    }

    if (chatworkSidebarScrollLock) {
      chatworkSidebarScrollLock.addEventListener('change', () => {
        settings.chatworkSidebarScrollLock = chatworkSidebarScrollLock.checked;
        queueSave();
      });
    }

    if (chatworkMarkdownAutoPaste) {
      chatworkMarkdownAutoPaste.addEventListener('change', () => {
        settings.chatworkMarkdownAutoPaste = chatworkMarkdownAutoPaste.checked;
        queueSave();
      });
    }

    resetButton.addEventListener('click', async () => {
      settings = settingsHelper.normalizeSettings(settingsHelper.DEFAULT_SETTINGS);
      render();
      await saveNow();
    });

    if (openOptionsButton) {
      openOptionsButton.addEventListener('click', () => {
        if (globalThis.chrome?.runtime?.openOptionsPage) {
          chrome.runtime.openOptionsPage();
          window.close();
        }
      });
    }

    if (dismissUpdateNotice) {
      dismissUpdateNotice.addEventListener('click', dismissNotice);
    }
  }

  function render() {
    settings = settingsHelper.normalizeSettings(settings);
    for (const input of keyTable.querySelectorAll('input[type="checkbox"][data-site]')) {
      input.checked = settings.sites[input.dataset.site] !== false;
    }
    for (const input of keyTable.querySelectorAll('input[type="radio"][data-site]')) {
      input.checked = settings.keys[input.dataset.site]?.[input.dataset.combo] === input.value;
    }
    geminiModel.value = settings.geminiModel;
    geminiThinkingLevel.value = settings.geminiThinkingLevel;
    if (messengerCompositionGuardMs) {
      messengerCompositionGuardMs.value = settings.messengerCompositionGuardMs;
    }
    if (chatworkSidebarScrollLock) {
      chatworkSidebarScrollLock.checked = settings.chatworkSidebarScrollLock;
    }
    if (chatworkMarkdownAutoPaste) {
      chatworkMarkdownAutoPaste.checked = settings.chatworkMarkdownAutoPaste;
    }
    renderAvailability();
  }

  // Settings that cannot take effect in the current state are shown disabled or hidden.
  function renderAvailability() {
    for (const row of keyTable.querySelectorAll('tbody tr[data-site]')) {
      const enabled = settings.sites[row.dataset.site] !== false;
      row.classList.toggle('is-off', !enabled);
      for (const radio of row.querySelectorAll('input[type="radio"]')) {
        radio.disabled = !enabled;
      }
    }

    const geminiEnabled = settings.sites.gemini !== false;
    geminiSection.classList.toggle('is-off', !geminiEnabled);
    geminiModel.disabled = !geminiEnabled;
    geminiThinkingLevel.disabled = !geminiEnabled;
    // Auto mode in Gemini has no thinking level to choose.
    geminiThinkingField.hidden = settings.geminiModel === 'auto';

    if (messengerSection && messengerCompositionGuardMs) {
      const messengerEnabled = settings.sites.messenger !== false;
      messengerSection.classList.toggle('is-off', !messengerEnabled);
      messengerCompositionGuardMs.disabled = !messengerEnabled;
    }
  }

  function queueSave() {
    status.textContent = '保存中...';
    if (saveTimerId) {
      window.clearTimeout(saveTimerId);
    }
    saveTimerId = window.setTimeout(saveNow, 180);
  }

  async function saveNow() {
    if (saveTimerId) {
      window.clearTimeout(saveTimerId);
      saveTimerId = 0;
    }
    settings = await settingsHelper.saveSettings(settings);
    render();
    status.textContent = '保存しました';
    window.setTimeout(() => {
      if (status.textContent === '保存しました') {
        status.textContent = '';
      }
    }, 1600);
  }

  async function renderUpdateNotice() {
    if (!updateNotice || !updateNoticeHelper?.loadPendingNotice) {
      return;
    }

    const notice = await updateNoticeHelper.loadPendingNotice();
    if (!notice) {
      updateNotice.hidden = true;
      return;
    }

    updateNoticeLabel.textContent = notice.kind === 'install' ? 'インストールしました' : '更新しました';
    updateNoticeTitle.textContent = `SILHack-dev v${notice.version}`;
    updateNoticeVersion.textContent = notice.kind === 'install' ? '主な機能' : '主なアップデート';
    updateNoticeList.textContent = '';
    for (const note of notice.notes) {
      const item = document.createElement('li');
      item.textContent = note;
      updateNoticeList.appendChild(item);
    }
    updateNotice.hidden = false;
  }

  async function dismissNotice() {
    const notice = await updateNoticeHelper.loadPendingNotice();
    if (!notice) {
      updateNotice.hidden = true;
      return;
    }

    const markedByBackground = await sendMarkNoticeSeen(notice.version);
    if (!markedByBackground) {
      await updateNoticeHelper.markSeen(notice.version);
    }
    updateNotice.hidden = true;
  }

  function sendMarkNoticeSeen(version) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        resolve(false);
        return;
      }

      chrome.runtime.sendMessage({
        type: updateNoticeHelper.MARK_SEEN_MESSAGE,
        version
      }, (response) => {
        resolve(!chrome.runtime.lastError && response?.ok === true);
      });
    });
  }
})();
