package com.jtech.zemer.utils

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * The approved non-music YouTube channels built into Stalow Music (`src/main/resources/stalow/channels.json`),
 * in three categories: Podcasts, Shiurim and Videos. A channel may be in more than one category.
 *
 * Every channel in any category joins the channel-level allow-set ([PodcastWhitelistCache], synced through the
 * podcast whitelist), so its own content passes the content gate. The category only decides which browse
 * screen lists it.
 *
 * To change a list, edit the JSON file and raise its `version` so existing installs re-import it.
 */
object StalowChannels {
    enum class Category { PODCASTS, SHIURIM, VIDEOS }

    @Serializable
    internal data class BuiltInChannels(
        val version: Long = 0,
        val podcasts: List<ContentPodcastDoc> = emptyList(),
        val shiurim: List<ContentPodcastDoc> = emptyList(),
        val videos: List<ContentPodcastDoc> = emptyList(),
    ) {
        fun of(category: Category): List<ContentPodcastDoc> = when (category) {
            Category.PODCASTS -> podcasts
            Category.SHIURIM -> shiurim
            Category.VIDEOS -> videos
        }

        /** Every channel once (first entry wins), in podcasts, shiurim, videos order. */
        fun all(): List<ContentPodcastDoc> =
            (podcasts + shiurim + videos).filter { it.id.isNotBlank() }.distinctBy { it.id }
    }

    internal const val RESOURCE = "/stalow/channels.json"

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    /** Parses the bundled list; internal so the JVM unit tests read exactly what the app reads. */
    internal fun parse(text: String): BuiltInChannels = json.decodeFromString(BuiltInChannels.serializer(), text)

    private val builtIn: BuiltInChannels by lazy {
        val stream = StalowChannels::class.java.getResourceAsStream(RESOURCE)
        if (stream == null) {
            Timber.w("StalowChannels: %s missing, no approved channels", RESOURCE)
            BuiltInChannels()
        } else {
            stream.use { parse(it.readBytes().decodeToString()) }.also {
                Timber.d(
                    "StalowChannels: v%d, %d podcasts, %d shiurim, %d videos",
                    it.version, it.podcasts.size, it.shiurim.size, it.videos.size,
                )
            }
        }
    }

    private fun categoryName(c: Category) = when (c) {
        Category.PODCASTS -> CatalogOverrides.PODCASTS
        Category.SHIURIM -> CatalogOverrides.SHIURIM
        Category.VIDEOS -> CatalogOverrides.VIDEOS
    }

    /** The built-in list with the admins' changes ([CatalogOverrides]) applied, rebuilt when they change. */
    internal fun effective(base: BuiltInChannels, overrides: Map<String, CatalogOverrides.Entry>): BuiltInChannels {
        if (overrides.isEmpty()) return base
        fun listFor(c: Category): List<ContentPodcastDoc> {
            val name = categoryName(c)
            val kept = base.of(c).filter { it.id !in overrides }
            val existing = base.all().associateBy { it.id }
            val added = overrides.values.filter { it.category == name && !it.removed }.map { e ->
                existing[e.id]?.copy(name = e.name.ifBlank { existing[e.id]?.name }, thumbnailUrl = e.thumbnail.ifBlank { existing[e.id]?.thumbnailUrl })
                    ?: ContentPodcastDoc(id = e.id, name = e.name.ifBlank { e.id }, thumbnailUrl = e.thumbnail.ifBlank { null })
            }
            return kept + added
        }
        return BuiltInChannels(base.version, listFor(Category.PODCASTS), listFor(Category.SHIURIM), listFor(Category.VIDEOS))
    }

    @Volatile
    private var cache: Pair<Map<String, CatalogOverrides.Entry>, BuiltInChannels>? = null

    private val current: BuiltInChannels
        get() {
            val o = CatalogOverrides.entries
            cache?.let { if (it.first === o) return it.second }
            return effective(builtIn, o).also { cache = o to it }
        }

    /** The list's version: raising it (or an admin change) makes existing installs re-import the channels. */
    val version: Long get() = builtIn.version * 1_000_000 + CatalogOverrides.version

    /** Every approved channel, each once. */
    fun all(): List<ContentPodcastDoc> = current.all()

    /** The built-in channels, before the admins' changes (Settings > Channels & artists). */
    fun builtInByCategory(): Map<Category, List<ContentPodcastDoc>> = Category.entries.associateWith { builtIn.of(it) }

    /** The channel ids listed under [category]. */
    fun ids(category: Category): Set<String> = current.of(category).map { it.id }.toSet()

    /** Every approved Podcasts, Shiurim or Videos channel id (not music artists). */
    val allIds: Set<String> get() = current.all().map { it.id }.toSet()

    /** Starts as video (Settings > Player): a podcast episode, or an upload by an approved Podcasts, Shiurim or Videos channel. Music stays audio. */
    fun startsAsVideo(isEpisode: Boolean, artistIds: List<String?>): Boolean =
        isEpisode || artistIds.any { it != null && it in allIds }
}
