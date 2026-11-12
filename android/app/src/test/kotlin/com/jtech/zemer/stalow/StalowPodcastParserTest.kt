package com.jtech.zemer.stalow

import com.metrolist.innertube.models.EpisodeItem
import com.metrolist.innertube.models.PodcastItem
import com.metrolist.innertube.models.SongItem
import com.metrolist.innertube.pages.StalowPodcastParser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Podcast channels and shows, in the shapes YouTube Music sends (trimmed from real 18Forty responses). */
class StalowPodcastParserTest {
    private val episode = """
        {"onTap":{"watchEndpoint":{"videoId":"ZiLVylXYU44","params":"8gEDmAEI"}},
         "title":{"runs":[{"text":"Manis Friedman: 'We can't remain strangers to God'"}]},
         "subtitle":{"runs":[{"text":"1.6K views"},{"text":" • "},{"text":"2d ago"}]},
         "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/vi/ZiLVylXYU44/hq720.jpg"}]}}},
         "playbackProgress":{"musicPlaybackProgressRenderer":{"durationText":{"runs":[{"text":" • "},{"text":"1 hr 26 min"}]}}}}
    """.trimIndent()
    private val channelRun = """{"text":"18Forty","navigationEndpoint":{"browseEndpoint":{"browseId":"UCp3HDDoqMXaNOCkqKz7EjiQ"}}}"""
    private val show = """
        {"title":{"runs":[{"text":"18 Questions, 40 Jewish Mystics"}]},
         "subtitle":{"runs":[$channelRun]},
         "thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/pl_c/x.jpg"}]}}},
         "navigationEndpoint":{"browseEndpoint":{"browseId":"MPSPPLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3",
           "browseEndpointContextSupportedConfigs":{"browseEndpointContextMusicConfig":{"pageType":"MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE"}}}}}
    """.trimIndent()
    private fun shelf(title: String, item: String) =
        """{"musicCarouselShelfRenderer":{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"$title"}]}}},"contents":[$item]}}"""
    private fun json(s: String) = Json.parseToJsonElement(s) as JsonObject

    @Test
    fun `lengths in words`() {
        assertEquals(1560, StalowPodcastParser.wordsToSeconds("26 min"))
        assertEquals(3900, StalowPodcastParser.wordsToSeconds("1 hr 5 min"))
        assertEquals(185, StalowPodcastParser.wordsToSeconds("3:05"))
        assertNull(StalowPodcastParser.wordsToSeconds("Played"))
    }

    @Test
    fun `a podcast channel page has its latest episodes and its shows`() {
        val page = json("""{"contents":{"singleColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
            ${shelf("Latest episodes", """{"musicMultiRowListItemRenderer":$episode}""")},
            ${shelf("Podcasts", """{"musicTwoRowItemRenderer":$show}""")},
            ${shelf("Videos", """{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"v"}]},"navigationEndpoint":{"watchEndpoint":{"videoId":"abc"}}}}""")}
        ]}}}}]}}}""")
        val sections = StalowPodcastParser.channelSections(page, "UCp3HDDoqMXaNOCkqKz7EjiQ", "18Forty")
        assertEquals(listOf("Latest episodes", "Podcasts"), sections.map { it.title }) // Videos is left to ArtistPage
        val ep = sections[0].items.single() as EpisodeItem
        assertEquals("ZiLVylXYU44", ep.id)
        assertEquals("UCp3HDDoqMXaNOCkqKz7EjiQ", ep.author?.id) // the channel, as the row names none
        assertEquals(5160, ep.duration)
        assertEquals("2d ago", ep.publishDateText)
        val pod = sections[1].items.single() as PodcastItem
        assertEquals("PLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3", pod.id)
        assertEquals("UCp3HDDoqMXaNOCkqKz7EjiQ", pod.channelId)
    }

    @Test
    fun `a podcast show page has its episodes, by the show's channel`() {
        val page = json("""{"contents":{"twoColumnBrowseResultsRenderer":{
            "tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[{"musicResponsiveHeaderRenderer":{
                "title":{"runs":[{"text":"18 Questions, 40 Jewish Mystics"}]},"straplineTextOne":{"runs":[$channelRun]},
                "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://x/y.jpg"}]}}}}}]}}}}],
            "secondaryContents":{"sectionListRenderer":{"contents":[{"musicShelfRenderer":{"contents":[{"musicMultiRowListItemRenderer":$episode}],
                "continuations":[{"nextContinuationData":{"continuation":"NEXT"}}]}}]}}}}}""")
        val show = StalowPodcastParser.showPage(page, "MPSPPLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3")!!
        assertEquals("18 Questions, 40 Jewish Mystics", show.podcast.title)
        assertEquals("UCp3HDDoqMXaNOCkqKz7EjiQ", show.podcast.channelId)
        assertEquals(1, show.episodes.size)
        assertEquals("UCp3HDDoqMXaNOCkqKz7EjiQ", show.episodes[0].author?.id)
        assertEquals("MPSPPLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3", show.episodes[0].podcast?.id)
        assertEquals("NEXT", show.continuation)
        assertTrue(StalowPodcastParser.showPage(json("{}"), "MPSPx") == null)
    }

    @Test
    fun `a shelf keeps its arrow link, and the see-all page has every item`() {
        val shelfJson = json("""{"header":{"musicCarouselShelfBasicHeaderRenderer":{"title":{"runs":[{"text":"Videos"}]},
            "moreContentButton":{"buttonRenderer":{"navigationEndpoint":{"browseEndpoint":{"browseId":"UC0b5Mwp","params":"EgZ2aWRlb3M"}}}}}}}""")
        val more = StalowPodcastParser.moreOf(shelfJson)!!
        assertEquals("UC0b5Mwp", more.browseId)
        assertEquals("EgZ2aWRlb3M", more.params)
        val video = """{"musicTwoRowItemRenderer":{"title":{"runs":[{"text":"A video"}]},"navigationEndpoint":{"watchEndpoint":{"videoId":"VIDEO%d"}},
            "thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://t/%d.jpg"}]}}}}}"""
        val grid = (1..30).joinToString(",") { video.replace("%d", it.toString()) }
        val page = json("""{"contents":{"singleColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
            {"gridRenderer":{"items":[$grid,{"musicMultiRowListItemRenderer":$episode}]}}]}}}}]}}}""")
        val items = StalowPodcastParser.moreItems(page, "UC0b5Mwp", "Ah Blick Live")
        assertEquals(31, items.size)
        val v = items.first() as SongItem
        assertEquals("VIDEO1", v.id)
        assertTrue(v.isVideo)
        assertEquals("UC0b5Mwp", v.artists.single().id) // by the channel
        assertTrue(items.last() is EpisodeItem)
    }
}
