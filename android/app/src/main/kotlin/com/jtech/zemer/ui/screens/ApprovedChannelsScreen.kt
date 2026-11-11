package com.jtech.zemer.ui.screens

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
) {
    val menuState = LocalMenuState.current
    var viewType by rememberEnumPreference(PodcastViewTypeKey, LibraryViewType.GRID)
    val channels by viewModel.channels.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()

    BrowseScreenScaffold(
        navController = navController,
        scrollBehavior = scrollBehavior,
        items = channels.orEmpty(),
        isLoading = channels == null,
        shimmerThumbnailShape = RoundedCornerShape(ThumbnailCornerRadius),
        itemKey = { it.channelId },
        itemName = { it.name },
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
        listItemContent = { _, channel, modifier ->
            WhitelistedPodcastListItem(
                navController = navController,
                menuState = menuState,
                modifier = modifier,
                podcast = channel,
            )
        },
        gridItemContent = { _, channel, modifier ->
            WhitelistedPodcastGridItem(
                navController = navController,
                menuState = menuState,
                modifier = modifier,
                podcast = channel,
            )
        },
    )
}
