package com.jtech.zemer.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.jtech.zemer.R
import com.jtech.zemer.playback.Bookmark
import com.jtech.zemer.ui.component.focusBorder
import com.jtech.zemer.utils.makeTimeString

/**
 * Stalow: Home's "Bookmarks" row: the places saved with the player's Bookmark button. A tap carries on
 * from the saved spot; a long press removes the bookmark.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeBookmarksRow(
    bookmarks: List<Bookmark>,
    onOpen: (Bookmark) -> Unit,
    onRemove: (Bookmark) -> Unit,
) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(items = bookmarks, key = { it.id }) { bookmark ->
            Column(
                modifier = Modifier
                    .width(140.dp)
                    .focusBorder()
                    .combinedClickable(onClick = { onOpen(bookmark) }, onLongClick = { onRemove(bookmark) })
                    .padding(4.dp),
            ) {
                AsyncImage(
                    model = bookmark.thumbnailUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(132.dp)
                        .clip(RoundedCornerShape(8.dp)),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = bookmark.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = stringResource(R.string.stalow_bookmark_at, makeTimeString(bookmark.positionMs)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                )
                if (bookmark.artist.isNotBlank()) {
                    Text(
                        text = bookmark.artist,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}
