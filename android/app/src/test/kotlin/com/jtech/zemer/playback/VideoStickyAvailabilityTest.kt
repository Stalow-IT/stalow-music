package com.jtech.zemer.playback

import com.jtech.zemer.playback.VideoModeLogic.Rendition
import com.jtech.zemer.playback.VideoModeLogic.RenditionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Stalow: after switching a video to audio, the Song/Video toggle must still offer video. */
class VideoStickyAvailabilityTest {
    private val self = Rendition(RenditionKind.SELF, "abc")
    private val counterpart = Rendition(RenditionKind.COUNTERPART, "vid")
    private val nothingBlocked: (String) -> Boolean = { false }

    private fun sticky(
        fresh: Rendition? = null,
        prior: Rendition? = self,
        casting: Boolean = false,
        blockVideos: Boolean = false,
        station: Boolean = false,
        online: Boolean = true,
        blocked: (String) -> Boolean = nothingBlocked,
    ) = VideoModeLogic.stickyAvailability(fresh, prior, casting, blockVideos, station, online, blocked)

    @Test
    fun `a fresh answer always wins`() {
        assertEquals(counterpart, sticky(fresh = counterpart, prior = self))
    }

    @Test
    fun `an item that played as video keeps its toggle after switching to audio`() {
        assertEquals(self, sticky(fresh = null, prior = self))
        assertEquals(counterpart, sticky(fresh = null, prior = counterpart))
    }

    @Test
    fun `nothing is offered for an item that never played as video`() {
        assertNull(sticky(fresh = null, prior = null))
    }

    @Test
    fun `the remembered video is dropped when video becomes impossible`() {
        assertNull(sticky(casting = true))
        assertNull(sticky(blockVideos = true))
        assertNull(sticky(station = true))
        assertNull(sticky(online = false))
        assertNull(sticky(blocked = { it == "abc" }))
    }

    @Test
    fun `a downloaded video file is never reused from memory`() {
        assertNull(sticky(prior = Rendition(RenditionKind.LOCAL, null)))
    }
}
