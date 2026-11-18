package com.jtech.zemer.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import coil3.compose.AsyncImage
import com.jtech.zemer.LocalPlayerAwareWindowInsets
import com.jtech.zemer.LocalPlayerConnection
import com.jtech.zemer.R
import com.jtech.zemer.extensions.toMediaItem
import com.jtech.zemer.extensions.toast
import com.jtech.zemer.playback.Bookmarks
import com.jtech.zemer.playback.BookmarksKey
import com.jtech.zemer.tracking.PlaySource
import com.jtech.zemer.playback.queues.ListQueue
import com.jtech.zemer.ui.component.BackNavigationIcon
import com.jtech.zemer.ui.component.AppBarTitle
import com.jtech.zemer.ui.component.zemerTopAppBarColors
import com.jtech.zemer.utils.makeTimeString
import com.jtech.zemer.utils.rememberPreference

/** The side menu's Bookmarks: the places saved with the player's Bookmark button. Tap = carry on from there. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookmarksScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
) {
    val context = LocalContext.current
    val playerConnection = LocalPlayerConnection.current ?: return
    var json by rememberPreference(BookmarksKey, "")
    val bookmarks = remember(json) { Bookmarks.decode(json) }

    if (bookmarks.isEmpty()) {
        Text(
            stringResource(R.string.stalow_bookmarks_empty),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.windowInsetsPadding(LocalPlayerAwareWindowInsets.current).padding(24.dp),
        )
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize().windowInsetsPadding(LocalPlayerAwareWindowInsets.current),
        ) {
            items(bookmarks, key = { it.id }) { b ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            playerConnection.playQueue(
                                ListQueue(
                                    title = b.title,
                                    items = listOf(b.toMediaMetadata().toMediaItem()),
                                    position = b.positionMs,
                                    playSource = if (b.isEpisode) PlaySource.podcast(null) else PlaySource.OTHER,
                                ),
                            )
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    AsyncImage(
                        model = b.thumbnailUrl,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        placeholder = painterResource(R.drawable.bookmark),
                        error = painterResource(R.drawable.bookmark),
                        modifier = Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                        Text(b.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOf(b.artist.takeIf { it.isNotBlank() }, stringResource(R.string.stalow_bookmark_at, makeTimeString(b.positionMs)))
                                .filterNotNull().joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = {
                        json = Bookmarks.encode(Bookmarks.remove(bookmarks, b.id))
                        context.toast(R.string.stalow_bookmark_removed)
                    }) {
                        Icon(painterResource(R.drawable.delete), contentDescription = stringResource(R.string.stalow_bookmark_remove))
                    }
                }
            }
        }
    }

    TopAppBar(
        title = { AppBarTitle(stringResource(R.string.stalow_bookmarks)) },
        navigationIcon = { BackNavigationIcon(navController) },
        scrollBehavior = scrollBehavior,
        colors = zemerTopAppBarColors(),
    )
}
