package com.jtech.zemer.utils.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class StalowUpdateFeedTest {
    private val sha = "a".repeat(64)
    private val feed = "https://stalow.netlify.app/downloads/stalow-music.json"

    @Test
    fun `a complete update file is read, extra fields are ignored`() {
        val r = StalowUpdateFeed.parse(
            """{"versionCode":2,"versionName":"1.1","apk":"stalow-music.apk","sha256":"$sha","size":10,"notes":"Fixes","extra":1}""",
        )
        assertNotNull(r)
        assertEquals(2, r!!.versionCode)
        assertEquals("Fixes", r.notes)
    }

    @Test
    fun `an incomplete or broken update file is never used`() {
        assertNull(StalowUpdateFeed.parse("not json"))
        assertNull(StalowUpdateFeed.parse("""{"versionCode":2,"versionName":"1.1","apk":"x.apk"}"""))
        assertNull(StalowUpdateFeed.parse("""{"versionCode":2,"versionName":"1.1","apk":"x.apk","sha256":"short"}"""))
        assertNull(StalowUpdateFeed.parse("""{"versionCode":0,"versionName":"1.1","apk":"x.apk","sha256":"$sha"}"""))
    }

    @Test
    fun `only a higher version code is an update`() {
        val r = StalowUpdateFeed.parse("""{"versionCode":2,"versionName":"1.1","apk":"x.apk","sha256":"$sha"}""")!!
        assertTrue(StalowUpdateFeed.isNewer(r, 1))
        assertFalse(StalowUpdateFeed.isNewer(r, 2))
        assertFalse(StalowUpdateFeed.isNewer(r, 3))
    }

    @Test
    fun `the apk is found next to the update file unless a full address is given`() {
        val rel = StalowUpdateFeed.parse("""{"versionCode":2,"versionName":"1.1","apk":"stalow-music.apk","sha256":"$sha"}""")!!
        assertEquals("https://stalow.netlify.app/downloads/stalow-music.apk", StalowUpdateFeed.apkUrl(feed, rel))
        val abs = rel.copy(apk = "https://example.org/files/app.apk")
        assertEquals("https://example.org/files/app.apk", StalowUpdateFeed.apkUrl(feed, abs))
    }

    @Test
    fun `a download that is not the announced apk is rejected`() {
        val r = StalowUpdateFeed.parse("""{"versionCode":2,"versionName":"1.1","apk":"x.apk","sha256":"$sha","size":10}""")!!
        StalowUpdateFeed.verify(r, 10, sha.uppercase())
        assertThrows(IllegalStateException::class.java) { StalowUpdateFeed.verify(r, 11, sha) }
        assertThrows(IllegalStateException::class.java) { StalowUpdateFeed.verify(r, 10, "b".repeat(64)) }
    }
}
