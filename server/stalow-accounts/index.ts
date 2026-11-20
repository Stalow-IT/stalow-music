// Stalow Music accounts and the admin-managed channel / artist list.
// A device makes a private key, signs up with a name and waits; an admin approves it (as user or admin).
// The key is never stored, only its sha256. All requests: POST {action, key, ...}.
//   register {name, device}  status  claimOwner {code}
//   accounts.list  accounts.decide {id, status?, role?}            (admins)
//   catalog.get                                                     (approved accounts)
//   catalog.set {entry:{id,name,thumbnail,category,removed}}  catalog.search {q}   (admins)
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
