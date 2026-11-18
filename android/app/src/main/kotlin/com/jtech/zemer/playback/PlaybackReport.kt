package com.jtech.zemer.playback

import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Stalow: Settings > Playback report. A short record of what playback did (states, stalls, load errors, buffer,
 * connection speed, downloads, video/audio) that the user can share when the sound cuts out, so the cause is
 * seen instead of guessed. Kept in memory only (the last [MAX_LINES] lines); never sent anywhere by itself.
 * Web addresses are removed from every line (stream links carry signatures).
 */
object PlaybackReport {
    private const val MAX_LINES = 600
    private val lines = ArrayDeque<String>()
    private val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
    private val url = Regex("https?://\\S+")

    @Synchronized
    fun add(text: String) {
        val clean = url.replace(text, "<link>").take(400)
        lines.addLast(time.format(Date()) + "  " + clean)
        while (lines.size > MAX_LINES) lines.removeFirst()
    }

    @Synchronized
    fun text(header: String): String = header + "\n\n" + lines.joinToString("\n")

    @Synchronized
    fun clear() = lines.clear()

    const val CRASH_FILE = "stalow_last_crash.txt"

    /** Saves an app crash (with the events just before it) so the next report can include it. */
    fun installCrashCapture(file: java.io.File) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val trace = java.io.StringWriter().also { error.printStackTrace(java.io.PrintWriter(it)) }.toString()
                file.writeText(url.replace(text("CRASH at ${Date()} in thread ${thread.name}") + "\n\n" + trace.take(12_000), "<link>"))
            }
            previous?.uncaughtException(thread, error)
        }
    }

    val size: Int @Synchronized get() = lines.size

    private fun stateName(s: Int) = when (s) {
        Player.STATE_IDLE -> "IDLE"
        Player.STATE_BUFFERING -> "BUFFERING"
        Player.STATE_READY -> "READY"
        Player.STATE_ENDED -> "ENDED"
        else -> s.toString()
    }

    private fun causes(e: Throwable?): String {
        val out = mutableListOf<String>()
        var c = e
        while (c != null && out.size < 4) {
            out += "${c.javaClass.simpleName}: ${c.message ?: ""}".trim()
            c = c.cause
        }
        return out.joinToString(" <- ")
    }

    /** Attached to the player in MusicService. */
    @OptIn(UnstableApi::class)
    class Listener : AnalyticsListener {
        override fun onPlaybackStateChanged(eventTime: AnalyticsListener.EventTime, state: Int) {
            add("state ${stateName(state)} at ${eventTime.currentPlaybackPositionMs / 1000}s, buffered ${eventTime.totalBufferedDurationMs / 1000}s")
        }

        override fun onPlayWhenReadyChanged(eventTime: AnalyticsListener.EventTime, playWhenReady: Boolean, reason: Int) {
            add("playWhenReady $playWhenReady (reason $reason)")
        }

        override fun onPlaybackSuppressionReasonChanged(eventTime: AnalyticsListener.EventTime, reason: Int) {
            if (reason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) add("playback suppressed, reason $reason (e.g. audio focus)")
        }

        override fun onMediaItemTransition(eventTime: AnalyticsListener.EventTime, mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
            val key = mediaItem?.localConfiguration?.customCacheKey
            add("item ${mediaItem?.mediaId} (reason $reason${if (key != null && key != mediaItem.mediaId) ", source $key" else ""})")
        }

        override fun onLoadError(
            eventTime: AnalyticsListener.EventTime,
            loadEventInfo: LoadEventInfo,
            mediaLoadData: MediaLoadData,
            error: IOException,
            wasCanceled: Boolean,
        ) {
            add("LOAD ERROR${if (wasCanceled) " (cancelled)" else ""}: ${causes(error)}; loaded ${loadEventInfo.bytesLoaded / 1024} KB in ${loadEventInfo.loadDurationMs} ms")
        }

        override fun onPlayerError(eventTime: AnalyticsListener.EventTime, error: PlaybackException) {
            add("PLAYER ERROR ${error.errorCodeName}: ${causes(error)}")
        }

        override fun onBandwidthEstimate(eventTime: AnalyticsListener.EventTime, totalLoadTimeMs: Int, totalBytesLoaded: Long, bitrateEstimate: Long) {
            add("speed ~${bitrateEstimate / 1000} kbit/s (${totalBytesLoaded / 1024} KB in ${totalLoadTimeMs} ms)")
        }

        override fun onAudioUnderrun(eventTime: AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
            add("AUDIO UNDERRUN (sound ran dry), ${elapsedSinceLastFeedMs} ms since last data")
        }

        override fun onAudioSinkError(eventTime: AnalyticsListener.EventTime, audioSinkError: Exception) {
            add("AUDIO SINK ERROR: ${causes(audioSinkError)}")
        }

        override fun onAudioCodecError(eventTime: AnalyticsListener.EventTime, audioCodecError: Exception) {
            add("AUDIO DECODER ERROR: ${causes(audioCodecError)}")
        }
    }
}
