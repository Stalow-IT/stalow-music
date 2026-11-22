package com.jtech.zemer.accounts

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.stringPreferencesKey
import com.jtech.zemer.R
import com.jtech.zemer.utils.rememberEnumPreference

/**
 * Stalow: where the lists' content comes from. Google Drive folders and files (Settings > Google Drive) are mixed
 * into the usual lists — artist pages, search, Podcasts / Shiurim / Videos, Home — and these chips on top narrow
 * a list to one source. One choice for the whole app.
 */
enum class SourceFilter {
    ALL, YOUTUBE, DRIVE;

    val showsYouTube get() = this != DRIVE
    val showsDrive get() = this != YOUTUBE
}

val SourceFilterKey = stringPreferencesKey("stalowSourceFilter")

/** The chips, shown only when there is something from Google Drive to filter. */
@Composable
fun SourceFilterChips(modifier: Modifier = Modifier) {
    val items by DriveLibrary.items.collectAsState()
    if (items.isEmpty()) return
    var filter by rememberEnumPreference(SourceFilterKey, SourceFilter.ALL)
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        for ((value, label) in listOf(
            SourceFilter.ALL to R.string.stalow_cat_all,
            SourceFilter.YOUTUBE to R.string.stalow_source_youtube,
            SourceFilter.DRIVE to R.string.stalow_drive,
        )) {
            FilterChip(selected = filter == value, onClick = { filter = value }, label = { Text(stringResource(label)) })
        }
    }
}

/** The current choice. */
@Composable
fun rememberSourceFilter(): SourceFilter {
    val filter by rememberEnumPreference(SourceFilterKey, SourceFilter.ALL)
    return filter
}

/** Drive folders and files whose name or files match [query] (search). */
fun driveSearch(query: String): Pair<List<DriveLibrary.Item>, List<Pair<DriveLibrary.Item, DriveLibrary.DriveFile>>> {
    val q = query.trim().lowercase()
    if (q.length < 2) return emptyList<DriveLibrary.Item>() to emptyList()
    val all = DriveLibrary.items.value
    val folders = all.filter { it.isFolder && it.title.lowercase().contains(q) }
    val files = all.flatMap { d -> d.files.filter { f -> f.name.lowercase().contains(q) }.map { d to it } }.take(30)
    return folders to files
}
