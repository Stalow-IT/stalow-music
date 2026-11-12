package com.jtech.zemer.ui.player

import androidx.compose.ui.unit.sp

import androidx.compose.ui.res.painterResource

import androidx.compose.foundation.layout.padding

import androidx.compose.foundation.layout.size

import androidx.compose.foundation.layout.height

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.jtech.zemer.LocalDatabase
import com.jtech.zemer.LocalDownloadUtil
import com.jtech.zemer.LocalPlayerConnection
import com.jtech.zemer.R
import com.jtech.zemer.constants.BlockVideosKey
import com.jtech.zemer.models.MediaMetadata
import com.jtech.zemer.playback.DownloadStateResolver
import com.jtech.zemer.playback.DownloadStatus
import com.jtech.zemer.ui.stalow.StalowOutlinedButton
import com.jtech.zemer.utils.rememberPreference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The bottom row of the Now playing screen (Stalow design): Up next, Lyrics, Download, plus the sleep
 * timer. Shuffle and Repeat moved up next to Play; "more options" is in the header.
 */
@Composable
fun StalowPlayerActionRow(
    mediaMetadata: MediaMetadata?,
    onUpNext: () -> Unit,
    onLyrics: (() -> Unit)?,
    sleepTimerContent: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Equal tiles, each an icon with a short label under it, so every label fits on a phone.
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth(),
    ) {
        StalowActionTile(R.drawable.queue_music, stringResource(R.string.stalow_up_next), onUpNext, Modifier.weight(1f))
        if (onLyrics != null) {
            StalowActionTile(R.drawable.lyrics, stringResource(R.string.stalow_lyrics), onLyrics, Modifier.weight(1f))
        }
        if (mediaMetadata != null && !mediaMetadata.isEpisode) {
            StalowDownloadButton(mediaMetadata, Modifier.weight(1f))
        }
        androidx.compose.foundation.layout.Box(Modifier.weight(1f)) { sleepTimerContent() }
    }
}

/** One tile of the bottom row: an icon with a short label under it. */
@Composable
fun StalowActionTile(
    icon: Int,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: (@Composable () -> Unit)? = null,
) {
    val c = com.jtech.zemer.ui.stalow.stalowColors
    androidx.compose.material3.Surface(
        onClick = onClick,
        enabled = enabled,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = c.surface,
        contentColor = c.text,
        border = androidx.compose.foundation.BorderStroke(1.dp, c.border),
        modifier = modifier.height(60.dp),
    ) {
        androidx.compose.foundation.layout.Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 3.dp),
        ) {
            if (content != null) content() else androidx.compose.material3.Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(22.dp))
            androidx.compose.foundation.layout.Spacer(Modifier.height(4.dp))
            // The label shrinks (down to 9sp) to fit the tile on a narrow phone, so it is never cut off.
            androidx.compose.foundation.text.BasicText(
                text = label,
                style = androidx.compose.ui.text.TextStyle(
                    color = c.text,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                ),
                maxLines = 1,
                autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = 9.sp, maxFontSize = 13.sp, stepSize = 0.5.sp),
            )
        }
    }
}

/**
 * Download for the song that is playing: "Download", then the progress while it downloads, then
 * "Downloaded". Same rules as the player menu's download row (a video-capable item downloads its
 * video unless videos are blocked). Removing a download stays in the player menu.
 */
@Composable
private fun StalowDownloadButton(mediaMetadata: MediaMetadata, modifier: Modifier = Modifier) {
    val database = LocalDatabase.current
    val downloadUtil = LocalDownloadUtil.current
    val playerConnection = LocalPlayerConnection.current ?: return
    val coroutineScope = rememberCoroutineScope()
    val (blockVideos, _) = rememberPreference(BlockVideosKey, false)
    val live by downloadUtil.getMediaStoreDownload(mediaMetadata.id).collectAsState(initial = null)
    val librarySong by database.song(mediaMetadata.id).collectAsState(initial = null)
    val currentItemIsVideo by playerConnection.currentItemIsVideo.collectAsState()
    val isDownloaded = librarySong?.song?.isDownloaded == true
    val status = DownloadStateResolver.forSong(isDownloaded, live)
    val progress = DownloadStateResolver.songProgress(isDownloaded, live)
    val label = when (status) {
        DownloadStatus.DOWNLOADED -> stringResource(R.string.stalow_downloaded)
        DownloadStatus.DOWNLOADING -> "${(progress * 100).roundToInt()}%"
        DownloadStatus.NOT_DOWNLOADED -> stringResource(R.string.action_download)
    }
    StalowActionTile(
        icon = if (status == DownloadStatus.DOWNLOADED) R.drawable.offline else R.drawable.download,
        label = label,
        enabled = status == DownloadStatus.NOT_DOWNLOADED,
        onClick = {
            // Stalow: downloads are always the sound (videos and podcasts too).
            coroutineScope.launch(Dispatchers.IO) {
                database.transaction { insert(mediaMetadata) }
                database.song(mediaMetadata.id).first()?.let {
                    downloadUtil.downloadToMediaStore(it)
                }
            }
        },
        modifier = modifier,
    )
}
