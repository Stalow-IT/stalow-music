package com.jtech.zemer.accounts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.R
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.SettingsScreenTopSpacing
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import kotlinx.coroutines.launch

/** Settings > Users (admins): approve new users as a user or an admin, change roles, block. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountsSettings(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    val me by StalowAccount.state.collectAsState()
    val scope = rememberCoroutineScope()
    var accounts by remember { mutableStateOf<List<StalowAccount.Account>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun load(block: suspend () -> Unit = {}) {
        busy = true
        scope.launch {
            try {
                block()
                accounts = StalowAccount.accounts()
                error = null
            } catch (e: Exception) {
                error = context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName)
            }
            busy = false
        }
    }
    LaunchedEffect(Unit) { load() }

    val list = accounts.orEmpty()
    val pending = list.filter { it.status == "pending" }
    val approved = list.filter { it.status == "approved" }
    val blocked = list.filter { it.status == "blocked" }

    LazyColumn(
        modifier = Modifier.fillMaxSize().windowInsetsPadding(LocalPlayerAwareWindowInsets.current),
    ) {
        item { Spacer(Modifier.height(SettingsScreenTopSpacing)) }
        if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }

        item { SectionTitle(stringResource(R.string.stalow_accounts_pending) + " (${pending.size})") }
        if (pending.isEmpty() && accounts != null) item {
            Text(
                stringResource(R.string.stalow_accounts_none_pending),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        items(pending, key = { it.id }) { a ->
            AccountCard(a) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(onClick = { load { StalowAccount.decide(a.id, "approved", "user") } }, enabled = !busy) { Text(stringResource(R.string.stalow_approve)) }
                    OutlinedButton(onClick = { load { StalowAccount.decide(a.id, "approved", "admin") } }, enabled = !busy) { Text(stringResource(R.string.stalow_approve_admin), maxLines = 1) }
                }
                TextButton(onClick = { load { StalowAccount.decide(a.id, "blocked") } }, enabled = !busy) {
                    Text(stringResource(R.string.stalow_deny), color = MaterialTheme.colorScheme.error)
                }
            }
        }

        item { SectionTitle(stringResource(R.string.stalow_accounts_approved) + " (${approved.size})") }
        items(approved, key = { it.id }) { a ->
            AccountCard(a, isMe = a.id == me.id) {
                if (a.role == "owner") {
                    Text(stringResource(R.string.stalow_role_owner), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        RoleDropdown(a.role, enabled = !busy) { role -> load { StalowAccount.decide(a.id, role = role) } }
                        if (a.id != me.id) TextButton(onClick = { load { StalowAccount.decide(a.id, "blocked") } }, enabled = !busy) {
                            Text(stringResource(R.string.stalow_block), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        if (blocked.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.stalow_accounts_blocked) + " (${blocked.size})") }
            items(blocked, key = { it.id }) { a ->
                AccountCard(a) {
                    OutlinedButton(onClick = { load { StalowAccount.decide(a.id, "approved") } }, enabled = !busy) { Text(stringResource(R.string.stalow_unblock)) }
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.stalow_accounts)) },
        navigationIcon = { BackNavigationIcon(navController) },
        actions = {
            androidx.compose.material3.IconButton(onClick = { load() }, enabled = !busy) { Icon(painterResource(R.drawable.sync), null) }
        },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
    )
}

@Composable
private fun AccountCard(a: StalowAccount.Account, isMe: Boolean = false, actions: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(a.name + if (isMe) " " + stringResource(R.string.stalow_you) else "", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val seen = a.lastSeen.take(16).replace('T', ' ')
            Text(
                listOf(a.device, seen).filter { it.isNotBlank() }.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(8.dp))
            actions()
        }
    }
}

@Composable
private fun RoleDropdown(role: String, enabled: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = @Composable { r: String -> stringResource(if (r == "admin") R.string.stalow_role_admin else R.string.stalow_role_user) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled) {
            Text(label(role))
            Icon(painterResource(R.drawable.expand_more), null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (r in listOf("user", "admin")) DropdownMenuItem(
                text = { Text(label(r)) },
                onClick = { open = false; if (r != role) onPick(r) },
            )
        }
    }
}
