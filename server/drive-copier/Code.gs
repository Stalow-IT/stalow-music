// Stalow Music: copies the Google Drive folders and files the admins add into YOUR Google Drive
// (a folder named "Stalow Music"), so they stay even if the person who shared them deletes them.
// The app then plays your copies, and an admin can move a copy to the bin once the album is on YouTube Music.
// Install once:
//   1. Open https://script.google.com while signed in to your Google account, click "New project".
//   2. Delete what is there, paste this whole file, and save (name it "Stalow Music copier").
//   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
//   4. Allow access to your Google Drive when Google asks (Advanced > Go to ... if it warns: it is your own script).
//   5. Copy the "Web app URL" and paste it in Stalow Music: Settings > Google Drive > Copy to my Google Drive.
// The app connects once with a private key the script keeps; nobody else can use it after that.

const ROOT_NAME = 'Stalow Music';
const TIME_LIMIT_MS = 100 * 1000; // stop and carry on next time, well inside the server's time limit
const START = Date.now();

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ error: 'bad request' }); }
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SECRET');
  if (!secret) {
    // the first connection sets the private key
    if (req.action !== 'connect' || typeof req.secret !== 'string' || req.secret.length < 32) return out({ error: 'not connected yet' });
    props.setProperty('SECRET', req.secret);
    secret = req.secret;
  }
  if (req.secret !== secret) return out({ error: 'wrong key' });
  try {
    if (req.action === 'connect') return out({ ok: true, rootUrl: root().getUrl() });
    if (req.action === 'copy') return out(copy(req));
    if (req.action === 'trash') return out(trash(req));
    return out({ error: 'unknown action' });
  } catch (err) {
    return out({ error: String(err && err.message || err).slice(0, 300) });
  }
}

function doGet() {
  return out({ ok: true, app: 'Stalow Music copier' });
}

function root() {
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
}

function share(item) {
  // the app streams the copies, so they are shared by link (view only), like the originals
  item.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
}

/** Copies one shared file, or a shared folder with its sub-folders; safe to call again (only what is missing is copied). */
function copy(req) {
  if (req.kind === 'file') {
    if (req.copyId) return { done: true, copyId: req.copyId };
    const src = DriveApp.getFileById(req.sourceId);
    const f = src.makeCopy(src.getName(), root());
    share(f);
    return { done: true, copyId: f.getId() };
  }
  let dest;
  if (req.copyId) {
    dest = DriveApp.getFolderById(req.copyId);
  } else {
    dest = root().createFolder(String(req.title || 'Google Drive').slice(0, 200));
    share(dest);
  }
  let src;
  try {
    src = DriveApp.getFolderById(req.sourceId);
  } catch (err) {
    // the original is gone (or no longer shared): keep the copy as it is
    return { done: true, copyId: dest.getId(), sourceGone: true };
  }
  const done = copyInto(src, dest, 0);
  return { done: done, copyId: dest.getId() };
}

/** Moves a copy to the bin (an album that is now on YouTube Music); only items inside "Stalow Music". */
function trash(req) {
  let item;
  try { item = req.kind === 'file' ? DriveApp.getFileById(req.copyId) : DriveApp.getFolderById(req.copyId); } catch (err) { return { done: true, gone: true }; }
  const rootId = root().getId();
  const parents = item.getParents();
  let inside = false;
  while (parents.hasNext()) if (parents.next().getId() === rootId) inside = true;
  if (!inside) return { error: 'not a Stalow Music copy' };
  item.setTrashed(true);
  return { done: true };
}

function copyInto(src, dest, depth) {
  const have = {};
  const existing = dest.getFiles();
  while (existing.hasNext()) have[existing.next().getName()] = true;
  const files = src.getFiles();
  while (files.hasNext()) {
    if (Date.now() - START > TIME_LIMIT_MS) return false;
    const f = files.next();
    if (!have[f.getName()]) f.makeCopy(f.getName(), dest);
  }
  if (depth >= 2) return true;
  const subs = src.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    const it = dest.getFoldersByName(s.getName());
    const d = it.hasNext() ? it.next() : dest.createFolder(s.getName());
    if (!copyInto(s, d, depth + 1)) return false;
  }
  return true;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
