(() => {
  'use strict';

  const STORAGE_KEY = 'silhackUpdateNotice';
  const SEEN_VERSION_KEY = 'silhackUpdateNoticeSeenVersion';
  const MARK_SEEN_MESSAGE = 'silhack:updateNoticeSeen';
  const RELEASE_NOTES = {
    '0.2.1': [
      'ChatGPTのEnter改行がスペースになる問題を修正',
      '設定をポップアップとサイドパネルから開けるように変更',
      '更新内容を一回だけ表示するカードを追加'
    ]
  };
  const FALLBACK_NOTES = [
    '入力補助の安定性を改善しました'
  ];

  function getCurrentVersion() {
    return globalThis.chrome?.runtime?.getManifest?.().version || '';
  }

  function getReleaseNotes(version) {
    return RELEASE_NOTES[version] || FALLBACK_NOTES;
  }

  function buildNotice(version, previousVersion) {
    return {
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
    const notes = Array.isArray(value.notes) && value.notes.length
      ? value.notes.filter((note) => typeof note === 'string' && note.trim())
      : getReleaseNotes(value.version);
    return {
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
    buildNotice,
    getCurrentVersion,
    getReleaseNotes,
    isVersionUpdate,
    loadPendingNotice,
    markSeen,
    normalizeNotice,
    saveNotice
  };
})();
