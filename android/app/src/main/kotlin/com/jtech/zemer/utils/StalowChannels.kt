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

    private val idsByCategory: Map<Category, Set<String>> by lazy {
        Category.entries.associateWith { c -> builtIn.of(c).map { it.id }.toSet() }
    }

    /** The list's version: raising it makes existing installs re-import the channels on next launch. */
    val version: Long get() = builtIn.version

    /** Every approved channel, each once. */
    fun all(): List<ContentPodcastDoc> = builtIn.all()

    /** The channel ids listed under [category]. */
    fun ids(category: Category): Set<String> = idsByCategory[category].orEmpty()

    /** Every approved Podcasts, Shiurim or Videos channel id (not music artists). */
    val allIds: Set<String> by lazy { idsByCategory.values.flatten().toSet() }

    /** Starts as video (Settings > Player): a podcast episode, or an upload by an approved Podcasts, Shiurim or Videos channel. Music stays audio. */
    fun startsAsVideo(isEpisode: Boolean, artistIds: List<String?>): Boolean =
        isEpisode || artistIds.any { it != null && it in allIds }
}
