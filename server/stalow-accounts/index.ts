// Stalow Music accounts and the admin-managed channel / artist list.
// A device makes a private key, signs up with a name and waits; an admin approves it (as user or admin).
// The key is never stored, only its sha256. All requests: POST {action, key, ...}.
//   register {name, device}  status  claimOwner {code}
//   accounts.list  accounts.decide {id, status?, role?}            (admins)
//   catalog.get                                                     (approved accounts)
//   catalog.set {entry:{id,name,thumbnail,category,removed}}  catalog.search {q}  catalog.images {id, q}   (admins)
//   drive.list (approved)   drive.all  drive.add {link, category, title?, artistId?, year?}  drive.set {id, title?, category?, removed?, refresh?, artistId?, year?}  catalog.albums {id}   (admins)
//   drive.copier.get  drive.copier.set {url}  drive.copier.clear   (owner)     drive.copyTick {tickKey}   (scheduler)
//   catalog.compare {id}  drive.set {..., removed: true, deleteCopy: true}   (admins)
// Deployed as the Supabase edge function "stalow-accounts" (verify_jwt off) in the it-manager project.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CATEGORIES = new Set(["music", "podcasts", "shiurim", "videos"]);
const MAX_PENDING = 300;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const validKey = (k: unknown): k is string => typeof k === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(k);
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

async function accountFor(key: string) {
  const { data } = await db.from("stalow_accounts").select("id,name,status,role").eq("key_hash", await sha256("stalow-account:" + key)).maybeSingle();
  return data;
}
const isAdmin = (a: any) => a && a.status === "approved" && (a.role === "admin" || a.role === "owner");

// ---- YouTube Music search, for adding a channel or artist ----
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20260707.12.00", hl: "en", gl: "US" };
async function ytmSearch(q: string) {
  const res = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0" },
    body: JSON.stringify({ context: { client: CLIENT }, query: q }),
  });
  if (!res.ok) throw new Error("YouTube Music search failed");
  const j = await res.json();
  const found = new Map<string, { id: string; name: string; thumbnail: string; kind: string }>();
  const thumbOf = (r: any) => { const t = r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || r?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || []; return t.length ? t[t.length - 1].url : ""; };
  (function walk(x: any) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    const r = x.musicResponsiveListItemRenderer || x.musicCardShelfRenderer;
    if (r) {
      const be = r.navigationEndpoint?.browseEndpoint || r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
      const pt = be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";
      const name = (r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || r.title?.runs || []).map((a: any) => a.text).join("");
      if (be?.browseId?.startsWith("UC") && name && !found.has(be.browseId)) found.set(be.browseId, { id: be.browseId, name, thumbnail: thumbOf(r), kind: /ARTIST/.test(pt) ? "artist" : "channel" });
      // channels named inside other results (podcast hosts, video uploaders)
      for (const run of [...(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []), ...(r.subtitle?.runs || [])]) {
        const b = run.navigationEndpoint?.browseEndpoint;
        if (b?.browseId?.startsWith("UC") && run.text && !found.has(b.browseId)) found.set(b.browseId, { id: b.browseId, name: run.text, thumbnail: "", kind: "channel" });
      }
    }
    for (const k in x) walk(x[k]);
  })(j);
  return [...found.values()].slice(0, 25);
}

// ---- YouTube channel search (channels that are not YouTube Music artists), and pasted links / @handles ----
const WEB = { clientName: "WEB", clientVersion: "2.20260701.00.00", hl: "en", gl: "US" };
const YT_HEADERS = { "Content-Type": "application/json", Origin: "https://www.youtube.com", Referer: "https://www.youtube.com/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0" };
async function ytChannelSearch(q: string) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST", headers: YT_HEADERS, body: JSON.stringify({ context: { client: WEB }, query: q, params: "EgIQAg==" }),
  });
  if (!res.ok) return [];
  const out: { id: string; name: string; thumbnail: string; kind: string }[] = [];
  (function walk(x: any) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    const c = x.channelRenderer;
    if (c?.channelId?.startsWith("UC")) {
      const t = c.thumbnail?.thumbnails || [];
      let thumb = t.length ? String(t[t.length - 1].url || "") : "";
      if (thumb.startsWith("//")) thumb = "https:" + thumb;
      out.push({ id: c.channelId, name: c.title?.simpleText || (c.title?.runs || []).map((r: any) => r.text).join(""), thumbnail: thumb, kind: "channel" });
      return;
    }
    for (const k in x) walk(x[k]);
  })(await res.json());
  return out;
}
// A pasted channel link, "UC..." id or @handle -> that channel
async function resolveChannel(q: string) {
  const direct = q.match(/(UC[A-Za-z0-9_-]{22})/);
  if (direct) return direct[1];
  const handle = q.match(/(?:youtube\.com\/)?(@[A-Za-z0-9._-]{3,40})/);
  const url = handle ? "https://www.youtube.com/" + handle[1] : /^https:\/\/(www\.|m\.|music\.)?youtube\.com\//.test(q) ? q : null;
  if (!url) return null;
  const res = await fetch("https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false", {
    method: "POST", headers: YT_HEADERS, body: JSON.stringify({ context: { client: WEB }, url }),
  });
  if (!res.ok) return null;
  const id = (await res.json())?.endpoint?.browseEndpoint?.browseId;
  return typeof id === "string" && id.startsWith("UC") ? id : null;
}

async function search(q: string) {
  const id = await resolveChannel(q).catch(() => null);
  const lists = await Promise.all([
    ytmSearch(q).catch(() => []),
    ytChannelSearch(q).catch(() => []),
  ]);
  const found = new Map<string, { id: string; name: string; thumbnail: string; kind: string }>();
  // exact name matches first, then YouTube Music artists, then YouTube channels
  const all = [...lists[0].filter((r) => r.kind === "artist"), ...lists[1], ...lists[0].filter((r) => r.kind !== "artist")];
  const lower = q.toLowerCase();
  all.sort((a, b) => Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower));
  if (id) {
    const known = all.find((r) => r.id === id);
    found.set(id, known || { id, name: q, thumbnail: "", kind: "channel" });
  }
  for (const r of all) {
    const prev = found.get(r.id);
    if (!prev) found.set(r.id, r);
    else if (!prev.thumbnail && r.thumbnail) found.set(r.id, { ...prev, thumbnail: r.thumbnail, name: prev.name === q ? r.name : prev.name });
  }
  return [...found.values()].slice(0, 30);
}

// ---- Picture choices for a channel / artist (Settings > Channels & artists > Picture) ----
const bigger = (u: string) => (u.startsWith("//") ? "https:" + u : u)
  .replace(/=s\d+(-[^=/]*)?$/, "=s544-c-k-c0x00ffffff-no-rj")
  .replace(/=w\d+-h\d+(-[^=/]*)?$/, "=w544-h544-l90-rj");
function thumbsIn(x: any, out: string[], max = 60) {
  if (out.length >= max || !x || typeof x !== "object") return;
  if (Array.isArray(x)) { for (const v of x) thumbsIn(v, out, max); return; }
  if (Array.isArray(x.thumbnails) && x.thumbnails.length) {
    const u = String(x.thumbnails[x.thumbnails.length - 1].url || "");
    if (/^(https:)?\/\/(yt3|lh3|i\.ytimg)\./.test(u)) out.push(bigger(u));
    return;
  }
  if (Array.isArray(x.sources) && x.sources.length && typeof x.sources[0]?.url === "string") {
    const u = String(x.sources[x.sources.length - 1].url);
    if (/^(https:)?\/\/(yt3|lh3|i\.ytimg)\./.test(u)) out.push(bigger(u));
    return;
  }
  for (const k in x) thumbsIn(x[k], out, max);
}
async function images(id: string, q: string) {
  const found: { url: string; from: string }[] = [];
  const add = (urls: string[], from: string, max: number) => {
    for (const url of urls) {
      if (found.length >= 40 || max <= 0) return;
      if (!/^https:\/\//.test(url) || found.some((f) => f.url === url)) continue;
      found.push({ url, from }); max--;
    }
  };
  const jobs: Promise<void>[] = [];
  if (/^UC[A-Za-z0-9_-]{10,40}$/.test(id)) {
    // the artist page on YouTube Music: its picture first, then its album and single covers
    jobs.push((async () => {
      const res = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/", "User-Agent": YT_HEADERS["User-Agent"] },
        body: JSON.stringify({ context: { client: CLIENT }, browseId: id }),
      });
      if (!res.ok) return;
      const j = await res.json();
      const head: string[] = []; thumbsIn(j?.header, head, 4);
      add(head, "YouTube Music", 3);
      const rest: string[] = []; thumbsIn(j?.contents, rest, 30);
      add(rest, "YouTube Music", 8);
    })().catch(() => {}));
    // the channel on YouTube: its avatar and banner
    jobs.push((async () => {
      const res = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        method: "POST", headers: YT_HEADERS, body: JSON.stringify({ context: { client: WEB }, browseId: id }),
      });
      if (!res.ok) return;
      const j = await res.json();
      const head: string[] = []; thumbsIn(j?.header, head, 6); thumbsIn(j?.metadata, head, 8);
      add(head.filter((u) => !/i\.ytimg/.test(u)), "YouTube", 4);
    })().catch(() => {}));
  }
  if (q) {
    // the same name searched on both: the artists and channels it finds
    jobs.push((async () => {
      const [a, b] = await Promise.all([ytmSearch(q).catch(() => []), ytChannelSearch(q).catch(() => [])]);
      add([...a, ...b].filter((r) => r.thumbnail).map((r) => bigger(r.thumbnail)), "Search", 14);
    })());
  }
  await Promise.all(jobs);
  return found;
}

// ---- Google Drive: shared ("anyone with the link") folders and files the admins add ----
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|amr|mka)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|3gp|avi|mpeg|mpg|ts)$/i;
const unhtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).trim();
type DriveFile = { id: string; name: string; type: "audio" | "video" };

/** A Drive link (or bare id) -> {id, kind}. */
function parseDriveLink(link: string): { id: string; kind: "folder" | "file" } | null {
  const t = link.trim();
  let m = t.match(/\/folders\/([A-Za-z0-9_-]{10,100})/) || t.match(/folderview\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,100})/);
  if (m) return { id: m[1], kind: "folder" };
  m = t.match(/\/file\/d\/([A-Za-z0-9_-]{10,100})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,100})/);
  if (m) return { id: m[1], kind: "file" };
  if (/^[A-Za-z0-9_-]{25,100}$/.test(t)) return { id: t, kind: "folder" };
  return null;
}

const DRIVE_HEADERS = { "User-Agent": YT_HEADERS["User-Agent"], "Accept-Language": "en-US,en;q=0.9" };

/** One shared folder's own entries (audio / video files and sub-folders), from Drive's public folder view. */
async function folderEntries(folderId: string): Promise<{ title: string; files: DriveFile[]; subfolders: { id: string; name: string }[] }> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, { headers: DRIVE_HEADERS });
  if (!res.ok) throw new Error(res.status === 404 ? "folder not found or not shared" : `Drive answered ${res.status}`);
  const html = await res.text();
  if (!/flip-entry|flip-entries/.test(html)) throw new Error("folder not shared with \"Anyone with the link\"");
  const title = unhtml((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
  const files: DriveFile[] = [];
  const subfolders: { id: string; name: string }[] = [];
  for (const chunk of html.split(/class="flip-entry"/).slice(1)) {
    const id = (chunk.match(/id="entry-([A-Za-z0-9_-]+)"/) || [])[1];
    const href = (chunk.match(/href="([^"]+)"/) || [])[1] || "";
    const name = unhtml((chunk.match(/flip-entry-title">([^<]*)</) || [])[1] || "");
    if (!id || !name) continue;
    if (/\/folders\//.test(href)) { subfolders.push({ id, name }); continue; }
    const type = AUDIO_EXT.test(name) ? "audio" : VIDEO_EXT.test(name) ? "video" : null;
    if (type) files.push({ id, name, type });
  }
  subfolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { title, files, subfolders };
}

/** Runs [fn] over [items], [n] at a time. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** The files in a shared folder and its sub-folders (two levels down), read several at a time. */
async function listDriveFolder(folderId: string, depth = 0): Promise<{ title: string; files: DriveFile[] }> {
  const top = await folderEntries(folderId);
  const files = [...top.files];
  if (depth < 2 && top.subfolders.length) {
    const inner = await pool(top.subfolders.slice(0, 400), 8, async (sub) => {
      try { return (await listDriveFolder(sub.id, depth + 1)).files.map((f) => ({ ...f, name: `${sub.name} / ${f.name}` })); } catch { return []; }
    });
    for (const list of inner) files.push(...list);
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { title: top.title, files: files.slice(0, 3000) };
}

// ---- Collections: a shared folder of album folders ("Artist - Album"); each album goes to its artist ----
const nameKey = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0591-\u05C7\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function artistIndex(): Promise<Map<string, string>> {
  // the database answers at most 1000 rows at a time: read the artists page by page
  const a: any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await db.from("stalow_release_artists").select("artist_id,name").order("artist_id").range(from, from + 999);
    a.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const { data: c } = await db.from("stalow_catalog").select("entry_id,name,category,removed");
  const m = new Map<string, string>();
  for (const r of a) if (r.name) m.set(nameKey(r.name), r.artist_id);
  for (const r of c || []) if (r.name && r.category === "music" && !r.removed) m.set(nameKey(r.name), r.entry_id);
  return m;
}
/** "Artist - Album", "Artist & Other - Album" or "Album - Artist" -> the approved artist and the album name. */
function albumOf(folder: string, idx: Map<string, string>): { artistId: string | null; title: string; year: number | null } {
  const year = Number((folder.match(/\((19\d{2}|20\d{2})\)/) || [])[1]) || null;
  // "R' Cheskie Weisz", "Rabbi ...", "Reb ..." -> the name itself
  const find = (piece: string) => { const k = nameKey(piece); return idx.get(k) || idx.get(k.replace(/^(r|rabbi|reb|harav|rav)\s+/, "")) || null; };
  const parts = folder.split(/\s+[-–]\s+/);
  if (parts.length >= 2) {
    for (let i = 0; i < parts.length; i++) {
      for (const piece of [parts[i], ...parts[i].split(/\s*(?:&|,|\+|\band\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)]) {
        const id = find(piece);
        if (id) return { artistId: id, title: parts.filter((_, j) => j !== i).join(" - ").trim() || folder, year };
      }
    }
  }
  // no "Artist - Album": the folder name may start with the artist's name (the longest that fits)
  const k = nameKey(folder);
  let best: { id: string; len: number } | null = null;
  for (const [name, id] of idx) if (name.length >= 4 && (k === name || k.startsWith(name + " ")) && (!best || name.length > best.len)) best = { id, len: name.length };
  if (best) return { artistId: best.id, title: folder, year };
  return { artistId: null, title: folder, year };
}
/** Adds a collection's album folders that are not in the list yet (all of them the first time). */
async function importAlbums(collection: { drive_id: string; category: string; added_by?: string | null }, subfolders: { id: string; name: string }[]) {
  const { data: have } = await db.from("stalow_drive").select("drive_id,artist_id").eq("parent_id", collection.drive_id);
  const known = new Set((have || []).map((r: any) => r.drive_id));
  const fresh = subfolders.filter((s) => !known.has(s.id)).slice(0, 400);
  const unmatched = new Set((have || []).filter((r: any) => !r.artist_id).map((r: any) => r.drive_id));
  if (!fresh.length && !unmatched.size) return { added: 0, matched: 0 };
  const idx = await artistIndex();
  // albums added before without an artist: try again (the artist list may have grown)
  for (const sub of subfolders.filter((s) => unmatched.has(s.id))) {
    const a = albumOf(sub.name, idx);
    if (a.artistId) await db.from("stalow_drive").update({ artist_id: a.artistId, title: a.title, year: a.year }).eq("drive_id", sub.id);
  }
  if (!fresh.length) return { added: 0, matched: 0 };
  const now = new Date().toISOString();
  const rows = (await pool(fresh, 8, async (sub) => {
    let files: DriveFile[] = [];
    try { files = (await listDriveFolder(sub.id, 1)).files; } catch { /* unreadable: skipped */ }
    if (!files.length) return null;
    const a = albumOf(sub.name, idx);
    return { drive_id: sub.id, kind: "folder", title: a.title, category: collection.category, removed: false, files, listed_at: now, added_by: collection.added_by || null, artist_id: a.artistId, year: a.year, parent_id: collection.drive_id };
  })).filter(Boolean) as any[];
  if (rows.length) await db.from("stalow_drive").upsert(rows, { onConflict: "drive_id", ignoreDuplicates: true });
  return { added: rows.length, matched: rows.filter((r) => r.artist_id).length };
}
/** A collection is looked at again every half hour, so new album folders show up by themselves. */
async function refreshCollections() {
  const { data } = await db.from("stalow_drive").select("drive_id,category,added_by,listed_at").eq("kind", "collection").eq("removed", false);
  const stale = (data || []).filter((r: any) => !r.listed_at || Date.now() - Date.parse(r.listed_at) > 30 * 60 * 1000).slice(0, 3);
  for (const c of stale) {
    try {
      const top = await folderEntries(c.drive_id);
      const r = await importAlbums(c, top.subfolders);
      await db.from("stalow_drive").update({ listed_at: new Date().toISOString() }).eq("drive_id", c.drive_id);
      if (r.added) await bumpVersion();
    } catch { /* try again next time */ }
  }
}

/** A shared single file's name (its page title), or an error when it is not shared. */
async function driveFileName(fileId: string): Promise<string> {
  const res = await fetch(`https://drive.google.com/file/d/${fileId}/view`, { headers: DRIVE_HEADERS, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) throw new Error("file not shared with \"Anyone with the link\"");
  if (!res.ok) throw new Error(res.status === 404 ? "file not found" : `Drive answered ${res.status}`);
  const title = unhtml(((await res.text()).match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/\s*-\s*Google Drive\s*$/i, "");
  if (!title || /^Google Drive/i.test(title)) throw new Error("file not shared with \"Anyone with the link\"");
  return title;
}

const driveOut = (r: any) => ({ id: r.drive_id, parentId: r.parent_id || null, kind: r.kind, title: r.title, category: r.category, removed: r.removed, files: r.files || [], listedAt: r.listed_at, artistId: r.artist_id || null, year: r.year || null, copyStatus: r.copy_status || null, copyError: r.copy_error || null });
const ARTIST_ID = /^UC[A-Za-z0-9_-]{10,40}$/;

// ---- An artist's albums and singles on YouTube Music (Settings > Channels & artists > Albums) ----
type Album = { browseId: string; title: string; year: number | null; kind: string; thumbnail: string };
async function ytmBrowse(body: Record<string, unknown>, visitorData?: string) {
  const res = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/", "User-Agent": YT_HEADERS["User-Agent"], ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}) },
    body: JSON.stringify({ context: { client: { ...CLIENT, ...(visitorData ? { visitorData } : {}) } }, ...body }),
  });
  if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
  return await res.json();
}
function albumsIn(x: any, kind: string, out: Map<string, Album>) {
  (function walk(n: any) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const r = n.musicTwoRowItemRenderer;
    if (r) {
      const be = r.navigationEndpoint?.browseEndpoint;
      if (be?.browseId?.startsWith("MPRE") && !out.has(be.browseId)) {
        const sub = (r.subtitle?.runs || []).map((a: any) => a.text);
        const t = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        out.set(be.browseId, {
          browseId: be.browseId, title: (r.title?.runs || []).map((a: any) => a.text).join(""),
          year: Number(sub.find((s: string) => /^\d{4}$/.test(s))) || null,
          kind: /single|ep/i.test(sub[0] || "") ? "single" : kind,
          thumbnail: t.length ? t[t.length - 1].url : "",
        });
      }
      return;
    }
    for (const k in n) walk(n[k]);
  })(x);
}
async function artistAlbums(id: string): Promise<Album[]> {
  const page = await ytmBrowse({ browseId: id });
  const visitorData = page?.responseContext?.visitorData;
  const out = new Map<string, Album>();
  const shelves = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  for (const c of shelves) {
    const sh = c.musicCarouselShelfRenderer; if (!sh) continue;
    const head = sh.header?.musicCarouselShelfBasicHeaderRenderer;
    const name = (head?.title?.runs || []).map((a: any) => a.text).join("").toLowerCase();
    if (!/album|single|ep/.test(name)) continue;
    const kind = /single|ep/.test(name) ? "single" : "album";
    // the shelf's "More" opens the whole list
    const more = head?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint || head?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
    if (more?.browseId) {
      try { albumsIn(await ytmBrowse({ browseId: more.browseId, ...(more.params ? { params: more.params } : {}) }, visitorData), kind, out); } catch { /* fall back to the shelf */ }
    }
    albumsIn(sh.contents, kind, out);
  }
  return [...out.values()].sort((a, b) => (b.year || 0) - (a.year || 0));
}

/** Folders are read again when their copy is older than half an hour (new files show up by themselves). */
async function refreshDriveFolders(rows: any[]) {
  const stale = rows.filter((r) => r.kind === "folder" && !r.removed && (!r.listed_at || Date.now() - Date.parse(r.listed_at) > 30 * 60 * 1000));
  await Promise.all(stale.slice(0, 10).map(async (r) => {
    try {
      // a finished copy in the owner's Drive is what plays
      const { files } = await listDriveFolder(r.copy_status === "done" && r.copy_id ? r.copy_id : r.drive_id);
      r.files = files; r.listed_at = new Date().toISOString();
      await db.from("stalow_drive").update({ files, listed_at: r.listed_at }).eq("drive_id", r.drive_id);
    } catch { /* keep the last copy */ }
  }));
}

// ---- Copies in the owner's own Google Drive (Settings > Google Drive > Copy to my Google Drive) ----
// The owner installs a small Google Apps Script (server/drive-copier/Code.gs, sent to the app below) that copies
// each added folder or file into "Stalow Music" in their Drive; the apps then play the copies, which stay even
// if the original is deleted. Big folders are copied a part at a time (on add, then every 5 minutes).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const COPIER_SCRIPT = String.raw`// Stalow Music: copies the Google Drive folders and files the admins add into YOUR Google Drive
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
`;
const COPIER_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,120}\/exec$/;
async function copier() {
  const { data } = await db.from("stalow_drive_copier").select("*").eq("id", 1).single();
  return data && data.url && data.secret ? data : null;
}
async function callCopier(c: any, body: Record<string, unknown>) {
  const res = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, secret: c.secret }), redirect: "follow" });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(res.ok ? "the copier answered something else (is it deployed as a Web app for Anyone?)" : `the copier answered ${res.status}`); }
}
/** Copies (or carries on copying) one item into the owner's Drive; once done, the item plays from the copy. */
async function runCopy(c: any, r: any) {
  try {
    const out = await callCopier(c, { action: "copy", sourceId: r.drive_id, kind: r.kind, title: r.title, copyId: r.copy_id || undefined });
    if (out.error) throw new Error(out.error);
    const patch: Record<string, unknown> = { copy_id: out.copyId, copy_status: out.done ? "done" : "copying", copy_error: null };
    if (out.done) {
      patch.copied_at = new Date().toISOString();
      if (r.kind === "folder") {
        try { patch.files = (await listDriveFolder(out.copyId)).files; patch.listed_at = patch.copied_at; } catch { /* keep the list */ }
      } else {
        patch.files = (r.files || []).map((f: any) => ({ ...f, id: out.copyId }));
      }
    }
    await db.from("stalow_drive").update(patch).eq("drive_id", r.drive_id);
  } catch (e) {
    await db.from("stalow_drive").update({ copy_status: "failed", copy_error: String((e as Error).message || e).slice(0, 300) }).eq("drive_id", r.drive_id);
  }
}
/** The next items to copy: new ones, unfinished ones, and finished folders every 6 hours (for new files). */
async function copyTick(limit: number) {
  const c = await copier();
  if (!c) return { copied: 0 };
  const { data } = await db.from("stalow_drive").select("*").eq("removed", false).order("created_at", { ascending: true });
  const sixHours = Date.now() - 6 * 3600 * 1000;
  const due = (data || []).filter((r: any) => r.kind !== "collection").filter((r: any) => !r.copy_status || r.copy_status === "copying" ||
    (r.copy_status === "done" && r.kind === "folder" && (!r.copied_at || Date.parse(r.copied_at) < sixHours))).slice(0, limit);
  for (const r of due) await runCopy(c, r);
  return { copied: due.length };
}

// ---- Compare: Drive albums that YouTube Music now has (the Drive copy can then go) ----
const albumKey = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0591-\u05C7\u0300-\u036f]/g, "")
  .replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function sameAlbum(a: string, b: string) {
  const x = albumKey(a), y = albumKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // one name inside the other ("Album" vs "Album - Deluxe"), for names long enough to mean something
  return Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x));
}

async function bumpVersion() {
  const { data } = await db.from("stalow_account_state").select("catalog_version").eq("id", 1).single();
  await db.from("stalow_account_state").update({ catalog_version: (data?.catalog_version || 1) + 1 }).eq("id", 1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  // the scheduler (every 5 minutes) carries on copying into the owner's Drive
  if (b?.action === "drive.copyTick") {
    const { data } = await db.from("stalow_drive_copier").select("tick_key").eq("id", 1).single();
    if (!data || typeof b.tickKey !== "string" || b.tickKey !== data.tick_key) return json({ error: "not allowed" }, 403);
    return json(await copyTick(1));
  }
  if (!validKey(b?.key)) return json({ error: "bad key" }, 400);
  try {
    if (b.action === "register") {
      const name = clean(b.name, 60);
      if (!name) return json({ error: "name needed" }, 400);
      const existing = await accountFor(b.key);
      if (existing) return json(existing);
      const { count } = await db.from("stalow_accounts").select("id", { count: "exact", head: true }).eq("status", "pending");
      if ((count ?? 0) >= MAX_PENDING) return json({ error: "too many requests waiting" }, 429);
      const { data, error } = await db.from("stalow_accounts")
        .insert({ key_hash: await sha256("stalow-account:" + b.key), name, device: clean(b.device, 80) })
        .select("id,name,status,role").single();
      if (error) return json({ error: "sign up failed" }, 500);
      return json(data);
    }

    const me = await accountFor(b.key);
    if (!me) return json({ status: "unknown" });
    await db.from("stalow_accounts").update({ last_seen: new Date().toISOString() }).eq("id", me.id);

    if (b.action === "status") return json(me);

    if (b.action === "claimOwner") {
      const { data: st } = await db.from("stalow_account_state").select("owner_claim_code").eq("id", 1).single();
      if (!st?.owner_claim_code || typeof b.code !== "string" || b.code.trim().toLowerCase() !== st.owner_claim_code) return json({ error: "wrong code" }, 403);
      await db.from("stalow_account_state").update({ owner_claim_code: null }).eq("id", 1); // one time only
      const { data } = await db.from("stalow_accounts").update({ status: "approved", role: "owner", decided_by: me.id, decided_at: new Date().toISOString() })
        .eq("id", me.id).select("id,name,status,role").single();
      return json(data);
    }

    if (b.action === "catalog.get") {
      if (me.status !== "approved") return json({ error: "not approved" }, 403);
      const [{ data: st }, { data: entries }] = await Promise.all([
        db.from("stalow_account_state").select("catalog_version").eq("id", 1).single(),
        db.from("stalow_catalog").select("entry_id,name,thumbnail,category,removed"),
      ]);
      return json({ version: st?.catalog_version || 1, entries: (entries || []).map((e: any) => ({ id: e.entry_id, name: e.name, thumbnail: e.thumbnail, category: e.category, removed: e.removed })) });
    }

    if (b.action === "drive.list") {
      if (me.status !== "approved") return json({ error: "not approved" }, 403);
      await refreshCollections();
      const { data } = await db.from("stalow_drive").select("*").eq("removed", false).neq("kind", "collection").order("created_at", { ascending: true });
      const rows = data || [];
      await refreshDriveFolders(rows);
      return json({ items: rows.map(driveOut) });
    }

    // ---- admins only from here ----
    if (!isAdmin(me)) return json({ error: "admins only" }, 403);

    if (b.action === "accounts.list") {
      const { data } = await db.from("stalow_accounts").select("id,name,device,status,role,created_at,last_seen").order("created_at", { ascending: false }).limit(1000);
      return json({ me: me.id, accounts: data || [] });
    }

    if (b.action === "accounts.decide") {
      const { data: target } = await db.from("stalow_accounts").select("id,role").eq("id", String(b.id || "")).maybeSingle();
      if (!target) return json({ error: "no such account" }, 404);
      if (target.role === "owner") return json({ error: "the owner can't be changed" }, 403);
      const patch: Record<string, unknown> = { decided_by: me.id, decided_at: new Date().toISOString() };
      if (["pending", "approved", "blocked"].includes(b.status)) patch.status = b.status;
      if (["user", "admin"].includes(b.role)) patch.role = b.role;
      const { data } = await db.from("stalow_accounts").update(patch).eq("id", target.id).select("id,name,device,status,role,created_at,last_seen").single();
      return json(data);
    }

    if (b.action === "catalog.search") {
      const q = clean(b.q, 100);
      if (!q) return json({ results: [] });
      return json({ results: await search(q) });
    }

    if (b.action === "catalog.images") {
      const id = typeof b.id === "string" ? b.id : "";
      return json({ images: await images(id, clean(b.q, 100)) });
    }

    if (b.action === "catalog.albums") {
      const id = typeof b.id === "string" && ARTIST_ID.test(b.id) ? b.id : "";
      if (!id) return json({ error: "bad artist" }, 400);
      const [albums, { data }] = await Promise.all([
        artistAlbums(id).catch(() => [] as Album[]),
        db.from("stalow_drive").select("*").eq("artist_id", id).order("created_at", { ascending: true }),
      ]);
      return json({ albums, drive: (data || []).map(driveOut) });
    }

    if (b.action === "catalog.compare") {
      const id = typeof b.id === "string" && ARTIST_ID.test(b.id) ? b.id : "";
      if (!id) return json({ error: "bad artist" }, 400);
      const [albums, { data }] = await Promise.all([
        artistAlbums(id),
        db.from("stalow_drive").select("*").eq("artist_id", id).eq("removed", false),
      ]);
      const results = (data || []).map((d: any) => {
        const match = albums.find((a) => sameAlbum(a.title, d.title));
        return { drive: driveOut(d), match: match || null };
      });
      return json({ results, youtubeCount: albums.length });
    }

    if (b.action === "drive.all") {
      const { data } = await db.from("stalow_drive").select("*").order("created_at", { ascending: true });
      return json({ items: (data || []).map(driveOut) });
    }

    if (b.action === "drive.add") {
      const parsed = parseDriveLink(clean(b.link, 500));
      if (!parsed) return json({ error: "not a Google Drive link" }, 400);
      if (!CATEGORIES.has(b.category)) return json({ error: "choose a section" }, 400);
      let title = clean(b.title, 200), files: DriveFile[] = [];
      // a folder of album folders (and no songs of its own) is a collection: each album goes to its artist
      if (parsed.kind === "folder" && b.asAlbums !== false) {
        let top;
        try { top = await folderEntries(parsed.id); } catch (e) { return json({ error: String((e as Error).message || e) }, 400); }
        if (!top.files.length && top.subfolders.length >= 2) {
          const col = { drive_id: parsed.id, kind: "collection", title: title || top.title || "Google Drive", category: b.category, removed: false, files: [], listed_at: new Date().toISOString(), added_by: me.id };
          const { error } = await db.from("stalow_drive").upsert(col, { onConflict: "drive_id" });
          if (error) return json({ error: "save failed" }, 500);
          const r = await importAlbums(col, top.subfolders);
          await bumpVersion();
          const c = await copier();
          if (c) EdgeRuntime.waitUntil(copyTick(2));
          return json({ item: driveOut(col), albums: r.added, matched: r.matched });
        }
      }
      try {
        if (parsed.kind === "folder") {
          const listed = await listDriveFolder(parsed.id);
          files = listed.files;
          if (!files.length) return json({ error: "no audio or video files in this folder" }, 400);
          title = title || listed.title || "Google Drive";
        } else {
          const name = await driveFileName(parsed.id);
          const type = AUDIO_EXT.test(name) ? "audio" : VIDEO_EXT.test(name) ? "video" : null;
          if (!type) return json({ error: "not an audio or video file" }, 400);
          files = [{ id: parsed.id, name, type }];
          title = title || name.replace(/\.[^.]+$/, "");
        }
      } catch (e) { return json({ error: String((e as Error).message || e) }, 400); }
      const artistId = typeof b.artistId === "string" && ARTIST_ID.test(b.artistId) ? b.artistId : null;
      const year = Number(b.year) >= 1900 && Number(b.year) <= 2100 ? Number(b.year) : null;
      const row = { drive_id: parsed.id, kind: parsed.kind, title, category: b.category, removed: false, files, listed_at: new Date().toISOString(), added_by: me.id, artist_id: artistId, year };
      const { error } = await db.from("stalow_drive").upsert(row, { onConflict: "drive_id" });
      if (error) return json({ error: "save failed" }, 500);
      await bumpVersion();
      // with the owner's copier connected, start copying it into their Drive now
      const c = await copier();
      if (c) EdgeRuntime.waitUntil(runCopy(c, row));
      return json({ item: driveOut({ ...row, copy_status: c ? "copying" : null }) });
    }

    if (b.action === "drive.copier.get") {
      const { data } = await db.from("stalow_drive_copier").select("url,root_url,connected_at").eq("id", 1).single();
      return json({ connected: !!data?.url, rootUrl: data?.root_url || null, connectedAt: data?.connected_at || null, owner: me.role === "owner", script: COPIER_SCRIPT });
    }

    if (b.action === "drive.copier.set") {
      if (me.role !== "owner") return json({ error: "only the owner can connect their Google Drive" }, 403);
      const url = clean(b.url, 300);
      if (!COPIER_URL.test(url)) return json({ error: "paste the Web app URL (it ends with /exec)" }, 400);
      const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
      let out: any;
      try { out = await callCopier({ url, secret }, { action: "connect" }); } catch (e) { return json({ error: String((e as Error).message || e) }, 400); }
      if (!out?.ok) return json({ error: out?.error === "wrong key" ? "this script was connected before: in the script, Project Settings > Script Properties, delete SECRET, then try again" : (out?.error || "the copier did not answer") }, 400);
      await db.from("stalow_drive_copier").update({ url, secret, root_url: out.rootUrl || null, connected_at: new Date().toISOString() }).eq("id", 1);
      await db.from("stalow_drive").update({ copy_status: null, copy_error: null }).eq("copy_status", "failed");
      EdgeRuntime.waitUntil(copyTick(3));
      return json({ connected: true, rootUrl: out.rootUrl || null });
    }

    if (b.action === "drive.copier.clear") {
      if (me.role !== "owner") return json({ error: "only the owner can disconnect their Google Drive" }, 403);
      await db.from("stalow_drive_copier").update({ url: null, secret: null, root_url: null, connected_at: null }).eq("id", 1);
      return json({ connected: false });
    }

    if (b.action === "drive.set") {
      const patch: Record<string, unknown> = {};
      if (typeof b.title === "string" && clean(b.title, 200)) patch.title = clean(b.title, 200);
      if (CATEGORIES.has(b.category)) patch.category = b.category;
      if (typeof b.removed === "boolean") patch.removed = b.removed;
      if (b.refresh === true) patch.listed_at = null;
      // removing it can also move the copy in the owner's Drive to the bin (e.g. the album is now on YouTube Music)
      if (b.removed === true && b.deleteCopy === true) {
        const { data: row } = await db.from("stalow_drive").select("*").eq("drive_id", String(b.id || "")).maybeSingle();
        const c = await copier();
        if (row?.copy_id && c) {
          let out: any;
          try { out = await callCopier(c, { action: "trash", kind: row.kind, copyId: row.copy_id }); } catch (e) { return json({ error: String((e as Error).message || e) }, 400); }
          if (out?.error) return json({ error: out.error }, 400);
          patch.copy_id = null; patch.copy_status = null;
        }
      }
      if (b.artistId === null || (typeof b.artistId === "string" && ARTIST_ID.test(b.artistId))) patch.artist_id = b.artistId;
      if (b.year === null || (Number(b.year) >= 1900 && Number(b.year) <= 2100)) patch.year = b.year === null ? null : Number(b.year);
      const { data, error } = await db.from("stalow_drive").update(patch).eq("drive_id", String(b.id || "")).select("*").maybeSingle();
      if (error || !data) return json({ error: "no such item" }, 404);
      if (data.kind === "collection" && typeof b.removed === "boolean") await db.from("stalow_drive").update({ removed: b.removed }).eq("parent_id", data.drive_id);
      if (data.kind === "collection" && b.refresh === true) {
        try { const top = await folderEntries(data.drive_id); await importAlbums(data, top.subfolders); } catch { /* next time */ }
      }
      await bumpVersion();
      return json({ item: driveOut(data) });
    }

    if (b.action === "catalog.set") {
      const e = b.entry || {};
      if (typeof e.id !== "string" || !/^UC[A-Za-z0-9_-]{10,40}$/.test(e.id) || !CATEGORIES.has(e.category)) return json({ error: "bad entry" }, 400);
      const row = {
        entry_id: e.id, name: clean(e.name, 200), category: e.category, removed: e.removed === true, updated_by: me.id, updated_at: new Date().toISOString(),
        thumbnail: typeof e.thumbnail === "string" && /^https:\/\//.test(e.thumbnail) ? e.thumbnail.slice(0, 500) : "",
      };
      const { error } = await db.from("stalow_catalog").upsert(row, { onConflict: "entry_id" });
      if (error) return json({ error: "save failed" }, 500);
      await bumpVersion();
      // New releases follows the list: music artists are checked, anything else is not
      if (row.category === "music" && !row.removed) await db.from("stalow_release_artists").upsert({ artist_id: row.entry_id, name: row.name }, { onConflict: "artist_id" });
      else { await db.from("stalow_release_artists").delete().eq("artist_id", row.entry_id); await db.from("stalow_releases").delete().eq("artist_id", row.entry_id); }
      return json({ saved: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "failed", message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
