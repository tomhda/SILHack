importScripts('js/update_notice.js');

const updateNotice = globalThis.SILHackUpdateNotice;

chrome.runtime.onInstalled.addListener((details) => {
  return handleInstalled(details);
});

chrome.runtime.onStartup.addListener(() => {
  return refreshUpdateBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== updateNotice.MARK_SEEN_MESSAGE) {
    return false;
  }

  handleNoticeSeen(message.version)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function handleInstalled(details) {
  if (details.reason !== chrome.runtime.OnInstalledReason.UPDATE) {
    return;
  }

  const version = updateNotice.getCurrentVersion();
  if (!updateNotice.isVersionUpdate(version, details.previousVersion)) {
    return;
  }

  await updateNotice.saveNotice(updateNotice.buildNotice(version, details.previousVersion));
  await refreshUpdateBadge();
}

async function handleNoticeSeen(version) {
  await updateNotice.markSeen(version);
  await clearUpdateBadge();
}

async function refreshUpdateBadge() {
  const notice = await updateNotice.loadPendingNotice();
  if (!notice) {
    await clearUpdateBadge();
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: '#31972b' });
  await chrome.action.setBadgeText({ text: 'NEW' });
}

async function clearUpdateBadge() {
  await chrome.action.setBadgeText({ text: '' });
}
