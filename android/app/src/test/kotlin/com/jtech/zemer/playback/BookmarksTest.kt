package com.jtech.zemer.playback

import com.jtech.zemer.models.MediaMetadata
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stalow: the player's Bookmark button and the long-item resume rule. */
class BookmarksTest {
    private fun meta(id: String, seconds: Int, episode: Boolean = false) = MediaMetadata(
        id = id,
        title = "Title $id",
        artists = listOf(MediaMetadata.Artist(id = "UCchannel", name = "Teef Teef")),
        duration = seconds,
        thumbnailUrl = "https://example.com/$id.jpg",
        isEpisode = episode,
    )

    @Test
    fun `a bookmark round-trips through its saved text and plays the same item`() {
        val b = Bookmarks.of(meta("ep1", 3600, episode = true), positionMs = 1_395_000, now = 42)
        val back = Bookmarks.decode(Bookmarks.encode(listOf(b)))
        assertEquals(listOf(b), back)
        val m = back.single().toMediaMetadata()
        assertEquals("ep1", m.id)
        assertEquals("Teef Teef", m.artists.single().name)
        assertEquals("UCchannel", m.artists.single().id)
        assertTrue(m.isEpisode)
        assertEquals(3600, m.duration)
    }

    @Test
    fun `saving the same item again moves it to the front with the new place`() {
        val a1 = Bookmarks.of(meta("a", 3000), 60_000, 1)
        val b = Bookmarks.of(meta("b", 3000), 90_000, 2)
        val a2 = Bookmarks.of(meta("a", 3000), 120_000, 3)
        val list = Bookmarks.add(Bookmarks.add(Bookmarks.add(emptyList(), a1), b), a2)
        assertEquals(listOf("a", "b"), list.map { it.id })
        assertEquals(120_000L, list.first().positionMs)
        assertEquals(listOf("b"), Bookmarks.remove(list, "a").map { it.id })
    }

    @Test
    fun `at most MAX bookmarks are kept, the oldest go first`() {
        var list = emptyList<Bookmark>()
        repeat(Bookmarks.MAX + 5) { i -> list = Bookmarks.add(list, Bookmarks.of(meta("i$i", 3000), 10_000, i.toLong())) }
        assertEquals(Bookmarks.MAX, list.size)
        assertEquals("i${Bookmarks.MAX + 4}", list.first().id)
    }

    @Test
    fun `broken or empty saved text reads as no bookmarks`() {
        assertTrue(Bookmarks.decode(null).isEmpty())
        assertTrue(Bookmarks.decode("").isEmpty())
        assertTrue(Bookmarks.decode("{not json").isEmpty())
    }

    @Test
    fun `the button and auto-resume cover episodes and long items, never songs`() {
        assertTrue(Bookmarks.offeredFor(meta("ep", 300, episode = true)))
        assertTrue(Bookmarks.offeredFor(meta("shiur", EpisodeResume.LONG_ITEM_SECONDS)))
        assertFalse(Bookmarks.offeredFor(meta("song", 240)))
        assertFalse(Bookmarks.offeredFor(null))
        assertTrue(EpisodeResume.tracksPosition(isEpisode = false, durationSeconds = 45 * 60))
        assertFalse(EpisodeResume.tracksPosition(isEpisode = false, durationSeconds = 6 * 60))
    }
}
