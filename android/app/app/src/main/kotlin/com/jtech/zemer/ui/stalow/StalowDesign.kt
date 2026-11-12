package com.jtech.zemer.ui.stalow

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jtech.zemer.R

/**
 * The Stalow Music design (design canvas "Stalow Music App Design": Main, Artist, Player, HomeLight,
 * SearchLight, Brand). Shared pieces used by Home, Artist, Now playing, Search and the mini player.
 *
 * The tokens follow the brand sheet: dark = background #0F1117, surface #161820, raised #1E2029,
 * border #2E3042, Stalow blue #4F7CFF, mint #3EF2E4; light = background #F4F5F7, surface #FFFFFF,
 * border #E3E5EC, navy #0D2B8E, Stalow blue #3A66F0, mint #06E0C4. Whether the dark or light set is
 * used follows the app's theme (by the background's lightness), not the system setting, so the
 * app's own dark/light/pure-black choice keeps working.
 */
@Immutable
data class StalowColors(
    val isDark: Boolean,
    val background: Color,
    val surface: Color,
    val raised: Color,
    val border: Color,
    val track: Color,
    val text: Color,
    val muted: Color,
    val blue: Color,
    val mint: Color,
    val onMint: Color,
    val navy: Color,
    val pill: Color,
    val miniPlayer: Color,
    val miniPlayerText: Color,
    val miniPlayerMuted: Color,
    val noteBackground: Color,
    val noteBorder: Color,
    val noteText: Color,
    val noteIcon: Color,
    val heroTop: Color,
)

private val DarkColors = StalowColors(
    isDark = true,
    background = Color(0xFF0F1117),
    surface = Color(0xFF161820),
    raised = Color(0xFF1E2029),
    border = Color(0xFF2E3042),
    track = Color(0xFF3D4058),
    text = Color(0xFFE8EAF0),
    muted = Color(0xFF9DA3B8),
    blue = Color(0xFF4F7CFF),
    mint = Color(0xFF3EF2E4),
    onMint = Color(0xFF062A2A),
    navy = Color(0xFF1B3A8F),
    pill = Color(0xFF1D2A52),
    miniPlayer = Color(0xFF1E2029),
    miniPlayerText = Color(0xFFE8EAF0),
    miniPlayerMuted = Color(0xFF9DA3B8),
    noteBackground = Color(0xFF0F2A2A),
    noteBorder = Color(0xFF1C4D48),
    noteText = Color(0xFFB8FFF8),
    noteIcon = Color(0xFF3EF2E4),
    heroTop = Color(0xFF1B3A8F),
)

private val LightColors = StalowColors(
    isDark = false,
    background = Color(0xFFF4F5F7),
    surface = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    border = Color(0xFFE3E5EC),
    track = Color(0xFFD5D9E6),
    text = Color(0xFF1A1D2E),
    muted = Color(0xFF4A5068),
    blue = Color(0xFF3A66F0),
    mint = Color(0xFF06E0C4),
    onMint = Color(0xFF0D2B8E),
    navy = Color(0xFF0D2B8E),
    pill = Color(0xFFE4EBFF),
    miniPlayer = Color(0xFF0D2B8E),
    miniPlayerText = Color(0xFFFFFFFF),
    miniPlayerMuted = Color(0xFFC9D4FF),
    noteBackground = Color(0xFFE9FBF7),
    noteBorder = Color(0xFFB6EFE3),
    noteText = Color(0xFF0B4D43),
    noteIcon = Color(0xFF007A69),
    heroTop = Color(0xFF3A66F0),
)

/** The design's colours for the app's current theme. */
val stalowColors: StalowColors
    @Composable
    @ReadOnlyComposable
    get() = if (MaterialTheme.colorScheme.background.luminance() < 0.5f) {
        // Pure-black mode keeps its black background; only the accents and borders come from the design.
        if (MaterialTheme.colorScheme.background == Color.Black) DarkColors.copy(background = Color.Black) else DarkColors
    } else {
        LightColors
    }

/** IBM Plex Mono is the design's face for times and counts; the platform monospace stands in for it. */
val StalowMono: FontFamily = FontFamily.Monospace

/** Logo + "Stalow Music", the Home header title (dark or light logo by theme). */
@Composable
fun StalowLogoTitle(modifier: Modifier = Modifier) {
    val c = stalowColors
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Image(
            painter = painterResource(if (c.isDark) R.drawable.stalow_logo_dark else R.drawable.stalow_logo_light),
            contentDescription = null,
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(9.dp)),
        )
        Text(
            text = stringResource(R.string.app_name),
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = if (c.isDark) c.text else c.navy,
            maxLines = 1,
        )
    }
}

/** The design's square, bordered 44 dp icon button (Settings on Home, back/close/more elsewhere). */
@Composable
fun StalowSquareButton(
    @DrawableRes icon: Int,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    translucent: Boolean = false,
) {
    val c = stalowColors
    Box(
        modifier = modifier
            .size(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (translucent) c.background.copy(alpha = 0.55f) else c.surface)
            .then(if (translucent) Modifier else Modifier.border(1.dp, c.border, RoundedCornerShape(12.dp)))
            .clickable(role = Role.Button, onClickLabel = contentDescription, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = contentDescription, tint = if (translucent) c.text else c.muted, modifier = Modifier.size(20.dp))
    }
}

/** Home's search field: tapping it opens search. */
@Composable
fun StalowSearchField(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = stalowColors
    val label = stringResource(R.string.stalow_search_hint)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(c.surface)
            .border(1.dp, c.border, RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(painterResource(R.drawable.search), contentDescription = null, tint = c.muted, modifier = Modifier.size(18.dp))
        Text(text = label, color = c.muted, fontSize = 15.sp, maxLines = 1)
    }
}

/** A section title ("Quick picks", "Artists for you", "Top songs") with an optional "See all". */
@Composable
fun StalowSectionTitle(title: String, modifier: Modifier = Modifier, onSeeAll: (() -> Unit)? = null) {
    val c = stalowColors
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.text, modifier = Modifier.weight(1f))
        if (onSeeAll != null) {
            Text(
                text = stringResource(R.string.stalow_see_all),
                fontSize = 13.sp,
                color = c.blue,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClick = onSeeAll)
                    .padding(horizontal = 6.dp, vertical = 8.dp),
            )
        }
    }
}

/** The small upper-case label over a group ("TOP RESULT", "PLAYING FROM", "APPROVED ARTIST"). */
@Composable
fun StalowOverline(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.08.sp * 12,
        color = color,
        modifier = modifier,
        maxLines = 1,
    )
}

/** "Only approved artists appear in results." (Search). */
@Composable
fun StalowApprovedNote(modifier: Modifier = Modifier) {
    val c = stalowColors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.noteBackground)
            .border(1.dp, c.noteBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(painterResource(R.drawable.stalow_shield_check), contentDescription = null, tint = c.noteIcon, modifier = Modifier.size(18.dp))
        Text(stringResource(R.string.stalow_only_approved), fontSize = 13.sp, color = c.noteText)
    }
}

/** A rounded outlined action button (Shuffle on the artist page; Up next / Lyrics / Download). */
@Composable
fun StalowOutlinedButton(
    text: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    contentDescription: String? = null,
    enabled: Boolean = true,
) {
    val c = stalowColors
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        color = c.surface,
        contentColor = c.text,
        border = BorderStroke(1.dp, c.border),
        modifier = modifier.height(48.dp),
    ) {
        Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp)) {
            if (icon != null) Icon(painterResource(icon), contentDescription = if (text == null) contentDescription else null, modifier = Modifier.size(if (text == null) 20.dp else 16.dp))
            if (icon != null && text != null) Box(Modifier.size(8.dp))
            if (text != null) Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** The filled Stalow-blue button (Play on the artist page). */
@Composable
fun StalowFilledButton(text: String, @DrawableRes icon: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = stalowColors
    Surface(onClick = onClick, shape = RoundedCornerShape(12.dp), color = c.blue, contentColor = Color.White, modifier = modifier.height(48.dp)) {
        Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(16.dp))
            Box(Modifier.size(8.dp))
            Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** The mint round play/pause button (mini player). */
@Composable
fun StalowMintPlayButton(isPlaying: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, size: Int = 44) {
    val c = stalowColors
    Box(
        modifier = modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(c.mint)
            .clickable(role = Role.Button, onClickLabel = stringResource(if (isPlaying) R.string.stalow_pause else R.string.play), onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(if (isPlaying) R.drawable.pause else R.drawable.play),
            contentDescription = stringResource(if (isPlaying) R.string.stalow_pause else R.string.play),
            tint = c.onMint,
            modifier = Modifier.size(20.dp),
        )
    }
}

/** Column helper used by previews/screenshot tests. */
@Composable
internal fun StalowScreenColumn(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.background(stalowColors.background)) { content() }
}

/** A round artist photo with the name under it ("Artists for you"). */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun StalowArtistCircle(
    name: String,
    thumbnailUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    size: Int = 76,
) {
    val c = stalowColors
    Column(
        modifier = modifier
            .width((size + 4).dp)
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StalowInitialImage(
            url = thumbnailUrl,
            label = name,
            shape = CircleShape,
            modifier = Modifier
                .size(size.dp)
                .border(2.dp, if (c.isDark) Color(0xFF252733) else Color.White, CircleShape),
            textSize = (size / 3).sp,
        )
        Text(
            text = name,
            fontSize = 12.sp,
            lineHeight = 15.sp,
            color = c.text,
            maxLines = 2,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

/** A picture, or the first letter of [label] on a Stalow tile when there is none or it fails to load. */
@Composable
fun StalowInitialImage(
    url: String?,
    label: String,
    shape: androidx.compose.ui.graphics.Shape,
    modifier: Modifier = Modifier,
    textSize: androidx.compose.ui.unit.TextUnit = 26.sp,
) {
    val c = stalowColors
    var failed by remember(url) { mutableStateOf(url.isNullOrBlank()) }
    Box(
        modifier = modifier
            .clip(shape)
            .background(if (c.isDark) Color(0xFF16336F) else Color(0xFFDBE4FF)),
        contentAlignment = Alignment.Center,
    ) {
        if (failed) {
            Text(
                text = label.trim().firstOrNull()?.uppercase() ?: "♪",
                fontSize = textSize,
                fontWeight = FontWeight.Bold,
                color = if (c.isDark) c.text else c.navy,
            )
        } else {
            coil3.compose.AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                onError = { failed = true },
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** Search's "Top result" card: round photo, name, a short line and a round Play button. */
@Composable
fun StalowTopResultCard(
    title: String,
    subtitle: String,
    thumbnailUrl: String?,
    onClick: () -> Unit,
    onPlay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = stalowColors
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        StalowOverline(stringResource(R.string.stalow_top_result), color = c.muted)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(c.surface)
                .border(1.dp, c.border, RoundedCornerShape(16.dp))
                .clickable(role = Role.Button, onClick = onClick)
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            StalowInitialImage(url = thumbnailUrl, label = title, shape = CircleShape, textSize = 24.sp, modifier = Modifier.size(64.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.text, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(subtitle, fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(c.blue)
                    .clickable(role = Role.Button, onClickLabel = stringResource(R.string.play), onClick = onPlay),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.play), contentDescription = stringResource(R.string.play), tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
    }
}
