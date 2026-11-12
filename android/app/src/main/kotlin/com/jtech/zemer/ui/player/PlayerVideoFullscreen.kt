package com.jtech.zemer.ui.player

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.Player.STATE_ENDED
import com.jtech.zemer.LocalPlayerConnection
import com.jtech.zemer.R
import com.jtech.zemer.ui.component.focusBorder
import com.jtech.zemer.ui.menu.VideoQualityMenu
import com.jtech.zemer.utils.makeTimeString
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The fullscreen video experience — an in-player overlay, NOT a nav route (I6: the video runs on the
 * shared MusicService/ExoPlayer). It re-parents the one [PlayerVideoSurface] to a window-filling black
 * layer, hides the system bars, and locks to sensor-landscape while shown (all restored on dispose).
 *
 * Playback is driven entirely through [com.jtech.zemer.playback.PlayerConnection] (same transport as
 * the expanded player). Back / the exit button return to the expanded player still in video mode; a
 * track advance (D4) flips `isVideoMode` false → the caller's `shouldExitFullscreen` closes this and
 * the queue advances as audio. Every control is focusable + focus-bordered for D-pad.
 */
@Composable
fun PlayerVideoFullscreen(onExit: () -> Unit) {
    val playerConnection = LocalPlayerConnection.current ?: return
    val isPlaying by playerConnection.isPlaying.collectAsState()
    val playbackState by playerConnection.playbackState.collectAsState()
    val canSkipPrevious by playerConnection.canSkipPrevious.collectAsState()
    val canSkipNext by playerConnection.canSkipNext.collectAsState()
    val videoQualities by playerConnection.videoQualities.collectAsState()
    val currentVideoQuality by playerConnection.currentVideoQuality.collectAsState()

    var position by remember { mutableLongStateOf(playerConnection.currentPositionMs()) }
    var duration by remember { mutableLongStateOf(playerConnection.currentDurationMs()) }
    var sliderPosition by remember { mutableStateOf<Long?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    // The quality picker is a fullscreen-LOCAL panel (not the root bottom-sheet menu, which is a
    // portrait sheet that fights this immersive landscape window). Back closes it before exiting.
    var showQualityPanel by remember { mutableStateOf(false) }

    BackHandler(enabled = showQualityPanel) { showQualityPanel = false }
    BackHandler(enabled = !showQualityPanel, onBack = onExit)

    // Immersive: hide the system bars and lock landscape while fullscreen; restore both on exit.
    val view = LocalView.current
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowInsetsControllerCompat(it, view) }
        controller?.let {
            it.hide(WindowInsetsCompat.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val activity = context as? Activity
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            position = playerConnection.currentPositionMs()
            duration = playerConnection.currentDurationMs()
            delay(500)
        }
    }

    // Auto-hide the scrim controls while playing; a tap on the surface toggles them back.
    LaunchedEffect(controlsVisible, isPlaying) {
        if (controlsVisible && isPlaying) {
            delay(3500)
            controlsVisible = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Fullscreen video backdrop: the theme's scrim token, never a literal.
            .background(MaterialTheme.colorScheme.scrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { controlsVisible = !controlsVisible },
        contentAlignment = Alignment.Center,
    ) {
        PlayerVideoSurface(
            // Fill the screen; PlayerVideoSurface fits the video to its real aspect within (16:9 for
            // DIRECT, so this is visually unchanged there).
            modifier = Modifier.fillMaxSize(),
        )

        AnimatedVisibility(
            visible = controlsVisible,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.35f))
                    .systemBarsPadding(),
            ) {
                // Stalow: only the controls, in one bar at the bottom - the seek bar, then exit full screen,
                // previous / play / next, the quality, and the Audio only switch.
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Slider(
                        value = (sliderPosition ?: position).toFloat(),
                        valueRange = 0f..(if (duration == C.TIME_UNSET) 0f else duration.toFloat()),
                        onValueChange = { sliderPosition = it.toLong() },
                        onValueChangeFinished = {
                            sliderPosition?.let {
                                playerConnection.seekTo(it)
                                position = it
                            }
                            sliderPosition = null
                        },
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = onExit, modifier = Modifier.focusBorder(CircleShape)) {
                            Icon(
                                painter = painterResource(R.drawable.close),
                                contentDescription = stringResource(R.string.exit_fullscreen),
                                tint = Color.White,
                            )
                        }
                        Text(
                            text = makeTimeString(sliderPosition ?: position) +
                                (if (duration != C.TIME_UNSET) " / " + makeTimeString(duration) else ""),
                            style = MaterialTheme.typography.labelMedium,
                            color = Color.White,
                        )
                        Spacer(Modifier.weight(1f))
                        IconButton(
                            onClick = playerConnection::seekToPrevious,
                            enabled = canSkipPrevious,
                            modifier = Modifier.focusBorder(CircleShape),
                        ) {
                            Icon(painterResource(R.drawable.skip_previous), null, tint = Color.White, modifier = Modifier.size(32.dp))
                        }
                        IconButton(
                            onClick = { playerConnection.playPauseOrReplay(playbackState == STATE_ENDED) },
                            modifier = Modifier.size(56.dp).focusBorder(CircleShape),
                        ) {
                            Icon(
                                painter = painterResource(
                                    when {
                                        playbackState == STATE_ENDED -> R.drawable.replay
                                        isPlaying -> R.drawable.pause
                                        else -> R.drawable.play
                                    }
                                ),
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(40.dp),
                            )
                        }
                        IconButton(
                            onClick = playerConnection::seekToNext,
                            enabled = canSkipNext,
                            modifier = Modifier.focusBorder(CircleShape),
                        ) {
                            Icon(painterResource(R.drawable.skip_next), null, tint = Color.White, modifier = Modifier.size(32.dp))
                        }
                        Spacer(Modifier.weight(1f))
                        // The only place that saves the video file: a small arrow. Download elsewhere saves the sound.
                        VideoDownloadArrow()
                        VideoQualitySelector(
                            qualities = videoQualities,
                            currentQuality = currentVideoQuality,
                            onSelect = playerConnection::setVideoQuality,
                            onOpen = { showQualityPanel = true },
                        )
                        Spacer(Modifier.size(8.dp))
                        Text(
                            text = stringResource(R.string.stalow_audio_only),
                            style = MaterialTheme.typography.labelLarge,
                            color = Color.White,
                        )
                        Spacer(Modifier.size(8.dp))
                        // Audio only: leaves video (and full screen) now, and the next videos and podcasts play as audio.
                        Switch(
                            checked = false,
                            onCheckedChange = { audioOnly -> if (audioOnly) playerConnection.chooseVideo(false) },
                            modifier = Modifier.focusBorder(CircleShape),
                        )
                    }
                }
            }
        }

        // The fullscreen-LOCAL quality panel: a dim scrim + a centered, height-bounded, scrollable
        // card (the shared VideoQualityMenu body — same Auto/rung choice cards as the inline sheet).
        // Drawn last so it sits above the controls, and inside THIS overlay so it inherits the
        // landscape/immersive window (the root bottom sheet did not — that was the bug). Tapping the
        // scrim dismisses; a choice applies + dismisses.
        AnimatedVisibility(
            visible = showQualityPanel,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.6f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { showQualityPanel = false }
                    .systemBarsPadding(),
                contentAlignment = Alignment.Center,
            ) {
                Surface(
                    shape = RoundedCornerShape(28.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    tonalElevation = 3.dp,
                    modifier = Modifier
                        .widthIn(max = 420.dp)
                        .heightIn(max = 360.dp)
                        // Swallow taps so a tap inside the card never dismisses via the scrim.
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) {},
                ) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        VideoQualityMenu(
                            qualities = videoQualities,
                            currentQuality = currentVideoQuality,
                            onSelect = playerConnection::setVideoQuality,
                            onDismiss = { showQualityPanel = false },
                        )
                    }
                }
            }
        }
    }
}

/**
 * Downloads the playing video as a video file (with its sound). Shows a ring while it downloads and a tick
 * once the video is saved. Everywhere else in the app, Download saves the sound only.
 */
@Composable
private fun VideoDownloadArrow() {
    val playerConnection = LocalPlayerConnection.current ?: return
    val database = com.jtech.zemer.LocalDatabase.current
    val downloadUtil = com.jtech.zemer.LocalDownloadUtil.current
    val metadata by playerConnection.mediaMetadata.collectAsState()
    val id = metadata?.id ?: return
    val song by database.song(id).collectAsState(initial = null)
    val live by downloadUtil.getMediaStoreDownload(id).collectAsState(initial = null)
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val savedVideo = song?.song?.isDownloaded == true && song?.song?.isVideo == true
    val downloading = live?.status == com.jtech.zemer.playback.MediaStoreDownloadManager.DownloadState.Status.DOWNLOADING ||
        live?.status == com.jtech.zemer.playback.MediaStoreDownloadManager.DownloadState.Status.QUEUED
    IconButton(
        enabled = !savedVideo && !downloading,
        onClick = {
            val meta = metadata ?: return@IconButton
            scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                database.transaction { insert(meta) }
                database.song(meta.id).first()?.let { downloadUtil.downloadVideoFile(it, playerConnection.downloadVideoQuality(it.id)) }
            }
        },
        modifier = Modifier.focusBorder(CircleShape),
    ) {
        when {
            downloading -> androidx.compose.material3.CircularProgressIndicator(
                progress = { live?.progress ?: 0f },
                color = Color.White,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
            else -> Icon(
                painter = painterResource(if (savedVideo) R.drawable.check else R.drawable.download),
                contentDescription = stringResource(if (savedVideo) R.string.stalow_video_downloaded else R.string.stalow_download_video),
                tint = Color.White,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}
