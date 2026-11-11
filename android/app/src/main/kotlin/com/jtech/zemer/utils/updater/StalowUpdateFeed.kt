package com.jtech.zemer.utils.updater

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URI

/**
 * Stalow Music's update file, published next to the APK on your own website, for example
 * `https://stalow.netlify.app/downloads/stalow-music.json`:
 *
 * ```
 * {"versionCode": 2, "versionName": "1.1", "apk": "stalow-music.apk",
 *  "sha256": "<sha-256 of the apk>", "size": 10445854, "notes": "What changed"}
 * ```
 * `apk` may be a full URL or a file name next to the update file. The download is installed only if its
 * size and SHA-256 match, and Android itself only accepts it if it is signed with your release key.
 * Pure (no Android), so it is unit-tested.
 */
object StalowUpdateFeed {
    @Serializable
    data class Release(
        val versionCode: Int,
        val versionName: String,
        val apk: String,
        val sha256: String,
        val size: Long? = null,
        val notes: String? = null,
    )

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** The release, or null for an unreadable/incomplete file. */
    fun parse(text: String): Release? = runCatching { json.decodeFromString(Release.serializer(), text) }.getOrNull()
        ?.takeIf { it.versionCode > 0 && it.apk.isNotBlank() && SHA256.matches(it.sha256.trim()) }

    fun isNewer(release: Release, installedVersionCode: Int): Boolean = release.versionCode > installedVersionCode

    /** The APK's download URL: [Release.apk] as given if absolute, else resolved next to the update file. */
    fun apkUrl(feedUrl: String, release: Release): String = URI(feedUrl).resolve(release.apk.trim()).toString()

    /** Throws when the downloaded bytes are not the announced APK. */
    fun verify(release: Release, downloadedBytes: Long, sha256Hex: String) {
        release.size?.let { if (it != downloadedBytes) throw IllegalStateException("Update size mismatch") }
        if (!release.sha256.trim().equals(sha256Hex, ignoreCase = true)) throw IllegalStateException("Update checksum mismatch")
    }

    private val SHA256 = Regex("^[0-9a-fA-F]{64}$")
}
