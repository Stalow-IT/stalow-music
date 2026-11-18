package com.jtech.zemer.ui.screens.settings

import android.content.Intent
import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.jtech.zemer.BuildConfig
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.R
import com.jtech.zemer.playback.PlaybackReport
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.PreferenceEntry
import com.jtech.zemer.ui.component.SettingsCardGroup
import com.jtech.zemer.ui.component.SettingsScreenTopSpacing
import com.jtech.zemer.ui.component.zemerTopAppBarColors

/** Settings > Playback report: share what playback did, when the sound cuts out (see [PlaybackReport]). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaybackReportSettings(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    var lines by remember { mutableIntStateOf(PlaybackReport.size) }

    Column(
        Modifier
            .windowInsetsPadding(LocalPlayerAwareWindowInsets.current)
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(Modifier.height(SettingsScreenTopSpacing))
        Text(
            stringResource(R.string.stalow_playback_report_explain),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )
        SettingsCardGroup(
            rows = listOf({
                PreferenceEntry(
                    title = { Text(stringResource(R.string.stalow_playback_report_share)) },
                    description = stringResource(R.string.stalow_playback_report_lines, lines),
                    icon = { Icon(painterResource(R.drawable.share), null) },
                    onClick = {
                        val header = "Stalow Music ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) on Android ${Build.VERSION.RELEASE}, ${Build.MANUFACTURER} ${Build.MODEL}"
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_SUBJECT, "Stalow Music playback report")
                            val crash = java.io.File(context.filesDir, PlaybackReport.CRASH_FILE)
                            val crashText = if (crash.exists()) "\n\n===== Last crash =====\n" + runCatching { crash.readText() }.getOrDefault("") else ""
                            putExtra(Intent.EXTRA_TEXT, PlaybackReport.text(header) + crashText)
                        }
                        context.startActivity(Intent.createChooser(send, null))
                    },
                )
            }, {
                PreferenceEntry(
                    title = { Text(stringResource(R.string.stalow_playback_report_clear)) },
                    icon = { Icon(painterResource(R.drawable.history), null) },
                    onClick = { PlaybackReport.clear(); java.io.File(context.filesDir, PlaybackReport.CRASH_FILE).delete(); lines = 0 },
                )
            }),
        )
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.stalow_playback_report)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}
