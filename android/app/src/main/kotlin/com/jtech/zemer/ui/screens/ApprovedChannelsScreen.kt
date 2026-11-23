package com.jtech.zemer.ui.screens

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavController
import com.jtech.zemer.R
import com.jtech.zemer.constants.LibraryViewType
import com.jtech.zemer.constants.PodcastViewTypeKey
import com.jtech.zemer.constants.ThumbnailCornerRadius
import com.jtech.zemer.ui.component.BrowseScreenScaffold
import com.jtech.zemer.ui.component.LocalMenuState
import com.jtech.zemer.ui.component.WhitelistedPodcastGridItem
import com.jtech.zemer.ui.component.WhitelistedPodcastListItem
import com.jtech.zemer.utils.rememberEnumPreference
import com.jtech.zemer.viewmodels.ApprovedChannelsViewModel
import com.jtech.zemer.viewmodels.ShiurimViewModel
import com.jtech.zemer.viewmodels.VideoChannelsViewModel

/** The Shiurim browse grid: the approved shiurim channels; a tile opens the channel's page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShiurimScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    viewModel: ShiurimViewModel = hiltViewModel(),
) = ApprovedChannelsScreen(
    navController = navController,
    scrollBehavior = scrollBehavior,
    viewModel = viewModel,
    titleRes = R.string.shiurim,
    emptyIconRes = R.drawable.genre_menu_book,
    emptyTextRes = R.string.shiurim_empty,
    searchPlaceholderRes = R.string.search_shiurim,
    driveCategory = "shiurim",
)

/** The Videos browse grid: the approved video channels; a tile opens the channel's page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoChannelsScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    viewModel: VideoChannelsViewModel = hiltViewModel(),
) = ApprovedChannelsScreen(
    navController = navController,
    scrollBehavior = scrollBehavior,
    viewModel = viewModel,
    titleRes = R.string.videos,
    emptyIconRes = R.drawable.ondemand_video,
    emptyTextRes = R.string.video_channels_empty,
    searchPlaceholderRes = R.string.search_video_channels,
    driveCategory = "videos",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ApprovedChannelsScreen(
    navController: NavController,
    scrollBehavior: TopAppBarScrollBehavior,
    viewModel: ApprovedChannelsViewModel,
    titleRes: Int,
    emptyIconRes: Int,
    emptyTextRes: Int,
    searchPlaceholderRes: Int,
    driveCategory: String,
) {
    val menuState = LocalMenuState.current
    // Stalow: Google Drive folders put in this section are listed with the channels (the chips narrow the list)
    val sourceFilter = com.jtech.zemer.accounts.rememberSourceFilter()
    val driveAll by com.jtech.zemer.accounts.DriveLibrary.items.collectAsState()
    var viewType by rememberEnumPreference(PodcastViewTypeKey, LibraryViewType.GRID)
    val channels by viewModel.channels.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()

    val driveFolders = remember(driveAll, searchQuery) {
        driveAll.filter { it.category == driveCategory && it.artistId == null && (searchQuery.isBlank() || it.title.contains(searchQuery.trim(), ignoreCase = true)) }
    }
    val mixedItems: List<Any> = (if (sourceFilter.showsYouTube) channels.orEmpty() else emptyList<Any>()) +
        (if (sourceFilter.showsDrive) driveFolders else emptyList())
    BrowseScreenScaffold(
        navController = navController,
        scrollBehavior = scrollBehavior,
        items = mixedItems,
        isLoading = channels == null,
        shimmerThumbnailShape = RoundedCornerShape(ThumbnailCornerRadius),
        itemKey = { if (it is com.jtech.zemer.accounts.DriveLibrary.Item) "drive_" + it.id else (it as com.jtech.zemer.db.entities.PodcastWhitelistEntity).channelId },
        itemName = { if (it is com.jtech.zemer.accounts.DriveLibrary.Item) it.title else (it as com.jtech.zemer.db.entities.PodcastWhitelistEntity).name },
        topSections = { com.jtech.zemer.accounts.SourceFilterChips() },
        viewType = viewType,
        onToggleViewType = { viewType = viewType.toggle() },
        searchQuery = searchQuery,
        onSearchQueryChange = { viewModel.searchQuery.value = it },
        onRefresh = { viewModel.sync() },
        titleRes = titleRes,
        emptyIconRes = emptyIconRes,
        emptyTextRes = emptyTextRes,
        isSyncing = viewModel.isSyncing,
        countPluralRes = R.plurals.n_channel,
        searchPlaceholderRes = searchPlaceholderRes,
        listItemContent = { _, entry, modifier ->
            if (entry is com.jtech.zemer.accounts.DriveLibrary.Item) {
                com.jtech.zemer.accounts.DriveListItem(entry, modifier) { navController.navigate("drive/${entry.id}") }
            } else WhitelistedPodcastListItem(
                navController = navController,
                menuState = menuState,
                modifier = modifier,
                podcast = entry as com.jtech.zemer.db.entities.PodcastWhitelistEntity,
            )
        },
        gridItemContent = { _, entry, modifier ->
            if (entry is com.jtech.zemer.accounts.DriveLibrary.Item) {
                com.jtech.zemer.accounts.DriveCard(entry, modifier) { navController.navigate("drive/${entry.id}") }
            } else WhitelistedPodcastGridItem(
                navController = navController,
                menuState = menuState,
                modifier = modifier,
                podcast = entry as com.jtech.zemer.db.entities.PodcastWhitelistEntity,
            )
        },
    )
}
