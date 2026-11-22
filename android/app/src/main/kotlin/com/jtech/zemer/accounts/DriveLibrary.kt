package com.jtech.zemer.accounts

import com.jtech.zemer.models.MediaMetadata
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File

/**
 * Stalow: Google Drive folders and files the admins added (Settings > Google Drive), for everyone. Only files
 * shared as "Anyone with the link" are added; the server reads the folders (new files show up by themselves) and
 * the phone streams each file straight from Drive. A copy of the list is kept so it shows offline too.
 */
object DriveLibrary {
    data class DriveFile(val id: String, val name: String, val type: String) {
        val isVideo get() = type == "video"

        /** The name without its folder path and file extension. */
        val title: String get() = name.substringAfterLast(" / ").substringBeforeLast('.').ifBlank { name }
    }

    data class Item(
        val id: String,
        val kind: String,
        val title: String,
        val category: String,
        val removed: Boolean,
        val files: List<DriveFile>,
        /** The artist this is an album of (filled in by an admin when YouTube Music lacks it), or null. */
        val artistId: String? = null,
        val year: Int? = null,
        /** Copying into the owner's Google Drive: "copying", "done", "failed", or null (not copied). */
        val copyStatus: String? = null,
        val copyError: String? = null,
        /** The collection it came from (a shared folder of album folders), or null. */
        val parentId: String? = null,
    ) {
        val isFolder get() = kind == "folder"
        val isCollection get() = kind == "collection"
    }

    private val _items = MutableStateFlow<List<Item>>(emptyList())
    val items: StateFlow<List<Item>> = _items.asStateFlow()
    private var file: File? = null

    fun load(file: File) {
        this.file = file
        if (file.exists()) runCatching { _items.value = parse(JSONObject(file.readText())) }
    }

    internal fun parse(json: JSONObject): List<Item> {
        val list = json.optJSONArray("items") ?: JSONArray()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.mapNotNull { o ->
            val id = o.optString("id").takeIf { it.matches(ID) } ?: return@mapNotNull null
            val files = o.optJSONArray("files") ?: JSONArray()
            Item(
                id = id,
                kind = o.optString("kind", "folder"),
                title = o.optString("title").ifBlank { "Google Drive" },
                category = o.optString("category", "music"),
                removed = o.optBoolean("removed"),
                files = (0 until files.length()).mapNotNull { files.optJSONObject(it) }.mapNotNull { f ->
                    val fid = f.optString("id").takeIf { it.matches(ID) } ?: return@mapNotNull null
                    DriveFile(fid, f.optString("name"), f.optString("type", "audio"))
                },
                artistId = o.optString("artistId").takeIf { it.startsWith("UC") },
                year = o.optInt("year").takeIf { it in 1900..2100 },
                copyStatus = o.optString("copyStatus").takeIf { it.isNotBlank() && it != "null" },
                copyError = o.optString("copyError").takeIf { it.isNotBlank() && it != "null" },
                parentId = o.optString("parentId").takeIf { it.matches(ID) },
            )
        }
    }

    /** Fetches the shared list (approved devices); without a connection the saved copy stays. */
    suspend fun refresh() {
        if (StalowAccount.state.value.status != StalowAccount.Status.APPROVED) return
        runCatching {
            val json = StalowAccount.call("drive.list")
            _items.value = parse(json)
            file?.writeText(json.toString())
        }.onFailure { Timber.d(it, "DriveLibrary: refresh failed") }
    }

    fun item(id: String): Item? = _items.value.firstOrNull { it.id == id }

    // ---- admins ----

    /** Everything, including removed entries (Settings > Google Drive). */
    suspend fun all(): List<Item> = parse(StalowAccount.call("drive.all"))

    /** Adds a shared folder or file link; the server checks it can be read and has audio or video in it. */
    suspend fun add(link: String, category: String, title: String, artistId: String? = null, year: Int? = null) {
        StalowAccount.call(
            "drive.add",
            JSONObject().put("link", link.trim()).put("category", category).put("title", title.trim()).apply {
                artistId?.let { put("artistId", it) }
                year?.let { put("year", it) }
            },
        )
        refresh()
    }

    /** Removes it for everyone; with [deleteCopy] its copy in the owner's Drive goes to the bin too. */
    suspend fun remove(id: String, deleteCopy: Boolean) {
        StalowAccount.call("drive.set", JSONObject().put("id", id).put("removed", true).put("deleteCopy", deleteCopy))
        refresh()
    }

    data class Copier(val connected: Boolean, val rootUrl: String?, val isOwner: Boolean, val script: String)

    /** Copy to my Google Drive: whether the owner's copier is connected, and the script to install. */
    suspend fun copier(): Copier {
        val o = StalowAccount.call("drive.copier.get")
        return Copier(o.optBoolean("connected"), o.optString("rootUrl").takeIf { it.startsWith("https://") }, o.optBoolean("owner"), o.optString("script"))
    }

    suspend fun connectCopier(url: String) { StalowAccount.call("drive.copier.set", JSONObject().put("url", url.trim())) }

    suspend fun disconnectCopier() { StalowAccount.call("drive.copier.clear") }

    data class Compared(val item: Item, val match: Album?)

    /** Each Drive album of [artistId], and the YouTube Music album with the same name if it has appeared. */
    suspend fun compare(artistId: String): List<Compared> {
        val json = StalowAccount.call("catalog.compare", JSONObject().put("id", artistId))
        val list = json.optJSONArray("results") ?: JSONArray()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.mapNotNull { r ->
            val item = parse(JSONObject().put("items", JSONArray().put(r.optJSONObject("drive") ?: return@mapNotNull null))).firstOrNull() ?: return@mapNotNull null
            val m = r.optJSONObject("match")
            Compared(item, m?.let { Album(it.optString("browseId"), it.optString("title"), it.optInt("year").takeIf { y -> y > 0 }, it.optString("kind"), it.optString("thumbnail")) })
        }
    }

    /** The albums of [artistId] attached from Drive. */
    fun forArtist(artistId: String): List<Item> = _items.value.filter { it.artistId == artistId }

    data class Album(val browseId: String, val title: String, val year: Int?, val kind: String, val thumbnail: String)

    /** An artist's albums and singles on YouTube Music, and the Drive albums attached to it (admins). */
    suspend fun artistAlbums(artistId: String): Pair<List<Album>, List<Item>> {
        val json = StalowAccount.call("catalog.albums", JSONObject().put("id", artistId))
        val list = json.optJSONArray("albums") ?: JSONArray()
        val albums = (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map {
            Album(it.optString("browseId"), it.optString("title"), it.optInt("year").takeIf { y -> y > 0 }, it.optString("kind"), it.optString("thumbnail"))
        }
        return albums to parse(JSONObject().put("items", json.optJSONArray("drive") ?: JSONArray()))
    }

    suspend fun set(id: String, title: String? = null, category: String? = null, removed: Boolean? = null, refreshFiles: Boolean = false) {
        StalowAccount.call(
            "drive.set",
            JSONObject().put("id", id).apply {
                title?.let { put("title", it) }
                category?.let { put("category", it) }
                removed?.let { put("removed", it) }
                if (refreshFiles) put("refresh", true)
            },
        )
        refresh()
    }

    private val ID = Regex("^[A-Za-z0-9_-]{10,100}$")
}

/** How a Drive file plays: its own media id (`drive:<fileId>`), streamed from Drive's download address. */
object DriveMedia {
    const val PREFIX = "drive:"

    fun isDrive(mediaId: String?): Boolean = mediaId?.startsWith(PREFIX) == true

    fun mediaId(fileId: String) = PREFIX + fileId

    /** The file's download address (shared files only); it accepts range requests, so seeking works. */
    fun streamUrl(mediaId: String): String =
        "https://drive.usercontent.google.com/download?id=" + mediaId.removePrefix(PREFIX) + "&export=download&confirm=t"

    fun metadata(file: DriveLibrary.DriveFile, item: DriveLibrary.Item) = MediaMetadata(
        id = mediaId(file.id),
        title = file.title,
        artists = listOf(MediaMetadata.Artist(id = null, name = item.title)),
        duration = -1,
        thumbnailUrl = null,
        album = null,
        isVideo = false,
    )
}
