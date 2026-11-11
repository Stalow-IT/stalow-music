package com.jtech.zemer.ui.screens.settings

import com.jtech.zemer.ui.component.RequestInitialDpadFocus
import com.jtech.zemer.ui.component.expressiveAvatarShape
import com.jtech.zemer.ui.component.AppNameTitle
import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import coil3.compose.AsyncImage
import com.jtech.zemer.BuildConfig
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.R
import com.jtech.zemer.constants.DeveloperModeEnabledKey
import com.jtech.zemer.extensions.openUrlOrCopy
import com.jtech.zemer.extensions.toast
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.GenreWeaveLayer
import com.jtech.zemer.ui.component.PreferenceEntry
import com.jtech.zemer.ui.component.SettingsCardGroup
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import com.jtech.zemer.utils.rememberPreference

private const val SOURCE_URL = "https://github.com/ZemerTeam/zemer-app"
private const val METROLIST_URL = "https://github.com/metrolistgroup/metrolist"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    val backFocus = remember { FocusRequester() }
    val firstFocus = remember { FocusRequester() }
    var devTapCount by remember { mutableIntStateOf(0) }
    val (developerMode, onDeveloperModeChange) = rememberPreference(DeveloperModeEnabledKey, false)

    RequestInitialDpadFocus(firstFocus)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .windowInsetsPadding(LocalPlayerAwareWindowInsets.current)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))

        // App header: icon, name, tagline, version chip (the version chip doubles as the debug-only
        // developer-mode easter egg).
        Surface(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .fillMaxWidth(),
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 6.dp,
        ) {
            BoxWithLogoWeave {
                Column(
                    modifier = Modifier
                        .padding(horizontal = 20.dp, vertical = 20.dp)
                        .fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Surface(
                        modifier = Modifier.size(68.dp),
                        shape = MaterialTheme.shapes.extraLarge,
                        tonalElevation = 0.dp,
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                    ) {
                        Image(
                            painter = painterResource(R.mipmap.ic_launcher_foreground),
                            contentDescription = null,
                            modifier = Modifier
                                .padding(12.dp)
                                .fillMaxWidth()
                                .clip(MaterialTheme.shapes.extraLarge),
                        )
                    }

                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        AppNameTitle()
                        Text(
                            text = stringResource(R.string.about_tagline),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            // Always one line, whole text shown: auto-size shrinks it to fit the width.
                            maxLines = 1,
                            autoSize = TextAutoSize.StepBased(
                                minFontSize = 8.sp,
                                maxFontSize = 14.sp,
                                stepSize = 0.5.sp,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = Alignment.Center,
                    ) {
                        AssistChip(
                            // Developer-mode easter egg — debug builds only; the chip is inert in
                            // release so the Log viewer can never be surfaced there.
                            onClick = {
                                if (!BuildConfig.DEBUG) return@AssistChip
                                devTapCount++
                                if (devTapCount >= 7) {
                                    devTapCount = 0
                                    val newValue = !developerMode
                                    onDeveloperModeChange(newValue)
                                    context.toast(if (newValue) R.string.developer_mode_enabled else R.string.developer_mode_disabled)
                                }
                            },
                            label = { Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME)) },
                            modifier = Modifier.focusRequester(firstFocus),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // Links.
        SectionTitle(stringResource(R.string.about_links))
        SettingsCardGroup(
            rows = listOf(
                {
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.about_source_code)) },
                        icon = { Icon(painterResource(R.drawable.github), null) },
                        onClick = { context.openUrlOrCopy(SOURCE_URL) },
                    )
                },
                {
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.about_based_on)) },
                        icon = { Icon(painterResource(R.drawable.github), null) },
                        onClick = { context.openUrlOrCopy(METROLIST_URL) },
                    )
                },
            ),
        )

        if (BuildConfig.DEBUG && developerMode) {
            Spacer(Modifier.height(16.dp))
            SettingsCardGroup(
                rows = listOf(
                    {
                        PreferenceEntry(
                            title = { Text(stringResource(R.string.log_viewer)) },
                            description = stringResource(R.string.enable_debug_logging_desc),
                            onClick = { navController.navigate("settings/log_viewer") },
                        )
                    },
                ),
            )
        }

        Spacer(Modifier.height(32.dp))
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.about)) },
        navigationIcon = {
            BackNavigationIcon(
                navController,
                modifier = Modifier
                    .focusRequester(backFocus)
                    .focusProperties { down = firstFocus },
            )
        },
        colors = zemerTopAppBarColors(),
    )
}

/**
 * A card interior whose background is the drifting Zemer-logo motif weave — the same [GenreWeaveLayer]
 * the genre cards use, tiled with the monochrome app logo and accent-tinted. Defined once and shared
 * by the header card and every contributor card so the animated backdrop never drifts between them.
 */
@Composable
private fun BoxWithLogoWeave(content: @Composable () -> Unit) {
    Box {
        GenreWeaveLayer(
            motif = painterResource(R.mipmap.ic_launcher_monochrome),
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.matchParentSize(),
        )
        content()
    }
}

/** A left-aligned section header reusing the top-bar title's font and size ([AppBarTitle]). */
@Composable
private fun SectionTitle(text: String) {
    AppBarTitle(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
    )
}

/**
 * A credit card: the contributor's live GitHub avatar, name and role, plus link chips (GitHub, and
 * optionally JTechForums / a personal website). The background is the same slow-drifting motif weave
 * ([GenreWeaveLayer]) the genre cards use. All colors are theme tokens.
 */
@Composable
private fun aboutChipColors() = AssistChipDefaults.assistChipColors(
    leadingIconContentColor = MaterialTheme.colorScheme.onSurface,
)

@Composable
private fun LinkChip(
    @StringRes labelRes: Int,
    iconRes: Int,
    url: String,
    onOpen: (String) -> Unit,
    focus: FocusRequester? = null,
) {
    AssistChip(
        onClick = { onOpen(url) },
        label = { Text(stringResource(labelRes)) },
        colors = aboutChipColors(),
        leadingIcon = {
            Icon(
                painter = painterResource(iconRes),
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
        },
        modifier = if (focus != null) Modifier.focusRequester(focus) else Modifier,
    )
}
