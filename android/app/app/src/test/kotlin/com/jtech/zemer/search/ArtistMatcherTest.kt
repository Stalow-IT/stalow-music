package com.jtech.zemer.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArtistMatcherTest {
    private val m = ArtistMatcher(
        listOf(
            ArtistMatcher.Entry("mbd", listOf("Mordechai Ben David", "מרדכי בן דוד")),
            ArtistMatcher.Entry("af", listOf("Avraham Fried")),
            ArtistMatcher.Entry("ys", listOf("Yaakov Shwekey")),
            ArtistMatcher.Entry("ybc", listOf("Yeshiva Boys Choir")),
            ArtistMatcher.Entry("ms", listOf("Motty Steinmetz")),
            ArtistMatcher.Entry("df", listOf("Duvid Fried")),
        ),
    )
    private fun top(q: String) = m.match(q).firstOrNull()?.id

    @Test fun `nicknames`() {
        assertEquals("mbd", top("MBD"))
        assertEquals("mbd", top("mbd"))
        assertEquals("af", top("fried"))
        assertEquals("ys", top("shwekey"))
        assertEquals("ms", top("motty"))
    }

    @Test fun `initials of any listed name`() = assertEquals("ybc", top("ybc"))

    @Test fun `loose spellings and typos`() {
        assertEquals("mbd", top("mordche ben dovid"))
        assertEquals("ys", top("yakov schwekey"))
        assertEquals("af", top("avrom fried"))
        assertEquals("ms", top("moti steinmets"))
    }

    @Test fun `hebrew finds the english listing`() {
        assertEquals("mbd", top("מרדכי בן דוד"))
        assertEquals("af", top("אברהם פריד"))
    }

    @Test fun `unrelated text matches nothing`() = assertTrue(m.match("reggaeton").isEmpty())
}

class PlaylistListingRuleTest {
    @Test fun `own small collections stay on the artist page only`() {
        assertTrue(LocalCatalog.isListedPlaylist(4, 4, ownPage = true))
        org.junit.Assert.assertFalse(LocalCatalog.isListedPlaylist(4, 4, ownPage = false))
        org.junit.Assert.assertFalse(LocalCatalog.isListedPlaylist(3, 4, ownPage = true))
        assertTrue(LocalCatalog.isListedPlaylist(15, 90, ownPage = false))
    }
}
