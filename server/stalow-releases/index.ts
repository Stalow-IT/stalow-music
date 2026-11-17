// Stalow Music "New releases": the approved artists' new albums and singles, newest first.
//
// GET  (or POST {action:"feed"})          -> the feed the apps show (no key needed; public data)
// POST {action:"scan", key}               -> checks the next artists on YouTube Music (run by the scheduler)
// POST {action:"seed", key, artists:[...]} -> sets the approved artists to check
//
// An artist's first check records what is already there as "baseline" (not new). Anything found on a later
// check is new from that moment (first_seen), so the list is truly newest first. Until the first full round
// is done, this year's releases fill the list.
// Deployed as the Supabase edge function "stalow-releases" (verify_jwt off) in the it-manager project.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SCAN_BATCH = 30;        // artists per scheduled run
const PARALLEL = 5;           // YouTube Music requests at once
const NEW_DAYS = 60;          // how long a release counts as new
const FEED_MAX = 150;
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20260707.12.00", hl: "en", gl: "US" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

let visitorData: string | null = null;
async function browse(browseId: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": UA, Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/" };
  if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;
  const res = await fetch("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", {
    method: "POST", headers,
    body: JSON.stringify({ context: { client: { ...CLIENT, ...(visitorData ? { visitorData } : {}) } }, browseId }),
  });
  if (!res.ok) throw new Error(`YouTube Music HTTP ${res.status}`);
  const j = await res.json();
  visitorData = visitorData || j?.responseContext?.visitorData || null;
  return j;
}

const runsText = (o: any) => (o?.runs || []).map((r: any) => r.text).join("") || o?.simpleText || "";
const bestThumb = (o: any) => { const t = o?.musicThumbnailRenderer?.thumbnail?.thumbnails || []; return t.length ? t[t.length - 1].url : ""; };

type Release = { browse_id: string; artist_id: string; artist_name: string; title: string; playlist_id: string; thumbnail: string; year: number | null; kind: string };

/** An artist page's Albums and Singles shelves (newest first on YouTube Music). */
function releasesOf(page: any, artistId: string, artistName: string): Release[] {
  const out: Release[] = [];
  const contents = page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  for (const c of contents) {
    const s = c.musicCarouselShelfRenderer; if (!s) continue;
    const shelf = runsText(s.header?.musicCarouselShelfBasicHeaderRenderer?.title).toLowerCase();
    if (!/album|single|ep/.test(shelf)) continue;
    for (const x of s.contents || []) {
      const r = x.musicTwoRowItemRenderer; if (!r) continue;
      const be = r.navigationEndpoint?.browseEndpoint;
      const pt = be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";
      if (!be?.browseId || !/^MPRE/.test(be.browseId) || !/ALBUM/.test(pt)) continue;
      const sub = (r.subtitle?.runs || []).map((a: any) => a.text);
      const year = Number(sub.find((t: string) => /^\d{4}$/.test(t))) || null;
      out.push({
        browse_id: be.browseId, artist_id: artistId, artist_name: artistName,
        title: runsText(r.title).slice(0, 300) || "Untitled",
        playlist_id: r.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId || "",
        thumbnail: bestThumb(r.thumbnailRenderer), year,
        kind: /single|ep/.test(shelf) || /single|ep/i.test(sub[0] || "") ? "single" : "album",
      });
    }
  }
  return out;
}

async function checkKey(key: unknown): Promise<boolean> {
  if (typeof key !== "string" || key.length < 20) return false;
  const { data } = await db.from("stalow_release_state").select("scan_key").eq("id", 1).single();
  return !!data && data.scan_key === key;
}

async function scan() {
  const { data: artists, error } = await db.from("stalow_release_artists").select("artist_id,name,last_scanned")
    .order("last_scanned", { ascending: true, nullsFirst: true }).limit(SCAN_BATCH);
  if (error) throw error;
  let found = 0, added = 0, failed = 0;
  const queue = [...(artists || [])];
  const work = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        const list = releasesOf(await browse(a.artist_id), a.artist_id, a.name);
        found += list.length;
        if (list.length) {
          const rows = list.map((r) => ({ ...r, baseline: a.last_scanned === null }));
          // ignoreDuplicates: a release keeps the first_seen of when it was first found
          const { data: ins } = await db.from("stalow_releases").upsert(rows, { onConflict: "browse_id", ignoreDuplicates: true }).select("browse_id");
          added += ins?.length || 0;
        }
        await db.from("stalow_release_artists").update({ last_scanned: new Date().toISOString() }).eq("artist_id", a.artist_id);
      } catch (_e) {
        failed++;
        // try this artist again later rather than holding up the round
        await db.from("stalow_release_artists").update({ last_scanned: new Date().toISOString() }).eq("artist_id", a.artist_id);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, work));
  return { checked: artists?.length || 0, found, added, failed };
}

async function feed() {
  const since = new Date(Date.now() - NEW_DAYS * 86400000).toISOString();
  const thisYear = new Date().getUTCFullYear();
  const cols = "browse_id,artist_id,artist_name,title,playlist_id,thumbnail,year,first_seen";
  const fresh = await db.from("stalow_releases").select(cols).eq("baseline", false).gte("first_seen", since).order("first_seen", { ascending: false }).limit(FEED_MAX);
  let rows = fresh.data || [];
  if (rows.length < 30) {
    // while the first round builds up: this year's releases the artists already had
    const base = await db.from("stalow_releases").select(cols).eq("baseline", true).gte("year", thisYear).order("first_seen", { ascending: false }).limit(FEED_MAX - rows.length);
    rows = rows.concat(base.data || []);
  }
  const releases = rows.map((r: any) => ({
    artistId: r.artist_id, artistName: r.artist_name, title: r.title, browseId: r.browse_id,
    playlistId: r.playlist_id, thumbnail: r.thumbnail, year: r.year, uploadDate: String(r.first_seen).slice(0, 10),
  }));
  return { generatedAt: new Date().toISOString(), windowDays: NEW_DAYS, count: releases.length, releases };
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") return json(await feed(), 200, { "Cache-Control": "public, max-age=900" });
    if (req.method !== "POST") return json({ error: "GET or POST" }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (!body?.action || body.action === "feed") return json(await feed());
    if (!(await checkKey(body.key))) return json({ error: "not allowed" }, 403);
    if (body.action === "scan") return json(await scan());
    if (body.action === "seed") {
      const list = (Array.isArray(body.artists) ? body.artists : [])
        .filter((a: any) => typeof a?.id === "string" && /^UC[A-Za-z0-9_-]{10,40}$/.test(a.id))
        .map((a: any) => ({ artist_id: a.id, name: String(a.name || "").slice(0, 200) }));
      if (!list.length || list.length > 5000) return json({ error: "no artists" }, 400);
      const { error } = await db.from("stalow_release_artists").upsert(list, { onConflict: "artist_id", ignoreDuplicates: false });
      if (error) return json({ error: "seed failed" }, 500);
      // artists no longer approved stop being checked, and their releases leave the list
      const ids = new Set(list.map((a: any) => a.artist_id));
      const { data: all } = await db.from("stalow_release_artists").select("artist_id");
      const gone = (all || []).map((a: any) => a.artist_id).filter((id: string) => !ids.has(id));
      if (gone.length) {
        await db.from("stalow_release_artists").delete().in("artist_id", gone);
        await db.from("stalow_releases").delete().in("artist_id", gone);
      }
      return json({ artists: list.length, removed: gone.length });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "failed", message: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
