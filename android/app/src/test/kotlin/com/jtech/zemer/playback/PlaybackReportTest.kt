package com.jtech.zemer.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shareable playback report never carries stream links and stays short. */
class PlaybackReportTest {
    @Test
    fun `links are removed and the report is bounded`() {
        PlaybackReport.clear()
        PlaybackReport.add("LOAD ERROR: HttpDataSourceException: 403 https://rr3---sn.googlevideo.com/videoplayback?expire=1&sig=SECRET&n=abc")
        val text = PlaybackReport.text("header")
        assertTrue(text.startsWith("header"))
        assertFalse("no signed link", text.contains("googlevideo") || text.contains("SECRET"))
        assertTrue(text.contains("<link>"))
        repeat(1000) { PlaybackReport.add("line $it") }
        assertEquals(600, PlaybackReport.size)
        assertTrue(PlaybackReport.text("h").contains("line 999"))
        PlaybackReport.clear()
        assertEquals(0, PlaybackReport.size)
    }
}
