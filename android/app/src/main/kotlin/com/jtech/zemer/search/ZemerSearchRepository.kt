package com.jtech.zemer.search

import android.content.Context
import com.jtech.zemer.db.MusicDatabase
import com.jtech.zemer.R
import com.jtech.zemer.offline.OfflineReadProvider
import com.jtech.zemer.offline.OfflineRadioToken
import com.jtech.zemer.search.ZemerResultMapper.toAlbumFacetPage
import com.jtech.zemer.search.ZemerResultMapper.toAlbumItems
import com.jtech.zemer.search.ZemerResultMapper.toAlbumPage
import com.jtech.zemer.search.ZemerResultMapper.toArtistPage
import com.jtech.zemer.search.ZemerResultMapper.toEpisodeItems
import com.jtech.zemer.search.ZemerResultMapper.toPodcastItems
import com.jtech.zemer.search.ZemerResultMapper.toGenrePage
import com.jtech.zemer.search.ZemerResultMapper.toChannelEpisodeItems
import com.jtech.zemer.search.ZemerResultMapper.toPodcastChannelPage
import com.jtech.zemer.search.ZemerResultMapper.toPodcastGenrePage
import com.jtech.zemer.search.ZemerResultMapper.toPodcastPage
import com.jtech.zemer.search.ZemerResultMapper.toSongItems
import com.metrolist.innertube.YouTube.SearchFilter
import com.metrolist.innertube.models.AlbumItem
import com.metrolist.innertube.models.Artist
import com.metrolist.innertube.models.EpisodeItem
import com.metrolist.innertube.models.PodcastItem
import com.metrolist.innertube.models.PlaylistItem
import com.metrolist.innertube.models.SearchSuggestions
import com.metrolist.innertube.models.SongItem
import com.metrolist.innertube.pages.AlbumPage
import com.metrolist.innertube.pages.ArtistPage
import com.metrolist.innertube.pages.PodcastPage
import com.metrolist.innertube.pages.SearchResult
import com.metrolist.innertube.pages.SearchSummaryPage
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import java.nio.channels.UnresolvedAddressException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/** A Zemer `/playlist` open, mapped to the UI types the online-playlist screen already renders. */
data class ZemerPlaylistPage(val playlist: PlaylistItem, val songs: List<SongItem>)

/** A Zemer `/radio` page: the next whitelist-pure tracks + the opaque continuation token (null = end). */
data class ZemerRadioPage(val songs: List<SongItem>, val continuation: String?)

/**
 * A curated `/zemer-playlists?id=…` open: the server header plus playable, already-filtered tracks.
 * [albums] = the curated albums as browsable rows (the detail screen's Albums chip). [albumTrackIds] =
 * the videoIds that entered the playlist via an album expansion ([ZemerTrack.fromAlbum]) — the Songs
 * chip's complement, and what Play/Shuffle plays under the Albums chip ([SongItem] can't carry it).
 */
data class ZemerCuratedPlaylistPage(
    val playlist: ZemerCuratedPlaylist,
    val songs: List<SongItem>,
    val albums: List<AlbumItem>,
    val albumTrackIds: Set<String>,
    /**
     * videoId → chart movement, for the `auto-*` playlists. Kept beside [songs] rather than on the
     * items themselves because [SongItem] is an innertube model shared with the YouTube path — the
     * same reason [albumTrackIds] is a side set. Missing key = no badge (the common case).
     */
    val movement: Map<String, ChartMovement>,
    /**
     * videoId → 1-based position on the unfiltered chart. Non-empty IS the test for "ranked chart":
     * the server emits `rank` whenever a stored ordering exists, even when no movement badges do.
     * Because our list is filtered, the displayed positions legitimately have GAPS (…31, 32, 34…) —
     * the dropped row's position is left empty rather than absorbed, so every position keeps meaning
     * the same thing as the delta beside it. Row count therefore does NOT equal the last position;
     * never derive one from the other.
     */
    val rank: Map<String, Int>,
)

/**
 * Whether [this] is the server being unreachable, as opposed to a code bug. Timeouts and non-2xx
 * responses surface as [IOException] (the client wraps them), but Ktor CIO signals missing
 * connectivity / dead DNS — the offline feature's flagship scenario — as
 * [UnresolvedAddressException], which is an [IllegalArgumentException], NOT an [IOException]
 * (same hazard `LyricsHelper` documents). Both must trigger the fallback.
 */
internal fun Throwable.isZemerServerUnreachable(): Boolean =
    this is IOException || this is UnresolvedAddressException

/**
 * Server-first with offline fallback: run [server]; if it fails because the service is unreachable
 * ([isZemerServerUnreachable]), serve [offline] from the on-device snapshot when one is present, else
 * rethrow so the ViewModel keeps its normal error/retry behavior. A non-network null (a 404 the
 * client returns as null) is returned as-is and never triggers the fallback; a non-network exception
 * is never masked. Top-level + `internal` so the routing policy is unit-tested without an Android
 * runtime or mocking.
 */
internal suspend fun <T> serverOrOffline(server: suspend () -> T, offline: suspend () -> T?): T =
    try {
        server()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        if (!e.isZemerServerUnreachable()) throw e
        offline() ?: throw e
    }

/**
 * Entry point for search and browse. Stalow Music answers every call from YouTube Music directly, filtered by
 * the built-in artist list ([LocalCatalog]); the original search server is never contacted. The public API is
 * unchanged so every screen keeps working. Features that only existed on the original server (podcast
 * catalog, genres, stations, curated playlists, the Videos/Podcasts tab rankings) return empty results, which
 * every screen already shows as "nothing here" or hides.
 */
@Singleton
class ZemerSearchRepository @Inject constructor(
    database: MusicDatabase,
    @ApplicationContext private val context: Context,
) {
    private val catalog = LocalCatalog(database)

    suspend fun summary(query: String, options: ZemerSearchOptions): SearchSummaryPage =
        catalog.summary(query.trim(), includeVideos = !options.blockVideos)

    suspend fun filtered(query: String, filter: SearchFilter, options: ZemerSearchOptions): SearchResult =
        when (filter.value) {
            ZEMER_FILTER_PODCAST.value, ZEMER_FILTER_EPISODE.value ->
                SearchResult(items = emptyList(), continuation = null)
            SearchFilter.FILTER_VIDEO.value -> if (options.blockVideos) {
                SearchResult(items = emptyList(), continuation = null)
            } else {
                catalog.filtered(query.trim(), filter)
            }
            else -> catalog.filtered(query.trim(), filter)
        }

    @Suppress("UNUSED_PARAMETER")
    suspend fun suggestions(query: String, options: ZemerSearchOptions): SearchSuggestions =
        catalog.suggestions(query)

    @Suppress("UNUSED_PARAMETER")
    suspend fun playlist(id: String, options: ZemerSearchOptions): ZemerPlaylistPage {
        val (header, songs) = catalog.playlist(id)
        val formatted = header.copy(
            songCountText = songs.size.takeIf { it > 0 }?.let { context.resources.getQuantityString(R.plurals.n_song, it, it) },
        )
        return ZemerPlaylistPage(formatted, songs)
    }

    @Suppress("UNUSED_PARAMETER")
    suspend fun album(browseId: String, playlistId: String?, options: ZemerSearchOptions): AlbumPage? =
        catalog.album(browseId)

    @Suppress("UNUSED_PARAMETER")
    suspend fun homeRows(options: ZemerSearchOptions): ZemerResultMapper.HomeRows = catalog.homeRows()

    @Suppress("UNUSED_PARAMETER")
    suspend fun artist(id: String, options: ZemerSearchOptions): ArtistPage? = catalog.artist(id)

    // --- Podcasts: the podcast catalog lived on the original server. Stalow Music's approved channels
    // (StalowChannels) open as YouTube Music channel pages; the server-only podcast features stay empty. ---

    @Suppress("UNUSED_PARAMETER")
    suspend fun kidZonePodcasts(options: ZemerSearchOptions): List<PodcastItem>? = emptyList()

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcast(id: String, offset: Int, options: ZemerSearchOptions): PodcastPage? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastChannel(id: String, options: ZemerSearchOptions): ZemerResultMapper.PodcastChannelPage? =
        catalog.channel(id)?.let { ZemerResultMapper.PodcastChannelPage(it, episodesNextOffset = null) }

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastChannelEpisodes(
        id: String,
        offset: Int,
        options: ZemerSearchOptions,
    ): Pair<List<EpisodeItem>, Int?>? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastHomeRows(options: ZemerSearchOptions): ZemerResultMapper.PodcastHomeRows =
        ZemerResultMapper.PodcastHomeRows(emptyList(), emptyList(), emptyList())

    @Suppress("UNUSED_PARAMETER")
    suspend fun videoHomeRows(options: ZemerSearchOptions): ZemerResultMapper.VideoHomeRows =
        ZemerResultMapper.VideoHomeRows(emptyList(), emptyList(), emptyList())

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastsNewEpisodes(k: Int, options: ZemerSearchOptions): List<EpisodeItem> = emptyList()

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastGenres(options: ZemerSearchOptions): PodcastGenreCatalog = PodcastGenreCatalog()

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastGenre(id: String, options: ZemerSearchOptions): ZemerResultMapper.PodcastGenrePage? = null

    // --- Radio: YouTube Music radio, filtered to approved artists. ---

    @Suppress("UNUSED_PARAMETER")
    suspend fun radio(kind: String, seed: String?, options: ZemerSearchOptions): ZemerRadioPage =
        catalog.radio(kind, seed).let { (songs, continuation) -> ZemerRadioPage(songs, continuation) }

    suspend fun radioContinuation(continuation: String): ZemerRadioPage =
        catalog.radioContinuation(continuation).let { (songs, next) -> ZemerRadioPage(songs, next) }

    // --- Original-server-only features: none in Stalow Music. ---

    suspend fun stations(): List<ZemerStation> = emptyList()

    @Suppress("UNUSED_PARAMETER")
    suspend fun stationTuneIn(id: String, next: Int = 5): ZemerStationTuneInResponse? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun curatedPlaylists(options: ZemerSearchOptions): List<ZemerCuratedPlaylist> = emptyList()

    @Suppress("UNUSED_PARAMETER")
    suspend fun curatedPlaylist(id: String, options: ZemerSearchOptions): ZemerCuratedPlaylistPage? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun genres(options: ZemerSearchOptions): List<ZemerGenreSummary> = emptyList()

    @Suppress("UNUSED_PARAMETER")
    suspend fun genre(id: String, options: ZemerSearchOptions, offset: Int = 0): ZemerResultMapper.ZemerGenrePage? = null

    @Suppress("UNUSED_PARAMETER")
    suspend fun genreFacet(
        id: String,
        facet: String,
        options: ZemerSearchOptions,
        offset: Int = 0,
    ): ZemerResultMapper.ZemerGenreFacetPage? = null

    /** Kept for the Retry action; there is no server-side cache to drop. */
    suspend fun invalidate() = Unit
}
