package com.jtech.zemer.stalow

import com.jtech.zemer.net.ZemerHosts
import com.jtech.zemer.search.RadioToken
import com.jtech.zemer.utils.ZemerContentClient
import com.metrolist.innertube.models.WatchEndpoint
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stalow Music: the built-in artist list, the block on the original servers, and radio paging. */
class StalowIndependenceTest {

    @Test
    fun `the built-in artist list loads, is versioned and has unique YouTube channel ids`() = runBlocking {
        val version = ZemerContentClient.version()
        val docs = ZemerContentClient.whitelist()
        assertTrue("version must be at least 1", version >= 1)
        assertTrue("expected a real list, got ${docs.size}", docs.size > 1000)
        assertTrue(docs.all { it.id.startsWith("UC") && it.id.length == 24 })
        assertTrue(docs.all { !it.name.isNullOrBlank() })
        assertEquals(docs.size, docs.map { it.id }.toSet().size)
    }

    @Test
    fun `the lists the original servers held are empty and server-only features are unavailable`() = runBlocking {
        assertTrue(ZemerContentClient.blockedIds().isEmpty())
        assertTrue(ZemerContentClient.removedArtists().isEmpty())
        assertTrue(ZemerContentClient.israeliArtists().isEmpty())
        assertTrue(runCatching { ZemerContentClient.registerInstall() }.isFailure)
        assertTrue(runCatching { ZemerContentClient.legal() }.isFailure)
    }

    @Test
    fun `a broken built-in list is rejected instead of wiping the artist table`() {
        val parsed = ZemerContentClient.parseBuiltIn("""{"version":3,"artists":[]}""")
        assertEquals(3L, parsed.version)
        assertTrue(parsed.artists.isEmpty())
    }

    @Test
    fun `every original server address is recognised for blocking, other sites are not`() {
        listOf("zemer.io", "search.zemer.io", "content.zemer.io", "tracking.zemer.io", "stream.zemer.io", "PAY.ZEMER.IO")
            .forEach { assertTrue(it, ZemerHosts.isZemerHost(it)) }
        listOf("music.youtube.com", "lrclib.net", "notzemer.io", "zemer.io.example.com")
            .forEach { assertFalse(it, ZemerHosts.isZemerHost(it)) }
    }

    @Test
    fun `a radio token round-trips the station and YouTube's continuation`() {
        val endpoint = WatchEndpoint(videoId = "abc123", playlistId = "RDAMVMabc123", params = "wAEB")
        val (back, continuation) = RadioToken.decode(RadioToken.encode(endpoint, "CONT"))!!
        assertEquals("abc123", back.videoId)
        assertEquals("RDAMVMabc123", back.playlistId)
        assertEquals("wAEB", back.params)
        assertEquals("CONT", continuation)
    }

    @Test
    fun `old or malformed radio tokens end the queue instead of crashing`() {
        assertNull(RadioToken.decode("offline1|whatever"))
        assertNull(RadioToken.decode(""))
        assertNull(RadioToken.decode(RadioToken.encode(WatchEndpoint(), "CONT")))
    }
}

class StalowGuestAndPlaylistTest {
    @Test
    fun `a guest's visitor id is read from YouTube's reply and URL-decoded`() {
        val id = com.jtech.zemer.auth.GuestSession.parseVisitorData(
            """{"responseContext":{"visitorData":"CgtIdnZCOFg2blI0VSjAhsrXBg%3D%3D"}}""",
        )
        org.junit.Assert.assertEquals("CgtIdnZCOFg2blI0VSjAhsrXBg==", id)
        org.junit.Assert.assertNull(com.jtech.zemer.auth.GuestSession.parseVisitorData("""{"responseContext":{}}"""))
        org.junit.Assert.assertNull(com.jtech.zemer.auth.GuestSession.parseVisitorData("not json"))
    }

    @Test
    fun `playlists need at least 15 approved songs to be listed`() {
        org.junit.Assert.assertFalse(com.jtech.zemer.search.LocalCatalog.isFullPlaylist(0))
        org.junit.Assert.assertFalse(com.jtech.zemer.search.LocalCatalog.isFullPlaylist(14))
        org.junit.Assert.assertTrue(com.jtech.zemer.search.LocalCatalog.isFullPlaylist(15))
    }
}
