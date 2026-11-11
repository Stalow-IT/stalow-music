package com.jtech.zemer.viewmodels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jtech.zemer.db.MusicDatabase
import com.jtech.zemer.db.entities.PodcastWhitelistEntity
import com.jtech.zemer.utils.ContentFilterState
import com.jtech.zemer.utils.StalowChannels
import com.jtech.zemer.utils.SyncUtils
import com.jtech.zemer.utils.allowsFemale
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One category's approved channels (Shiurim or Videos, see [StalowChannels]) for its browse grid. The rows
 * come from the channel allow-set table, so the female and kid gates match the Podcasts grid.
 */
abstract class ApprovedChannelsViewModel(
    database: MusicDatabase,
    private val syncUtils: SyncUtils,
    category: StalowChannels.Category,
) : ViewModel() {
    val searchQuery = MutableStateFlow("")

    val isSyncing = syncUtils.isPodcastWhitelistSyncing

    // Null until the first DB emission so the screen can shimmer instead of flashing "empty".
    val channels: StateFlow<List<PodcastWhitelistEntity>?> =
        combine(
            database.allWhitelistedPodcastsByName(),
            searchQuery,
            ContentFilterState.state,
        ) { all: List<PodcastWhitelistEntity>, query, filters ->
            filterCategory(all, StalowChannels.ids(category), query, filters.allowsFemale())
        }.stateIn(viewModelScope, SharingStarted.Lazily, null)

    fun sync() {
        viewModelScope.launch(Dispatchers.IO) {
            syncUtils.syncPodcastWhitelist(forceSync = true)
        }
    }

    companion object {
        /** The rows of one category: listed in it, past the female and kid gates, matching the search. */
        internal fun filterCategory(
            all: List<PodcastWhitelistEntity>,
            categoryIds: Set<String>,
            query: String,
            allowFemale: Boolean,
        ): List<PodcastWhitelistEntity> =
            all.filter { it.channelId in categoryIds }
                .filter { !it.isFemale || allowFemale }
                .filter { !it.isKidZone }
                .filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
    }
}

@HiltViewModel
class ShiurimViewModel @Inject constructor(
    database: MusicDatabase,
    syncUtils: SyncUtils,
) : ApprovedChannelsViewModel(database, syncUtils, StalowChannels.Category.SHIURIM)

@HiltViewModel
class VideoChannelsViewModel @Inject constructor(
    database: MusicDatabase,
    syncUtils: SyncUtils,
) : ApprovedChannelsViewModel(database, syncUtils, StalowChannels.Category.VIDEOS)
