package com.jtech.zemer.playback

/**
 * Stalow: playback comes before downloads. On a phone connection a download running at full speed (three at
 * once, a long podcast) starved what was playing: the sound cut in and out every few seconds, and switching
 * video to audio (a fresh audio stream) took about a minute. While something streams with little buffered,
 * [needed] is set by MusicService and downloads slow to a trickle until the buffer is comfortable again.
 */
object PlaybackBandwidth {
    /** Streaming playback is short of buffer (or loading): downloads should give way. */
    @Volatile
    var needed: Boolean = false

    /** Buffered ahead below this while streaming = downloads give way. */
    const val MIN_BUFFER_MS = 30_000L

    /** Pure decision, for tests: playing (or about to) from the network with little buffered, or loading. */
    fun shouldYield(playWhenReady: Boolean, hasItem: Boolean, localFile: Boolean, buffering: Boolean, bufferedAheadMs: Long): Boolean =
        playWhenReady && hasItem && !localFile && (buffering || bufferedAheadMs < MIN_BUFFER_MS)

    /** A download chunk's pause while playback needs the connection: ~64 KB/s for 8 KB chunks. */
    const val TRICKLE_DELAY_MS = 125L

    /** For blocking download paths (SABR): wait while playback needs the connection, at most [maxMs]. */
    fun blockWhileNeeded(maxMs: Long) {
        var waited = 0L
        while (needed && waited < maxMs) {
            try { Thread.sleep(250) } catch (_: InterruptedException) { return }
            waited += 250
        }
    }
}
