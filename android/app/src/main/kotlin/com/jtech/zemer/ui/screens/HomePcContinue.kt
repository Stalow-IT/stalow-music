package com.jtech.zemer.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.jtech.zemer.R
import com.jtech.zemer.extensions.toMediaItem
import com.jtech.zemer.pcsync.PcSync
import com.jtech.zemer.pcsync.PcSyncNowPlaying
import com.jtech.zemer.playback.queues.ListQueue
import org.json.JSONObject

/** The newest session another device (the PC) is playing, if it is newer than what this phone last played. */
fun pcContinueOffer(sessions: List<JSONObject>, now: Long = System.currentTimeMillis()): JSONObject? {
    val mine = maxOf(PcSyncNowPlaying.session?.optLong("at") ?: 0L, PcSyncNowPlaying.continuedAt)
    return sessions.filter { s ->
        val q = s.optJSONArray("queue")
        q != null && q.length() > 0 && s.optLong("at") > mine && now - s.optLong("at") < 2 * 86_400_000L
    }.maxByOrNull { it.optLong("at") }
}

/** Plays the other device's queue from the same song and position. */
fun pcContinueQueue(offer: JSONObject): ListQueue {
    PcSyncNowPlaying.continuedAt = offer.optLong("at")
    val q = offer.getJSONArray("queue")
    val items = (0 until q.length()).mapNotNull { i -> runCatching { PcSync.metadataOf(q.getJSONObject(i)).toMediaItem() }.getOrNull() }
    val index = offer.optInt("index", 0).coerceIn(0, (items.size - 1).coerceAtLeast(0))
    return ListQueue(items = items, startIndex = index, position = offer.optLong("time", 0L) * 1000L)
}

/** Home: "Continue from PC" card (Settings > Sync with your PC). */
@Composable
fun HomePcContinueCard(offer: JSONObject, onContinue: () -> Unit, modifier: Modifier = Modifier) {
    val q = offer.getJSONArray("queue")
    val cur = q.getJSONObject(offer.optInt("index", 0).coerceIn(0, q.length() - 1))
    val artists = cur.optJSONArray("artists")?.let { a -> (0 until a.length()).joinToString(", ") { a.getJSONObject(it).optString("name") } }.orEmpty()
    Card(
        modifier = modifier.fillMaxWidth().clickable(onClick = onContinue),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = cur.optString("thumbnail").ifEmpty { null },
                contentDescription = null,
                contentScale = ContentScale.Crop,
                placeholder = painterResource(R.drawable.music_note),
                error = painterResource(R.drawable.music_note),
                modifier = Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                Text(
                    stringResource(R.string.continue_from_device, offer.optString("device").ifEmpty { "PC" }).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(cur.optString("title"), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (artists.isNotEmpty()) Text(artists, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(8.dp))
            Button(onClick = onContinue) {
                Icon(painterResource(R.drawable.play), null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.continue_action))
            }
        }
    }
}
