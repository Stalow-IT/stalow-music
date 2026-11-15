package com.metrolist.innertube.pages

import com.metrolist.innertube.models.Album
import com.metrolist.innertube.models.AlbumItem
import com.metrolist.innertube.models.Artist
import com.metrolist.innertube.models.BrowseEndpoint
import com.metrolist.innertube.models.PlaylistItem
import com.metrolist.innertube.models.SongItem
import com.metrolist.innertube.models.EpisodeItem
import com.metrolist.innertube.models.PodcastItem
import com.metrolist.innertube.models.WatchEndpoint
import com.metrolist.innertube.models.YTItem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Stalow: reads podcast episodes and shows straight from YouTube Music's JSON. The typed models skip
 * `musicMultiRowListItemRenderer` (an episode row), so a podcast channel's "Latest episodes" and a show's
 * episode list came back empty once podcasts no longer came from Zemer's server. Same rules as the
 * Windows app (src/ytm.js parseMultiRow).
 */
object StalowPodcastParser {
    data class Section(val title: String, val items: List<YTItem>, val more: BrowseEndpoint? = null)

    private fun JsonElement?.obj(key: String): JsonObject? = (this as? JsonObject)?.get(key) as? JsonObject
    private fun JsonElement?.arr(key: String): JsonArray? = (this as? JsonObject)?.get(key) as? JsonArray
    private fun JsonElement?.str(key: String): String? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull
    private fun JsonElement?.at(vararg path: String): JsonElement? {
        var x: JsonElement? = this
        for (p in path) x = (x as? JsonObject)?.get(p) ?: return null
        return x
    }

    private fun runsText(o: JsonElement?): String =
        o.arr("runs")?.joinToString("") { it.str("text").orEmpty() } ?: o.str("simpleText").orEmpty()

    private fun bestThumb(o: JsonElement?): String? {
        val thumbs = o.at("musicThumbnailRenderer", "thumbnail").arr("thumbnails") ?: o.obj("thumbnail").arr("thumbnails") ?: return null
        return thumbs.lastOrNull().str("url")
    }

    private fun pageType(endpoint: JsonElement?): String =
        endpoint.at("browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig").str("pageType").orEmpty()

    /** "26 min", "1 hr 5 min", "45 sec", "3:05" -> seconds. */
    fun wordsToSeconds(text: String?): Int? {
        val t = text?.trim().orEmpty()
        if (Regex("^(\\d+:)?\\d{1,2}:\\d{2}$").matches(t)) return t.split(":").fold(0) { a, b -> a * 60 + b.toInt() }
        var n = 0; var any = false
        for (m in Regex("(\\d+)\\s*(hr|hour|min|sec)", RegexOption.IGNORE_CASE).findAll(t)) {
            any = true
            val v = m.groupValues[1].toInt(); val u = m.groupValues[2].lowercase()
            n += v * when { u.startsWith("h") -> 3600; u.startsWith("m") -> 60; else -> 1 }
        }
        return if (any) n else null
    }

    private fun channelRun(runs: JsonArray?): Artist? = runs?.firstNotNullOfOrNull { r ->
        val be = r.at("navigationEndpoint", "browseEndpoint")
        val id = be.str("browseId")
        if (id != null && id.startsWith("UC")) Artist(name = r.str("text").orEmpty(), id = id) else null
    }

    /** One episode row. [channel] is used when the row does not name its channel. */
    fun episode(r: JsonElement?, channel: Artist?, podcast: Album? = null): EpisodeItem? {
        val watch = r.at("onTap", "watchEndpoint")
            ?: r.at("overlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer", "playNavigationEndpoint", "watchEndpoint")
        val videoId = watch.str("videoId") ?: return null
        val title = runsText(r.obj("title")).ifEmpty { return null }
        val subtitle = r.obj("subtitle").arr("runs")
        val dur = runsText(r.at("playbackProgress", "musicPlaybackProgressRenderer", "durationText")).replace("•", " ")
        return EpisodeItem(
            id = videoId,
            title = title,
            author = channelRun(subtitle) ?: channel,
            podcast = podcast,
            duration = wordsToSeconds(dur),
            publishDateText = subtitle?.mapNotNull { it.str("text")?.trim() }?.lastOrNull { it.isNotEmpty() && it != "•" && !it.contains("view") },
            thumbnail = bestThumb(r.obj("thumbnail")) ?: "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
            endpoint = WatchEndpoint(videoId = videoId, params = watch.str("params")),
        )
    }

    /** One podcast show card (a channel's "Podcasts" shelf). Its id is the show's playlist id (PL…). */
    fun show(r: JsonElement?): PodcastItem? {
        val be = r.at("navigationEndpoint", "browseEndpoint") ?: return null
        val browseId = be.str("browseId") ?: return null
        if (!pageType(be).contains("PODCAST_SHOW") || !browseId.startsWith("MPSP")) return null
        val author = channelRun(r.obj("subtitle").arr("runs"))
        return PodcastItem(
            id = browseId.removePrefix("MPSP"),
            title = runsText(r.obj("title")).ifEmpty { return null },
            author = author,
            episodeCountText = null,
            thumbnail = bestThumb(r.obj("thumbnailRenderer")),
            playEndpoint = null,
            shuffleEndpoint = null,
            channelId = author?.id,
        )
    }

    /** A channel page's podcast shelves: "Latest episodes" and "Podcasts" (other shelves are left to ArtistPage). */
    fun channelSections(json: JsonElement, channelId: String, channelName: String): List<Section> {
        val channel = Artist(name = channelName, id = channelId)
        val contents = json.at("contents", "singleColumnBrowseResultsRenderer").arr("tabs")?.firstOrNull()
            .at("tabRenderer", "content", "sectionListRenderer").arr("contents") ?: return emptyList()
        return contents.mapNotNull { c ->
            val shelf = c.obj("musicCarouselShelfRenderer") ?: c.obj("musicShelfRenderer") ?: return@mapNotNull null
            val title = runsText(shelf.at("header", "musicCarouselShelfBasicHeaderRenderer", "title")).ifEmpty { runsText(shelf.obj("title")) }
            val items = shelf.arr("contents")?.mapNotNull { x ->
                x.obj("musicMultiRowListItemRenderer")?.let { episode(it, channel) }
                    ?: x.obj("musicTwoRowItemRenderer")?.let { show(it) }
            }.orEmpty()
            if (items.isEmpty()) null else Section(title, items, moreOf(shelf))
        }
    }

    /** A shelf's "see all" link (the arrow): the header's More button, or its title link. */
    fun moreOf(shelf: JsonElement?): BrowseEndpoint? {
        val h = shelf.at("header", "musicCarouselShelfBasicHeaderRenderer")
        val be = h.at("moreContentButton", "buttonRenderer", "navigationEndpoint", "browseEndpoint")
            ?: h.obj("title").arr("runs")?.firstOrNull().at("navigationEndpoint", "browseEndpoint")
            ?: return null
        return BrowseEndpoint(browseId = be.str("browseId") ?: return null, params = be.str("params"))
    }

    /** One grid card on a "see all" page: a video, album/single, playlist or podcast show. */
    fun card(r: JsonElement?, channel: Artist?): YTItem? {
        val title = runsText(r.obj("title")).ifEmpty { return null }
        val subtitle = r.obj("subtitle").arr("runs")
        val thumb = bestThumb(r.obj("thumbnailRenderer"))
        val watch = r.at("navigationEndpoint", "watchEndpoint")
        watch.str("videoId")?.let { id ->
            return SongItem(
                id = id, title = title, artists = listOfNotNull(channelRun(subtitle) ?: channel),
                thumbnail = thumb ?: "https://i.ytimg.com/vi/$id/hqdefault.jpg",
                endpoint = WatchEndpoint(videoId = id, params = watch.str("params")), isVideo = true,
            )
        }
        show(r)?.let { return it }
        val be = r.at("navigationEndpoint", "browseEndpoint") ?: return null
        val id = be.str("browseId") ?: return null
        val type = pageType(be)
        val author = channelRun(subtitle) ?: channel
        return when {
            type.contains("ALBUM") -> AlbumItem(
                browseId = id,
                playlistId = r.at("thumbnailOverlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer",
                    "playNavigationEndpoint", "watchPlaylistEndpoint").str("playlistId") ?: id,
                title = title, artists = listOfNotNull(author),
                year = subtitle?.mapNotNull { it.str("text")?.toIntOrNull() }?.firstOrNull { it in 1900..2100 },
                thumbnail = thumb ?: return null,
            )
            type.contains("PLAYLIST") -> PlaylistItem(
                id = id.removePrefix("VL"), title = title, author = author, songCountText = null,
                thumbnail = thumb, playEndpoint = null, shuffleEndpoint = null, radioEndpoint = null,
            )
            else -> null
        }
    }

    /** Everything on a channel shelf's "see all" page (episodes, videos, albums, playlists, shows), in order. */
    fun moreItems(json: JsonElement, channelId: String, channelName: String): List<YTItem> {
        val channel = Artist(name = channelName, id = channelId)
        val out = mutableListOf<YTItem>()
        fun walk(x: JsonElement?) {
            when (x) {
                is JsonArray -> x.forEach(::walk)
                is JsonObject -> {
                    x.obj("musicMultiRowListItemRenderer")?.let { r -> episode(r, channel)?.let(out::add); return }
                    x.obj("musicTwoRowItemRenderer")?.let { r -> card(r, channel)?.let(out::add); return }
                    x.values.forEach(::walk)
                }
                else -> {}
            }
        }
        walk(json.at("contents"))
        return out.distinctBy { it.id }
    }

    /** A podcast show page (browse "MPSP…"): the show and its first episodes. */
    fun showPage(json: JsonElement, browseId: String): PodcastPage? {
        val header = json.at("contents", "twoColumnBrowseResultsRenderer").arr("tabs")?.firstOrNull()
            .at("tabRenderer", "content", "sectionListRenderer").arr("contents")?.firstOrNull().obj("musicResponsiveHeaderRenderer")
            ?: return null
        val author = channelRun(header.obj("straplineTextOne").arr("runs"))
        val playlistId = browseId.removePrefix("MPSP")
        val title = runsText(header.obj("title"))
        val podcast = PodcastItem(
            id = playlistId,
            title = title,
            author = author,
            episodeCountText = null,
            thumbnail = bestThumb(header.obj("thumbnail")),
            playEndpoint = null,
            shuffleEndpoint = null,
            channelId = author?.id,
        )
        val shelf = json.at("contents", "twoColumnBrowseResultsRenderer", "secondaryContents", "sectionListRenderer").arr("contents")
            ?.firstNotNullOfOrNull { it.obj("musicShelfRenderer") }
        val album = Album(name = title, id = browseId)
        val episodes = shelf.arr("contents")?.mapNotNull { x -> x.obj("musicMultiRowListItemRenderer")?.let { episode(it, author, album) } }.orEmpty()
        val continuation = shelf.arr("continuations")?.firstOrNull().at("nextContinuationData").str("continuation")
        return PodcastPage(podcast = podcast, episodes = episodes, continuation = continuation)
    }
}
