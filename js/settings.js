(() => {
  'use strict';

  const STORAGE_KEY = 'silhackSettings';
  const SITE_DEFAULTS = {
    chatgpt: true,
    claude: true,
    gemini: true,
    perplexity: true,
    messenger: true,
    chatwork: true
  };
  const DEFAULT_SETTINGS = {
    version: 1,
    sites: SITE_DEFAULTS,
    sendMode: 'newline',
    geminiPreferredMode: 'pro',
    messengerCompositionGuardMs: 160,
    chatworkMarkdownAutoPaste: false
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    const normalized = clone(DEFAULT_SETTINGS);

    normalized.sites = { ...SITE_DEFAULTS, ...(input.sites || {}) };
    for (const site of Object.keys(SITE_DEFAULTS)) {
      normalized.sites[site] = normalized.sites[site] !== false;
    }

    if (input.sendMode === 'send') {
      normalized.sendMode = 'send';
    }

    if (['pro', 'thinking', 'fast'].includes(input.geminiPreferredMode)) {
      normalized.geminiPreferredMode = input.geminiPreferredMode;
    }

    const guardMs = Number(input.messengerCompositionGuardMs);
    if (Number.isFinite(guardMs)) {
      normalized.messengerCompositionGuardMs = Math.max(0, Math.min(1000, Math.round(guardMs)));
    }

    normalized.chatworkMarkdownAutoPaste = input.chatworkMarkdownAutoPaste === true;
    return normalized;
  }

  function loadSettings() {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.sync) {
        resolve(normalizeSettings());
        return;
      }
      chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (result) => {
        resolve(normalizeSettings(result && result[STORAGE_KEY]));
      });
    });
  }

  function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.sync) {
        resolve(normalized);
        return;
      }
      chrome.storage.sync.set({ [STORAGE_KEY]: normalized }, () => {
        resolve(normalized);
      });
    });
  }

  globalThis.SILHackSettings = {
    STORAGE_KEY,
    SITE_DEFAULTS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings
  };
})();
