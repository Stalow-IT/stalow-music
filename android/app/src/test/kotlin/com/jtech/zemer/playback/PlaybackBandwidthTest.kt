package com.jtech.zemer.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Downloads give way only while something streams short of buffer (or loads). */
class PlaybackBandwidthTest {
    @Test
    fun `yield only while streaming short of buffer`() {
        assertTrue(PlaybackBandwidth.shouldYield(playWhenReady = true, hasItem = true, localFile = false, buffering = false, bufferedAheadMs = 5_000))
        assertTrue(PlaybackBandwidth.shouldYield(playWhenReady = true, hasItem = true, localFile = false, buffering = true, bufferedAheadMs = 90_000))
        assertFalse("enough buffered", PlaybackBandwidth.shouldYield(true, true, false, false, 60_000))
        assertFalse("paused", PlaybackBandwidth.shouldYield(false, true, false, true, 0))
        assertFalse("playing a downloaded file", PlaybackBandwidth.shouldYield(true, true, true, true, 0))
        assertFalse("nothing playing", PlaybackBandwidth.shouldYield(true, false, false, true, 0))
    }
}
