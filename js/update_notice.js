(() => {
  'use strict';

  const STORAGE_KEY = 'silhackUpdateNotice';
  const SEEN_VERSION_KEY = 'silhackUpdateNoticeSeenVersion';
  const MARK_SEEN_MESSAGE = 'silhack:updateNoticeSeen';
  const RELEASE_NOTES = {
    '0.2.1': [
      'Claude.aiに対応',
      '設定をポップアップとサイドパネルから開けるように変更',
      'サイトごとのON/OFFと送信キー切替を追加',
      'Geminiの優先モードをPro/思考/高速から選択可能に',
      'Geminiの自動モード選択が手動メニュー操作を邪魔しないよう改善',
      'ChatworkでMarkdown貼り付けをChatworkタグに変換できるように変更',
      'ChatGPTのEnter改行がスペースになる問題を修正',
      'MessengerのIME確定直後EnterとCtrl/Cmd+Enter送信の誤判定を改善',
      '送信ボタン検出を入力欄近くの可視ボタン優先に改善',
      '設定画面を会社カラーに合わせて調整'
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
