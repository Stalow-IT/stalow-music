package com.jtech.zemer.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import com.jtech.zemer.constants.GuestModeKey
import com.jtech.zemer.constants.InnerTubeCookieKey
import com.jtech.zemer.constants.VisitorDataKey
import com.jtech.zemer.utils.dataStore
import com.metrolist.innertube.YouTube
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

/**
 * Stalow Music: using the app without a Google account. YouTube Music works signed out; it only needs a
 * visitor id, which YouTube itself hands out. This replaces the original app's "anonymous" sign-in, which
 * logged everyone into a shared account fetched from a developer's server.
 */
object GuestSession {
    private const val VISITOR_URL = "https://music.youtube.com/youtubei/v1/visitor_id?prettyPrint=false"
    private const val BODY = """{"context":{"client":{"clientName":"WEB_REMIX","clientVersion":"1.20260707.12.00","hl":"en","gl":"US"}}}"""

    /** Turns guest mode on and makes sure a visitor id exists. Returns false when YouTube could not be reached. */
    suspend fun start(context: Context): Boolean {
        context.dataStore.edit { it[GuestModeKey] = true }
        return ensureVisitorData(context)
    }

    /** For a guest without a visitor id (first start, or after one was cleared): fetch and store one. */
    suspend fun ensureVisitorData(context: Context): Boolean = withContext(Dispatchers.IO) {
        val prefs = context.dataStore.data.first()
        if (prefs[GuestModeKey] != true) return@withContext true
        if (!prefs[InnerTubeCookieKey].isNullOrBlank()) return@withContext true
        if (!prefs[VisitorDataKey].isNullOrBlank() && prefs[VisitorDataKey] != "null") return@withContext true
        val visitor = runCatching { fetchVisitorData() }
            .onFailure { Timber.w(it, "GuestSession: visitor id unavailable") }
            .getOrNull() ?: return@withContext false
        context.dataStore.edit { it[VisitorDataKey] = visitor }
        YouTube.visitorData = visitor
        true
    }

    private fun fetchVisitorData(): String? {
        val conn = URL(VISITOR_URL).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(BODY.toByteArray()) }
            if (conn.responseCode !in 200..299) return null
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            return parseVisitorData(text)
        } finally {
            conn.disconnect()
        }
    }

    /** The visitor id in a YouTube reply, URL-decoded; null when absent. Pure, so it is unit-tested. */
    internal fun parseVisitorData(json: String): String? = runCatching {
        Json.parseToJsonElement(json).jsonObject["responseContext"]?.jsonObject?.get("visitorData")
            ?.jsonPrimitive?.contentOrNull
    }.getOrNull()?.takeIf { it.isNotBlank() }?.let { URLDecoder.decode(it, "UTF-8") }
}
