package com.jtech.zemer.ui.screens.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.navigation.NavController
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.R
import com.jtech.zemer.extensions.toast
import com.jtech.zemer.pcsync.PcSync
import com.jtech.zemer.pcsync.SyncProtocol
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.ConfirmDialog
import com.jtech.zemer.ui.component.PreferenceEntry
import com.jtech.zemer.ui.component.SettingsCardGroup
import com.jtech.zemer.ui.component.SettingsScreenTopSpacing
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PcSyncViewModel @Inject constructor(val pcSync: PcSync) : ViewModel()

/** Settings > Sync with your PC: make a sync code or enter the PC's, then see the status. Same steps as the PC app. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PcSyncSettings(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    viewModel: PcSyncViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pcSync = viewModel.pcSync
    val status by pcSync.status.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<Boolean?>(null) } // true = erase, false = stop
    val badCode = stringResource(R.string.pc_sync_bad_code)

    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { block() } catch (e: Exception) { context.toast(e.message ?: e.toString()) } finally { busy = false }
        }
    }

    confirm?.let { erase ->
        ConfirmDialog(
            text = stringResource(if (erase) R.string.pc_sync_erase_confirm else R.string.pc_sync_stop_confirm),
            onDismiss = { confirm = null },
            onConfirm = { confirm = null; run { pcSync.leave(erase) } },
        )
    }

    Column(
        Modifier
            .windowInsetsPadding(LocalPlayerAwareWindowInsets.current)
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(Modifier.height(SettingsScreenTopSpacing))
        val code = status.code
        if (code == null) {
            Text(
                stringResource(R.string.pc_sync_explain),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
            )
            SettingsCardGroup(
                title = stringResource(R.string.pc_sync_first_device),
                rows = listOf({
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.pc_sync_create)) },
                        description = stringResource(R.string.pc_sync_create_desc),
                        icon = { Icon(painterResource(R.drawable.sync), null) },
                        onClick = { run { pcSync.create() } },
                        isEnabled = !busy,
                    )
                }),
            )
            SettingsCardGroup(
                title = stringResource(R.string.pc_sync_other_device),
                rows = listOf({
                    Column(Modifier.padding(16.dp)) {
                        Text(stringResource(R.string.pc_sync_enter), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.pc_sync_enter_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(12.dp))
                        OutlinedTextField(
                            value = input,
                            onValueChange = { input = it.take(40) },
                            singleLine = true,
                            placeholder = { Text("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", fontFamily = FontFamily.Monospace) },
                            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(
                            enabled = !busy && input.isNotBlank(),
                            onClick = {
                                if (SyncProtocol.cleanCode(input) == null) context.toast(badCode)
                                else run { pcSync.join(input); input = "" }
                            },
                        ) { Text(stringResource(R.string.pc_sync_join)) }
                    }
                }),
            )
        } else {
            SettingsCardGroup(
                title = stringResource(R.string.pc_sync_code),
                rows = listOf({
                    Column(Modifier.padding(16.dp)) {
                        Text(code, fontFamily = FontFamily.Monospace, fontSize = 20.sp, style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(6.dp))
                        Text(stringResource(R.string.pc_sync_your_code_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }, {
                    val copied = stringResource(R.string.pc_sync_copied)
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.pc_sync_copy)) },
                        icon = { Icon(painterResource(R.drawable.content_copy), null) },
                        onClick = {
                            context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Stalow Music sync code", code))
                            context.toast(copied)
                        },
                    )
                }),
            )
            val line = when (status.state) {
                "syncing" -> stringResource(R.string.pc_sync_syncing)
                "error" -> stringResource(R.string.pc_sync_error, status.error ?: "")
                else -> status.lastSync?.let { stringResource(R.string.pc_sync_last, DateUtils.formatDateTime(context, it, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME)) }
                    ?: stringResource(R.string.pc_sync_never)
            }
            SettingsCardGroup(
                title = stringResource(R.string.pc_sync_status),
                rows = listOf({
                    PreferenceEntry(
                        title = { Text(line) },
                        description = stringResource(R.string.pc_sync_what),
                        icon = { Icon(painterResource(R.drawable.sync), null) },
                        trailingContent = { Button(enabled = !busy, onClick = { run { pcSync.syncNow() } }) { Text(stringResource(R.string.pc_sync_now)) } },
                    )
                }),
            )
            SettingsCardGroup(
                rows = listOf({
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.pc_sync_stop)) },
                        description = stringResource(R.string.pc_sync_stop_desc),
                        icon = { Icon(painterResource(R.drawable.link), null) },
                        onClick = { confirm = false },
                        isEnabled = !busy,
                    )
                }, {
                    PreferenceEntry(
                        title = { Text(stringResource(R.string.pc_sync_erase), color = MaterialTheme.colorScheme.error) },
                        description = stringResource(R.string.pc_sync_erase_desc),
                        icon = { Icon(painterResource(R.drawable.delete), null, tint = MaterialTheme.colorScheme.error) },
                        onClick = { confirm = true },
                        isEnabled = !busy,
                    )
                }),
            )
        }
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.sync_with_pc)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}
