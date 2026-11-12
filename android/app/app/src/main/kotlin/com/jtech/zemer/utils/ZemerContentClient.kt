package com.jtech.zemer.utils

import com.jtech.zemer.BuildConfig
import com.jtech.zemer.sync.ContentServerException
import com.jtech.zemer.sync.isCloudflareChallenge
import com.jtech.zemer.tracking.Tracker
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.HttpTimeoutConfig
import io.ktor.client.plugins.compression.ContentEncoding
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import com.jtech.zemer.net.ContentSignature
import com.jtech.zemer.net.ContentSignatureException
import io.ktor.http.isSuccess
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import io.ktor.client.network.sockets.ConnectTimeoutException
import io.ktor.client.network.sockets.SocketTimeoutException
import io.ktor.client.plugins.HttpRequestTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.nio.channels.UnresolvedAddressException

/**
 * Stalow Music: the content allow-sets are BUILT INTO the app (`src/main/resources/stalow/artists.json`) instead
 * of being downloaded from a content server, so the app never contacts the original developers' servers.
 *
 * The public API is unchanged so every caller ([WhitelistFetcher], [IsraeliArtistRegistry], HomeViewModel, …)
 * keeps working: the artist whitelist and its version gate come from the bundled file; the lists this app does
 * not use (id overrides, removals, Israeli-artist ids) are empty; the approved channels come from [StalowChannels]; features that only existed on
 * the server (legal mirror, music statuses, install registration) throw, which every caller already treats as
 * "unavailable, keep the built-in/last-good data".
 *
 * To change the artist list, edit the JSON file and raise its `version` so existing installs re-import it.
 */
object ZemerContentClient {
    /** Always on: the data is local. */
    val enabled: Boolean get() = true

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    @Serializable
    internal data class BuiltInArtists(
        val version: Long = 0,
        val artists: List<ContentWhitelistDoc> = emptyList(),
    )

    internal const val BUILT_IN_ARTISTS_RESOURCE = "/stalow/artists.json"

    /** Parses the bundled list; internal so the JVM unit tests read exactly what the app reads. */
    internal fun parseBuiltIn(text: String): BuiltInArtists = json.decodeFromString(BuiltInArtists.serializer(), text)

    private val builtIn: BuiltInArtists by lazy {
        val stream = ZemerContentClient::class.java.getResourceAsStream(BUILT_IN_ARTISTS_RESOURCE)
            ?: error("built-in artist list missing: $BUILT_IN_ARTISTS_RESOURCE")
        stream.use { parseBuiltIn(it.readBytes().decodeToString()) }.also {
            Timber.d("ZemerContentClient: built-in list v%d with %d artists", it.version, it.artists.size)
        }
    }

    /** The built-in list's version: raising it makes existing installs re-import the list on next launch. */
    @Suppress("UNUSED_PARAMETER")
    suspend fun version(firstSync: Boolean = false): Long = builtIn.version

    /** The built-in artist whitelist. Throws on an empty list so a broken file can never wipe a good table. */
    @Suppress("UNUSED_PARAMETER")
    suspend fun whitelist(reuseRecent: Boolean = false, firstSync: Boolean = false): List<ContentWhitelistDoc> {
        val docs = builtIn.artists.filter { (it.id.ifBlank { it.artistId.orEmpty() }).isNotBlank() }
        if (docs.isEmpty()) error("content mirror: empty /whitelist")
        return docs
    }

    /**
     * The approved channels built into the app ([StalowChannels]: Podcasts, Shiurim and Videos), served as the
     * channel-level allow-set. Every category joins it; the category only picks the browse screen.
     */
    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastsWhitelistVersion(firstSync: Boolean = false): Long = StalowChannels.version

    @Suppress("UNUSED_PARAMETER")
    suspend fun podcastsWhitelist(firstSync: Boolean = false): List<ContentPodcastDoc> = StalowChannels.all()

    /** Removals are not tracked separately: an artist left out of the built-in list simply stops showing. */
    suspend fun removedArtists(): Set<String> = emptySet()

    @Suppress("UNUSED_PARAMETER")
    suspend fun blockedIds(firstSync: Boolean = false): Map<String, String> = emptyMap()

    /** No remote legal mirror: callers keep the built-in documents. */
    suspend fun legal(): String = throw UnsupportedOperationException("no remote legal documents in Stalow Music")

    @Suppress("UNUSED_PARAMETER")
    suspend fun israeliArtists(firstSync: Boolean = false): Set<String> = emptySet()

    @Suppress("UNUSED_PARAMETER")
    suspend fun statusSourcesVersion(firstSync: Boolean = false): Long =
        throw UnsupportedOperationException("music statuses are not available in Stalow Music")

    @Suppress("UNUSED_PARAMETER")
    suspend fun statusSourcesRaw(firstSync: Boolean = false): String =
        throw UnsupportedOperationException("music statuses are not available in Stalow Music")

    /** Install registration was only for the original servers' request signing; never contacted. */
    suspend fun registerInstall(): String = throw UnsupportedOperationException("no install registration in Stalow Music")
}

/** `/whitelist/version`. `gate` is the monotonic epoch-ms (or `update`) the app version-gates on. */
@Serializable
data class ContentVersionDto(
    val update: String? = null,
    val updatedAtMs: Long? = null,
    val gate: Long? = null,
)

/** One `/whitelist/removed` row (`removedAt` is informational and not read). */
@Serializable
data class ContentRemovedArtistDto(val id: String)

/** `/blockedContentIds` — already bucketed by reason, disabled entries already dropped server-side. */
@Serializable
data class ContentBlockedDto(
    val global: List<String> = emptyList(),
    val female: List<String> = emptyList(),
)

/** `/status-sources/version`. `version` is the monotonic integer the app version-gates on; `updatedAt` is informational. */
@Serializable
data class StatusSourcesVersionDto(
    val version: Long? = null,
    val updatedAt: String? = null,
)

/**
 * One `/whitelist` document. **Every boolean is nullable** on purpose: the mirror omits fields a doc
 * lacks (e.g. `isKids`/`isChasid`/`isGenZ` are sparse), and the same doc feeds two mappings with
 * different null semantics — the whitelist-entity mapping coerces `?: false`, while `HomeArtistProfile`
 * keeps null (`isAmerican` may be genuinely unknown). Defaulting to `false` here would erase that.
 */
@Serializable
data class ContentWhitelistDoc(
    val id: String = "",
    @SerialName("artistId") val artistId: String? = null,
    val name: String? = null,
    @SerialName("artistName") val artistName: String? = null,
    // Additive display-name split (2026-08-21): `name` keeps the legacy value (for ~49 artists a dual
    // "English - עברית" dash form) so old installs are untouched; `displayName` is the clean
    // single-script name to render, `altName` the same name in the other script (matched by Library
    // search, the browse filters, and artistByName). Contract:
    // handoff-docs/zemer-whitelist-display-names.md.
    val displayName: String? = null,
    val altName: String? = null,
    val isFemale: Boolean? = null,
    val isChasid: Boolean? = null,
    val isGenZ: Boolean? = null,
    val isKids: Boolean? = null,
    val isKidZone: Boolean? = null,
    val isAmerican: Boolean? = null,
    val isFamous: Boolean? = null,
    val isDJ: Boolean? = null,
    val isGroup: Boolean? = null,
    // Per-artist channel image (yt3/lh3 URL), resolved once server-side so devices don't each fetch it.
    val thumbnail: String? = null,
)

/**
 * One `/podcastChannelsWhitelist` document (the mirror's copy of a Firestore `podcastChannelsWhitelist`
 * doc) — a whitelisted podcast HOST CHANNEL. `id` is the `UC…` channel id; `thumbnailUrl` is the durable
 * channel avatar; `isFemale`/`isKidZone` are the wholly-female/kids channel flags; `showCount` is how
 * many of the channel's shows are known.
 */
@Serializable
data class ContentPodcastDoc(
    val id: String = "",
    val name: String? = null,
    val thumbnailUrl: String? = null,
    val isFemale: Boolean = false,
    val isKidZone: Boolean = false,
    val isVerified: Boolean = false,
    val showCount: Int = 0,
)

/**
 * Logs a failed content read and reports it as a `fetch_fail` event (once per [label] per session), so
 * we can see how many devices cannot reach the content server. A cancellation is rethrown, never reported.
 */
/**
 * A read's time limits: [totalMs] for the whole call, and with [stallMs] a large body fails only when no data
 * arrives for that long, so a slow link that keeps delivering finishes (JVM-tested in ContentReadTimeoutsTest).
 */
internal fun HttpTimeoutConfig.contentReadTimeouts(totalMs: Long, stallMs: Long?) {
    requestTimeoutMillis = totalMs
    if (stallMs != null) socketTimeoutMillis = stallMs
}

internal inline fun <T> contentRead(label: String, block: () -> T): Result<T> =
    runCatching(block).onFailure { reportContentFetchFailure(label, it) }

internal fun reportContentFetchFailure(label: String, t: Throwable) {
    // a cancelled read is not a failure: rethrown so the caller's runCatching never turns it into one
    if (t is CancellationException) throw t
    Timber.w(t, "ZemerContentClient: %s unavailable", label)
}

/**
 * Why a content-mirror read failed, for the `fetch_fail` telemetry event: `challenge` (Cloudflare bot
 * challenge), `http_<code>`, `timeout`, `io` (no network / DNS / connection), `non_json` (a 2xx body
 * that is not the expected JSON), `empty` (a valid but empty allow-set), else `other`.
 */
internal fun fetchFailKind(t: Throwable): String = when {
    t is ContentServerException && t.challenge -> "challenge"
    t is ContentServerException -> "http_${t.status}"
    t is HttpRequestTimeoutException || t is ConnectTimeoutException || t is SocketTimeoutException -> "timeout"
    t is IOException || t is UnresolvedAddressException -> "io"
    t is SerializationException || t is IllegalArgumentException -> "non_json"
    t is IllegalStateException && t.message?.startsWith("content mirror: empty") == true -> "empty"
    else -> "other"
}
