package com.jtech.zemer.stalow

import com.jtech.zemer.db.entities.PodcastWhitelistEntity
import com.jtech.zemer.utils.StalowChannels
import com.jtech.zemer.utils.ZemerContentClient
import com.jtech.zemer.viewmodels.ApprovedChannelsViewModel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stalow Music: the built-in Podcasts, Shiurim and Videos channel lists. */
class StalowChannelsTest {

    @Test
    fun `every category has channels with real YouTube channel ids and names`() {
        StalowChannels.Category.entries.forEach { category ->
            val ids = StalowChannels.ids(category)
            assertTrue("$category is empty", ids.isNotEmpty())
            assertTrue(ids.all { it.startsWith("UC") && it.length == 24 })
        }
        assertTrue(StalowChannels.all().all { !it.name.isNullOrBlank() })
    }

    @Test
    fun `the podcast allow-set serves every category once`() = runBlocking {
        val served = ZemerContentClient.podcastsWhitelist().map { it.id }
        assertEquals(served.size, served.toSet().size)
        val expected = StalowChannels.Category.entries.flatMap { StalowChannels.ids(it) }.toSet()
        assertEquals(expected, served.toSet())
        assertTrue(ZemerContentClient.podcastsWhitelistVersion() >= 2)
    }

    @Test
    fun `a channel can be in more than one category and is served once`() {
        val parsed = StalowChannels.parse(
            """{"version":5,"podcasts":[{"id":"UCaaaaaaaaaaaaaaaaaaaaaa","name":"A"}],
               "shiurim":[{"id":"UCaaaaaaaaaaaaaaaaaaaaaa","name":"A"},{"id":"UCbbbbbbbbbbbbbbbbbbbbbb","name":"B"}],
               "videos":[]}""",
        )
        assertEquals(5L, parsed.version)
        assertEquals(listOf("UCaaaaaaaaaaaaaaaaaaaaaa", "UCbbbbbbbbbbbbbbbbbbbbbb"), parsed.all().map { it.id })
    }

    @Test
    fun `the Shiurim and Videos grids list only their own category past the female and kid gates`() {
        fun row(id: String, name: String, female: Boolean = false, kid: Boolean = false) =
            PodcastWhitelistEntity(channelId = id, name = name, isFemale = female, isKidZone = kid)
        val all = listOf(row("UC1", "Shiur One"), row("UC2", "Video Two"), row("UC3", "Shiur Female", female = true), row("UC4", "Shiur Kids", kid = true))
        val shiurim = setOf("UC1", "UC3", "UC4")

        assertEquals(listOf("UC1"), ApprovedChannelsViewModel.filterCategory(all, shiurim, "", allowFemale = false).map { it.channelId })
        assertEquals(listOf("UC1", "UC3"), ApprovedChannelsViewModel.filterCategory(all, shiurim, "", allowFemale = true).map { it.channelId })
        assertEquals(listOf("UC3"), ApprovedChannelsViewModel.filterCategory(all, shiurim, " female ", allowFemale = true).map { it.channelId })
        assertFalse(ApprovedChannelsViewModel.filterCategory(all, shiurim, "", allowFemale = true).any { it.channelId == "UC2" })
    }
}
