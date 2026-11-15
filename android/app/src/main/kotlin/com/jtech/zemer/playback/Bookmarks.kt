package com.jtech.zemer.playback

import androidx.datastore.preferences.core.stringPreferencesKey
import com.jtech.zemer.models.MediaMetadata
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Stalow: a saved place in something you were listening to (a podcast, a shiur, a long video), so you can
 * hear music in between and come back to the same spot. Kept on the phone as a small JSON list in
 * DataStore ([BookmarksKey]); one bookmark per item, newest first.
 */
@Serializable
data class Bookmark(
    val id: String,
    val title: String,
    val artist: String = "",
    val artistId: String? = null,
    val thumbnailUrl: String? = null,
    val positionMs: Long,
    val durationSeconds: Int = 0,
    val isEpisode: Boolean = false,
    val isVideo: Boolean = false,
    val savedAt: Long,
) {
    /** The item to play again (the queue then seeks to [positionMs]). */
    fun toMediaMetadata() = MediaMetadata(
        id = id,
        title = title,
        artists = listOf(MediaMetadata.Artist(id = artistId, name = artist)),
        duration = durationSeconds,
        thumbnailUrl = thumbnailUrl,
        isVideo = isVideo,
        isEpisode = isEpisode,
    )
}

val BookmarksKey = stringPreferencesKey("stalowBookmarks")

object Bookmarks {
    /** At most this many are kept; the oldest go first. */
    const val MAX = 50

    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val serializer = ListSerializer(Bookmark.serializer())

    /** The saved list; an empty or broken value reads as no bookmarks. */
    fun decode(text: String?): List<Bookmark> =
        if (text.isNullOrBlank()) emptyList() else runCatching { json.decodeFromString(serializer, text) }.getOrDefault(emptyList())

    fun encode(list: List<Bookmark>): String = json.encodeToString(serializer, list)

    /** A bookmark for [meta] at [positionMs], taken at [now] (epoch ms). */
    fun of(meta: MediaMetadata, positionMs: Long, now: Long) = Bookmark(
        id = meta.id,
        title = meta.title,
        artist = meta.artists.joinToString { it.name },
        artistId = meta.artists.firstOrNull()?.id,
        thumbnailUrl = meta.thumbnailUrl,
        positionMs = positionMs.coerceAtLeast(0),
        durationSeconds = meta.duration,
        isEpisode = meta.isEpisode,
        isVideo = meta.isVideo,
        savedAt = now,
    )

    /** Adds [bookmark] first, replacing an older bookmark of the same item, keeping at most [MAX]. */
    fun add(list: List<Bookmark>, bookmark: Bookmark): List<Bookmark> =
        (listOf(bookmark) + list.filter { it.id != bookmark.id }).take(MAX)

    fun remove(list: List<Bookmark>, id: String): List<Bookmark> = list.filter { it.id != id }

    /** Whether the player offers the Bookmark button for this item: podcasts and long items. */
    fun offeredFor(meta: MediaMetadata?): Boolean =
        meta != null && EpisodeResume.tracksPosition(meta.isEpisode, meta.duration)
}
