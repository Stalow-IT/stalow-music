// Stalow Music phone <-> PC sync. The apps have no accounts in this project: they hold a private sync code
// (made on the first device, typed on the others). This function is the only way to the stalow_sync table:
// it stores rows under sha256(code), so a code is never stored, and one code can never see another's rows.
// Deployed as the Supabase edge function "stalow-sync" (verify_jwt off) in the it-manager project.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KINDS = new Set(["history", "like", "download", "settings", "session"]);
const MAX_PUSH = 500;            // rows per request
const MAX_ROWS = 5000;           // rows per sync code
const MAX_HISTORY = 500;         // history rows kept per sync code
const MAX_DATA = 16 * 1024;      // bytes per row

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** "ABCD-EFGH-..." -> "ABCDEFGH..."; a code is 24 letters/digits (base32), about 120 bits. */
function cleanCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{24}$/.test(c) ? c : null;
}

async function syncId(code: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("stalow-music-sync:" + code));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const code = cleanCode(body?.code);
  if (!code) return json({ error: "bad sync code" }, 400);
  const sid = await syncId(code);
  const device = typeof body.device === "string" ? body.device.slice(0, 64) : null;

  if (body.action === "pull") {
    // everything changed since [since] (server time), oldest first; the client keeps the last updated_at
    let q = db.from("stalow_sync").select("kind,key,data,deleted,device,updated_at").eq("sync_id", sid).order("updated_at", { ascending: true }).limit(1000);
    if (typeof body.since === "string" && !isNaN(Date.parse(body.since))) q = q.gte("updated_at", body.since);
    const { data, error } = await q;
    if (error) return json({ error: "pull failed" }, 500);
    return json({ items: data, now: new Date().toISOString() });
  }

  if (body.action === "push") {
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_PUSH) : [];
    const rows = [];
    for (const it of items) {
      if (!it || !KINDS.has(it.kind) || typeof it.key !== "string" || !it.key || it.key.length > 64) continue;
      const data = it.data && typeof it.data === "object" ? it.data : {};
      if (JSON.stringify(data).length > MAX_DATA) continue;
      rows.push({ sync_id: sid, kind: it.kind, key: it.key, data, deleted: !!it.deleted, device });
    }
    if (!rows.length) return json({ saved: 0 });
    const { count } = await db.from("stalow_sync").select("key", { count: "exact", head: true }).eq("sync_id", sid);
    if ((count ?? 0) + rows.length > MAX_ROWS + MAX_PUSH) return json({ error: "this sync code is full" }, 413);
    const { error } = await db.from("stalow_sync").upsert(rows, { onConflict: "sync_id,kind,key" });
    if (error) return json({ error: "push failed" }, 500);
    // keep only the newest history rows
    if (rows.some((r) => r.kind === "history")) {
      const { data: old } = await db.from("stalow_sync").select("key").eq("sync_id", sid).eq("kind", "history").order("updated_at", { ascending: false }).range(MAX_HISTORY, MAX_HISTORY + 1000);
      if (old && old.length) await db.from("stalow_sync").delete().eq("sync_id", sid).eq("kind", "history").in("key", old.map((o) => o.key));
    }
    return json({ saved: rows.length, now: new Date().toISOString() });
  }

  if (body.action === "forget") {
    // "Stop syncing and delete my synced data"
    const { error } = await db.from("stalow_sync").delete().eq("sync_id", sid);
    if (error) return json({ error: "delete failed" }, 500);
    return json({ deleted: true });
  }

  return json({ error: "unknown action" }, 400);
});
