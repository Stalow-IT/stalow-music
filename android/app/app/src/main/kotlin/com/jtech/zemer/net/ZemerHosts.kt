package com.jtech.zemer.net

import com.jtech.zemer.BuildConfig
import java.net.URI

/**
 * The Zemer servers that receive the request signature and build header. Several shared clients (lyrics pages,
 * images) also reach third-party hosts, which must never see them.
 */
object ZemerHosts {
    private val hosts: Set<String> = buildSet {
        add("search.zemer.io")
        add("content.zemer.io")
        add("stream.zemer.io")
        add("tracking.zemer.io")
        // a build pointed at another server (local testing) sends them there too
        listOf(BuildConfig.CONTENT_MIRROR_URL, BuildConfig.ZEMER_LYRICS_BASE_URL).forEach { url ->
            runCatching { URI(url).host }.getOrNull()?.takeIf { it.isNotBlank() }?.let(::add)
        }
    }

    fun isZemerHost(host: String): Boolean {
        val h = host.lowercase()
        return h in hosts || h == "zemer.io" || h.endsWith(".zemer.io")
    }

    /**
     * Stalow Music never talks to the original developers' servers. Every client that installs
     * [ZemerHeaders] fails a request to one of these hosts on the device, before anything is sent.
     */
    class Blocked(host: String) : java.net.SocketException("blocked: $host is not used by Stalow Music")
}
