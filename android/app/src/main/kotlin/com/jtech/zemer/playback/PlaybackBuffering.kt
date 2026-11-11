package com.jtech.zemer.playback

/**
 * How far ahead the player loads. Stalow Music loads the whole current song (up to [MAX_BUFFER_MS]) as soon
 * as it starts, so playback survives a weak or dropping connection; [TARGET_BUFFER_BYTES] caps the memory used
 * (about 20+ minutes of music, less in video mode).
 */
object PlaybackBuffering {
    const val MIN_BUFFER_MS = 20 * 60 * 1000
    const val MAX_BUFFER_MS = 20 * 60 * 1000
    const val TARGET_BUFFER_BYTES = 32 * 1024 * 1024
}
