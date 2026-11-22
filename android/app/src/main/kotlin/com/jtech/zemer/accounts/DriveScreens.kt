package com.jtech.zemer.accounts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.LocalPlayerConnection
import com.jtech.zemer.R
import com.jtech.zemer.extensions.toMediaItem
import com.jtech.zemer.extensions.toast
import com.jtech.zemer.playback.queues.ListQueue
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.SettingsScreenTopSpacing
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import com.jtech.zemer.utils.CatalogOverrides
import kotlinx.coroutines.launch

@Composable
private fun sectionLabel(category: String): String = stringResource(
    when (category) {
        CatalogOverrides.PODCASTS -> R.string.stalow_cat_podcasts
        CatalogOverrides.SHIURIM -> R.string.stalow_cat_shiurim
        CatalogOverrides.VIDEOS -> R.string.stalow_cat_videos
        else -> R.string.stalow_cat_music
    },
)

/** A Drive folder or file on Home. */
@Composable
fun DriveCard(item: DriveLibrary.Item, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.width(140.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(140.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Icon(
                painterResource(if (item.isFolder) R.drawable.library_music else if (item.files.firstOrNull()?.isVideo == true) R.drawable.ondemand_video else R.drawable.music_note),
                null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(48.dp),
            )
        }
        Text(item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(
            sectionLabel(item.category) + " · " + stringResource(R.string.stalow_drive_files, item.files.size),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        )
    }
}

/** One Drive folder (or file): Play all, Shuffle, and its files; a tap plays from that file on. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveFolderScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    id: String,
) {
    val playerConnection = LocalPlayerConnection.current ?: return
    val items by DriveLibrary.items.collectAsState()
    val item = items.firstOrNull { it.id == id }
    var query by remember { mutableStateOf("") }

    fun play(from: Int, shuffle: Boolean = false) {
        val d = item ?: return
        val files = if (shuffle) d.files.shuffled() else d.files
        playerConnection.playQueue(
            ListQueue(
                title = d.title,
                items = files.map { DriveMedia.metadata(it, d).toMediaItem() },
                startIndex = if (shuffle) 0 else from,
            ),
        )
    }

    LazyColumn(Modifier.fillMaxSize().windowInsetsPadding(LocalPlayerAwareWindowInsets.current)) {
        if (item == null) {
            item { Text(stringResource(R.string.stalow_drive_missing), modifier = Modifier.padding(24.dp)) }
        } else {
            item {
                Column(Modifier.padding(16.dp)) {
                    Text(item.title, style = MaterialTheme.typography.headlineSmall)
                    Text(
                        sectionLabel(item.category) + " · " + stringResource(R.string.stalow_drive_files, item.files.size),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = { play(0) }, enabled = item.files.isNotEmpty()) {
                            Icon(painterResource(R.drawable.play), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.stalow_drive_play_all))
                        }
                        OutlinedButton(onClick = { play(0, shuffle = true) }, enabled = item.files.size > 1) {
                            Icon(painterResource(R.drawable.shuffle), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.shuffle))
                        }
                    }
                    if (item.files.size > 12) {
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = query, onValueChange = { query = it }, singleLine = true,
                            leadingIcon = { Icon(painterResource(R.drawable.search), null) },
                            placeholder = { Text(stringResource(R.string.stalow_drive_find)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            val q = query.trim().lowercase()
            itemsIndexed(item.files, key = { _, f -> f.id }) { index, f ->
                if (q.isNotEmpty() && !f.name.lowercase().contains(q)) return@itemsIndexed
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().clickable { play(index) }.padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    Icon(painterResource(if (f.isVideo) R.drawable.ondemand_video else R.drawable.music_note), null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(f.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val folder = f.name.substringBeforeLast(" / ", "")
                        if (folder.isNotEmpty()) Text(folder, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
            }
        }
    }

    TopAppBar(
        title = { AppBarTitle(item?.title ?: stringResource(R.string.stalow_drive)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}

/** Settings > Google Drive (admins): add a shared folder or file link, choose its section, refresh, remove. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveSettings(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var all by remember { mutableStateOf<List<DriveLibrary.Item>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf<DriveLibrary.Item?>(null) }

    fun run(done: Int? = null, block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
                all = DriveLibrary.all()
                done?.let { context.toast(it) }
            } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName), long = true)
            }
            busy = false
        }
    }
    LaunchedEffect(Unit) { run {} }

    LazyColumn(Modifier.fillMaxSize().windowInsetsPadding(LocalPlayerAwareWindowInsets.current)) {
        item { Spacer(Modifier.height(SettingsScreenTopSpacing)) }
        item { CopierCard() }
        item {
            Text(
                stringResource(R.string.stalow_drive_explain), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.End) {
                Button(onClick = { showAdd = true }, enabled = !busy) {
                    Icon(painterResource(R.drawable.add), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.stalow_drive_add))
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
        }
        items(all.orEmpty(), key = { it.id }) { d ->
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).alpha(if (d.removed) 0.55f else 1f)) {
                Column(Modifier.padding(12.dp)) {
                    Text(d.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        stringResource(if (d.isFolder) R.string.stalow_drive_folder else R.string.stalow_drive_file) + " · " +
                            stringResource(R.string.stalow_drive_files, d.files.size),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    CopyStatusLine(d)
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (d.removed) {
                            OutlinedButton(onClick = { run(R.string.stalow_channels_saved) { DriveLibrary.set(d.id, removed = false) } }, enabled = !busy) {
                                Text(stringResource(R.string.stalow_channels_restore))
                            }
                        } else {
                            SectionDropdown(d.category, enabled = !busy) { c -> run(R.string.stalow_channels_saved) { DriveLibrary.set(d.id, category = c) } }
                            if (d.isFolder) IconButton(onClick = { run(R.string.stalow_drive_refreshed) { DriveLibrary.set(d.id, refreshFiles = true) } }, enabled = !busy) {
                                Icon(painterResource(R.drawable.sync), stringResource(R.string.stalow_drive_refresh))
                            }
                            IconButton(onClick = { confirmRemove = d }, enabled = !busy) {
                                Icon(painterResource(R.drawable.delete), stringResource(R.string.delete), tint = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }

    confirmRemove?.let { d ->
        AlertDialog(
            onDismissRequest = { confirmRemove = null },
            text = { Text(stringResource(R.string.stalow_channels_delete_q, d.title)) },
            confirmButton = {
                TextButton(onClick = { confirmRemove = null; run(R.string.stalow_channels_removed) { DriveLibrary.set(d.id, removed = true) } }) {
                    Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmRemove = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }

    if (showAdd) {
        var link by remember { mutableStateOf("") }
        var title by remember { mutableStateOf("") }
        var category by remember { mutableStateOf(CatalogOverrides.MUSIC) }
        AlertDialog(
            onDismissRequest = { showAdd = false },
            title = { Text(stringResource(R.string.stalow_drive_add)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.stalow_drive_add_explain), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(link, { link = it }, singleLine = true, label = { Text(stringResource(R.string.stalow_drive_link)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(title, { title = it }, singleLine = true, label = { Text(stringResource(R.string.stalow_drive_name)) }, modifier = Modifier.fillMaxWidth())
                    SectionDropdown(category, enabled = true) { category = it }
                }
            },
            confirmButton = {
                Button(onClick = { showAdd = false; run(R.string.stalow_channels_added) { DriveLibrary.add(link, category, title) } }, enabled = link.isNotBlank()) {
                    Text(stringResource(R.string.stalow_add))
                }
            },
            dismissButton = { TextButton(onClick = { showAdd = false }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.stalow_drive)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}

@Composable
private fun SectionDropdown(category: String, enabled: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled) {
            Text(sectionLabel(category), maxLines = 1)
            Icon(painterResource(R.drawable.expand_more), null, Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (c in CatalogOverrides.CATEGORIES) DropdownMenuItem(text = { Text(sectionLabel(c)) }, onClick = { open = false; if (c != category) onPick(c) })
        }
    }
}

/** One Google Drive file in a mixed list (search): a tap plays its folder from this file on. */
@Composable
fun DriveFileRow(item: DriveLibrary.Item, file: DriveLibrary.DriveFile, modifier: Modifier = Modifier) {
    val playerConnection = LocalPlayerConnection.current ?: return
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth().clickable {
            playerConnection.playQueue(
                ListQueue(
                    title = item.title,
                    items = item.files.map { DriveMedia.metadata(it, item).toMediaItem() },
                    startIndex = item.files.indexOf(file).coerceAtLeast(0),
                ),
            )
        }.padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Icon(painterResource(if (file.isVideo) R.drawable.ondemand_video else R.drawable.music_note), null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(file.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(R.string.stalow_drive) + " · " + item.title,
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** A Google Drive folder as a row in a list (Podcasts / Shiurim / Videos in list view). */
@Composable
fun DriveListItem(item: DriveLibrary.Item, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Icon(painterResource(R.drawable.library_music), null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(R.string.stalow_drive) + " · " + stringResource(R.string.stalow_drive_files, item.files.size),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
            )
        }
    }
}

/** A Google Drive folder as a big tile in the New releases row on Home. */
@Composable
fun DriveHeroTile(item: DriveLibrary.Item, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.secondaryContainer).clickable(onClick = onClick),
    ) {
        Icon(
            painterResource(R.drawable.library_music), null,
            tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(56.dp).align(Alignment.Center),
        )
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
            Text(item.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                stringResource(R.string.stalow_drive) + " · " + stringResource(R.string.stalow_drive_files, item.files.size),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 1,
            )
        }
    }
}

/** Where the item's copy in the owner's Google Drive stands. */
@Composable
fun CopyStatusLine(d: DriveLibrary.Item) {
    val text = when (d.copyStatus) {
        "copying" -> stringResource(R.string.stalow_copy_copying)
        "done" -> stringResource(R.string.stalow_copy_done)
        "failed" -> stringResource(R.string.stalow_copy_failed, d.copyError.orEmpty())
        else -> return
    }
    Text(
        text, style = MaterialTheme.typography.bodySmall,
        color = if (d.copyStatus == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
    )
}

/**
 * Copy to my Google Drive: the owner installs a small script in their Google account (the steps and the script are
 * here) and pastes its link; from then on every added folder or file is copied into "Stalow Music" in their Drive
 * and plays from there, so it stays even if the person who shared it deletes it.
 */
@Composable
private fun CopierCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    var copier by remember { mutableStateOf<DriveLibrary.Copier?>(null) }
    var url by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var showSteps by remember { mutableStateOf(false) }

    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { block(); copier = DriveLibrary.copier() } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName), long = true)
            }
            busy = false
        }
    }
    LaunchedEffect(Unit) { run {} }
    val c = copier ?: return

    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.stalow_copier), style = MaterialTheme.typography.titleMedium)
            if (c.connected) {
                Text(stringResource(R.string.stalow_copier_on), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    c.rootUrl?.let { link -> OutlinedButton(onClick = { uriHandler.openUri(link) }) { Text(stringResource(R.string.stalow_copier_open)) } }
                    if (c.isOwner) TextButton(onClick = { run { DriveLibrary.disconnectCopier() } }, enabled = !busy) {
                        Text(stringResource(R.string.stalow_copier_disconnect), color = MaterialTheme.colorScheme.error)
                    }
                }
            } else if (!c.isOwner) {
                Text(stringResource(R.string.stalow_copier_owner_only), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(stringResource(R.string.stalow_copier_explain), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!showSteps) {
                    Button(onClick = { showSteps = true }) { Text(stringResource(R.string.stalow_copier_setup)) }
                } else {
                    Text(stringResource(R.string.stalow_copier_steps), style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(c.script))
                            context.toast(R.string.stalow_copier_copied)
                        }) { Text(stringResource(R.string.stalow_copier_copy_script)) }
                        OutlinedButton(onClick = { uriHandler.openUri("https://script.google.com/home/projects/create") }) { Text("script.google.com") }
                    }
                    OutlinedTextField(url, { url = it }, singleLine = true, label = { Text(stringResource(R.string.stalow_copier_url)) }, modifier = Modifier.fillMaxWidth())
                    Button(onClick = { run { DriveLibrary.connectCopier(url); context.toast(R.string.stalow_copier_connected) } }, enabled = !busy && url.isNotBlank()) {
                        Text(stringResource(R.string.stalow_copier_connect))
                    }
                }
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}
