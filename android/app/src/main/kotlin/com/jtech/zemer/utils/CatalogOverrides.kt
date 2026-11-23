package com.jtech.zemer.utils

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Stalow: the admins' changes to the built-in artist and channel lists (Settings > Channels & artists), from the
 * stalow-accounts server. Each entry moves one channel to a category (music, podcasts, shiurim, videos) or removes
 * it. [ZemerContentClient] and [StalowChannels] apply them on top of the lists built into the app, so a removed
 * channel stops showing anywhere and an added one shows like a built-in one. Kept in a file so they apply offline.
 */
object CatalogOverrides {
    data class Entry(
        val id: String,
        val name: String,
        val thumbnail: String,
        val category: String,
        val removed: Boolean,
    ) {
        val isMusic get() = category == MUSIC
    }

    const val MUSIC = "music"
    const val PODCASTS = "podcasts"
    const val SHIURIM = "shiurim"
    const val VIDEOS = "videos"
    val CATEGORIES = listOf(MUSIC, PODCASTS, SHIURIM, VIDEOS)

    @Volatile
    var version: Long = 0
        private set

    @Volatile
    var entries: Map<String, Entry> = emptyMap()
        private set

    private var file: File? = null

    /** Reads the saved copy (at app start). */
    @Synchronized
    fun load(file: File) {
        this.file = file
        if (file.exists()) runCatching { set(parse(file.readText())) }
    }

    /** Applies a server copy; true when it changed anything. Saves it for next time. */
    @Synchronized
    fun update(json: JSONObject): Boolean {
        val parsed = parse(json.toString())
        if (parsed.first == version && parsed.second == entries) return false
        set(parsed)
        runCatching { file?.writeText(json.toString()) }
        return true
    }

    /** For tests. */
    @Synchronized
    internal fun set(parsed: Pair<Long, Map<String, Entry>>) {
        version = parsed.first
        entries = parsed.second
    }

    internal fun parse(text: String): Pair<Long, Map<String, Entry>> {
        val o = JSONObject(text)
        val list = o.optJSONArray("entries") ?: JSONArray()
        val map = LinkedHashMap<String, Entry>()
        for (i in 0 until list.length()) {
            val e = list.optJSONObject(i) ?: continue
            val id = e.optString("id")
            val category = e.optString("category")
            if (!id.startsWith("UC") || category !in CATEGORIES) continue
            map[id] = Entry(id, e.optString("name"), e.optString("thumbnail"), category, e.optBoolean("removed"))
        }
        return o.optLong("version") to map
    }

    /** Ids the admins took off the music list (removed, or moved to another category). */
    fun notMusic(): Set<String> = entries.values.filter { it.removed || !it.isMusic }.map { it.id }.toSet()

    /** Ids the admins removed entirely. */
    fun removedIds(): Set<String> = entries.values.filter { it.removed }.map { it.id }.toSet()

    /** Music artists the admins added or kept (not removed). */
    fun music(): List<Entry> = entries.values.filter { it.isMusic && !it.removed }

    /** Channels the admins put in [category] (not removed). */
    fun channels(category: String): List<Entry> = entries.values.filter { it.category == category && !it.removed }
}
