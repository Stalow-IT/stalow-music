package com.jtech.zemer.stalow

import com.metrolist.innertube.YouTube
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in: reads real podcast channels from YouTube Music. Runs only when app/build/stalow-live-podcasts exists. */
class StalowPodcastLiveTest {
    @Test
    fun `real podcast channels have episodes and shows`() = runBlocking {
        assumeTrue(File("build/stalow-live-podcasts").exists())
        for ((id, name) in listOf("UCp3HDDoqMXaNOCkqKz7EjiQ" to "18Forty", "UCZvi7uExPlhSVh-HKJLAF5w" to "second")) {
            val sections = YouTube.channelPodcastSections(id, name).getOrThrow()
            println("$name: " + sections.joinToString { "${it.title}(${it.items.size})" })
            assertTrue(sections.isNotEmpty())
        }
        // the arrow on a video channel's "Videos" and a podcast's "Latest episodes"
        val ch = "UC0b5MwpPLBKh1Oanj2YzGVw" // Ah Blick Live, an approved Videos channel
        val page = YouTube.artist(ch).getOrThrow()
        val vids = page.sections.first { it.moreEndpoint != null }
        val all = YouTube.channelShelfAll(vids.moreEndpoint!!, ch, page.artist.title).getOrThrow()
        println("${page.artist.title} ${vids.title}: page ${vids.items.size}, see all ${all.size}")
        assertTrue(all.size > vids.items.size)
        val pod = YouTube.channelPodcastSections("UCp3HDDoqMXaNOCkqKz7EjiQ", "18Forty").getOrThrow().first()
        val eps = YouTube.channelShelfAll(pod.more!!, "UCp3HDDoqMXaNOCkqKz7EjiQ", "18Forty").getOrThrow()
        println("18Forty ${pod.title}: page ${pod.items.size}, see all ${eps.size}")
        assertTrue(eps.size > pod.items.size)
        val show = YouTube.podcastShow("PLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3").getOrThrow()
        println("show: ${show.podcast.title} by ${show.podcast.author?.name} - ${show.episodes.size} episodes, first: ${show.episodes.firstOrNull()?.title} (${show.episodes.firstOrNull()?.duration}s)")
        assertTrue(show.episodes.size >= 10)
    }
}
