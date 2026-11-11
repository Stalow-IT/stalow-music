package com.jtech.zemer.pcsync

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * Phone <-> PC sync through Stalow's server (the `stalow-sync` function). There are no accounts: the first device
 * makes a private sync code (24 letters/digits) and the others type it in; the server keeps each code's data
 * apart and stores only a hash of the code. The Windows app (src/sync.js) speaks the same protocol. Shared:
 *   history   recently played songs
 *   like      liked songs (an unlike is a row with deleted = true)
 *   download  the list of downloaded songs - each device downloads the songs itself, no song files go online
 *   settings  the settings both apps have, under the Windows app's names
 *   session   what each device is playing, for "Continue from your PC"
 *
 * Plain Kotlin (org.json + an injected transport) so it is unit tested without Android.
 */
object SyncProtocol {
    const val URL = "https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-sync"
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /** A new sync code: 24 characters in groups of four, about 120 bits. */
    fun newCode(random: SecureRandom = SecureRandom()): String =
        (1..24).map { ALPHABET[random.nextInt(32)] }.joinToString("").chunked(4).joinToString("-")

    /** "abcd efgh-..." -> "ABCD-EFGH-..."; null when it is not a sync code. */
    fun cleanCode(text: String?): String? {
        val c = (text ?: "").uppercase().replace(Regex("[\\s-]"), "")
        return if (Regex("^[A-Z2-7]{24}$").matches(c)) c.chunked(4).joinToString("-") else null
    }

    /**
     * What counts as a change, per kind - the same rules as the Windows app. The two apps store songs a little
     * differently, so only what matters is compared: when it was played / liked (to the second), whether it is
     * liked or downloaded, the setting's value, and for what is playing, the song and the position to 30 s.
     */
    fun fingerprint(kind: String, data: JSONObject?, deleted: Boolean): String {
        val d = data ?: JSONObject()
        fun sec(key: String) = Math.floorDiv(d.optLong(key, 0L), 1000L)
        return when (kind) {
            "history" -> "h:${sec("playedAt")}"
            "like" -> "l:${if (deleted) 0 else 1}:${sec("likedAt")}"
            "download" -> "d:${if (deleted) 0 else 1}"
            "settings" -> "s:${jsValue(if (d.has("value")) d.opt("value") else null)}"
            "session" -> "p:${d.optLong("at", 0L)}:${Math.floorDiv(d.optDouble("time", 0.0).toLong(), 30L)}"
            else -> "x:$d:$deleted"
        }
    }

    /** JSON.stringify of a single value, as the Windows app writes it. */
    fun jsValue(v: Any?): String = when (v) {
        null, JSONObject.NULL -> "null"
        is Boolean -> v.toString()
        is String -> JSONObject.quote(v)
        is Number -> if (v.toDouble() == Math.floor(v.toDouble()) && !v.toDouble().isInfinite()) v.toLong().toString() else v.toString()
        else -> v.toString()
    }

    /** Settings both apps have, under the Windows app's names. */
    val SHARED_SETTINGS = listOf(
        "theme", "allowFemale", "blockPodcasts", "blockVideos", "audioNormalization", "skipSilence", "persistentQueue",
        "autoLoadMore", "lyricsWordSync", "lyricsAutoScroll", "lyricsPosition", "pauseListenHistory", "pauseSearchHistory",
    )
}

/** This device's data, as the sync sees it. Songs are JSON: id, title, artists [{id, name}], album, thumbnail, duration. */
interface SyncLocal {
    /** Recently played, newest first, each with playedAt (ms). */
    suspend fun history(): List<JSONObject>
    /** Plays from the other devices (each song with playedAt) to add to this device's history. */
    suspend fun addPlays(songs: List<JSONObject>)
    /** The liked songs, each with likedAt (ms). */
    suspend fun likes(): List<JSONObject>
    /** Likes or unlikes a song (the song may not be on this device yet). */
    suspend fun setLike(song: JSONObject, liked: Boolean)
    /** The downloaded songs. */
    suspend fun downloads(): List<JSONObject>
    /** Songs downloaded on another device: download them here too. */
    suspend fun download(songs: List<JSONObject>)
    /** The shared settings this device holds (Windows names, Windows values). */
    suspend fun settings(): Map<String, Any>
    /** Applies settings from another device. */
    suspend fun applySettings(changes: Map<String, Any?>)
    /** What is playing here: { queue, index, time (s), at }, or null. */
    suspend fun session(): JSONObject?
}

data class PcSyncStatus(
    val code: String? = null,
    val state: String = "off", // off | idle | syncing | error
    val lastSync: Long? = null,
    val error: String? = null,
)

class SyncEngine(
    private val stateFile: File,
    private val deviceName: String,
    private val transport: suspend (JSONObject) -> JSONObject,
    private val local: SyncLocal,
    private val now: () -> Long = System::currentTimeMillis,
    private val onChange: (PcSyncStatus) -> Unit = {},
) {
    private var state: JSONObject = load()
    private val mutex = kotlinx.coroutines.sync.Mutex()

    var status: PcSyncStatus = PcSyncStatus(code = state.optString("code").ifEmpty { null }, state = if (state.optString("code").isEmpty()) "off" else "idle", lastSync = state.optLong("lastSync").takeIf { it > 0 })
        private set

    val code: String? get() = state.optString("code").ifEmpty { null }

    /** What the other devices are playing (device id -> session with device name and updatedAt). */
    fun remoteSessions(): List<JSONObject> {
        val o = state.optJSONObject("remoteSessions") ?: return emptyList()
        return o.keys().asSequence().mapNotNull { o.optJSONObject(it) }.toList()
    }

    private fun load(): JSONObject {
        val s = runCatching { JSONObject(stateFile.readText()) }.getOrElse { JSONObject() }
        if (s.optString("deviceId").isEmpty()) s.put("deviceId", (1..16).map { "0123456789abcdef"[SecureRandom().nextInt(16)] }.joinToString(""))
        if (s.optJSONObject("pushed") == null) s.put("pushed", JSONObject())
        if (s.optJSONObject("unliked") == null) s.put("unliked", JSONObject())
        return s
    }

    private fun save() {
        runCatching {
            val tmp = File(stateFile.path + ".tmp")
            tmp.writeText(state.toString())
            if (!tmp.renameTo(stateFile)) { stateFile.writeText(state.toString()); tmp.delete() }
        }
    }

    private fun setStatus(s: PcSyncStatus) { status = s; onChange(s) }
    private val pushed get() = state.getJSONObject("pushed")
    private val unliked get() = state.getJSONObject("unliked")
    private val deviceId get() = state.getString("deviceId")

    /** Starts syncing with a new code (this is the first device). */
    suspend fun create(): PcSyncStatus = join(SyncProtocol.newCode())

    /** Starts syncing with a code made on another device. */
    suspend fun join(text: String): PcSyncStatus {
        val code = SyncProtocol.cleanCode(text) ?: throw IllegalArgumentException("That is not a sync code (24 letters and digits)")
        mutex.lock()
        try {
            state = JSONObject().put("deviceId", deviceId).put("code", code).put("pushed", JSONObject()).put("unliked", JSONObject()).put("remoteSessions", JSONObject())
            save()
            setStatus(PcSyncStatus(code = code, state = "idle"))
        } finally { mutex.unlock() }
        return syncNow()
    }

    /** Stops syncing on this device; with [erase], also deletes everything synced under the code. */
    suspend fun leave(erase: Boolean) {
        val code = code
        if (erase && code != null) call(JSONObject().put("action", "forget").put("code", code))
        mutex.lock()
        try {
            state = JSONObject().put("deviceId", deviceId).put("pushed", JSONObject()).put("unliked", JSONObject())
            save()
            setStatus(PcSyncStatus())
        } finally { mutex.unlock() }
    }

    private suspend fun call(body: JSONObject): JSONObject = transport(body.put("device", deviceId))

    private fun fp(kind: String, data: JSONObject?, deleted: Boolean) = SyncProtocol.fingerprint(kind, data, deleted)

    /** What this device has now, as sync rows. */
    private suspend fun localItems(): List<Row> {
        val items = mutableListOf<Row>()
        for (s in local.history().take(200)) items += Row("history", s.getString("id"), songOf(s).put("playedAt", s.optLong("playedAt")), false)
        val likedNow = local.likes()
        val likedIds = likedNow.map { it.getString("id") }.toSet()
        for (s in likedNow) {
            unliked.remove(s.getString("id"))
            items += Row("like", s.getString("id"), songOf(s).put("likedAt", s.optLong("likedAt")), false)
        }
        // unlikes: songs this device sent as liked that are not liked any more (the time is kept, so it is sent once)
        for (key in pushed.keys().asSequence().toList()) {
            if (!key.startsWith("like:")) continue
            val id = key.removePrefix("like:")
            if (id in likedIds) continue
            if (pushed.optString(key).startsWith("l:1")) unliked.put(id, unliked.optLong(id, 0L).takeIf { it > 0 } ?: now())
            if (unliked.has(id)) items += Row("like", id, JSONObject().put("id", id).put("likedAt", unliked.getLong(id)), true)
        }
        for (s in local.downloads()) items += Row("download", s.getString("id"), songOf(s), false)
        val settings = local.settings()
        for (k in SyncProtocol.SHARED_SETTINGS) settings[k]?.let { items += Row("settings", k, JSONObject().put("value", it), false) }
        local.session()?.let { s ->
            items += Row("session", deviceId, JSONObject(s.toString()).put("device", deviceName).put("at", s.optLong("at").takeIf { it > 0 } ?: now()), false)
        }
        return items
    }

    /** One round: fetch and apply what changed elsewhere, then send what changed here. */
    suspend fun syncNow(): PcSyncStatus {
        if (code == null) return status
        if (!mutex.tryLock()) return status // a round is already running
        try {
            val code = code ?: return status
            setStatus(status.copy(state = "syncing"))
            try {
                // first fetch and apply what changed elsewhere (a device that joins takes the shared settings)
                var more = true
                while (more) {
                    val r = call(JSONObject().put("action", "pull").put("code", code).put("since", state.opt("cursor") ?: JSONObject.NULL))
                    val rows = r.optJSONArray("items") ?: JSONArray()
                    val all = (0 until rows.length()).map { rows.getJSONObject(it) }
                    val fresh = all.filter { x ->
                        x.optString("device") != deviceId &&
                            pushed.optString("${x.optString("kind")}:${x.optString("key")}") != fp(x.optString("kind"), x.optJSONObject("data"), x.optBoolean("deleted"))
                    }.map { Row(it.optString("kind"), it.optString("key"), it.optJSONObject("data") ?: JSONObject(), it.optBoolean("deleted"), it.optString("updated_at")) }
                    apply(fresh)
                    val last = all.lastOrNull()?.optString("updated_at")
                    more = all.size >= 1000 && last != null && last != state.optString("cursor")
                    if (last != null) state.put("cursor", last)
                }
                // then send what changed here
                val changed = localItems().filter { pushed.optString("${it.kind}:${it.key}") != fp(it.kind, it.data, it.deleted) }
                for (part in changed.chunked(400)) {
                    val items = JSONArray()
                    part.forEach { items.put(JSONObject().put("kind", it.kind).put("key", it.key).put("data", it.data).put("deleted", it.deleted)) }
                    call(JSONObject().put("action", "push").put("code", code).put("items", items))
                    part.forEach { pushed.put("${it.kind}:${it.key}", fp(it.kind, it.data, it.deleted)) }
                }
                state.put("lastSync", now())
                save()
                setStatus(PcSyncStatus(code = code, state = "idle", lastSync = state.optLong("lastSync")))
            } catch (e: Exception) {
                save()
                setStatus(status.copy(state = "error", error = e.message ?: e.toString()))
            }
            return status
        } finally { mutex.unlock() }
    }

    /** Applies rows from the other devices; each is marked as already sent, so it does not come back. */
    private suspend fun apply(rows: List<Row>) {
        if (rows.isEmpty()) return
        fun mark(r: Row) = pushed.put("${r.kind}:${r.key}", fp(r.kind, r.data, r.deleted))
        // history: add plays that are newer than this device's last play of the song
        val hist = rows.filter { it.kind == "history" && !it.deleted }
        if (hist.isNotEmpty()) {
            val mine = local.history().associate { it.getString("id") to it.optLong("playedAt") }
            val newer = hist.filter { it.data.optLong("playedAt") > (mine[it.key] ?: 0L) }
            if (newer.isNotEmpty()) local.addPlays(newer.map { songOf(JSONObject(it.data.toString()).put("id", it.key)).put("playedAt", it.data.optLong("playedAt")) })
            hist.forEach(::mark)
        }
        // likes: the latest change wins
        val likes = rows.filter { it.kind == "like" }
        if (likes.isNotEmpty()) {
            val mine = local.likes().associate { it.getString("id") to it.optLong("likedAt") }
            for (r in likes) {
                val at = r.data.optLong("likedAt")
                val localAt = mine[r.key] ?: unliked.optLong(r.key, 0L)
                if (localAt > at) { mark(r); continue } // a newer change here wins
                if (r.deleted) {
                    unliked.put(r.key, at)
                    if (r.key in mine) local.setLike(JSONObject().put("id", r.key), false)
                } else {
                    unliked.remove(r.key)
                    if (mine[r.key] != at) local.setLike(songOf(JSONObject(r.data.toString()).put("id", r.key)).put("likedAt", at), true)
                }
                mark(r)
            }
        }
        // downloads: songs downloaded on another device are downloaded here too
        val dls = rows.filter { it.kind == "download" && !it.deleted }
        if (dls.isNotEmpty()) {
            val have = local.downloads().map { it.getString("id") }.toSet()
            val want = dls.filter { it.key !in have }.map { songOf(JSONObject(it.data.toString()).put("id", it.key)) }
            if (want.isNotEmpty()) local.download(want)
            dls.forEach(::mark)
        }
        // settings: mark with the value this device ended up with (a value it cannot hold must not go back)
        val changes = linkedMapOf<String, Any?>()
        for (r in rows) if (r.kind == "settings" && r.key in SyncProtocol.SHARED_SETTINGS && r.data.has("value")) changes[r.key] = r.data.opt("value")
        if (changes.isNotEmpty()) {
            local.applySettings(changes)
            val held = local.settings()
            for (k in changes.keys) pushed.put("settings:$k", fp("settings", JSONObject().put("value", held[k] ?: changes[k] ?: JSONObject.NULL), false))
        }
        // what the other devices are playing
        val sessions = state.optJSONObject("remoteSessions") ?: JSONObject().also { state.put("remoteSessions", it) }
        for (r in rows) if (r.kind == "session" && r.key != deviceId) {
            if (r.deleted) sessions.remove(r.key) else sessions.put(r.key, JSONObject(r.data.toString()).put("updatedAt", r.updatedAt))
        }
    }

    private data class Row(val kind: String, val key: String, val data: JSONObject, val deleted: Boolean, val updatedAt: String = "")

    companion object {
        /** The song fields the apps share. */
        fun songOf(s: JSONObject): JSONObject {
            val artists = JSONArray()
            val src = s.optJSONArray("artists") ?: JSONArray()
            for (i in 0 until src.length()) {
                val a = src.optJSONObject(i) ?: continue
                artists.put(JSONObject().put("id", a.opt("id").takeUnless { it == null || it == JSONObject.NULL || it == "" } ?: JSONObject.NULL).put("name", a.optString("name")))
            }
            return JSONObject()
                .put("id", s.getString("id"))
                .put("title", s.optString("title"))
                .put("artists", artists)
                .put("album", s.optJSONObject("album") ?: JSONObject.NULL)
                .put("thumbnail", s.optString("thumbnail"))
                .put("duration", s.optInt("duration", 0).takeIf { it > 0 } ?: JSONObject.NULL)
        }
    }
}
