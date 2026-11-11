package com.jtech.zemer.stalow

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jtech.zemer.R
import com.jtech.zemer.constants.PlayerBackgroundStyle
import com.jtech.zemer.constants.SliderStyle
import com.jtech.zemer.ui.component.ChipsRow
import com.jtech.zemer.ui.player.PlayerSeekBar
import com.jtech.zemer.ui.player.PlayerTransportRow
import com.jtech.zemer.ui.player.StalowPlayerActionRow
import com.jtech.zemer.ui.stalow.StalowApprovedNote
import com.jtech.zemer.ui.stalow.StalowArtistCircle
import com.jtech.zemer.ui.stalow.StalowArtistHeader
import com.jtech.zemer.ui.stalow.StalowInitialImage
import com.jtech.zemer.ui.stalow.StalowLogoTitle
import com.jtech.zemer.ui.stalow.StalowMintPlayButton
import com.jtech.zemer.ui.stalow.StalowMono
import com.jtech.zemer.ui.stalow.StalowOverline
import com.jtech.zemer.ui.stalow.StalowSearchField
import com.jtech.zemer.ui.stalow.StalowSectionTitle
import com.jtech.zemer.ui.stalow.StalowSquareButton
import com.jtech.zemer.ui.stalow.StalowTopResultCard
import com.jtech.zemer.ui.stalow.stalowColors
import com.jtech.zemer.ui.theme.BrandThemeColor
import com.jtech.zemer.ui.theme.ZemerTheme
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.ConscryptMode
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders the Stalow design's screens from the app's own components (sample data, no network, so
 * pictures show the design's lettered tiles) and saves them as PNGs. Opt-in:
 * `./gradlew :app:testDebugUnitTest --tests '*StalowDesignScreenshotTest*' -PstalowScreenshots=/some/dir`
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@ConscryptMode(ConscryptMode.Mode.OFF)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi", application = Application::class)
class StalowDesignScreenshotTest {
    @get:Rule
    val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()

    private val outDir: String? = System.getProperty("stalow.screenshots")?.takeIf { it.isNotBlank() }

    private fun shoot(name: String, dark: Boolean, content: @Composable () -> Unit) {
        assumeTrue("screenshots are opt-in (-PstalowScreenshots=dir)", outDir != null)
        compose.setContent {
            ZemerTheme(darkTheme = dark, themeColor = BrandThemeColor) {
                Box(Modifier.size(390.dp, 844.dp).background(stalowColors.background)) { content() }
            }
        }
        compose.waitForIdle()
        // Draw the window's view hierarchy straight into a bitmap (Robolectric native graphics).
        val root = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        root.draw(android.graphics.Canvas(bitmap))
        File(outDir!!).mkdirs()
        File(outDir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private val picks = listOf(
        Triple("Yidden", "Mordechai Ben David", "4:12"),
        Triple("Ah Mechayeh", "Avraham Fried", "3:48"),
        Triple("Vehi Sheamda", "Yaakov Shwekey", "5:02"),
        Triple("Es Achai", "Shira Choir", "4:31"),
    )
    private val artists = listOf("Avraham Fried", "Motty Steinmetz", "Beri Weber", "Ishay Ribo")

    @Composable
    private fun SongRow(title: String, subtitle: String, time: String?) {
        val c = stalowColors
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 20.dp),
        ) {
            StalowInitialImage(url = null, label = title, shape = RoundedCornerShape(8.dp), textSize = 18.sp, modifier = Modifier.size(48.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text, maxLines = 1)
                Text(subtitle, fontSize = 13.sp, color = c.muted, maxLines = 1)
            }
            if (time != null) Text(time, fontFamily = StalowMono, fontSize = 12.sp, color = c.muted)
        }
    }

    @Composable
    private fun MiniPlayerCard() {
        // Same layout and colours as MiniPlayer's card (the real one needs a running player).
        val c = stalowColors
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .padding(horizontal = 12.dp)
                .fillMaxWidth()
                .height(64.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(c.miniPlayer)
                .padding(10.dp),
        ) {
            StalowInitialImage(url = null, label = "Yidden", shape = RoundedCornerShape(8.dp), textSize = 18.sp, modifier = Modifier.size(44.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Yidden", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.miniPlayerText)
                Text("Mordechai Ben David", fontSize = 12.sp, color = c.miniPlayerMuted)
            }
            StalowMintPlayButton(isPlaying = true, onClick = {})
        }
    }

    @Composable
    private fun BottomBar() {
        // The bottom bar's colours exactly as MainActivity sets them.
        val c = stalowColors
        NavigationBar(containerColor = if (c.isDark) c.background else c.surface) {
            listOf(
                Triple(R.string.home, R.drawable.home_filled, true),
                Triple(R.string.artists, R.drawable.artist, false),
                Triple(R.string.search, R.drawable.search, false),
                Triple(R.string.filter_library, R.drawable.library_music, false),
            ).forEach { (label, icon, selected) ->
                NavigationBarItem(
                    selected = selected,
                    onClick = {},
                    icon = { Icon(painterResource(icon), contentDescription = null) },
                    label = { Text(androidx.compose.ui.res.stringResource(label)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = c.blue, selectedTextColor = c.blue, indicatorColor = c.pill,
                        unselectedIconColor = c.muted, unselectedTextColor = c.muted,
                    ),
                )
            }
        }
    }

    @Composable
    private fun HomeScreenShot() {
        Column(Modifier.fillMaxSize()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 8.dp),
            ) {
                StalowLogoTitle(Modifier.weight(1f))
                StalowSquareButton(icon = R.drawable.settings, contentDescription = "Settings", onClick = {})
            }
            StalowSearchField(onClick = {}, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            Spacer(Modifier.height(8.dp))
            StalowSectionTitle(title = "Quick picks", onSeeAll = {})
            picks.forEach { (t, a, d) -> SongRow(t, a, d) }
            Spacer(Modifier.height(12.dp))
            StalowSectionTitle(title = "Artists for you", onSeeAll = {})
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(horizontal = 18.dp)) {
                artists.forEach { StalowArtistCircle(name = it, thumbnailUrl = null, onClick = {}) }
            }
            Spacer(Modifier.weight(1f))
            MiniPlayerCard()
            Spacer(Modifier.height(10.dp))
            BottomBar()
        }
    }

    @Test fun homeDark() = shoot("home-dark", dark = true) { HomeScreenShot() }

    @Test fun homeLight() = shoot("home-light", dark = false) { HomeScreenShot() }

    @Test
    fun artistDark() = shoot("artist-dark", dark = true) {
        Column(Modifier.fillMaxSize()) {
            StalowArtistHeader(
                name = "Avraham Fried",
                subtitle = "אברהם פריד",
                thumbnailUrl = null,
                isSubscribed = false,
                onSubscribe = {},
                onPlay = {},
                onShuffle = {},
                onRadio = {},
            )
            StalowSectionTitle(title = "Top songs")
            listOf("Ah Mechayeh" to "Single", "Aderaba" to "Aderaba", "Shalom Aleichem" to "Single", "Tatte" to "Single")
                .forEach { (t, a) -> SongRow(t, a, "4:05") }
        }
    }

    @Composable
    private fun PlayerShot() {
        val c = stalowColors
        Column(Modifier.fillMaxSize().padding(top = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
                StalowSquareButton(icon = R.drawable.expand_more, contentDescription = "Close", onClick = {})
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    StalowOverline("Playing from", color = c.text.copy(alpha = 0.65f))
                    Text("Mordechai Ben David radio", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.text)
                }
                StalowSquareButton(icon = R.drawable.more_horiz, contentDescription = "More", onClick = {})
            }
            Spacer(Modifier.height(22.dp))
            StalowInitialImage(url = null, label = "Yidden", shape = RoundedCornerShape(20.dp), textSize = 96.sp, modifier = Modifier.size(342.dp))
            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("Yidden", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = c.text)
                    Text("Mordechai Ben David", fontSize = 16.sp, color = c.text.copy(alpha = 0.7f))
                }
                Box(
                    Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape).background(c.surface),
                    contentAlignment = Alignment.Center,
                ) { Icon(painterResource(R.drawable.favorite), null, tint = c.mint, modifier = Modifier.size(22.dp)) }
            }
            Spacer(Modifier.height(12.dp))
            PlayerSeekBar(
                sliderStyle = SliderStyle.DEFAULT, isStationBroadcast = false, position = 96_000, duration = 252_000,
                sliderPosition = null, isPlaying = true, accentColor = c.mint, textColor = c.text,
                playerBackground = PlayerBackgroundStyle.DEFAULT, useDarkTheme = c.isDark,
                onSliderPositionChange = {}, onSeek = {}, centerLabel = "Whole song loaded",
            )
            Spacer(Modifier.height(12.dp))
            PlayerTransportRow(
                isPlaying = true, ended = false, canSkipPrevious = true, canSkipNext = true,
                accentColor = c.blue, playButtonContainerColor = c.blue, playButtonContentColor = Color.White,
                sideButtonContainerColor = Color.Transparent, sideButtonContentColor = c.text,
                onPlayPause = {}, onPrevious = {}, onNext = {},
                shuffleEnabled = false, repeatMode = 0, onShuffle = {}, onRepeat = {},
                toggleActiveColor = c.mint, toggleIdleColor = c.text.copy(alpha = 0.6f),
            )
            Spacer(Modifier.weight(1f))
            StalowPlayerActionRow(
                mediaMetadata = null,
                onUpNext = {},
                onLyrics = {},
                sleepTimerContent = {},
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
            )
        }
    }

    @Test fun playerDark() = shoot("player-dark", dark = true) { PlayerShot() }

    @Composable
    private fun SearchShot() {
        Column(Modifier.fillMaxSize().padding(top = 16.dp)) {
            ChipsRow(
                chips = listOf("all" to "All", "songs" to "Songs", "albums" to "Albums", "artists" to "Artists", "playlists" to "Playlists"),
                currentValue = "all",
                onValueUpdate = {},
            )
            Spacer(Modifier.height(12.dp))
            StalowTopResultCard(title = "Mordechai Ben David", subtitle = "Artist · you typed “mbd”", thumbnailUrl = null, onClick = {}, onPlay = {})
            Spacer(Modifier.height(10.dp))
            StalowSectionTitle(title = "Songs")
            listOf("Yidden", "MBD Kumzits 1 – Shiru Lamelech", "Es Achai", "Together Again").forEach { SongRow(it, "Mordechai Ben David", null) }
            Spacer(Modifier.weight(1f))
            StalowApprovedNote(Modifier.padding(horizontal = 20.dp, vertical = 24.dp))
        }
    }

    @Test fun searchLight() = shoot("search-light", dark = false) { SearchShot() }

    @Test fun searchDark() = shoot("search-dark", dark = true) { SearchShot() }
}
