package com.jtech.zemer.ui.player

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
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth(),
    ) {
        StalowOutlinedButton(
            text = stringResource(R.string.stalow_up_next),
            onClick = onUpNext,
            modifier = Modifier.weight(1f),
        )
        if (onLyrics != null) {
            StalowOutlinedButton(
                text = stringResource(R.string.stalow_lyrics),
                onClick = onLyrics,
                modifier = Modifier.weight(1f),
            )
        }
        if (mediaMetadata != null && !mediaMetadata.isEpisode) {
            StalowDownloadButton(mediaMetadata, Modifier.weight(1f))
        }
        sleepTimerContent()
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
    StalowOutlinedButton(
        text = label,
        enabled = status == DownloadStatus.NOT_DOWNLOADED,
        onClick = {
            val songIsVideo = !blockVideos &&
                (librarySong?.song?.isVideo == true || mediaMetadata.isVideo || currentItemIsVideo)
            coroutineScope.launch(Dispatchers.IO) {
                database.transaction { insert(mediaMetadata) }
                database.song(mediaMetadata.id).first()?.let {
                    if (songIsVideo) {
                        downloadUtil.downloadVideoToMediaStore(it, requestedQuality = playerConnection.downloadVideoQuality(it.id))
                    } else {
                        downloadUtil.downloadToMediaStore(it)
                    }
                }
            }
        },
        modifier = modifier,
    )
}
