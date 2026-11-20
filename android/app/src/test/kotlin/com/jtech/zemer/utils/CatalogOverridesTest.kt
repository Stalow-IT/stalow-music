package com.jtech.zemer.utils

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The admins' changes (Settings > Channels & artists) applied on top of the built-in lists. */
class CatalogOverridesTest {
    private val music1 = "UCmusic000000000000000001"
    private val music2 = "UCmusic000000000000000002"
    private val pod1 = "UCpod00000000000000000001"
    private val newCh = "UCnew00000000000000000001"

    private fun entry(id: String, category: String, removed: Boolean = false, name: String = "N $id") =
        CatalogOverrides.Entry(id, name, "", category, removed)

    @After
    fun reset() = CatalogOverrides.set(0L to emptyMap())

    @Test
    fun `parse keeps valid entries and skips bad ones`() {
        val (v, map) = CatalogOverrides.parse(
            """{"version":7,"entries":[{"id":"$newCh","name":"New","category":"podcasts","removed":false},
               {"id":"bad","category":"music"},{"id":"$pod1","category":"nonsense"},{"id":"$music1","category":"music","removed":true}]}""",
        )
        assertEquals(7L, v)
        assertEquals(setOf(newCh, music1), map.keys)
        assertTrue(map.getValue(music1).removed)
    }

    @Test
    fun `artists - removed and moved ones leave the music list, added ones join`() {
        val base = listOf(ContentWhitelistDoc(id = music1, name = "A"), ContentWhitelistDoc(id = music2, name = "B"))
        val out = ZemerContentClient.effectiveArtists(
            base,
            mapOf(music1 to entry(music1, "music", removed = true), music2 to entry(music2, "podcasts"), newCh to entry(newCh, "music", name = "New")),
        )
        assertEquals(listOf(newCh), out.map { it.id })
        assertEquals("New", out.single().name)
        assertEquals(base, ZemerContentClient.effectiveArtists(base, emptyMap()))
    }

    @Test
    fun `channels - moved between categories, removed, and added`() {
        val base = StalowChannels.BuiltInChannels(
            version = 3,
            podcasts = listOf(ContentPodcastDoc(id = pod1, name = "P", thumbnailUrl = "https://x/p.jpg")),
            videos = listOf(ContentPodcastDoc(id = pod1, name = "P")),
        )
        val moved = StalowChannels.effective(base, mapOf(pod1 to entry(pod1, "shiurim", name = "")))
        assertTrue(moved.podcasts.isEmpty())
        assertTrue(moved.videos.isEmpty())
        assertEquals("P", moved.shiurim.single().name) // keeps the built-in name and picture
        assertEquals("https://x/p.jpg", moved.shiurim.single().thumbnailUrl)

        val removed = StalowChannels.effective(base, mapOf(pod1 to entry(pod1, "podcasts", removed = true)))
        assertTrue(removed.all().isEmpty())

        val added = StalowChannels.effective(base, mapOf(newCh to entry(newCh, "videos", name = "Fresh"), music1 to entry(music1, "music")))
        assertEquals(listOf(pod1, newCh), added.videos.map { it.id })
        assertFalse(added.all().any { it.id == music1 }) // a music artist is not a channel
    }

    @Test
    fun `version grows with every admin change, and removals are reported`() = runBlocking {
        val before = ZemerContentClient.version()
        CatalogOverrides.set(5L to mapOf(music1 to entry(music1, "music", removed = true), pod1 to entry(pod1, "music")))
        assertEquals(before + 5, ZemerContentClient.version())
        assertEquals(setOf(music1), ZemerContentClient.removedArtists())
        assertEquals(setOf(music1), CatalogOverrides.notMusic())
        assertTrue(StalowChannels.version > 0)
    }
}
