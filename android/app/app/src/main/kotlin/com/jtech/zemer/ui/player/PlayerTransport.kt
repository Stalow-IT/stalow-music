package com.jtech.zemer.ui.player

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.C
import com.jtech.zemer.R
import com.jtech.zemer.constants.PlayerBackgroundStyle
import com.jtech.zemer.constants.PlayerHorizontalPadding
import com.jtech.zemer.constants.SliderStyle
import com.jtech.zemer.ui.component.PlayerSliderTrack
import com.jtech.zemer.ui.theme.PlayerSliderColors
import com.jtech.zemer.ui.component.focusVisualsEnabled
import com.jtech.zemer.utils.makeTimeString
import me.saket.squiggles.SquigglySlider

/*
 * The player's transport pieces, shared by the full player and the lyrics screen (one implementation,
 * two hosts): the seek bar in the user's slider style (+ LIVE bar for station broadcasts) with its time
 * labels, and the spring-grow transport cluster (wide labelled play/pause flanked by circular skips).
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerSeekBar(
    sliderStyle: SliderStyle,
    isStationBroadcast: Boolean,
    position: Long,
    duration: Long,
    sliderPosition: Long?,
    isPlaying: Boolean,
    accentColor: Color,
    textColor: Color,
    playerBackground: PlayerBackgroundStyle,
    useDarkTheme: Boolean,
    onSliderPositionChange: (Long?) -> Unit,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
    centerLabel: String? = null,
) {
    val value = (sliderPosition ?: position).toFloat()
    val valueRange = 0f..(if (duration == C.TIME_UNSET) 0f else duration.toFloat())
    // A TAP fires onValueChange and onValueChangeFinished inside one frame, before recomposition delivers the new
    // [sliderPosition] parameter — a closure over the parameter would seek to the stale (null) value and do nothing,
    // while a drag happened to work only because it recomposes along the way. Keep the latest value in state that
    // the finish callback reads directly, so tap-to-seek and drag-to-seek behave the same.
    val latest = remember { mutableStateOf<Long?>(null) }
    val onValueChange: (Float) -> Unit = { latest.value = it.toLong(); onSliderPositionChange(it.toLong()) }
    val onValueChangeFinished = { (latest.value ?: sliderPosition)?.let(onSeek); latest.value = null; onSliderPositionChange(null) }
    Column(modifier = modifier.fillMaxWidth()) {
        Box(modifier = Modifier.fillMaxWidth().padding(horizontal = PlayerHorizontalPadding - 8.dp)) {
            // A broadcast has no transport: the seek slider is replaced by the read-only LIVE bar.
            if (isStationBroadcast) StationLiveBar(position = position, duration = duration, accentColor = accentColor)
            else when (sliderStyle) {
                SliderStyle.DEFAULT -> Slider(
                    value = value, valueRange = valueRange, onValueChange = onValueChange, onValueChangeFinished = onValueChangeFinished,
                    colors = PlayerSliderColors.defaultSliderColors(accentColor, playerBackground, useDarkTheme),
                    modifier = Modifier.padding(horizontal = PlayerHorizontalPadding - 8.dp),
                )
                SliderStyle.SQUIGGLY -> SquigglySlider(
                    value = value, valueRange = valueRange, onValueChange = onValueChange, onValueChangeFinished = onValueChangeFinished,
                    colors = PlayerSliderColors.squigglySliderColors(accentColor, playerBackground, useDarkTheme),
                    modifier = Modifier.padding(horizontal = PlayerHorizontalPadding - 8.dp),
                    squigglesSpec = SquigglySlider.SquigglesSpec(amplitude = if (isPlaying) 2.dp else 0.dp, strokeWidth = 3.dp),
                )
                SliderStyle.SLIM -> Slider(
                    value = value, valueRange = valueRange, onValueChange = onValueChange, onValueChangeFinished = onValueChangeFinished,
                    thumb = { Spacer(modifier = Modifier.size(0.dp)) },
                    track = { sliderState -> PlayerSliderTrack(sliderState = sliderState, colors = PlayerSliderColors.slimSliderColors(accentColor, playerBackground, useDarkTheme)) },
                    modifier = Modifier.padding(horizontal = PlayerHorizontalPadding - 8.dp),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Row(
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = PlayerHorizontalPadding + 4.dp),
        ) {
            // Stalow design: times in a monospaced face (IBM Plex Mono in the design), muted.
            val timeStyle = MaterialTheme.typography.labelMedium.copy(fontFamily = com.jtech.zemer.ui.stalow.StalowMono)
            Text(text = makeTimeString(sliderPosition ?: position), style = timeStyle, color = textColor.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (centerLabel != null) {
                Text(text = centerLabel, style = timeStyle, color = textColor.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false).padding(horizontal = 8.dp))
            }
            Text(text = if (duration != C.TIME_UNSET) makeTimeString(duration) else "", style = timeStyle, color = textColor.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The transport row from the Stalow design: Shuffle, Previous, a big round Play/Pause, Next, Repeat.
 * Shuffle and Repeat appear when their state and actions are given (the full player); the lyrics
 * screen shows only Previous / Play / Next. Previous/Next keep long-press-to-seek.
 */
@Composable
fun PlayerTransportRow(
    isPlaying: Boolean,
    ended: Boolean,
    canSkipPrevious: Boolean,
    canSkipNext: Boolean,
    accentColor: Color,
    playButtonContainerColor: Color,
    playButtonContentColor: Color,
    sideButtonContainerColor: Color,
    sideButtonContentColor: Color,
    onPlayPause: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    isStationBroadcast: Boolean = false, // Zemer Station: play/stop only — skips are shown disabled and no-op (docs/stations)
    modifier: Modifier = Modifier,
    shuffleEnabled: Boolean? = null,
    repeatMode: Int? = null,
    onShuffle: (() -> Unit)? = null,
    onRepeat: (() -> Unit)? = null,
    toggleActiveColor: Color = accentColor,
    toggleIdleColor: Color = sideButtonContentColor.copy(alpha = 0.7f),
) {
    val skipPrevInteraction = remember { MutableInteractionSource() }
    val playPauseInteraction = remember { MutableInteractionSource() }
    val skipNextInteraction = remember { MutableInteractionSource() }
    val playPressed by playPauseInteraction.collectIsPressedAsState()
    val playSize by animateDpAsState(
        targetValue = if (playPressed) 80.dp else 76.dp,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 500f),
        label = "play_size",
    )
    val showToggles = shuffleEnabled != null && repeatMode != null && onShuffle != null && onRepeat != null
    Row(
        horizontalArrangement = if (showToggles) Arrangement.SpaceBetween else Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = PlayerHorizontalPadding + 4.dp),
    ) {
        if (showToggles) {
            TransportToggleButton(
                iconRes = R.drawable.shuffle,
                contentDescription = stringResource(R.string.shuffle),
                active = shuffleEnabled == true,
                enabled = !isStationBroadcast,
                activeColor = toggleActiveColor,
                idleColor = toggleIdleColor,
                accentColor = accentColor,
                onClick = onShuffle!!,
            )
        }
        TransportSkipButton(iconRes = R.drawable.skip_previous, contentDescription = null, enabled = canSkipPrevious && !isStationBroadcast, interactionSource = skipPrevInteraction, accentColor = accentColor, containerColor = sideButtonContainerColor, contentColor = sideButtonContentColor, onSkip = onPrevious)
        val playButtonFocused = remember { mutableStateOf(false) }
        val playButtonBorderColor = animateColorAsState(targetValue = if (playButtonFocused.value && focusVisualsEnabled()) accentColor else Color.Transparent, label = "play_button_focus")
        FilledIconButton(
            onClick = onPlayPause,
            interactionSource = playPauseInteraction,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = playButtonContainerColor, contentColor = playButtonContentColor),
            modifier = Modifier
                .size(playSize)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .border(3.dp, playButtonBorderColor.value, androidx.compose.foundation.shape.CircleShape)
                .focusable()
                .onFocusChanged { playButtonFocused.value = it.isFocused },
        ) {
            Icon(
                painter = painterResource(when { ended -> R.drawable.replay; isPlaying -> R.drawable.pause; else -> R.drawable.play }),
                contentDescription = stringResource(when { ended -> R.string.replay; isPlaying -> R.string.pause; else -> R.string.play }),
                modifier = Modifier.size(32.dp),
            )
        }
        TransportSkipButton(iconRes = R.drawable.skip_next, contentDescription = null, enabled = canSkipNext && !isStationBroadcast, interactionSource = skipNextInteraction, accentColor = accentColor, containerColor = sideButtonContainerColor, contentColor = sideButtonContentColor, onSkip = onNext)
        if (showToggles) {
            TransportToggleButton(
                iconRes = if (repeatMode == androidx.media3.common.Player.REPEAT_MODE_ONE) R.drawable.repeat_one else R.drawable.repeat,
                contentDescription = stringResource(
                    when (repeatMode) {
                        androidx.media3.common.Player.REPEAT_MODE_ONE -> R.string.repeat_mode_one
                        androidx.media3.common.Player.REPEAT_MODE_ALL -> R.string.repeat_mode_all
                        else -> R.string.repeat_mode_off
                    }
                ),
                active = repeatMode != androidx.media3.common.Player.REPEAT_MODE_OFF,
                enabled = !isStationBroadcast,
                activeColor = toggleActiveColor,
                idleColor = toggleIdleColor,
                accentColor = accentColor,
                onClick = onRepeat!!,
            )
        }
    }
}

/** Shuffle / Repeat in the transport row: a plain 44 dp icon, accent-coloured while on. */
@Composable
private fun TransportToggleButton(
    iconRes: Int,
    contentDescription: String,
    active: Boolean,
    enabled: Boolean,
    activeColor: Color,
    idleColor: Color,
    accentColor: Color,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val borderColor by animateColorAsState(targetValue = if (focused && focusVisualsEnabled()) accentColor else Color.Transparent, label = "toggle_focus")
    androidx.compose.material3.IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .size(44.dp)
            .border(2.dp, borderColor, androidx.compose.foundation.shape.CircleShape)
            .onFocusChanged { focused = it.isFocused },
    ) {
        Icon(
            painter = painterResource(iconRes),
            contentDescription = contentDescription,
            tint = if (active) activeColor else idleColor,
            modifier = Modifier.size(22.dp),
        )
    }
}

/**
 * A circular skip-previous / skip-next button for the transport cluster: the D-pad accent focus
 * border, a spring "pump" while pressed, and tap + long-press-to-seek (the long press repeats
 * [onSkip] every 200 ms until release). Both paths are gated by [enabled].
 */
@Composable
internal fun TransportSkipButton(
    iconRes: Int,
    contentDescription: String?,
    enabled: Boolean,
    interactionSource: MutableInteractionSource,
    accentColor: Color,
    containerColor: Color,
    contentColor: Color,
    onSkip: () -> Unit,
) {
    val coroutineScope = rememberCoroutineScope()
    var repeatJob by remember { mutableStateOf<Job?>(null) }
    var focused by remember { mutableStateOf(false) }
    val pressed by interactionSource.collectIsPressedAsState()
    // Stop the long-press seek the moment the finger lifts: combinedClickable has no release
    // callback, so without this the repeat loop would keep seeking until the next tap.
    LaunchedEffect(pressed) {
        if (!pressed) {
            repeatJob?.cancel()
            repeatJob = null
        }
    }
    val borderColor by animateColorAsState(
        targetValue = if (focused && focusVisualsEnabled()) accentColor else Color.Transparent,
        label = "skip_focus",
    )
    val size by animateDpAsState(
        targetValue = if (pressed) 58.dp else 56.dp,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 500f),
        label = "skip_size",
    )
    FilledTonalIconButton(
        // The button's own onClick is the live tap handler; the combinedClickable below adds
        // long-press-to-seek (its onClick mirrors this for the rare case it wins the gesture).
        onClick = {
            repeatJob?.cancel()
            onSkip()
        },
        enabled = enabled,
        interactionSource = interactionSource,
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = containerColor,
            contentColor = contentColor,
        ),
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(32.dp))
            .border(3.dp, borderColor, RoundedCornerShape(32.dp))
            .focusable()
            .onFocusChanged { focused = it.isFocused }
            .combinedClickable(
                enabled = enabled,
                interactionSource = interactionSource,
                indication = null,
                onClick = {
                    repeatJob?.cancel()
                    onSkip()
                },
                onLongClick = {
                    repeatJob = coroutineScope.launch {
                        while (isActive) {
                            onSkip()
                            delay(200)
                        }
                    }
                },
            ),
    ) {
        Icon(
            painter = painterResource(iconRes),
            contentDescription = contentDescription,
            modifier = Modifier.size(32.dp),
        )
    }
}
