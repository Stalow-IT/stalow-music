package com.jtech.zemer.pcsync

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant

class SyncEngineTest {
    /** The stalow-sync server in memory. */
    private class FakeServer {
        val rows = mutableMapOf<String, LinkedHashMap<String, JSONObject>>()
        var clock = 0L
        var pushes = 0
        suspend fun handle(b: JSONObject): JSONObject {
            val code = SyncProtocol.cleanCode(b.optString("code")) ?: error("bad sync code")
            val mine = rows.getOrPut(code) { LinkedHashMap() }
            return when (b.getString("action")) {
                "push" -> {
                    pushes++
                    val items = b.getJSONArray("items")
                    for (i in 0 until items.length()) {
                        val it = items.getJSONObject(i)
                        val k = "${it.getString("kind")}:${it.getString("key")}"
                        mine.remove(k)
                        mine[k] = JSONObject().put("kind", it.getString("kind")).put("key", it.getString("key")).put("data", it.get("data"))
                            .put("deleted", it.optBoolean("deleted")).put("device", b.getString("device"))
                            .put("updated_at", Instant.ofEpochMilli(1_000_000_000_000L + ++clock).toString())
                    }
                    JSONObject().put("saved", items.length())
                }
                "pull" -> {
                    val since = b.opt("since").takeIf { it is String } as String?
                    JSONObject().put("items", JSONArray(mine.values.filter { since == null || it.getString("updated_at") >= since }.sortedBy { it.getString("updated_at") }))
                }
                "forget" -> { rows.remove(code); JSONObject().put("deleted", true) }
                else -> error("unknown action")
            }
        }
    }

    /** One phone's data. */
    private class Phone(server: FakeServer, dir: File, name: String) : SyncLocal {
        val history = mutableListOf<JSONObject>()
        val liked = linkedMapOf<String, JSONObject>()
        val downloaded = mutableListOf<JSONObject>()
        val downloading = mutableListOf<String>()
        val settings = linkedMapOf<String, Any>("theme" to "system", "skipSilence" to true)
        var playing: JSONObject? = null
        val engine = SyncEngine(File(dir, "$name.json"), name, { server.handle(it) }, this)

        override suspend fun history() = history.sortedByDescending { it.optLong("playedAt") }
        override suspend fun addPlays(songs: List<JSONObject>) { songs.forEach { s -> history.removeAll { it.getString("id") == s.getString("id") }; history += JSONObject(s.toString()).put("thumbnail", "phone-size") } }
        override suspend fun likes() = liked.values.toList()
        override suspend fun setLike(song: JSONObject, liked: Boolean) { if (liked) this.liked[song.getString("id")] = song else this.liked.remove(song.getString("id")) }
        override suspend fun downloads() = downloaded.toList()
        override suspend fun download(songs: List<JSONObject>) { downloading += songs.map { it.getString("id") } }
        override suspend fun settings(): Map<String, Any> = settings.toMap()
        override suspend fun applySettings(changes: Map<String, Any?>) {
            for ((k, v) in changes) {
                if (v == null || v == JSONObject.NULL) continue
                settings[k] = if (k == "theme" && v == "black") "dark" else v // this phone has no black theme
            }
        }
        override suspend fun session() = playing
    }

    private fun song(id: String, extra: Map<String, Any> = emptyMap()) = JSONObject()
        .put("id", id).put("title", "Song $id").put("artists", JSONArray().put(JSONObject().put("id", "UCx").put("name", "A")))
        .put("thumbnail", "").put("duration", 200).also { o -> extra.forEach { (k, v) -> o.put(k, v) } }

    @Test
    fun `codes look like the Windows app's`() {
        val c = SyncProtocol.newCode()
        assertTrue(c, Regex("^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$").matches(c))
        assertEquals(c, SyncProtocol.cleanCode(c.lowercase().replace("-", " ")))
        assertNull(SyncProtocol.cleanCode("short"))
        assertNotEquals(SyncProtocol.newCode(), SyncProtocol.newCode())
    }

    @Test
    fun `fingerprints match the Windows app`() {
        // the values below are printed by desktop/src/sync.js fingerprint() for the same rows
        fun f(kind: String, data: String, deleted: Boolean = false) = SyncProtocol.fingerprint(kind, JSONObject(data), deleted)
        assertEquals("h:1700000000", f("history", """{"playedAt":1700000000999}"""))
        assertEquals("l:1:1700000000", f("like", """{"likedAt":1700000000456}"""))
        assertEquals("l:0:1700000000", f("like", """{"likedAt":1700000000456}""", true))
        assertEquals("d:1", f("download", "{}"))
        assertEquals("s:true", f("settings", """{"value":true}"""))
        assertEquals("s:\"left\"", f("settings", """{"value":"left"}"""))
        assertEquals("s:30", f("settings", """{"value":30}"""))
        assertEquals("s:null", f("settings", "{}"))
        assertEquals("p:1700000000123:2", f("session", """{"at":1700000000123,"time":61.5}"""))
    }

    @Test
    fun `history, likes, downloads, settings and what is playing reach the other device, and stay quiet after`() = runBlocking {
        val dir = Files.createTempDirectory("stalow-sync").toFile()
        val server = FakeServer()
        val pc = Phone(server, dir, "PC")
        val phone = Phone(server, dir, "Phone")
        pc.history += song("aaaaaaaaaaa", mapOf("playedAt" to 1_700_000_000_123L))
        pc.liked["ccccccccccc"] = song("ccccccccccc", mapOf("likedAt" to 1_700_000_000_456L))
        pc.downloaded += song("ddddddddddd")
        pc.settings["theme"] = "black"
        pc.playing = JSONObject().put("queue", JSONArray().put(song("aaaaaaaaaaa"))).put("index", 0).put("time", 42).put("at", 1_700_000_000_000L)
        val code = pc.engine.create().code!!
        phone.history += song("bbbbbbbbbbb", mapOf("playedAt" to 1_700_000_100_000L))
        phone.settings["theme"] = "light"
        val st = phone.engine.join(code)
        assertEquals("idle", st.state)
        assertEquals(listOf("bbbbbbbbbbb", "aaaaaaaaaaa"), phone.history().map { it.getString("id") })
        assertTrue("ccccccccccc" in phone.liked)
        assertEquals(listOf("ddddddddddd"), phone.downloading)
        assertEquals("dark", phone.settings["theme"]) // the PC's black, as near as this phone gets
        val offer = phone.engine.remoteSessions().single()
        assertEquals("PC", offer.getString("device"))
        assertEquals(42, offer.getInt("time"))
        pc.engine.syncNow()
        assertEquals("black", pc.settings["theme"]) // the phone did not send its nearest theme back
        assertEquals(listOf("bbbbbbbbbbb", "aaaaaaaaaaa"), pc.history().map { it.getString("id") })

        repeat(2) { pc.engine.syncNow(); phone.engine.syncNow() }
        val quiet = server.pushes
        repeat(3) { pc.engine.syncNow(); phone.engine.syncNow() }
        assertEquals("no pushes once both are up to date", quiet, server.pushes)

        // unlike on the phone reaches the PC, once
        phone.liked.remove("ccccccccccc")
        phone.engine.syncNow(); pc.engine.syncNow()
        assertFalse("ccccccccccc" in pc.liked)
        val afterUnlike = server.pushes
        repeat(2) { pc.engine.syncNow(); phone.engine.syncNow() }
        assertEquals(afterUnlike, server.pushes)
        // liked again on the PC later: the newer change wins on the phone
        pc.liked["ccccccccccc"] = song("ccccccccccc", mapOf("likedAt" to System.currentTimeMillis() + 5000))
        pc.engine.syncNow(); phone.engine.syncNow()
        assertTrue("ccccccccccc" in phone.liked)

        // a setting changed on the phone reaches the PC
        phone.settings["skipSilence"] = false
        phone.engine.syncNow(); pc.engine.syncNow()
        assertEquals(false, pc.settings["skipSilence"])

        // stop and delete
        pc.engine.leave(erase = true)
        assertEquals("off", pc.engine.status.state)
        assertFalse(server.rows.containsKey(code))
        try { pc.engine.join("nope"); error("accepted a bad code") } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("not a sync code")) }
    }
}
