package com.jtech.zemer.accounts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jtech.zemer.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * Shown instead of the app until an admin approves this device: ask for access with a name, then wait
 * (checked every 15 seconds). The owner's one-time code makes this device the owner straight away.
 */
@Composable
fun AccountGateScreen() {
    val state by StalowAccount.state.collectAsState()
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf(state.name) }
    var code by rememberSaveable { mutableStateOf("") }
    var showCode by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val offline = stringResource(R.string.stalow_gate_offline)

    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { block() } catch (e: StalowAccount.ServerError) { error = e.message } catch (e: IOException) { error = offline }
            busy = false
        }
    }

    // Waiting: look again every 15 seconds, and once straight away
    LaunchedEffect(state.status) {
        if (state.status == StalowAccount.Status.PENDING || state.status == StalowAccount.Status.BLOCKED) {
            while (true) { StalowAccount.refresh(); delay(15_000) }
        }
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Icon(painterResource(R.drawable.stalow_shield_check), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(56.dp))
        Spacer(Modifier.height(16.dp))
        val column = Modifier.widthIn(max = 420.dp).fillMaxWidth()
        when (state.status) {
            StalowAccount.Status.PENDING, StalowAccount.Status.BLOCKED -> {
                val pending = state.status == StalowAccount.Status.PENDING
                Text(
                    stringResource(if (pending) R.string.stalow_gate_waiting else R.string.stalow_gate_blocked),
                    style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (pending) stringResource(R.string.stalow_gate_waiting_explain, state.name) else stringResource(R.string.stalow_gate_blocked_explain),
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = column,
                )
                Spacer(Modifier.height(20.dp))
                if (pending) CircularProgressIndicator(Modifier.size(28.dp))
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = { run { if (!StalowAccount.refresh()) throw IOException() } }, enabled = !busy) {
                    Text(stringResource(R.string.stalow_gate_check))
                }
            }
            else -> {
                Text(stringResource(R.string.stalow_gate_title), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.stalow_gate_explain),
                    style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = column,
                )
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = name, onValueChange = { name = it.take(60) }, singleLine = true,
                    label = { Text(stringResource(R.string.stalow_gate_name)) }, modifier = column,
                )
                Spacer(Modifier.height(12.dp))
                Button(onClick = { run { StalowAccount.register(name) } }, enabled = !busy && name.isNotBlank(), modifier = column) {
                    Text(stringResource(R.string.stalow_gate_ask))
                }
                Spacer(Modifier.height(8.dp))
                if (!showCode) {
                    TextButton(onClick = { showCode = true }) { Text(stringResource(R.string.stalow_gate_owner)) }
                } else {
                    OutlinedTextField(
                        value = code, onValueChange = { code = it.take(40) }, singleLine = true,
                        label = { Text(stringResource(R.string.stalow_gate_code)) }, modifier = column,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { run { StalowAccount.claimOwner(name, code) } },
                        enabled = !busy && name.isNotBlank() && code.isNotBlank(), modifier = column,
                    ) { Text(stringResource(R.string.stalow_gate_use_code)) }
                }
            }
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        }
    }
}
