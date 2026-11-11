package com.jtech.zemer.ui.theme

import androidx.compose.ui.graphics.Color
import com.jtech.zemer.R

/**
 * One selectable entry in Settings -> Theme & Colors' Color Palette row.
 *
 * [seedColor] seeds the whole Material scheme (via materialKolor) when the entry is picked.
 * [Color.Transparent] is the sentinel for the "dynamic" palette, which is not a fixed seed at all:
 * it enables album-art theming (DynamicThemeKey) and is selected/deselected by that flag rather than
 * by matching a color. Every other entry is a concrete accent the user can pin.
 *
 * Color literals deliberately live in `ui/theme/` (exempt from the ui-audit R8-hex ratchet) so the
 * picker screen under `ui/screens/` stays free of hardcoded colors.
 */
data class ThemePalette(
    val nameRes: Int,
    val seedColor: Color,
)

/**
 * Stalow Music's brand: the Stalow website's palette (slate surfaces, Stalow blue) with the logo's mint as the music accent. The seed drives
 * materialKolor's tonal palette; [ZemerTheme] then pins the exact brand colours below for the main roles
 * (accents, backgrounds, surfaces) in both light and dark mode whenever this palette is active.
 */
val BrandThemeColor = Color(0xFF4F7CFF)

// Dark mode: the app icon - deep navy surfaces, mint/cyan accent, electric-blue secondary.
internal val BrandPrimaryDark = Color(0xFF4F7CFF)
internal val BrandOnPrimaryDark = Color(0xFFFFFFFF)
internal val BrandPrimaryContainerDark = Color(0xFF1D2A52)
internal val BrandOnPrimaryContainerDark = Color(0xFFD6E0FF)
internal val BrandSecondaryDark = Color(0xFF3EF2E4)
internal val BrandOnSecondaryDark = Color(0xFF062A2A)
internal val BrandSecondaryContainerDark = Color(0xFF0F3B3C)
internal val BrandOnSecondaryContainerDark = Color(0xFFB8FFF8)
internal val BrandBackgroundDark = Color(0xFF0F1117)
internal val BrandOnBackgroundDark = Color(0xFFE8EAF0)
internal val BrandSurfaceContainerLowestDark = Color(0xFF0B0D12)
internal val BrandSurfaceContainerLowDark = Color(0xFF13151C)
internal val BrandSurfaceContainerDark = Color(0xFF161820)
internal val BrandSurfaceContainerHighDark = Color(0xFF1E2029)
internal val BrandSurfaceContainerHighestDark = Color(0xFF252733)
internal val BrandSurfaceVariantDark = Color(0xFF252733)
internal val BrandOnSurfaceVariantDark = Color(0xFF9DA3B8)
internal val BrandOutlineDark = Color(0xFF3D4058)

// Light mode: the white logo - white surfaces, royal-navy accent, mint secondary.
internal val BrandPrimaryLight = Color(0xFF3A66F0)
internal val BrandOnPrimaryLight = Color(0xFFFFFFFF)
internal val BrandPrimaryContainerLight = Color(0xFFE4EBFF)
internal val BrandOnPrimaryContainerLight = Color(0xFF0D2B8E)
internal val BrandSecondaryLight = Color(0xFF00897A)
internal val BrandOnSecondaryLight = Color(0xFFFFFFFF)
internal val BrandSecondaryContainerLight = Color(0xFFC9F7EF)
internal val BrandOnSecondaryContainerLight = Color(0xFF0B4D43)
internal val BrandBackgroundLight = Color(0xFFF4F5F7)
internal val BrandOnBackgroundLight = Color(0xFF1A1D2E)
internal val BrandSurfaceContainerLowestLight = Color(0xFFFFFFFF)
internal val BrandSurfaceContainerLowLight = Color(0xFFFFFFFF)
internal val BrandSurfaceContainerLight = Color(0xFFF5F6F9)
internal val BrandSurfaceContainerHighLight = Color(0xFFEEF0F4)
internal val BrandSurfaceContainerHighestLight = Color(0xFFE8EAEF)
internal val BrandSurfaceVariantLight = Color(0xFFE8EAEF)
internal val BrandOnSurfaceVariantLight = Color(0xFF4A5068)
internal val BrandOutlineLight = Color(0xFFCFD3DF)

/**
 * Sentinel accent for the "System" palette: Android 12+ wallpaper-based Material You colors. It is not
 * a real seed (real accents are all opaque, 0xFFrrggbb); [ZemerTheme] special-cases this exact value to
 * the platform dynamic scheme. Distinct from [Color.Transparent], which the "dynamic" (album-art) entry
 * uses for display/selection. The picker only offers this entry on devices that support it.
 */
val SystemWallpaperThemeColor = Color(0x00000001)

/**
 * The Color Palette row, in display order: the dynamic (album-art) and System (wallpaper) sentinels, the
 * brand accent (default), then a spectrum of accents. The crimson entry is nudged off [DefaultThemeColor]
 * (0xFFED5564) so no swatch collides with that legacy sentinel.
 */
val PaletteColors: List<ThemePalette> = listOf(
    ThemePalette(R.string.palette_dynamic, Color.Transparent),
    ThemePalette(R.string.palette_system, SystemWallpaperThemeColor),
    ThemePalette(R.string.palette_brand, BrandThemeColor),
    ThemePalette(R.string.palette_crimson, Color(0xFFEC5464)),
    ThemePalette(R.string.palette_rose, Color(0xFFD81B60)),
    ThemePalette(R.string.palette_purple, Color(0xFF8E24AA)),
    ThemePalette(R.string.palette_deep_purple, Color(0xFF5E35B1)),
    ThemePalette(R.string.palette_indigo, Color(0xFF3949AB)),
    ThemePalette(R.string.palette_blue, Color(0xFF1E88E5)),
    ThemePalette(R.string.palette_sky_blue, Color(0xFF039BE5)),
    ThemePalette(R.string.palette_cyan, Color(0xFF00ACC1)),
    ThemePalette(R.string.palette_teal, Color(0xFF00897B)),
    ThemePalette(R.string.palette_green, Color(0xFF43A047)),
    ThemePalette(R.string.palette_light_green, Color(0xFF7CB342)),
    ThemePalette(R.string.palette_lime, Color(0xFFC0CA33)),
    ThemePalette(R.string.palette_yellow, Color(0xFFFDD835)),
    ThemePalette(R.string.palette_amber, Color(0xFFFFB300)),
    ThemePalette(R.string.palette_orange, Color(0xFFFB8C00)),
    ThemePalette(R.string.palette_deep_orange, Color(0xFFF4511E)),
    ThemePalette(R.string.palette_brown, Color(0xFF6D4C41)),
    ThemePalette(R.string.palette_grey, Color(0xFF757575)),
    ThemePalette(R.string.palette_blue_grey, Color(0xFF546E7A)),
)

/**
 * The default accent for a fresh install: the Stalow brand palette, on every device. (System/wallpaper
 * and the other accents stay available in the picker; they are just not the default.) This is the
 * `SelectedThemeColorKey` default when the user has never picked one.
 */
val DefaultAccentColor: Color = BrandThemeColor

/**
 * The palette entries to display. The System (wallpaper) entry is offered only on devices whose
 * platform supports dynamic wallpaper colors (Android 12+); everywhere else it is dropped.
 */
fun visiblePaletteColors(systemDynamicSupported: Boolean): List<ThemePalette> =
    if (systemDynamicSupported) PaletteColors
    else PaletteColors.filterNot { it.seedColor == SystemWallpaperThemeColor }

/**
 * Pure selection logic for the Color Palette row, extracted from the picker so it is unit-testable
 * without an Android runtime. The "dynamic" entry (a [Color.Transparent] seed) is driven by the
 * `dynamicEnabled` flag; every other entry (including the System wallpaper sentinel) by an exact
 * accent match.
 */
object ThemePaletteSelection {
    private val ThemePalette.isDynamic: Boolean get() = seedColor == Color.Transparent

    /** Whether [palette] is the currently active selection given the persisted accent + dynamic flag. */
    fun isSelected(palette: ThemePalette, selectedColor: Color, dynamicEnabled: Boolean): Boolean =
        if (palette.isDynamic) dynamicEnabled else !dynamicEnabled && palette.seedColor == selectedColor

    /**
     * The preference change a tap on [palette] should apply. [seedColor] is the accent to persist, or
     * null to leave the stored accent untouched (the dynamic entry keeps the last accent as its
     * idle/no-artwork fallback). [dynamicEnabled] is the album-art flag to write.
     */
    data class Selection(val seedColor: Color?, val dynamicEnabled: Boolean)

    fun onPicked(palette: ThemePalette): Selection =
        if (palette.isDynamic) Selection(seedColor = null, dynamicEnabled = true)
        else Selection(seedColor = palette.seedColor, dynamicEnabled = false)
}
