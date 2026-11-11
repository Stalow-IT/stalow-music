package com.jtech.zemer.ui.stalow

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jtech.zemer.R

/**
 * The artist page header from the design: a Stalow-blue gradient, the round photo, "Approved artist",
 * the name, then Play / Shuffle / Radio (and Subscribe). The screen's own transparent top bar sits over
 * the gradient and provides Back and the share link.
 *
 * A null action hides its button (no songs yet, a podcast channel without radio).
 */
@Composable
fun StalowArtistHeader(
    name: String,
    thumbnailUrl: String?,
    isSubscribed: Boolean,
    onSubscribe: () -> Unit,
    onPlay: (() -> Unit)?,
    onShuffle: (() -> Unit)?,
    onRadio: (() -> Unit)?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    showApproved: Boolean = true,
    playModifier: Modifier = Modifier,
) {
    val c = stalowColors
    Column(modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(c.heroTop, c.background)))
                .statusBarsPadding()
                .padding(top = 64.dp, start = 20.dp, end = 20.dp, bottom = 20.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                StalowInitialImage(
                    url = thumbnailUrl,
                    label = name,
                    shape = CircleShape,
                    textSize = 44.sp,
                    modifier = Modifier
                        .size(112.dp)
                        .border(3.dp, c.background, CircleShape),
                )
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(bottom = 6.dp),
                ) {
                    if (showApproved) {
                        StalowOverline(stringResource(R.string.stalow_approved_artist), color = if (c.isDark) c.mint else c.navy)
                    }
                    Text(
                        text = name,
                        fontSize = 28.sp,
                        lineHeight = 31.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (c.isDark) c.text else c.text,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!subtitle.isNullOrBlank()) {
                        Text(subtitle, fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 16.dp),
        ) {
            if (onPlay != null) {
                StalowFilledButton(
                    text = stringResource(R.string.play),
                    icon = R.drawable.play,
                    onClick = onPlay,
                    modifier = playModifier.weight(1f),
                )
            }
            if (onShuffle != null) {
                StalowOutlinedButton(
                    text = stringResource(R.string.shuffle),
                    icon = R.drawable.shuffle,
                    onClick = onShuffle,
                    modifier = Modifier.weight(1f),
                )
            }
            if (onRadio != null) {
                StalowOutlinedButton(
                    text = null,
                    icon = R.drawable.radio,
                    contentDescription = stringResource(R.string.radio),
                    onClick = onRadio,
                    modifier = Modifier.width(48.dp),
                )
            }
            StalowOutlinedButton(
                text = null,
                icon = if (isSubscribed) R.drawable.subscribed else R.drawable.subscribe,
                contentDescription = stringResource(if (isSubscribed) R.string.subscribed else R.string.subscribe),
                onClick = onSubscribe,
                // with no Play button, the focus target (TV / keyboard) moves here
                modifier = (if (onPlay == null) playModifier else Modifier).width(48.dp),
            )
            if (onPlay == null && onShuffle == null) Spacer(Modifier.weight(1f))
        }
        Spacer(Modifier.height(4.dp))
    }
}
