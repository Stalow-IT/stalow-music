package com.jtech.zemer.accounts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import coil3.compose.AsyncImage
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.LocalSyncUtils
import com.jtech.zemer.R
import com.jtech.zemer.extensions.toast
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.SettingsScreenTopSpacing
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import com.jtech.zemer.utils.CatalogOverrides
import com.jtech.zemer.utils.StalowChannels
import com.jtech.zemer.utils.ZemerContentClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** One channel or artist as the admins see it: built in, or changed / added by an admin. */
data class CatalogRow(val id: String, val name: String, val thumbnail: String?, val category: String, val removed: Boolean)

/** The built-in artists and channels with the admins' changes on top, removed ones last. */
fun catalogRows(): List<CatalogRow> {
    val map = LinkedHashMap<String, CatalogRow>()
    for (a in ZemerContentClient.builtInArtists()) {
        val id = a.id.ifBlank { a.artistId.orEmpty() }
        if (id.isBlank()) continue
        map[id] = CatalogRow(id, a.displayName ?: a.name ?: a.artistName ?: id, a.thumbnail, CatalogOverrides.MUSIC, false)
    }
    for ((category, docs) in StalowChannels.builtInByCategory()) {
        val name = when (category) {
            StalowChannels.Category.PODCASTS -> CatalogOverrides.PODCASTS
            StalowChannels.Category.SHIURIM -> CatalogOverrides.SHIURIM
            StalowChannels.Category.VIDEOS -> CatalogOverrides.VIDEOS
        }
        for (d in docs) if (d.id.isNotBlank() && d.id !in map) map[d.id] = CatalogRow(d.id, d.name ?: d.id, d.thumbnailUrl, name, false)
    }
    for (e in CatalogOverrides.entries.values) {
        val prev = map[e.id]
        map[e.id] = CatalogRow(e.id, e.name.ifBlank { prev?.name ?: e.id }, e.thumbnail.ifBlank { prev?.thumbnail }, e.category, e.removed)
    }
    return map.values.sortedWith(compareBy<CatalogRow> { it.removed }.thenBy { it.name.lowercase() })
}

@Composable
private fun categoryLabel(category: String): String = stringResource(
    when (category) {
        CatalogOverrides.MUSIC -> R.string.stalow_cat_music
        CatalogOverrides.PODCASTS -> R.string.stalow_cat_podcasts
        CatalogOverrides.SHIURIM -> R.string.stalow_cat_shiurim
        CatalogOverrides.VIDEOS -> R.string.stalow_cat_videos
        else -> R.string.stalow_cat_all
    },
)

// Re-importing the lists outlives the screen
private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

/** Settings > Channels & artists (admins): find, move between Music / Podcasts / Shiurim / Videos, remove, add. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelsSettings(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    val syncUtils = LocalSyncUtils.current
    val scope = rememberCoroutineScope()
    var version by remember { mutableIntStateOf(0) }
    val rows = remember(version) { catalogRows() }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<CatalogRow?>(null) }
    var pictureFor by remember { mutableStateOf<CatalogRow?>(null) }
    var albumsFor by remember { mutableStateOf<CatalogRow?>(null) }

    fun save(row: CatalogRow, category: String = row.category, removed: Boolean = row.removed, toastRes: Int = R.string.stalow_channels_saved) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                StalowAccount.setEntry(row.id, row.name, row.thumbnail, category, removed)
                version++
                context.toast(toastRes)
                background.launch { syncUtils.resyncCatalog() }
            } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName))
            }
            busy = false
        }
    }

    val shown = remember(rows, query, filter) {
        val q = query.trim().lowercase()
        rows.filter { r ->
            (filter == null || r.category == filter) && (q.isEmpty() || r.name.lowercase().contains(q) || r.id.lowercase() == q)
        }
    }

    Column(Modifier.fillMaxSize().windowInsetsPadding(LocalPlayerAwareWindowInsets.current)) {
        Spacer(Modifier.height(SettingsScreenTopSpacing))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 16.dp)) {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                leadingIcon = { Icon(painterResource(R.drawable.search), null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(painterResource(R.drawable.close), null) } },
                placeholder = { Text(stringResource(R.string.stalow_channels_filter)) },
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
        ) {
            FilterChip(selected = filter == null, onClick = { filter = null }, label = { Text(stringResource(R.string.stalow_cat_all)) })
            for (c in CatalogOverrides.CATEGORIES) {
                FilterChip(selected = filter == c, onClick = { filter = if (filter == c) null else c }, label = { Text(categoryLabel(c)) })
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Text(
                stringResource(R.string.stalow_count, shown.size), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
            )
            Button(onClick = { showAdd = true }) {
                Icon(painterResource(R.drawable.add), null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.stalow_channels_add))
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
        LazyColumn(Modifier.fillMaxSize()) {
            items(shown, key = { it.id }) { r ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp).alpha(if (r.removed) 0.5f else 1f),
                ) {
                    AsyncImage(
                        model = r.thumbnail, contentDescription = null, contentScale = ContentScale.Crop,
                        placeholder = painterResource(R.drawable.artist), error = painterResource(R.drawable.artist),
                        modifier = Modifier.size(44.dp).clip(CircleShape).clickable(enabled = !r.removed && !busy) { pictureFor = r },
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(r.name, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (r.removed) {
                        TextButton(onClick = { save(r, removed = false) }, enabled = !busy) { Text(stringResource(R.string.stalow_channels_restore)) }
                    } else {
                        CategoryDropdown(r.category, enabled = !busy) { c -> save(r, category = c) }
                        if (r.category == CatalogOverrides.MUSIC) IconButton(onClick = { albumsFor = r }, enabled = !busy) {
                            Icon(painterResource(R.drawable.library_music), contentDescription = stringResource(R.string.stalow_albums))
                        }
                        IconButton(onClick = { pictureFor = r }, enabled = !busy) {
                            Icon(painterResource(R.drawable.insert_photo), contentDescription = stringResource(R.string.stalow_picture))
                        }
                        IconButton(onClick = { confirmDelete = r }, enabled = !busy) {
                            Icon(painterResource(R.drawable.delete), contentDescription = stringResource(R.string.delete), tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }

    confirmDelete?.let { r ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            text = { Text(stringResource(R.string.stalow_channels_delete_q, r.name)) },
            confirmButton = {
                TextButton(onClick = { confirmDelete = null; save(r, removed = true, toastRes = R.string.stalow_channels_removed) }) {
                    Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }

    albumsFor?.let { r -> AlbumsDialog(r) { albumsFor = null } }

    pictureFor?.let { r ->
        PictureDialog(r, onDismiss = { pictureFor = null }) { url ->
            pictureFor = null
            save(r.copy(thumbnail = url))
        }
    }

    if (showAdd) AddChannelDialog(
        existing = rows.associateBy { it.id },
        onDismiss = { showAdd = false },
        onAdd = { found, category ->
            save(CatalogRow(found.id, found.name, found.thumbnail.ifBlank { null }, category, false), toastRes = R.string.stalow_channels_added)
        },
    )

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.stalow_channels)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}

@Composable
private fun CategoryDropdown(category: String, enabled: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(
            onClick = { open = true }, enabled = enabled,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Text(categoryLabel(category), style = MaterialTheme.typography.labelMedium, maxLines = 1)
            Icon(painterResource(R.drawable.expand_more), null, Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (c in CatalogOverrides.CATEGORIES) DropdownMenuItem(
                text = { Text(categoryLabel(c)) },
                onClick = { open = false; if (c != category) onPick(c) },
            )
        }
    }
}

/** Search YouTube Music and YouTube (or paste a channel link / @handle), pick where it goes, add. */
@Composable
private fun AddChannelDialog(
    existing: Map<String, CatalogRow>,
    onDismiss: () -> Unit,
    onAdd: (StalowAccount.Found, String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<StalowAccount.Found>?>(null) }
    var searching by remember { mutableStateOf(false) }
    val picked = remember { mutableStateOf(mapOf<String, String>()) }
    val added = remember { mutableStateOf(setOf<String>()) }

    fun search() {
        if (q.isBlank() || searching) return
        searching = true
        scope.launch {
            results = try { StalowAccount.searchChannels(q.trim()) } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName)); results
            }
            searching = false
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.stalow_channels_add)) },
        text = {
            Column {
                OutlinedTextField(
                    value = q, onValueChange = { q = it }, singleLine = true,
                    placeholder = { Text(stringResource(R.string.stalow_channels_search_hint)) },
                    trailingIcon = { IconButton(onClick = { search() }) { Icon(painterResource(R.drawable.search), stringResource(R.string.stalow_channels_search)) } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { search() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (searching) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
                results?.let { list ->
                    if (list.isEmpty()) Text(stringResource(R.string.stalow_channels_no_results), modifier = Modifier.padding(top = 12.dp))
                    LazyColumn(Modifier.heightIn(max = 420.dp).padding(top = 8.dp)) {
                        items(list, key = { it.id }) { f ->
                            val already = existing[f.id]?.takeIf { !it.removed }
                            val category = picked.value[f.id] ?: if (f.kind == "artist") CatalogOverrides.MUSIC else CatalogOverrides.PODCASTS
                            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    AsyncImage(
                                        model = f.thumbnail.ifBlank { null }, contentDescription = null, contentScale = ContentScale.Crop,
                                        placeholder = painterResource(R.drawable.artist), error = painterResource(R.drawable.artist),
                                        modifier = Modifier.size(40.dp).clip(CircleShape),
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Text(f.name, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 50.dp, top = 4.dp)) {
                                    when {
                                        f.id in added.value -> Text(stringResource(R.string.stalow_channels_added), color = MaterialTheme.colorScheme.primary)
                                        already != null -> Text(
                                            stringResource(R.string.stalow_channels_already, categoryLabel(already.category)),
                                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        else -> {
                                            CategoryDropdown(category, enabled = true) { picked.value = picked.value + (f.id to it) }
                                            Spacer(Modifier.width(8.dp))
                                            Button(onClick = { onAdd(f, category); added.value = added.value + f.id }) { Text(stringResource(R.string.stalow_add)) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.ok)) } },
    )
}

/** Possible pictures for one channel / artist (its own pages, and a search by name); tap one to use it for everyone. */
@Composable
private fun PictureDialog(row: CatalogRow, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf(row.name) }
    var pictures by remember { mutableStateOf<List<StalowAccount.Picture>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf<String?>(null) }

    fun load() {
        if (loading) return
        loading = true
        scope.launch {
            pictures = try { StalowAccount.pictures(row.id, q.trim()) } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName)); pictures
            }
            loading = false
        }
    }
    LaunchedEffect(Unit) { load() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.stalow_picture_for, row.name), maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column {
                OutlinedTextField(
                    value = q, onValueChange = { q = it }, singleLine = true,
                    placeholder = { Text(stringResource(R.string.stalow_picture_search_hint)) },
                    trailingIcon = { IconButton(onClick = { load() }) { Icon(painterResource(R.drawable.search), stringResource(R.string.stalow_channels_search)) } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { load() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
                val list = pictures
                if (list != null && list.isEmpty() && !loading) Text(stringResource(R.string.stalow_channels_no_results), modifier = Modifier.padding(top = 12.dp))
                if (!list.isNullOrEmpty()) {
                    Text(
                        stringResource(R.string.stalow_picture_tap), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                    )
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.heightIn(max = 380.dp),
                    ) {
                        gridItems(list, key = { it.url }) { p ->
                            val selected = chosen == p.url
                            AsyncImage(
                                model = p.url, contentDescription = p.from, contentScale = ContentScale.Crop,
                                placeholder = painterResource(R.drawable.artist), error = painterResource(R.drawable.hide_image),
                                modifier = Modifier
                                    .aspectRatio(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(if (selected) 3.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp))
                                    .clickable { chosen = p.url },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { chosen?.let(onPick) }, enabled = chosen != null) { Text(stringResource(R.string.stalow_picture_use)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.cancel)) } },
    )
}

/**
 * An artist's albums and singles on YouTube Music, and the albums attached from Google Drive to fill the gaps:
 * paste a shared Drive folder of the missing album, give its name and year, and it shows on the artist page.
 */
@Composable
private fun AlbumsDialog(row: CatalogRow, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var albums by remember { mutableStateOf<List<DriveLibrary.Album>?>(null) }
    var drive by remember { mutableStateOf<List<DriveLibrary.Item>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var year by remember { mutableStateOf("") }
    var comparing by remember { mutableStateOf(false) }

    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
                val (a, d) = DriveLibrary.artistAlbums(row.id)
                albums = a; drive = d
            } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName), long = true)
            }
            busy = false
        }
    }
    LaunchedEffect(Unit) { run {} }

    if (comparing) CompareDialog(row) { changed ->
        comparing = false
        if (changed) run {}
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.stalow_albums_of, row.name), maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            LazyColumn(Modifier.heightIn(max = 520.dp)) {
                if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(bottom = 8.dp)) }
                item {
                    Text(stringResource(R.string.stalow_albums_drive), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                }
                items(drive, key = { "d" + it.id }) { d ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).alpha(if (d.removed) 0.5f else 1f)) {
                        Icon(painterResource(R.drawable.library_music), null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(d.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(d.year?.toString(), stringResource(R.string.stalow_drive_files, d.files.size)).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (d.removed) TextButton(onClick = { run { DriveLibrary.set(d.id, removed = false) } }, enabled = !busy) { Text(stringResource(R.string.stalow_channels_restore)) }
                        else IconButton(onClick = { run { DriveLibrary.set(d.id, removed = true) } }, enabled = !busy) {
                            Icon(painterResource(R.drawable.delete), stringResource(R.string.delete), tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                item {
                    if (!adding) {
                        TextButton(onClick = { adding = true }) {
                            Icon(painterResource(R.drawable.add), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.stalow_albums_add))
                        }
                    } else {
                        Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(R.string.stalow_drive_add_explain), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            OutlinedTextField(link, { link = it }, singleLine = true, label = { Text(stringResource(R.string.stalow_drive_link)) }, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.stalow_albums_name)) }, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(year, { year = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text(stringResource(R.string.stalow_albums_year)) }, modifier = Modifier.fillMaxWidth())
                            Button(
                                onClick = {
                                    run {
                                        DriveLibrary.add(link, CatalogOverrides.MUSIC, name, row.id, year.toIntOrNull())
                                        link = ""; name = ""; year = ""; adding = false
                                        context.toast(R.string.stalow_channels_added)
                                    }
                                },
                                enabled = !busy && link.isNotBlank(),
                            ) { Text(stringResource(R.string.stalow_add)) }
                        }
                    }
                }
                item {
                    // Compare: which Drive albums YouTube Music now has (their Drive copy can then go)
                    if (drive.any { !it.removed }) OutlinedButton(onClick = { comparing = true }, enabled = !busy, modifier = Modifier.padding(top = 6.dp)) {
                        Icon(painterResource(R.drawable.sync), null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.stalow_compare))
                    }
                }
                item {
                    Text(
                        stringResource(R.string.stalow_albums_youtube, albums?.size ?: 0),
                        style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 10.dp),
                    )
                }
                items(albums.orEmpty(), key = { "y" + it.browseId }) { a ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        AsyncImage(
                            model = a.thumbnail.ifBlank { null }, contentDescription = null, contentScale = ContentScale.Crop,
                            placeholder = painterResource(R.drawable.album), error = painterResource(R.drawable.album),
                            modifier = Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(a.year?.toString(), stringResource(if (a.kind == "single") R.string.stalow_single else R.string.stalow_album)).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.ok)) } },
    )
}

/** Compare: each Drive album of the artist against YouTube Music; one that is there now can be deleted from Drive. */
@Composable
private fun CompareDialog(row: CatalogRow, onDone: (changed: Boolean) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var results by remember { mutableStateOf<List<DriveLibrary.Compared>?>(null) }
    var busy by remember { mutableStateOf(true) }
    var changed by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<DriveLibrary.Compared?>(null) }
    fun load() {
        busy = true
        scope.launch {
            results = try { DriveLibrary.compare(row.id) } catch (e: Exception) {
                context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName), long = true); results ?: emptyList()
            }
            busy = false
        }
    }
    LaunchedEffect(Unit) { load() }

    AlertDialog(
        onDismissRequest = { onDone(changed) },
        title = { Text(stringResource(R.string.stalow_compare)) },
        text = {
            LazyColumn(Modifier.heightIn(max = 480.dp)) {
                if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(bottom = 8.dp)) }
                if (results?.isEmpty() == true) item { Text(stringResource(R.string.stalow_compare_none)) }
                items(results.orEmpty(), key = { it.item.id }) { r ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text(r.item.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val m = r.match
                        if (m == null) {
                            Text(stringResource(R.string.stalow_compare_not_yet), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Text(
                                stringResource(R.string.stalow_compare_found, listOfNotNull(m.title, m.year?.toString()).joinToString(" · ")),
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
                            )
                            TextButton(onClick = { confirm = r }, enabled = !busy) {
                                Text(stringResource(R.string.stalow_compare_delete), color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onDone(changed) }) { Text(stringResource(android.R.string.ok)) } },
    )

    confirm?.let { r ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            text = { Text(stringResource(R.string.stalow_compare_delete_q, r.item.title)) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    busy = true
                    scope.launch {
                        try {
                            DriveLibrary.remove(r.item.id, deleteCopy = true)
                            changed = true
                            context.toast(R.string.stalow_channels_removed)
                        } catch (e: Exception) {
                            context.toast(context.getString(R.string.stalow_failed, e.message ?: e.javaClass.simpleName), long = true)
                        }
                        load()
                    }
                }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }
}
