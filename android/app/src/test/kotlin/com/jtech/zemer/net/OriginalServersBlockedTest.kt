package com.jtech.zemer.net

import com.jtech.zemer.net.ZemerHeaders.withZemerHeaders
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.get
import kotlinx.coroutines.runBlocking
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress

/**
 * Stalow Music never contacts the original developers' servers: every client that installs [ZemerHeaders]
 * fails such a request on the device, before any lookup or connection. (Replaces the original signing tests.)
 */
class OriginalServersBlockedTest {
    private val lookups = mutableListOf<String>()
    private val recordingDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            lookups += hostname
            throw java.net.UnknownHostException("test: no network for $hostname")
        }
    }

    @Test
    fun `okhttp blocks every original server before resolving or connecting`() {
        val client = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).dns(recordingDns).withZemerHeaders().build()
        listOf("https://search.zemer.io/search?q=x", "https://stream.zemer.io/stream?v=a", "https://tracking.zemer.io/v1/events")
            .forEach { url ->
                try {
                    client.newCall(Request.Builder().url(url).build()).execute().close()
                    fail("$url was not blocked")
                } catch (e: ZemerHosts.Blocked) {
                    // expected
                }
            }
        assertTrue("no original host may even be looked up: $lookups", lookups.isEmpty())
    }

    @Test
    fun `okhttp lets other sites through`() {
        val client = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).dns(recordingDns).withZemerHeaders().build()
        val failure = runCatching { client.newCall(Request.Builder().url("https://music.youtube.com/").build()).execute().close() }
            .exceptionOrNull()
        assertTrue("expected the test DNS failure, got $failure", failure is java.net.UnknownHostException)
        assertTrue(lookups == listOf("music.youtube.com"))
    }

    @Test
    fun `ktor blocks every original server before sending`() = runBlocking {
        val client = HttpClient(OkHttp) {
            engine { config { proxy(java.net.Proxy.NO_PROXY); dns(recordingDns) } }
            install(ZemerHeaders.KtorPlugin)
        }
        listOf("https://content.zemer.io/whitelist", "https://pay.zemer.io/app/v1/config").forEach { url ->
            val failure = runCatching { client.get(url) }.exceptionOrNull()
            assertTrue("$url: expected Blocked, got $failure", failure is ZemerHosts.Blocked)
        }
        assertTrue("no original host may even be looked up: $lookups", lookups.isEmpty())
        client.close()
    }
}
