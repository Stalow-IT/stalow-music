package com.jtech.zemer.pcsync

import android.content.Context
import android.os.Build
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import com.jtech.zemer.constants.AllowFemaleSingersKey
import com.jtech.zemer.constants.AudioNormalizationKey
import com.jtech.zemer.constants.AutoLoadMoreKey
import com.jtech.zemer.constants.BlockPodcastsKey
import com.jtech.zemer.constants.BlockVideosKey
import com.jtech.zemer.constants.DarkModeKey
import com.jtech.zemer.constants.LyricsScrollKey
import com.jtech.zemer.constants.LyricsTextPositionKey
import com.jtech.zemer.constants.LyricsWordSyncKey
import com.jtech.zemer.constants.PauseListenHistoryKey
import com.jtech.zemer.constants.PauseSearchHistoryKey
import com.jtech.zemer.constants.PersistentQueueKey
import com.jtech.zemer.constants.PureBlackKey
import com.jtech.zemer.constants.SkipSilenceKey
import com.jtech.zemer.db.MusicDatabase
import com.jtech.zemer.db.entities.Event
import com.jtech.zemer.db.entities.Song
import com.jtech.zemer.models.MediaMetadata
import com.jtech.zemer.playback.DownloadUtil
import com.jtech.zemer.utils.dataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Settings > Sync with your PC: connects [SyncEngine] to this phone's history, liked songs, downloads, settings
 * and player. Syncs a few seconds after a change here, every minute while the app runs, and when the app starts.
 */
@Singleton
class PcSync @Inject constructor(
    @ApplicationContext private val context: Context,
    private val databaseLazy: dagger.Lazy<MusicDatabase>,
    private val downloadUtilLazy: dagger.Lazy<DownloadUtil>,
) {
    private val database get() = databaseLazy.get()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
    private val _status = MutableStateFlow(PcSyncStatus())
    private val _remote = MutableStateFlow<List<JSONObject>>(emptyList())
    private var loop: Job? = null

    /** For Settings > Sync with your PC. */
    val status: StateFlow<PcSyncStatus> = _status.asStateFlow()

    /** What the other devices are playing, for "Continue from your PC". */
    val remoteSessions: StateFlow<List<JSONObject>> = _remote.asStateFlow()

    val engine: SyncEngine by lazy {
        SyncEngine(
            stateFile = File(context.filesDir, "pc_sync.json"),
            deviceName = "Phone (${Build.MODEL})".take(60),
            transport = ::post,
            local = Local(),
            onChange = { s -> _status.value = s; _remote.value = engineOrNull?.remoteSessions().orEmpty() },
        ).also { engineOrNull = it }
    }
    @Volatile private var engineOrNull: SyncEngine? = null

    /** Called once from App.onCreate. */
    @OptIn(FlowPreview::class)
    fun start() {
        scope.launch {
            _status.value = engine.status
            _remote.value = engine.remoteSessions()
            delay(8_000)
            restartLoop()
            // a change here: sync a few seconds later (changes close together go in one round)
            val db = database
            combine(
                db.eventCount(), db.likedSongsCount(), db.downloadedCount(),
                context.dataStore.data.map { p -> SHARED_KEYS.map { p[it] } + p[PureBlackKey] },
                PcSyncNowPlaying.changes,
            ) { a, b, c, d, e -> listOf(a, b, c, d, e) }
                .distinctUntilChanged().drop(1).debounce(4_000)
                .collect { if (engine.code != null) runCatching { engine.syncNow() } }
        }
    }

    private fun restartLoop() {
        loop?.cancel()
        loop = scope.launch {
            while (true) {
                if (engine.code != null) runCatching { engine.syncNow() }
                delay(60_000)
            }
        }
    }

    suspend fun create(): PcSyncStatus = withContext(Dispatchers.IO) { engine.create() }
    suspend fun join(code: String): PcSyncStatus = withContext(Dispatchers.IO) { engine.join(code) }
    suspend fun syncNow(): PcSyncStatus = withContext(Dispatchers.IO) { engine.syncNow() }
    suspend fun leave(erase: Boolean) = withContext(Dispatchers.IO) { engine.leave(erase); _remote.value = emptyList() }

    private suspend fun post(body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(SyncProtocol.URL)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!res.isSuccessful) throw IOException(json.optString("error").ifEmpty { "Sync failed (HTTP ${res.code})" })
            json
        }
    }

    private inner class Local : SyncLocal {
        override suspend fun history(): List<JSONObject> =
            database.latestPlayPerSong(200).filter { !it.song.song.isEpisode }.distinctBy { it.song.id }
                .map { songJson(it.song).put("playedAt", epochMs(it.event.timestamp)) }

        override suspend fun addPlays(songs: List<JSONObject>) {
            for (s in songs) runCatching {
                database.insert(metadataOf(s))
                database.insert(Event(songId = s.getString("id"), timestamp = localTime(s.optLong("playedAt")), playTime = 0))
            }.onFailure { Timber.w(it, "PcSync: could not add a play") }
        }

        override suspend fun likes(): List<JSONObject> =
            database.likedSongsBlocking().filter { !it.song.isEpisode }
                .map { songJson(it).put("likedAt", it.song.likedDate?.let(::epochMs) ?: 0L) }

        override suspend fun setLike(song: JSONObject, liked: Boolean) {
            val id = song.getString("id")
            val existing = database.getSongByIdBlocking(id)
            if (liked) {
                val at = localTime(song.optLong("likedAt").takeIf { it > 0 } ?: System.currentTimeMillis())
                if (existing == null) database.insert(metadataOf(song)) { it.copy(liked = true, likedDate = at, inLibrary = at) }
                else database.update(existing.song.copy(liked = true, likedDate = at, inLibrary = existing.song.inLibrary ?: at))
            } else if (existing != null && existing.song.liked) {
                database.update(existing.song.copy(liked = false, likedDate = null))
            }
        }

        override suspend fun downloads(): List<JSONObject> = database.downloadedSongsBlocking().map { songJson(it) }

        override suspend fun download(songs: List<JSONObject>) {
            for (s in songs) runCatching {
                database.insert(metadataOf(s))
                val song = database.getSongByIdBlocking(s.getString("id")) ?: return@runCatching
                downloadUtilLazy.get().downloadToMediaStore(song, fromUser = false)
            }.onFailure { Timber.w(it, "PcSync: could not start a download") }
        }

        override suspend fun settings(): Map<String, Any> {
            val p = context.dataStore.data.first()
            val out = linkedMapOf<String, Any>()
            p[DarkModeKey]?.let { mode ->
                out["theme"] = when (mode) {
                    "ON" -> if (p[PureBlackKey] == true) "black" else "dark"
                    "OFF" -> "light"
                    else -> "system"
                }
            }
            for ((name, key) in BOOLEANS) p[key]?.let { out[name] = it }
            p[LyricsTextPositionKey]?.lowercase()?.takeIf { it in listOf("left", "center", "right") }?.let { out["lyricsPosition"] = it }
            return out
        }

        override suspend fun applySettings(changes: Map<String, Any?>) {
            context.dataStore.edit { p ->
                for ((name, v) in changes) {
                    when (name) {
                        "theme" -> when (v) {
                            "black" -> { p[DarkModeKey] = "ON"; p[PureBlackKey] = true }
                            "dark" -> { p[DarkModeKey] = "ON"; p[PureBlackKey] = false }
                            "light" -> p[DarkModeKey] = "OFF"
                            "system" -> p[DarkModeKey] = "AUTO"
                        }
                        "lyricsPosition" -> if (v is String && v in listOf("left", "center", "right")) p[LyricsTextPositionKey] = v.uppercase()
                        else -> BOOLEANS[name]?.let { key -> if (v is Boolean) p[key] = v }
                    }
                }
            }
        }

        override suspend fun session(): JSONObject? = PcSyncNowPlaying.session
    }

    companion object {
        /** Windows setting name -> this app's switch. */
        private val BOOLEANS: Map<String, Preferences.Key<Boolean>> = mapOf(
            "allowFemale" to AllowFemaleSingersKey,
            "blockPodcasts" to BlockPodcastsKey,
            "blockVideos" to BlockVideosKey,
            "audioNormalization" to AudioNormalizationKey,
            "skipSilence" to SkipSilenceKey,
            "persistentQueue" to PersistentQueueKey,
            "autoLoadMore" to AutoLoadMoreKey,
            "lyricsWordSync" to LyricsWordSyncKey,
            "lyricsAutoScroll" to LyricsScrollKey,
            "pauseListenHistory" to PauseListenHistoryKey,
            "pauseSearchHistory" to PauseSearchHistoryKey,
            "videoFirst" to com.jtech.zemer.constants.VideoFirstKey,
        )
        private val SHARED_KEYS: List<Preferences.Key<*>> = BOOLEANS.values.toList() + DarkModeKey + LyricsTextPositionKey

        /** The app stores local wall-clock times; the sync uses real time (ms). */
        fun epochMs(t: LocalDateTime): Long = t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        fun localTime(ms: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault())

        fun songJson(s: Song): JSONObject = JSONObject()
            .put("id", s.id)
            .put("title", s.song.title)
            .put("artists", JSONArray().also { arr -> s.artists.forEach { a -> arr.put(JSONObject().put("id", a.channelId ?: a.id.takeIf { it.startsWith("UC") } ?: JSONObject.NULL).put("name", a.name)) } })
            .put("album", s.song.albumId?.let { JSONObject().put("id", it).put("title", s.song.albumName ?: s.album?.title ?: "") } ?: JSONObject.NULL)
            .put("thumbnail", s.song.thumbnailUrl ?: "")
            .put("duration", s.song.duration.takeIf { it > 0 } ?: JSONObject.NULL)

        fun metadataOf(s: JSONObject): MediaMetadata {
            val arr = s.optJSONArray("artists") ?: JSONArray()
            val artists = (0 until arr.length()).mapNotNull { i ->
                val a = arr.optJSONObject(i) ?: return@mapNotNull null
                MediaMetadata.Artist(id = a.optString("id").takeIf { it.isNotEmpty() && it != "null" }, name = a.optString("name"))
            }
            val album = s.optJSONObject("album")?.let { a ->
                val id = a.optString("id"); val title = a.optString("title").ifEmpty { a.optString("name") }
                if (id.isNotEmpty() && id != "null") MediaMetadata.Album(id = id, title = title) else null
            }
            return MediaMetadata(
                id = s.getString("id"),
                title = s.optString("title"),
                artists = artists,
                duration = s.optInt("duration", -1).takeIf { it > 0 } ?: -1,
                thumbnailUrl = s.optString("thumbnail").takeIf { it.isNotEmpty() },
                album = album,
            )
        }
    }
}

/**
 * What this phone is playing, set by the player (MusicService) whenever it saves the queue; read by the sync for
 * "Continue from your phone" on the PC. [changes] ticks when the song changes, so the PC hears of it soon.
 */
object PcSyncNowPlaying {
    @Volatile var session: JSONObject? = null
        private set
    private var lastId: String? = null
    private var at = 0L
    val changes = MutableStateFlow(0)

    /** The other device's session this phone continued from (so its offer goes away at once). */
    @Volatile var continuedAt = 0L

    fun update(items: List<MediaMetadata>, index: Int, positionMs: Long) {
        if (items.isEmpty() || index !in items.indices) return
        val id = items[index].id
        if (id != lastId) { lastId = id; at = System.currentTimeMillis(); changes.value = changes.value + 1 }
        val from = (index - 20).coerceAtLeast(0)
        val queue = JSONArray()
        items.subList(from, minOf(items.size, from + 100)).forEach { m ->
            queue.put(JSONObject()
                .put("type", "song").put("id", m.id).put("title", m.title)
                .put("artists", JSONArray().also { arr -> m.artists.forEach { a -> arr.put(JSONObject().put("id", a.id ?: JSONObject.NULL).put("name", a.name)) } })
                .put("album", m.album?.let { JSONObject().put("id", it.id).put("title", it.title) } ?: JSONObject.NULL)
                .put("thumbnail", m.thumbnailUrl ?: "")
                .put("duration", m.duration.takeIf { it > 0 } ?: JSONObject.NULL))
        }
        session = JSONObject().put("queue", queue).put("index", index - from).put("time", positionMs / 1000).put("at", at)
    }
}
