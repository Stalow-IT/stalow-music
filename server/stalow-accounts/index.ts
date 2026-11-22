// Stalow Music accounts and the admin-managed channel / artist list.
// A device makes a private key, signs up with a name and waits; an admin approves it (as user or admin).
// The key is never stored, only its sha256. All requests: POST {action, key, ...}.
//   register {name, device}  status  claimOwner {code}
//   accounts.list  accounts.decide {id, status?, role?}            (admins)
//   catalog.get                                                     (approved accounts)
//   catalog.set {entry:{id,name,thumbnail,category,removed}}  catalog.search {q}  catalog.images {id, q}   (admins)
//   drive.list (approved)   drive.all  drive.add {link, category, title?, artistId?, year?}  drive.set {id, title?, category?, removed?, refresh?, artistId?, year?}  catalog.albums {id}   (admins)
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

/** The files in a shared folder (and its sub-folders, two levels down), from Drive's public folder view. */
async function listDriveFolder(folderId: string, depth = 0, seen = new Set<string>()): Promise<{ title: string; files: DriveFile[] }> {
  if (seen.has(folderId) || seen.size > 40) return { title: "", files: [] };
  seen.add(folderId);
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
  if (depth < 2) {
    for (const sub of subfolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      try {
        const inner = await listDriveFolder(sub.id, depth + 1, seen);
        files.push(...inner.files.map((f) => ({ ...f, name: `${sub.name} / ${f.name}` })));
      } catch { /* a sub-folder that can't be read is skipped */ }
      if (files.length > 1000) break;
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { title, files: files.slice(0, 1000) };
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

const driveOut = (r: any) => ({ id: r.drive_id, kind: r.kind, title: r.title, category: r.category, removed: r.removed, files: r.files || [], listedAt: r.listed_at, artistId: r.artist_id || null, year: r.year || null });
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
      const { files } = await listDriveFolder(r.drive_id);
      r.files = files; r.listed_at = new Date().toISOString();
      await db.from("stalow_drive").update({ files, listed_at: r.listed_at }).eq("drive_id", r.drive_id);
    } catch { /* keep the last copy */ }
  }));
}

async function bumpVersion() {
  const { data } = await db.from("stalow_account_state").select("catalog_version").eq("id", 1).single();
  await db.from("stalow_account_state").update({ catalog_version: (data?.catalog_version || 1) + 1 }).eq("id", 1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
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
      const { data } = await db.from("stalow_drive").select("*").eq("removed", false).order("created_at", { ascending: true });
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

    if (b.action === "drive.all") {
      const { data } = await db.from("stalow_drive").select("*").order("created_at", { ascending: true });
      return json({ items: (data || []).map(driveOut) });
    }

    if (b.action === "drive.add") {
      const parsed = parseDriveLink(clean(b.link, 500));
      if (!parsed) return json({ error: "not a Google Drive link" }, 400);
      if (!CATEGORIES.has(b.category)) return json({ error: "choose a section" }, 400);
      let title = clean(b.title, 200), files: DriveFile[] = [];
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
      return json({ item: driveOut(row) });
    }

    if (b.action === "drive.set") {
      const patch: Record<string, unknown> = {};
      if (typeof b.title === "string" && clean(b.title, 200)) patch.title = clean(b.title, 200);
      if (CATEGORIES.has(b.category)) patch.category = b.category;
      if (typeof b.removed === "boolean") patch.removed = b.removed;
      if (b.refresh === true) patch.listed_at = null;
      if (b.artistId === null || (typeof b.artistId === "string" && ARTIST_ID.test(b.artistId))) patch.artist_id = b.artistId;
      if (b.year === null || (Number(b.year) >= 1900 && Number(b.year) <= 2100)) patch.year = b.year === null ? null : Number(b.year);
      const { data, error } = await db.from("stalow_drive").update(patch).eq("drive_id", String(b.id || "")).select("*").maybeSingle();
      if (error || !data) return json({ error: "no such item" }, 404);
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
