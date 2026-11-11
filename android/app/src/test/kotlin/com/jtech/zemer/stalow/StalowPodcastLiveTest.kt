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
        val show = YouTube.podcastShow("PLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3").getOrThrow()
        println("show: ${show.podcast.title} by ${show.podcast.author?.name} - ${show.episodes.size} episodes, first: ${show.episodes.firstOrNull()?.title} (${show.episodes.firstOrNull()?.duration}s)")
        assertTrue(show.episodes.size >= 10)
    }
}
