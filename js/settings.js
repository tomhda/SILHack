(() => {
  'use strict';

  const STORAGE_KEY = 'silhackSettings';
  // Sites whose Enter-key behavior SILHack controls.
  const KEY_SITES = ['chatgpt', 'claude', 'gemini', 'perplexity', 'messenger'];
  const SITE_DEFAULTS = {
    chatgpt: true,
    claude: true,
    gemini: true,
    perplexity: true,
    messenger: true
  };
  // enter = Enter alone, shift = Shift+Enter, ctrl = Ctrl+Enter (Cmd+Enter on macOS).
  const KEY_COMBOS = ['enter', 'shift', 'ctrl'];
  const KEY_ACTIONS = ['newline', 'send'];
  const DEFAULT_SITE_KEYS = {
    enter: 'newline',
    shift: 'newline',
    ctrl: 'send'
  };
  const ENTER_SENDS_SITE_KEYS = {
    enter: 'send',
    shift: 'newline',
    ctrl: 'newline'
  };
  const GEMINI_MODELS = ['keep', 'auto', 'hydrogen', 'neon', 'carbon'];
  const GEMINI_THINKING_LEVELS = ['keep', 'low', 'medium', 'high'];
  const LEGACY_GEMINI_MODES = {
    pro: 'carbon',
    thinking: 'neon',
    fast: 'hydrogen'
  };

  const DEFAULT_SETTINGS = {
    version: 2,
    sites: SITE_DEFAULTS,
    keys: buildKeys(() => DEFAULT_SITE_KEYS),
    geminiModel: 'carbon',
    geminiThinkingLevel: 'keep',
    messengerCompositionGuardMs: 160,
    chatworkSidebarScrollLock: true,
    chatworkMarkdownAutoPaste: false
  };

  function buildKeys(pick) {
    const keys = {};
    for (const site of KEY_SITES) {
      keys[site] = { ...pick(site) };
    }
    return keys;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeKeys(input) {
    // Version 1 had one switch for every site: Enter sends or Enter adds a line.
    const legacyBase = input.sendMode === 'send' ? ENTER_SENDS_SITE_KEYS : DEFAULT_SITE_KEYS;
    const sourceKeys = input.keys && typeof input.keys === 'object' ? input.keys : {};
    return buildKeys((site) => {
      const source = sourceKeys[site] && typeof sourceKeys[site] === 'object' ? sourceKeys[site] : {};
      const siteKeys = {};
      for (const combo of KEY_COMBOS) {
        siteKeys[combo] = KEY_ACTIONS.includes(source[combo]) ? source[combo] : legacyBase[combo];
      }
      return siteKeys;
    });
  }

  function normalizeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    const normalized = clone(DEFAULT_SETTINGS);

    const inputSites = input.sites && typeof input.sites === 'object' ? input.sites : {};
    normalized.sites = {};
    for (const site of Object.keys(SITE_DEFAULTS)) {
      normalized.sites[site] = inputSites[site] !== false;
    }

    normalized.keys = normalizeKeys(input);

    if (GEMINI_MODELS.includes(input.geminiModel)) {
      normalized.geminiModel = input.geminiModel;
    } else if (LEGACY_GEMINI_MODES[input.geminiPreferredMode]) {
      normalized.geminiModel = LEGACY_GEMINI_MODES[input.geminiPreferredMode];
    }

    if (GEMINI_THINKING_LEVELS.includes(input.geminiThinkingLevel)) {
      normalized.geminiThinkingLevel = input.geminiThinkingLevel;
    }

    const guardMs = Number(input.messengerCompositionGuardMs);
    if (Number.isFinite(guardMs)) {
      normalized.messengerCompositionGuardMs = Math.max(0, Math.min(1000, Math.round(guardMs)));
    }

    // Version 1 turned every Chatwork feature on and off with sites.chatwork.
    if (typeof input.chatworkSidebarScrollLock === 'boolean') {
      normalized.chatworkSidebarScrollLock = input.chatworkSidebarScrollLock;
    } else {
      normalized.chatworkSidebarScrollLock = inputSites.chatwork !== false;
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
      // Read without a default object: Chrome merges defaults into the stored value,
      // which would hide fields that are missing from older saved settings.
      chrome.storage.sync.get(STORAGE_KEY, (result) => {
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
    KEY_SITES,
    KEY_COMBOS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings
  };
})();
