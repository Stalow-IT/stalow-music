'use strict';
/* global stalow, S, loadLikes, syncInfo, applySetting, loadHistory, loadSearches, loadDownloads, jobs, restoreSession, go, translateStatic */
// Starts the app: settings first (theme, language), then history and the saved queue, then the start page.
// Also used after Settings > Backup and restore > Restore, so a restored backup applies at once.
async function startApp({ restoreQueue = true } = {}) {
  try { Object.assign(S, await stalow.settings()); } catch { /* defaults */ }
  applySetting();
  translateStatic();
  if (typeof S.volume === 'number') document.querySelector('#vol').value = S.volume;
  await Promise.all([loadHistory(), loadSearches(), loadDownloads(), loadLikes(), stalow.syncInfo().then((i) => { syncInfo = i; }).catch(() => {}), stalow.downloadJobs().then((l) => { jobs = l || []; }).catch(() => {})]);
  if (restoreQueue) await restoreSession();
  go(S.startPage || 'home');
}
startApp();
