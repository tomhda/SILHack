(() => {
  'use strict';

  const STORAGE_KEY = 'silhackUpdateNotice';
  const SEEN_VERSION_KEY = 'silhackUpdateNoticeSeenVersion';
  const MARK_SEEN_MESSAGE = 'silhack:updateNoticeSeen';
  const INSTALL_NOTES = {
    '0.2.3': [
      'ChatGPT / Claude / Gemini / Perplexity / Messengerで送信キーを統一',
      'Enterで改行、Ctrl/Cmd+Enterで送信',
      'サイトごとのON/OFFと送信キー切替に対応',
      'Geminiの優先モードをPro/思考/高速から選択可能',
      'ChatworkでMarkdownをChatworkタグに変換',
      'ポップアップ/設定画面から設定を変更'
    ]
  };
  const RELEASE_NOTES = {};

  function getCurrentVersion() {
    return globalThis.chrome?.runtime?.getManifest?.().version || '';
  }

  function getInstallNotes(version) {
    return INSTALL_NOTES[version] || [];
  }

  function getReleaseNotes(version) {
    return RELEASE_NOTES[version] || [];
  }

  function getNoticeNotes(kind, version) {
    return kind === 'install' ? getInstallNotes(version) : getReleaseNotes(version);
  }

  function buildInstallNotice(version) {
    return {
      kind: 'install',
      version,
      previousVersion: '',
      notes: getInstallNotes(version),
      createdAt: new Date().toISOString()
    };
  }

  function buildUpdateNotice(version, previousVersion) {
    return {
      kind: 'update',
      version,
      previousVersion: previousVersion || '',
      notes: getReleaseNotes(version),
      createdAt: new Date().toISOString()
    };
  }

  function isVersionUpdate(version, previousVersion) {
    return Boolean(version && previousVersion && version !== previousVersion);
  }

  function normalizeNotice(value) {
    if (!value || typeof value !== 'object' || !value.version) {
      return null;
    }
    const kind = value.kind === 'install' ? 'install' : 'update';
    const notes = getNoticeNotes(kind, value.version);
    if (!notes.length) {
      return null;
    }
    return {
      kind,
      version: String(value.version),
      previousVersion: value.previousVersion ? String(value.previousVersion) : '',
      notes,
      createdAt: value.createdAt ? String(value.createdAt) : ''
    };
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => {
        resolve(result || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(values, resolve);
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.remove(key, resolve);
    });
  }

  async function loadPendingNotice() {
    const result = await storageGet([STORAGE_KEY, SEEN_VERSION_KEY]);
    const notice = normalizeNotice(result[STORAGE_KEY]);
    if (!notice || result[SEEN_VERSION_KEY] === notice.version) {
      return null;
    }
    return notice;
  }

  async function saveNotice(notice) {
    await storageSet({ [STORAGE_KEY]: normalizeNotice(notice) });
  }

  async function markSeen(version) {
    if (!version) {
      return;
    }
    await storageSet({ [SEEN_VERSION_KEY]: version });
    await storageRemove(STORAGE_KEY);
  }

  globalThis.SILHackUpdateNotice = {
    STORAGE_KEY,
    SEEN_VERSION_KEY,
    MARK_SEEN_MESSAGE,
    buildInstallNotice,
    buildUpdateNotice,
    getCurrentVersion,
    getInstallNotes,
    getReleaseNotes,
    isVersionUpdate,
    loadPendingNotice,
    markSeen,
    normalizeNotice,
    saveNotice
  };
})();
