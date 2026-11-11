package com.jtech.zemer.pcsync

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Opt-in check against the real sync server, with the Windows app's sync code on the other end
 * (desktop/interop script). Runs only when app/build/stalow-sync-interop.txt holds a sync code made by the PC side.
 */
class SyncInteropLiveTest {
    @Test
    fun `phone joins the PC's code on the real server`() = runBlocking {
        val codeFile = File("build/stalow-sync-interop.txt")
        assumeTrue("no interop code", codeFile.exists())
        val code = codeFile.readText().trim()
        var pushes = 0
        val transport: suspend (JSONObject) -> JSONObject = { body ->
            if (body.optString("action") == "push") pushes++
            val c = URL(SyncProtocol.URL).openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val ok = c.responseCode in 200..299
            val text = (if (ok) c.inputStream else c.errorStream).bufferedReader().readText()
            if (!ok) error("HTTP ${c.responseCode}: $text")
            JSONObject(text)
        }
        val history = mutableListOf<JSONObject>()
        val likedSongs = linkedMapOf<String, JSONObject>()
        val downloading = mutableListOf<String>()
        val settings = linkedMapOf<String, Any>("theme" to "system", "skipSilence" to true)
        var playing: JSONObject? = null
        val local = object : SyncLocal {
            override suspend fun history() = history.sortedByDescending { it.optLong("playedAt") }
            override suspend fun addPlays(songs: List<JSONObject>) { history += songs }
            override suspend fun likes() = likedSongs.values.toList()
            override suspend fun setLike(song: JSONObject, liked: Boolean) { if (liked) likedSongs[song.getString("id")] = song else likedSongs.remove(song.getString("id")) }
            override suspend fun downloads() = emptyList<JSONObject>()
            override suspend fun download(songs: List<JSONObject>) { downloading += songs.map { it.getString("id") } }
            override suspend fun settings(): Map<String, Any> = settings.toMap()
            override suspend fun applySettings(changes: Map<String, Any?>) { changes.forEach { (k, v) -> if (v != null && v != JSONObject.NULL) settings[k] = v } }
            override suspend fun session() = playing
        }
        val engine = SyncEngine(File.createTempFile("pc_sync", ".json"), "Phone (interop)", transport, local)
        val st = engine.join(code)
        assertEquals(st.error, "idle", st.state)
        println("phone got history=${history.map { it.getString("id") }} likes=${likedSongs.keys} downloads=$downloading settings=$settings")
        println("phone sees PC playing: " + engine.remoteSessions().map { s -> s.getString("device") + " / " + s.getJSONArray("queue").getJSONObject(s.getInt("index")).getString("title") + " @" + s.optLong("time") })
        assertTrue(history.any { it.getString("id") == "pcplayed001" })
        assertTrue("pcliked0001" in likedSongs)
        assertEquals(listOf("pcdownload1"), downloading)
        assertEquals("black", settings["theme"])
        assertEquals(false, settings["skipSilence"])
        assertEquals("left", settings["lyricsPosition"])
        assertEquals("PC (interop)", engine.remoteSessions().single().getString("device"))

        // the phone plays, likes, unlikes the PC's song, changes a setting and is playing something
        history += JSONObject().put("id", "phoneplay01").put("title", "Played on phone").put("artists", JSONArray().put(JSONObject().put("id", "UCph").put("name", "Phone Artist"))).put("thumbnail", "").put("duration", 190).put("playedAt", System.currentTimeMillis())
        likedSongs["phonelike01"] = JSONObject().put("id", "phonelike01").put("title", "Liked on phone").put("artists", JSONArray()).put("likedAt", System.currentTimeMillis())
        likedSongs.remove("pcliked0001")
        settings["skipSilence"] = true
        playing = JSONObject().put("queue", JSONArray().put(JSONObject().put("type", "song").put("id", "phoneplay01").put("title", "Played on phone").put("artists", JSONArray()))).put("index", 0).put("time", 33).put("at", System.currentTimeMillis())
        engine.syncNow()
        val p = pushes
        engine.syncNow(); engine.syncNow()
        assertEquals("quiet once up to date", p, pushes)
    }
}
