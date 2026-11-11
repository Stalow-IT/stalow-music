package com.jtech.zemer.search

import com.jtech.zemer.db.MusicDatabase
import com.jtech.zemer.db.entities.ArtistWhitelistEntity
import com.jtech.zemer.utils.ContentFilterConfig
import com.jtech.zemer.utils.ContentFilterState
import com.jtech.zemer.utils.WhitelistCache
import com.jtech.zemer.utils.approvedChannelPasses
import com.jtech.zemer.utils.filterWhitelisted
import com.metrolist.innertube.YouTube
import com.metrolist.innertube.YouTube.SearchFilter
import com.metrolist.innertube.models.AlbumItem
import com.metrolist.innertube.models.ArtistItem
import com.metrolist.innertube.models.PlaylistItem
import com.metrolist.innertube.models.SearchSuggestions
import com.metrolist.innertube.models.SongItem
import com.metrolist.innertube.models.WatchEndpoint
import com.metrolist.innertube.models.YTItem
import com.metrolist.innertube.pages.AlbumPage
import com.metrolist.innertube.pages.ArtistPage
import com.metrolist.innertube.pages.SearchResult
import com.metrolist.innertube.pages.SearchSummary
import com.metrolist.innertube.pages.SearchSummaryPage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import timber.log.Timber
import java.io.IOException

/**
 * Stalow Music's catalog: YouTube Music, asked directly from the device, with every result passed through the
 * built-in artist whitelist ([filterWhitelisted]). It replaces the original app's search server, so search,
 * artist pages, albums, playlists and radio work without any third-party server.
 *
 * Content rules:
 *  - songs, videos, albums and artists show only when an approved artist is credited;
 *  - playlists made by other people are shown, but opening one keeps only songs by approved artists, and a
 *    playlist whose author is not an approved artist shows no cover image (its cover could show anything);
 *  - with content filters switched off in Settings, everything passes (the original app's behaviour).
 */
class LocalCatalog(private val database: MusicDatabase) {

    private val config: ContentFilterConfig get() = ContentFilterState.current

    // ---- search ------------------------------------------------------------------------------------------

    /** One chip's results, filtered to approved artists. */
    suspend fun search(query: String, filter: SearchFilter): List<YTItem> {
        val raw = YouTube.search(query, filter).getOrElse { throw it.asIo("search") }.items
        return if (filter.value == SearchFilter.FILTER_COMMUNITY_PLAYLIST.value ||
            filter.value == SearchFilter.FILTER_FEATURED_PLAYLIST.value
        ) {
            playlistsForDisplay(keepFullPlaylists(raw.filterIsInstance<PlaylistItem>()))
        } else {
            raw.filterWhitelisted(database, config)
        }
    }

    suspend fun filtered(query: String, filter: SearchFilter): SearchResult = coroutineScope {
        val matched = matchArtists(query)
        val expanded = expandedQuery(query, matched)
        val main = async { runCatching { search(query, filter) } }
        val extra = expanded?.let { q -> async { runCatching { search(q, filter) }.getOrDefault(emptyList()) } }
        val mainItems = main.await().getOrElse { if (extra == null) throw it else emptyList() }
        val items = buildList {
            if (filter.value == SearchFilter.FILTER_ARTIST.value) addAll(matched.map { it.toArtistItem() })
            extra?.await()?.let(::addAll)
            addAll(mainItems)
        }
        SearchResult(items = items.distinctBy { it.id }, continuation = null)
    }

    // ---- smart artist matching (nicknames, initials, spellings; see ArtistMatcher) -------------------

    @Volatile
    private var matcher: Pair<Int, ArtistMatcher>? = null

    private suspend fun matchArtists(query: String, limit: Int = 6): List<ArtistWhitelistEntity> {
        val allowed = allowedArtists()
        val m = matcher?.takeIf { it.first == allowed.size }?.second
            ?: ArtistMatcher(allowed.map { ArtistMatcher.Entry(it.artistId, it.names()) }).also { matcher = allowed.size to it }
        val byId = allowed.associateBy { it.artistId }
        return m.match(query, limit).mapNotNull { byId[it.id] }
    }

    /** When the query names an approved artist in another way ("mbd"), also search by the artist's full name. */
    private fun expandedQuery(query: String, matched: List<ArtistWhitelistEntity>): String? {
        val top = matched.firstOrNull() ?: return null
        val full = top.shownName()
        return full.takeIf { !it.equals(query.trim(), ignoreCase = true) }
    }

    /** The grouped "all results" page. Fails (for the Retry state) only when every section failed. */
    suspend fun summary(query: String, includeVideos: Boolean): SearchSummaryPage = coroutineScope {
        val sections = buildList {
            add(TITLE_ALBUMS to SearchFilter.FILTER_ALBUM)
            add(TITLE_SONGS to SearchFilter.FILTER_SONG)
            if (includeVideos) add(TITLE_VIDEOS to SearchFilter.FILTER_VIDEO)
            add(TITLE_ARTISTS to SearchFilter.FILTER_ARTIST)
            add(TITLE_PLAYLISTS to SearchFilter.FILTER_COMMUNITY_PLAYLIST)
        }
        val matched = matchArtists(query)
        val expanded = expandedQuery(query, matched)
        val results = sections.map { (title, filter) ->
            async {
                title to runCatching {
                    val extra = if (expanded != null && filter.value != SearchFilter.FILTER_COMMUNITY_PLAYLIST.value) {
                        runCatching { search(expanded, filter) }.getOrDefault(emptyList())
                    } else emptyList()
                    val lead = if (filter.value == SearchFilter.FILTER_ARTIST.value) matched.map { it.toArtistItem() } else emptyList()
                    val main = runCatching { search(query, filter) }
                    if (main.isFailure && extra.isEmpty() && lead.isEmpty()) throw main.exceptionOrNull()!!
                    lead + extra + main.getOrDefault(emptyList())
                }
            }
        }.awaitAll()
        if (results.all { it.second.isFailure }) {
            throw results.first().second.exceptionOrNull()!!.asIo("search")
        }
        SearchSummaryPage(
            summaries = results.mapNotNull { (title, result) ->
                result.getOrNull()?.distinctBy { it.id }?.take(SUMMARY_SECTION_LIMIT)?.takeIf { it.isNotEmpty() }
                    ?.let { SearchSummary(title, it) }
            },
        )
    }

    /**
     * As-you-type suggestions from the built-in artist list only (no network): approved artists whose name
     * (English or Hebrew) contains the typed text.
     */
    suspend fun suggestions(query: String): SearchSuggestions {
        if (query.isBlank()) return SearchSuggestions(emptyList(), emptyList())
        val matches = matchArtists(query, MAX_SUGGESTIONS)
        return SearchSuggestions(
            queries = matches.map { it.shownName() },
            recommendedItems = matches.map { it.toArtistItem() },
        )
    }

    // ---- pages -------------------------------------------------------------------------------------------

    /**
     * An artist page with every section filtered; null (not available) for an artist that is not approved.
     * An approved channel (Podcasts, Shiurim or Videos) that is not a music artist opens as [channel].
     */
    suspend fun artist(id: String): ArtistPage? {
        if (!isApprovedArtist(id)) return if (approvedChannelPasses(listOf(id), config)) channel(id) else null
        val page = YouTube.artist(id).getOrElse { throw it.asIo("artist") }
        val sections = page.sections.mapNotNull { section ->
            val filtered = section.items.filterWhitelisted(database, config, fallbackArtistId = id)
            val playlists = filtered.filterIsInstance<PlaylistItem>()
            val items = if (playlists.isEmpty()) filtered else {
                val keep = keepFullPlaylists(playlists, ownPage = true).map { it.id }.toSet()
                filtered.filter { it !is PlaylistItem || it.id in keep }
            }
            if (items.isEmpty()) null else section.copy(items = items)
        }
        return page.copy(sections = sections)
    }

    /**
     * An approved channel's page (Podcasts, Shiurim or Videos, see [com.jtech.zemer.utils.StalowChannels]):
     * the channel vouches for its own uploads and playlists, so those pass; anything else on the page still
     * needs an approved artist. Null for a channel that is not approved.
     */
    suspend fun channel(id: String): ArtistPage? {
        if (!approvedChannelPasses(listOf(id), config)) return null
        val page = YouTube.artist(id).getOrElse { throw it.asIo("channel") }
        // Podcast channels: "Latest episodes" and "Podcasts" (shows), which the artist page reader skips.
        val podcastSections = YouTube.channelPodcastSections(id, page.artist.title).getOrNull().orEmpty()
            .filter { ps -> page.sections.none { it.title == ps.title } }
            .map { com.metrolist.innertube.pages.ArtistSection(title = it.title, items = it.items, moreEndpoint = null) }
        val sections = (podcastSections + page.sections).mapNotNull { section ->
            val items = section.items.filterWhitelisted(database, config, fallbackArtistId = id)
            if (items.isEmpty()) null else section.copy(items = items)
        }
        return page.copy(sections = sections)
    }

    /** A podcast show by an approved channel, with its first episodes; null when the show's channel is not approved. */
    suspend fun podcastShow(id: String): com.metrolist.innertube.pages.PodcastPage? {
        val page = YouTube.podcastShow(id).getOrElse { throw it.asIo("podcast") }
        val channelId = page.podcast.channelId ?: return null
        if (!approvedChannelPasses(listOf(channelId), config)) return null
        val episodes = page.episodes.filterWhitelisted(database, config, fallbackArtistId = channelId)
            .filterIsInstance<com.metrolist.innertube.models.EpisodeItem>()
        return page.copy(episodes = episodes, continuation = null)
    }

    /** An album with only approved artists' songs; null when the album has none. */
    suspend fun album(browseId: String): AlbumPage? {
        val page = YouTube.album(browseId).getOrElse { throw it.asIo("album") }
        val albumArtist = page.album.artists?.firstNotNullOfOrNull { it.id }
        val songs = page.songs.filterWhitelisted(database, config, fallbackArtistId = albumArtist)
            .filterIsInstance<SongItem>()
        if (songs.isEmpty()) return null
        return page.copy(songs = songs)
    }

    /** A playlist with only approved artists' songs (up to [MAX_PLAYLIST_SONGS] read). */
    suspend fun playlist(id: String): Pair<PlaylistItem, List<SongItem>> {
        val page = YouTube.playlist(id).getOrElse { throw it.asIo("playlist") }
        val all = page.songs.toMutableList()
        var continuation = page.songsContinuation ?: page.continuation
        while (continuation != null && all.size < MAX_PLAYLIST_SONGS) {
            val next = YouTube.playlistContinuation(continuation).getOrNull() ?: break
            all += next.songs
            continuation = next.continuation
        }
        val songs = all.filterWhitelisted(database, config).filterIsInstance<SongItem>().distinctBy { it.id }
        return playlistForDisplay(page.playlist) to songs
    }

    // ---- radio -------------------------------------------------------------------------------------------

    /**
     * The first radio page for a seed: `song`, `artist`, `album`, `playlist`, or `shuffle` (a random approved
     * artist). Tracks are filtered; a page that filters down to almost nothing reads on a few more pages.
     */
    suspend fun radio(kind: String, seed: String?): Pair<List<SongItem>, String?> {
        val endpoint: WatchEndpoint = when (kind) {
            "song" -> seed?.let { WatchEndpoint(videoId = it, playlistId = "RDAMVM$it") }
            "playlist" -> seed?.let { WatchEndpoint(playlistId = "RDAMPL$it") }
            "album" -> seed?.let { albumRadio(it) }
            "artist" -> seed?.let { artistRadio(it) }
            "shuffle" -> allowedArtists().shuffled().firstNotNullOfOrNull { runCatching { artistRadio(it.artistId) }.getOrNull() }
            else -> null
        } ?: return emptyList<SongItem>() to null
        return readRadio(endpoint, continuation = null)
    }

    suspend fun radioContinuation(token: String): Pair<List<SongItem>, String?> {
        val (endpoint, continuation) = RadioToken.decode(token) ?: return emptyList<SongItem>() to null
        return readRadio(endpoint, continuation)
    }

    private suspend fun readRadio(endpoint: WatchEndpoint, continuation: String?): Pair<List<SongItem>, String?> {
        val out = ArrayList<SongItem>()
        var cont = continuation
        var pages = 0
        do {
            val result = YouTube.next(endpoint, cont).getOrElse { throw it.asIo("radio") }
            out += result.items.filterWhitelisted(database, config).filterIsInstance<SongItem>()
            cont = result.continuation
            pages++
        } while (out.size < MIN_RADIO_PAGE && cont != null && pages < MAX_RADIO_PAGES_PER_CALL)
        return out.distinctBy { it.id } to cont?.let { RadioToken.encode(endpoint, it) }
    }

    private suspend fun artistRadio(artistId: String): WatchEndpoint? {
        val page = YouTube.artist(artistId).getOrNull() ?: return null
        return page.artist.radioEndpoint ?: page.artist.shuffleEndpoint
    }

    private suspend fun albumRadio(browseId: String): WatchEndpoint? {
        val playlistId = YouTube.album(browseId, withSongs = false).getOrNull()?.album?.playlistId ?: return null
        return WatchEndpoint(playlistId = "RDAMPL$playlistId")
    }

    // ---- home --------------------------------------------------------------------------------------------

    /**
     * Home rows built from the approved list: the artists played most recently first (most recent
     * first), then a rotating set of others, and some of their albums.
     */
    suspend fun homeRows(): ZemerResultMapper.HomeRows = coroutineScope {
        val allowed = allowedArtists().filter { !it.isKids }
        val recentIds = runCatching {
            database.events().first().flatMap { e -> e.song.artists.map { it.id } }.distinct()
        }.getOrDefault(emptyList())
        val picks = recentFirst(allowed, recentIds, HOME_ARTISTS) { it.artistId }
        val albums = picks.take(HOME_ALBUM_SOURCES).map { entry ->
            async {
                runCatching {
                    YouTube.artist(entry.artistId).getOrNull()?.sections.orEmpty()
                        .flatMap { it.items }.filterIsInstance<AlbumItem>().take(3)
                }.getOrDefault(emptyList())
            }
        }.awaitAll().flatten()
        ZemerResultMapper.HomeRows(
            albums = albums.filterWhitelisted(database, config).filterIsInstance<AlbumItem>().distinctBy { it.id },
            videos = emptyList(),
            artists = picks.map { it.toArtistItem() },
            community = emptyList(),
        )
    }

    // ---- helpers -----------------------------------------------------------------------------------------

    private suspend fun allowedArtists(): List<ArtistWhitelistEntity> =
        WhitelistCache.allowedEntries(database, config)

    private suspend fun isApprovedArtist(id: String): Boolean =
        !config.filtersEnabled || allowedArtists().any { it.artistId == id }

    // playlist id -> (approved songs, all songs) on its first page (remembered for the session)
    private val playlistCounts = java.util.concurrent.ConcurrentHashMap<String, Pair<Int, Int>>()

    private suspend fun playlistCount(id: String): Pair<Int, Int>? = playlistCounts[id] ?: run {
        val songs = YouTube.playlist(id).getOrNull()?.songs ?: return null // not remembered: retried next time
        (songs.filterWhitelisted(database, config).size to songs.size).also { playlistCounts[id] = it }
    }

    /**
     * Stalow Music: only playlists with at least [MIN_PLAYLIST_SONGS] approved songs are listed, so search and
     * artist pages never show empty or near-empty playlists. On an approved artist's own page ([ownPage]) a
     * smaller playlist stays when every item is approved (e.g. a label's own collections). With filters off,
     * all pass. Checked in parallel.
     */
    private suspend fun keepFullPlaylists(items: List<PlaylistItem>, ownPage: Boolean = false): List<PlaylistItem> {
        if (!config.filtersEnabled) return items
        return coroutineScope {
            items.take(MAX_PLAYLIST_CHECKS).map { p -> async { p to playlistCount(p.id) } }.awaitAll()
        }.filter { (_, c) -> c != null && isListedPlaylist(c.first, c.second, ownPage) }.map { it.first }
    }

    private suspend fun playlistsForDisplay(items: List<PlaylistItem>): List<PlaylistItem> =
        items.map { playlistForDisplay(it) }

    private suspend fun playlistForDisplay(item: PlaylistItem): PlaylistItem {
        val authorApproved = item.author?.id?.let { isApprovedArtist(it) } ?: false
        return if (authorApproved || !config.filtersEnabled) item else item.copy(thumbnail = null)
    }

    private fun ArtistWhitelistEntity.names(): List<String> = listOfNotNull(artistName, displayName, altName)

    private fun ArtistWhitelistEntity.shownName(): String = displayName ?: artistName

    // Artist images from the built-in list (the whitelist table does not store them).
    @Volatile
    private var thumbnails: Map<String, String>? = null

    private suspend fun thumbnailOf(artistId: String): String? {
        val map = thumbnails ?: runCatching {
            com.jtech.zemer.utils.ZemerContentClient.whitelist()
                .mapNotNull { doc -> doc.thumbnail?.let { (doc.id.ifBlank { doc.artistId.orEmpty() }) to it } }
                .toMap()
        }.getOrDefault(emptyMap()).also { thumbnails = it }
        return map[artistId]
    }

    private suspend fun ArtistWhitelistEntity.toArtistItem() = ArtistItem(
        id = artistId,
        title = shownName(),
        thumbnail = thumbnailOf(artistId),
        channelId = artistId,
        shuffleEndpoint = null,
        radioEndpoint = null,
    )

    private fun Throwable.asIo(what: String): IOException =
        this as? IOException ?: IOException("YouTube Music $what failed: ${message ?: javaClass.simpleName}", this).also {
            Timber.w(this, "LocalCatalog: %s failed", what)
        }

    companion object {
        private const val TITLE_ALBUMS = "Albums"
        private const val TITLE_SONGS = "Songs"
        private const val TITLE_VIDEOS = "Videos"
        private const val TITLE_ARTISTS = "Artists"
        private const val TITLE_PLAYLISTS = "Playlists"
        private const val SUMMARY_SECTION_LIMIT = 8
        private const val MAX_SUGGESTIONS = 6
        private const val MAX_PLAYLIST_SONGS = 500
        private const val MIN_RADIO_PAGE = 8
        private const val MAX_RADIO_PAGES_PER_CALL = 4
        private const val HOME_ARTISTS = 20
        private const val HOME_ALBUM_SOURCES = 5
        private const val MAX_PLAYLIST_CHECKS = 20
        const val MIN_PLAYLIST_SONGS = 15

        /** Whether a playlist with [approvedSongs] approved songs is worth listing. Pure, so it is unit-tested. */
        fun isFullPlaylist(approvedSongs: Int): Boolean = approvedSongs >= MIN_PLAYLIST_SONGS

        /** [isFullPlaylist], or on an approved artist's own page: a non-empty playlist that is all approved. */
        fun isListedPlaylist(approvedSongs: Int, totalSongs: Int, ownPage: Boolean): Boolean =
            isFullPlaylist(approvedSongs) || (ownPage && totalSongs > 0 && approvedSongs == totalSongs)
    }
}

/**
 * A radio continuation token: the station's endpoint plus YouTube's own continuation, packed into one opaque
 * string so the queue can ask for the next page later. Pure, so it is unit-tested.
 */
internal object RadioToken {
    private const val PREFIX = "stalow1"
    private const val SEP = '\u001F'

    fun encode(endpoint: WatchEndpoint, continuation: String): String =
        listOf(PREFIX, endpoint.videoId.orEmpty(), endpoint.playlistId.orEmpty(), endpoint.params.orEmpty(), continuation)
            .joinToString(SEP.toString())

    fun decode(token: String): Pair<WatchEndpoint, String>? {
        val parts = token.split(SEP)
        if (parts.size != 5 || parts[0] != PREFIX || parts[4].isEmpty()) return null
        val endpoint = WatchEndpoint(
            videoId = parts[1].ifEmpty { null },
            playlistId = parts[2].ifEmpty { null },
            params = parts[3].ifEmpty { null },
        )
        if (endpoint.videoId == null && endpoint.playlistId == null) return null
        return endpoint to parts[4]
    }
}

/**
 * The entries whose ids appear in [recentIds] (in that order, most recent first), then the others
 * shuffled, [limit] in all.
 */
internal fun <T> recentFirst(all: List<T>, recentIds: List<String>, limit: Int, idOf: (T) -> String): List<T> {
    val byId = all.associateBy(idOf)
    val recent = recentIds.distinct().mapNotNull { byId[it] }.take(limit)
    val shown = recent.mapTo(HashSet(), idOf)
    return recent + all.filterNot { idOf(it) in shown }.shuffled().take(limit - recent.size)
}
