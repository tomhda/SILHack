(() => {
  'use strict';

  const SITE_LABELS = [
    ['chatgpt', 'ChatGPT'],
    ['claude', 'Claude'],
    ['gemini', 'Gemini'],
    ['perplexity', 'Perplexity'],
    ['messenger', 'Messenger'],
    ['chatwork', 'Chatwork']
  ];

  const settingsHelper = globalThis.SILHackSettings;
  const updateNoticeHelper = globalThis.SILHackUpdateNotice;
  let settings = settingsHelper.normalizeSettings();
  let saveTimerId = 0;

  const siteToggles = document.getElementById('site-toggles');
  const status = document.getElementById('status');
  const geminiPreferredMode = document.getElementById('geminiPreferredMode');
  const messengerCompositionGuardMs = document.getElementById('messengerCompositionGuardMs');
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
    buildSiteToggles();
    settings = await settingsHelper.loadSettings();
    render();
    bindEvents();
    await renderUpdateNotice();
  }

  function buildSiteToggles() {
    siteToggles.textContent = '';
    for (const [site, label] of SITE_LABELS) {
      const row = document.createElement('label');
      row.className = 'toggle-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.site = site;

      const text = document.createElement('span');
      text.textContent = label;

      row.append(input, text);
      siteToggles.appendChild(row);
    }
  }

  function bindEvents() {
    siteToggles.addEventListener('change', (event) => {
      const site = event.target?.dataset?.site;
      if (!site) {
        return;
      }
      settings.sites[site] = event.target.checked;
      queueSave();
    });

    document.querySelectorAll('input[name="sendMode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          settings.sendMode = input.value;
          queueSave();
        }
      });
    });

    geminiPreferredMode.addEventListener('change', () => {
      settings.geminiPreferredMode = geminiPreferredMode.value;
      queueSave();
    });

    messengerCompositionGuardMs.addEventListener('input', () => {
      settings.messengerCompositionGuardMs = Number(messengerCompositionGuardMs.value);
      queueSave();
    });

    chatworkMarkdownAutoPaste.addEventListener('change', () => {
      settings.chatworkMarkdownAutoPaste = chatworkMarkdownAutoPaste.checked;
      queueSave();
    });

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
    for (const input of siteToggles.querySelectorAll('input[data-site]')) {
      input.checked = settings.sites[input.dataset.site] !== false;
    }
    const sendMode = document.querySelector(`input[name="sendMode"][value="${settings.sendMode}"]`);
    if (sendMode) {
      sendMode.checked = true;
    }
    geminiPreferredMode.value = settings.geminiPreferredMode;
    messengerCompositionGuardMs.value = settings.messengerCompositionGuardMs;
    chatworkMarkdownAutoPaste.checked = settings.chatworkMarkdownAutoPaste;
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
