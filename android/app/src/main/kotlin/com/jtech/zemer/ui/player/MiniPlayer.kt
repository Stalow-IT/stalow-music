@file:Suppress("unused")

package com.jtech.zemer.ui.player

import android.annotation.SuppressLint
import android.content.res.Configuration
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import coil3.compose.AsyncImage
import com.jtech.zemer.LocalDatabase
import com.jtech.zemer.LocalPlayerConnection
import com.jtech.zemer.R
import com.jtech.zemer.constants.MiniPlayerHeight
import com.jtech.zemer.constants.PlayerBackgroundStyle
import com.jtech.zemer.constants.PlayerBackgroundStyleKey
import com.jtech.zemer.constants.SwipeSensitivityKey
import com.jtech.zemer.db.entities.ArtistEntity
import com.jtech.zemer.extensions.togglePlayPause
import com.jtech.zemer.models.MediaMetadata
import com.jtech.zemer.utils.rememberEnumPreference
import com.jtech.zemer.utils.rememberPreference
import androidx.compose.ui.graphics.toArgb
import kotlinx.coroutines.launch
import com.jtech.zemer.ui.component.focusBorder
import com.jtech.zemer.ui.component.gentleMarquee
import kotlin.math.absoluteValue
import kotlin.math.roundToInt
import androidx.compose.ui.res.stringResource
import androidx.compose.runtime.LaunchedEffect

data class MiniPlayerFocusTargets(
    val play: FocusRequester,
    val account: FocusRequester,
    val heart: FocusRequester,
    val afterHeart: FocusRequester?,
    val down: FocusRequester?
)

@SuppressLint("ConfigurationScreenWidthHeight")
@Composable
fun MiniPlayer(
    position: () -> Long,
    duration: () -> Long,
    modifier: Modifier = Modifier,
    pureBlack: Boolean,
    allowFocus: Boolean = true,
    focusTargets: MiniPlayerFocusTargets? = null,
) {
    NewMiniPlayer(
        position = position,
        duration = duration,
        modifier = modifier,
        pureBlack = pureBlack,
        allowFocus = allowFocus,
        focusTargets = focusTargets
    )
}

@SuppressLint("ConfigurationScreenWidthHeight")
@Composable
private fun NewMiniPlayer(
    position: () -> Long,
    duration: () -> Long,
    modifier: Modifier = Modifier,
    pureBlack: Boolean,
    allowFocus: Boolean,
    focusTargets: MiniPlayerFocusTargets? = null,
) {
    val playerConnection = LocalPlayerConnection.current ?: return
    val database = LocalDatabase.current
    val context = LocalContext.current
    val isPlaying by playerConnection.isPlaying.collectAsState()
    val playbackState by playerConnection.playbackState.collectAsState()
    val error by playerConnection.error.collectAsState()
    val isStationBroadcast by playerConnection.isStationBroadcast.collectAsState()
    val mediaMetadata by playerConnection.mediaMetadata.collectAsState()
    val canSkipNext by playerConnection.canSkipNext.collectAsState()
    val canSkipPrevious by playerConnection.canSkipPrevious.collectAsState()

    LocalView.current
    val layoutDirection = LocalLayoutDirection.current
    val coroutineScope = rememberCoroutineScope()
    val swipeSensitivity by rememberPreference(SwipeSensitivityKey, 0.73f)
    val swipeThumbnail by rememberPreference(com.jtech.zemer.constants.SwipeThumbnailKey, true)

    val configuration = LocalConfiguration.current
    val isTabletLandscape = configuration.screenWidthDp >= 600 &&
        configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    val offsetXAnimatable = remember { Animatable(0f) }
    var dragStartTime by remember { mutableLongStateOf(0L) }
    var totalDragDistance by remember { mutableFloatStateOf(0f) }

    val animationSpec = spring<Float>(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessLow
    )

    val overlayAlpha by animateFloatAsState(
        targetValue = if (isPlaying) 0.0f else 0.4f,
        label = "overlay_alpha",
        animationSpec = animationSpec
    )
    val playRequester = focusTargets?.play ?: remember { FocusRequester() }
    val accountRequester = focusTargets?.account ?: remember { FocusRequester() }
    val heartRequester = focusTargets?.heart ?: remember { FocusRequester() }
    val afterHeartRequester = focusTargets?.afterHeart
    val downRequester = focusTargets?.down

    /**
     * Calculates the auto-swipe threshold based on swipe sensitivity.
     * The formula uses a sigmoid function to determine the threshold dynamically.
     * Constants:
     * - -11.44748: Controls the steepness of the sigmoid curve.
     * - 9.04945: Adjusts the midpoint of the curve.
     * - 600: Base threshold value in pixels.
     *
     * @param swipeSensitivity The sensitivity value (typically between 0 and 1).
     * @return The calculated auto-swipe threshold in pixels.
     */
    fun calculateAutoSwipeThreshold(swipeSensitivity: Float): Int {
        return (600 / (1f + kotlin.math.exp(-(-11.44748 * swipeSensitivity + 9.04945)))).roundToInt()
    }
    val autoSwipeThreshold = calculateAutoSwipeThreshold(swipeSensitivity)

    // Mirror the full player's background style so the mini player matches it (no new setting).
    val playerBackground by rememberEnumPreference(
        key = PlayerBackgroundStyleKey,
        defaultValue = PlayerBackgroundStyle.DEFAULT
    )
    // Effective style: BLUR downgrades to DEFAULT below Android 12 (the RenderEffect blur is a
    // no-op there). Single source of truth shared with the full player (see effective()).
    val effectiveBackground = playerBackground.effective()

    val fallbackColor = MaterialTheme.colorScheme.surface.toArgb()
    // Shared, bounded, deduped gradient extraction (see rememberPlayerGradient): the mini player
    // and the full player share one cache so the same artwork is never decoded twice.
    val gradientColors = rememberPlayerGradient(
        mediaId = mediaMetadata?.id,
        thumbnailUrl = mediaMetadata?.thumbnailUrl,
        enabled = effectiveBackground == PlayerBackgroundStyle.GRADIENT,
        fallbackColor = fallbackColor,
    )

    // A dark backdrop is only actually painted once it is ready: a blurred thumbnail needs a
    // thumbnailUrl, an extracted gradient needs non-empty colors. Until then the box stays on the
    // solid surface, so keep DARK text — flipping to white before the backdrop exists would put
    // white text over the (light) Home screen showing through the transparent bar.
    val blurReady = effectiveBackground == PlayerBackgroundStyle.BLUR &&
        mediaMetadata?.thumbnailUrl != null
    val gradientReady = effectiveBackground == PlayerBackgroundStyle.GRADIENT &&
        gradientColors.isNotEmpty()
    val lightContent = blurReady || gradientReady
    val titleColor = if (lightContent) Color.White else MaterialTheme.colorScheme.onSurface
    val subtitleColor =
        if (lightContent) Color.White.copy(alpha = 0.7f)
        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(MiniPlayerHeight)
            .windowInsetsPadding(WindowInsets.systemBars.only(WindowInsetsSides.Horizontal))
            .padding(horizontal = 12.dp)
            // Move the swipe detection to the outer box to affect the entire box
            .let { baseModifier ->
                if (swipeThumbnail) {
                    baseModifier.pointerInput(Unit) {
                        detectHorizontalDragGestures(
                            onDragStart = {
                                dragStartTime = System.currentTimeMillis()
                                totalDragDistance = 0f
                            },
                            onDragCancel = {
                                coroutineScope.launch {
                                    offsetXAnimatable.animateTo(
                                        targetValue = 0f,
                                        animationSpec = animationSpec
                                    )
                                }
                            },
                            onHorizontalDrag = { _, dragAmount ->
                                val adjustedDragAmount =
                                    if (layoutDirection == LayoutDirection.Rtl) -dragAmount else dragAmount
                                // A broadcast has no transport: the swipe gesture acts on the raw
                                // player and would bypass the session command mask.
                                val canSkipPrevious = !isStationBroadcast && playerConnection.player.previousMediaItemIndex != -1
                                val canSkipNext = !isStationBroadcast && playerConnection.player.nextMediaItemIndex != -1
                                val allowLeft = adjustedDragAmount < 0 && canSkipNext
                                val allowRight = adjustedDragAmount > 0 && canSkipPrevious
                                if (allowLeft || allowRight) {
                                    totalDragDistance += kotlin.math.abs(adjustedDragAmount)
                                    coroutineScope.launch {
                                        offsetXAnimatable.snapTo(offsetXAnimatable.value + adjustedDragAmount)
                                    }
                                }
                            },
                            onDragEnd = {
                                val dragDuration = System.currentTimeMillis() - dragStartTime
                                val velocity = if (dragDuration > 0) totalDragDistance / dragDuration else 0f
                                val currentOffset = offsetXAnimatable.value

                                val minDistanceThreshold = 50f
                                val velocityThreshold = (swipeSensitivity * -8.25f) + 8.5f

                                val shouldChangeSong = (
                                    kotlin.math.abs(currentOffset) > minDistanceThreshold &&
                                    velocity > velocityThreshold
                                ) || (kotlin.math.abs(currentOffset) > autoSwipeThreshold)

                                if (shouldChangeSong) {
                                    val isRightSwipe = currentOffset > 0

                                    if (isRightSwipe && canSkipPrevious) {
                                        playerConnection.player.seekToPreviousMediaItem()
                                    } else if (!isRightSwipe && canSkipNext) {
                                        playerConnection.player.seekToNext()
                                    }
                                }

                                coroutineScope.launch {
                                    offsetXAnimatable.animateTo(
                                        targetValue = 0f,
                                        animationSpec = animationSpec
                                    )
                                }
                            }
                        )
                    }
                } else {
                    baseModifier
                }
            }
    ) {
        // Stalow design: a floating rounded card - artwork, title and artist, and a mint play/pause button.
        // A thin mint line along the bottom shows how far the song has played.
        val stalow = com.jtech.zemer.ui.stalow.stalowColors
        val cardTitle = if (lightContent) Color.White else stalow.miniPlayerText
        val cardSubtitle = if (lightContent) Color.White.copy(alpha = 0.75f) else stalow.miniPlayerMuted
        Box(
            modifier = Modifier
                .then(
                    if (isTabletLandscape) {
                        Modifier
                            .width(500.dp)
                            .align(Alignment.CenterEnd)
                    } else {
                        Modifier.fillMaxWidth()
                    }
                )
                .height(64.dp)
                .offset { IntOffset(offsetXAnimatable.value.roundToInt(), 0) }
                .clip(RoundedCornerShape(14.dp))
                .background(if (lightContent) Color.Transparent else stalow.miniPlayer)
                .then(
                    if (stalow.isDark && !lightContent) {
                        Modifier.border(1.dp, stalow.border, RoundedCornerShape(14.dp))
                    } else {
                        Modifier
                    }
                )
                .drawWithContent {
                    drawContent()
                    val d = duration()
                    if (d > 0) {
                        val fraction = (position().toFloat() / d).coerceIn(0f, 1f)
                        val h = 2.dp.toPx()
                        drawRect(
                            color = stalow.mint,
                            topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - h),
                            size = androidx.compose.ui.geometry.Size(size.width * fraction, h),
                        )
                    }
                }
        ) {
            // Background layer (behind the Row): blurred artwork or extracted gradient.
            when (effectiveBackground) {
                PlayerBackgroundStyle.BLUR -> {
                    mediaMetadata?.thumbnailUrl?.let { thumbnailUrl ->
                        AsyncImage(
                            model = thumbnailUrl,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxSize()
                                .blur(60.dp)
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.Black.copy(alpha = 0.4f))
                        )
                    }
                }
                PlayerBackgroundStyle.GRADIENT -> {
                    if (gradientColors.isNotEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Brush.horizontalGradient(colorStops = playerGradientStops(gradientColors)))
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(Color.Black.copy(alpha = 0.2f))
                        )
                    }
                }
                else -> {
                    // DEFAULT: the design's solid card colour, applied above.
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp, vertical = 10.dp),
            ) {
                // Artwork
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(stalow.navy)
                        .focusRequester(accountRequester)
                        .then(
                            if (focusTargets != null) {
                                Modifier.focusProperties {
                                    previous = playRequester
                                    next = heartRequester
                                    down = downRequester ?: FocusRequester.Default
                                }
                            } else Modifier
                        )
                        .focusable(),
                    contentAlignment = Alignment.Center,
                ) {
                    mediaMetadata?.let { metadata ->
                        Text(
                            text = metadata.title.trim().firstOrNull()?.uppercase() ?: "",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                        )
                        AsyncImage(
                            model = metadata.thumbnailUrl,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }

                Spacer(modifier = Modifier.width(12.dp))

                // Song info
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(heartRequester)
                        .then(
                            if (focusTargets != null) {
                                Modifier.focusProperties {
                                    previous = accountRequester
                                    afterHeartRequester?.let { next = it }
                                    down = downRequester ?: FocusRequester.Default
                                }
                            } else Modifier
                        )
                        .focusable(),
                    verticalArrangement = Arrangement.Center
                ) {
                    mediaMetadata?.let { metadata ->
                        AnimatedContent(
                            targetState = metadata.title,
                            transitionSpec = { fadeIn() togetherWith fadeOut() },
                            label = "",
                        ) { title ->
                            Text(
                                text = title,
                                color = cardTitle,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.gentleMarquee(),
                            )
                        }

                        if (metadata.artists.any { it.name.isNotBlank() }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                // A broadcast identifies itself on the mini bar too (handoff par. 5).
                                if (isStationBroadcast) {
                                    StationLiveBadge(
                                        accentColor = stalow.mint,
                                        modifier = Modifier.padding(end = 6.dp),
                                    )
                                }
                                AnimatedContent(
                                    targetState = metadata.artists.joinToString { it.name },
                                    transitionSpec = { fadeIn() togetherWith fadeOut() },
                                    label = "",
                                ) { artists ->
                                    Text(
                                        text = artists,
                                        color = cardSubtitle,
                                        fontSize = 12.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.gentleMarquee(),
                                    )
                                }
                            }
                        }

                        // Error indicator
                        androidx.compose.animation.AnimatedVisibility(
                            visible = error != null,
                            enter = fadeIn(),
                            exit = fadeOut(),
                        ) {
                            Text(
                                text = stringResource(R.string.error_playing),
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }

                rememberCastButtonState()?.let { castState ->
                    Spacer(modifier = Modifier.width(8.dp))
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .focusBorder(CircleShape)
                            .clickable(onClick = castState.onClick)
                    ) {
                        CastIcon(
                            connected = castState.connected,
                            idleTint = cardSubtitle,
                            size = 20.dp,
                        )
                    }
                }

                Spacer(modifier = Modifier.width(10.dp))

                // Mint play / pause (replay once the queue has ended)
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(stalow.mint)
                        .focusRequester(playRequester)
                        .then(
                            if (focusTargets != null) {
                                Modifier.focusProperties {
                                    next = accountRequester
                                    down = downRequester ?: FocusRequester.Default
                                }
                            } else Modifier
                        )
                        .focusBorder(CircleShape)
                        .clickable {
                            playerConnection.playPauseOrReplay(playbackState == Player.STATE_ENDED)
                        }
                ) {
                    Icon(
                        painter = painterResource(
                            when {
                                playbackState == Player.STATE_ENDED -> R.drawable.replay
                                isPlaying -> R.drawable.pause
                                else -> R.drawable.play
                            }
                        ),
                        contentDescription = stringResource(if (isPlaying) R.string.stalow_pause else R.string.play),
                        tint = stalow.onMint,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}
