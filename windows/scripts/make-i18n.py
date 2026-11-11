#!/usr/bin/env python3
"""Builds renderer/i18n.js: the Windows app's English texts, with the Android app's Hebrew, Yiddish and French
translations where Android has the same text (same key), and Hebrew written for the Windows-only texts.
Run: python3 scripts/make-i18n.py <path to the Android app's res folder>"""
import json, re, sys, html
from pathlib import Path

EN = {
 'home': 'Home', 'search': 'Search', 'artists': 'Artists', 'queue': 'Queue', 'settings': 'Settings', 'back': 'Back',
 'previous': 'Previous', 'next': 'Next', 'play': 'Play', 'pause': 'Pause', 'shuffle': 'Shuffle', 'repeat': 'Repeat', 'radio': 'Radio',
 'now_playing': 'Now playing', 'position': 'Position', 'volume': 'Volume', 'nothing_playing': 'Nothing playing',
 'repeat_mode_off': 'Repeat mode off', 'repeat_mode_one': 'Repeat current song', 'repeat_mode_all': 'Repeat queue',
 'see_all': 'See all', 'welcome': 'Welcome', 'welcome_hint': 'Only approved artists appear in Stalow Music. Pick an artist, or search for a song.',
 'loading': 'Loading…', 'keep_listening': 'Recently played', 'genres': 'Genres', 'your_artists': 'Your artists',
 'stalow_artists_for_you': 'Artists for you', 'show_other_artists': 'Show other artists', 'stalow_search_hint': 'Search songs, artists, albums',
 'search_history': 'Search history', 'remove': 'Remove', 'searching': 'Searching…', 'stalow_top_result': 'Top result',
 'stalow_top_result_artist': 'Artist · you typed “{0}”', 'songs': 'Songs', 'albums': 'Albums', 'playlists': 'Playlists',
 'nothing_matched': 'Nothing by approved artists matched. Try an artist name.', 'search_failed': 'Search failed: {0}. Check your internet connection.',
 'filter_artists_hint': 'Filter {0} approved artists', 'showing_n_of': 'Showing {0} of {1}. Type to narrow down.',
 'artist_not_approved': 'This artist is not in the approved list.', 'stalow_approved_artist': 'Approved artist', 'more': 'More',
 'no_songs_for_artist': 'No songs found for this artist right now.', 'album_not_approved': 'This album has no songs by approved artists.',
 'album': 'Album', 'artist': 'Artist', 'playlist': 'Playlist', 'n_songs_approved': '{0} songs by approved artists',
 'playlist_empty': 'This playlist has no songs by approved artists.', 'queue_empty': 'The queue is empty. Play a song, album or artist.',
 'something_went_wrong': 'Something went wrong: {0}. Check your internet connection and try again.',
 'add_to_queue': 'Add to queue', 'stalow_only_approved': 'Only approved artists appear in results.',
 'choose_first': 'Choose a song, album or artist first, then press Play.', 'error_not_starting': 'YouTube Music did not start playing',
 'error_songs_not_starting': 'Songs are not starting. Check your internet connection, or open Settings > Account > "Show the YouTube player" to see what YouTube is showing.',
 'error_could_not_play': 'Could not play this song', 'error_unknown': 'Unknown error', 'trying_next': 'Trying the next one…',
 'show_player': 'Show the YouTube player', 'update_ready': 'Version {0} is ready.', 'restart_to_update': 'Restart to update',
 'update_downloading': 'Downloading update… {0}%', 'up_to_date': 'Stalow Music is up to date.', 'update_check_failed': 'Could not check for updates: {0}',
 'updates_installed_only': 'Updates work in the installed app.',
 # Now playing / lyrics
 'stalow_lyrics': 'Lyrics', 'lyrics_hidden': 'Lyrics are turned off in Settings > Lyrics.', 'lyrics_not_found': 'Lyrics not found',
 'lyrics_from': 'Lyrics from {0}', 'lyrics_synced': 'synced', 'lyrics_plain': 'not synced',
 # settings: sections
 'appearance': 'Appearance', 'appearance_desc': 'Theme, colours, album art and the Home page',
 'player_and_audio': 'Player and audio', 'player_and_audio_desc': 'Sound, the queue and the player buttons',
 'lyrics_settings_desc': 'Lyrics on Now playing, their sources and how they scroll',
 'content': 'Content', 'content_desc': 'Language and content filters',
 'privacy': 'Privacy', 'privacy_desc': 'Listen and search history',
 'storage': 'Storage', 'storage_desc': 'Cache and recently played',
 'backup_restore': 'Backup and restore', 'backup_restore_desc': 'Save your settings, queue and history to a file, or restore them',
 'account': 'Account', 'account_desc': 'YouTube sign-in and the YouTube player',
 'about': 'About', 'about_desc': 'Version, updates, approved artists and credits',
 # appearance
 'theme': 'Theme', 'theme_desc': 'Dark, light, pure black, or follow Windows',
 'dark_theme_follow_system': 'Follow system', 'dark_theme_on': 'Dark', 'dark_theme_off': 'Light', 'pure_black': 'Pure black',
 'color_palette': 'Colour palette', 'color_palette_desc': 'The accent colour of buttons, links and the active tab',
 'palette_mint': 'Mint', 'palette_sky': 'Sky', 'palette_violet': 'Violet', 'palette_rose': 'Rose', 'palette_amber': 'Amber',
 'album_art': 'Album art', 'crop_album_art': 'Crop album art', 'crop_album_art_desc': 'Fill the square with the picture; off shows the whole picture',
 'hide_album_art': 'Hide album art', 'hide_album_art_desc': 'Show a letter tile instead of pictures everywhere',
 'show_recently_played': 'Show Recently played', 'show_recently_played_desc': 'The songs you played last, first on Home',
 'show_genres': 'Show genres', 'show_genres_desc': 'Genre shortcuts on Home',
 'default_open_tab': 'Default open tab', 'default_open_tab_desc': 'The page the app opens on',
 # player
 'player': 'Player', 'audio_quality': 'Audio quality', 'audio_quality_desc': 'As far as YouTube’s player allows: Low saves data',
 'audio_quality_auto': 'Auto', 'audio_quality_high': 'High', 'audio_quality_low': 'Low',
 'audio_normalization': 'Audio normalization', 'audio_normalization_desc': 'Keep songs at a similar volume',
 'skip_silence': 'Skip silence', 'skip_silence_desc': 'Quiet stretches (long intros, gaps) play fast until the music comes back',
 'progressive_seek': 'Progressive seek', 'progressive_seek_desc': 'Left/Right arrow keys seek 5 s; pressing again quickly seeks further each time',
 'persistent_queue': 'Persistent queue', 'persistent_queue_desc': 'Restore your last queue when the app starts',
 'auto_load_more': 'Auto load more songs', 'auto_load_more_desc': 'Automatically add more songs when the end of the queue is reached, if possible',
 'disable_load_more_when_repeat_all': 'Disable load more when repeat all', 'disable_load_more_when_repeat_all_desc': 'With Repeat queue on, play the same queue again instead of adding songs',
 'auto_skip_next_on_error': 'Auto skip to next song when error occurs', 'auto_skip_next_on_error_desc': 'Ensure your continuous playback experience',
 'player_buttons': 'Player buttons', 'shuffle_desc': 'Play the queue in random order (also the shuffle button in the player bar)',
 'repeat_desc': 'Also the repeat button in the player bar',
 # lyrics
 'show_lyrics': 'Show lyrics', 'show_lyrics_desc': 'Lyrics on the Now playing page (click the song in the player bar)',
 'lyrics_provider_selection': 'Provider selection', 'lyrics_provider_priority': 'Lyrics provider priority',
 'lyrics_provider_priority_desc_windows': 'Turn providers on or off and use the arrows to order them. The first one with the song’s lyrics is used; synced lyrics are preferred.',
 'enable_simpmusic_desc': 'Exact-track community lyrics', 'enable_lrclib_desc': 'Community synced-lyrics database', 'enable_youtube_lyrics_desc': 'The Music lyrics tab; tried last',
 'lyrics_display': 'Display', 'lyrics_text_position': 'Lyrics text position', 'lyrics_text_position_desc': 'Where the lines sit on the page',
 'left': 'Left', 'center': 'Center', 'right': 'Right',
 'lyrics_word_sync': 'Word-by-word lyrics', 'lyrics_word_sync_description': 'Highlight each word as it is sung when the lyrics source provides word timings',
 'lyrics_auto_scroll': 'Auto scroll', 'lyrics_auto_scroll_desc': 'Keep the current line in view',
 'lyrics_sync_offset_title': 'Lyrics timing offset', 'lyrics_sync_offset_desc': 'Move the lyrics earlier (+) or later (−) if they run ahead of or behind the song',
 'move_up': 'Move up', 'move_down': 'Move down',
 # content
 'app_language': 'App language', 'app_language_desc': 'The language of the app and of YouTube Music’s titles', 'system_default': 'System default',
 'content_filters': 'Content filters', 'allow_female_singers': 'Allow female content', 'allow_female_singers_desc': 'Also show approved female singers',
 'block_podcasts': 'Block podcasts', 'block_podcasts_desc': 'Hide podcast episodes everywhere',
 'block_videos': 'Block videos', 'block_videos_desc': 'Never show video pictures: videos play as audio, with a letter tile',
 # privacy
 'listen_history': 'Listen history', 'pause_listen_history': 'Pause listen history', 'pause_listen_history_desc': 'Songs you play are not remembered',
 'history_duration': 'History duration', 'history_duration_desc': 'How long played songs are remembered',
 'days_n': '{0} days', 'one_year': '1 year', 'forever': 'Forever',
 'clear_listen_history': 'Clear listen history', 'songs_in_history': '{0} songs remembered', 'clear': 'Clear',
 'clear_listen_history_confirm': 'Are you sure you want to clear all listen history?',
 'pause_search_history': 'Pause search history', 'pause_search_history_desc': 'Searches are not remembered',
 'clear_search_history': 'Clear search history', 'searches_in_history': '{0} searches remembered',
 'clear_search_history_confirm': 'Are you sure you want to clear all search history?',
 # storage
 'song_cache': 'Song Cache', 'max_cache_size': 'Max cache size', 'max_cache_size_desc': 'Space for songs and pictures kept on this computer (applies after a restart)',
 'clear_cache': 'Clear cache', 'cache_in_use': '{0} in use', 'clear_recently_played': 'Clear Recently played', 'clear_recently_played_desc': 'Empty the Recently played row on Home',
 # backup
 'action_backup': 'Backup', 'action_restore': 'Restore', 'backup_desc': 'Save your settings, queue, listen history and search history to a file',
 'restore_desc': 'Load a backup file; the app reloads with it', 'backup_create_success': 'Backup created successfully',
 'restore_success': 'Backup restored', 'restore_failed': 'Failed to restore backup',
 # account / about
 'youtube_account': 'YouTube account', 'youtube_sign_in': 'YouTube account (optional)',
 'youtube_sign_in_desc': 'Signing in to your own Google account can mean fewer interruptions. The window closes by itself once you are signed in.',
 'sign_in': 'Sign in', 'show_player_desc': 'For troubleshooting: shows the hidden YouTube Music window that plays the songs. Press again to hide it.',
 'show_hide': 'Show / hide', 'updates': 'Updates', 'version_n': 'Version {0}', 'updates_desc': 'Updates install automatically from stalow.netlify.app.',
 'check_for_updates': 'Check for updates', 'approved_artists': 'Approved artists', 'approved_artists_desc': '{0} artists, list version {1}',
 'downloads': 'Downloads', 'downloads_hint': 'Songs saved on this computer. They play without internet.', 'open_folder': 'Open folder',
 'downloads_count': '{0} songs, {1} MB', 'downloads_empty': 'No downloads yet. Open Now playing and press Download to save the song that is playing.',
 'remove_download': 'Delete download', 'remove_download_confirm': 'Delete the download of “{0}”?', 'remove_from_queue': 'Remove from queue',
 'clear_up_next': 'Clear up next', 'play_next': 'Play next', 'downloaded': 'Downloaded', 'download_saving': 'Saving… (press to cancel)',
 'download_saving_hint': 'The song is saved as it plays to the end.', 'action_download': 'Download',
 'download_failed': 'Could not save the song: {0}', 'download_done': 'Song saved. It now plays without internet.',
 'download_stopped': 'The song was not saved because it did not play to the end.', 'stalow_up_next': 'Up next',
 'downloads_folder': 'Downloads folder', 'downloads_folder_desc': 'Saved songs are in Music\\Stalow Music',
 'download_all_saved': 'Already downloaded.', 'download_added': '{0} added to Downloads. They are saved in the background, three at a time.',
 'download_all': 'Download all', 'downloading_n': 'Downloading ({0})', 'try_again': 'Try again', 'cancel_all': 'Cancel all', 'cancel': 'Cancel',
 'downloading_hint': 'Saved in the background by silent players, three at a time; each song takes about its own length. You can keep listening.',
 'download_saving_n': 'Saving… {0} of {1}', 'download_failed_short': 'Not saved ({0})', 'download_waiting': 'Waiting to be saved', 'download_saving_pct': 'Saving… {0}% (press to cancel)',
 'credits': 'Credits', 'credits_desc': 'Based on Zemer by ZemerTeam and Metrolist; free software under the GNU GPL v3.', 'open': 'Open',
}

# Hebrew for the texts the Android app does not have (written for Stalow Music for Windows).
HE = {
 'home': 'בית', 'search': 'חיפוש', 'artists': 'אמנים', 'queue': 'תור', 'settings': 'הגדרות', 'back': 'חזרה',
 'previous': 'הקודם', 'next': 'הבא', 'play': 'נגן', 'pause': 'השהה', 'shuffle': 'ערבוב', 'repeat': 'חזרה על שירים', 'radio': 'רדיו',
 'now_playing': 'מתנגן כעת', 'position': 'מיקום', 'volume': 'עוצמה', 'nothing_playing': 'שום דבר לא מתנגן',
 'see_all': 'הצג הכול', 'welcome': 'ברוכים הבאים', 'welcome_hint': 'רק אמנים מאושרים מופיעים ב-Stalow Music. בחרו אמן, או חפשו שיר.',
 'loading': 'טוען…', 'genres': 'סגנונות', 'your_artists': 'האמנים שלך', 'stalow_artists_for_you': 'אמנים בשבילך', 'show_other_artists': 'הצג אמנים אחרים',
 'stalow_search_hint': 'חיפוש שירים, אמנים, אלבומים', 'remove': 'הסר', 'searching': 'מחפש…', 'stalow_top_result': 'התוצאה המובילה',
 'stalow_top_result_artist': 'אמן · הקלדת „{0}”', 'nothing_matched': 'לא נמצא דבר של אמנים מאושרים. נסו שם של אמן.',
 'search_failed': 'החיפוש נכשל: {0}. בדקו את חיבור האינטרנט.', 'filter_artists_hint': 'סינון {0} אמנים מאושרים', 'showing_n_of': 'מוצגים {0} מתוך {1}. הקלידו כדי לצמצם.',
 'artist_not_approved': 'האמן הזה אינו ברשימה המאושרת.', 'stalow_approved_artist': 'אמן מאושר', 'more': 'עוד', 'no_songs_for_artist': 'לא נמצאו כרגע שירים של האמן הזה.',
 'album_not_approved': 'באלבום הזה אין שירים של אמנים מאושרים.', 'album': 'אלבום', 'artist': 'אמן', 'playlist': 'פלייליסט',
 'n_songs_approved': '{0} שירים של אמנים מאושרים', 'playlist_empty': 'בפלייליסט הזה אין שירים של אמנים מאושרים.', 'queue_empty': 'התור ריק. נגנו שיר, אלבום או אמן.',
 'something_went_wrong': 'משהו השתבש: {0}. בדקו את חיבור האינטרנט ונסו שוב.', 'add_to_queue': 'הוסף לתור', 'stalow_only_approved': 'רק אמנים מאושרים מופיעים בתוצאות.',
 'choose_first': 'בחרו קודם שיר, אלבום או אמן, ואז לחצו נגן.', 'error_not_starting': 'YouTube Music לא התחיל לנגן',
 'error_songs_not_starting': 'השירים לא מתחילים. בדקו את חיבור האינטרנט, או פתחו הגדרות > חשבון > „הצג את נגן YouTube” כדי לראות מה YouTube מציג.',
 'error_could_not_play': 'לא ניתן לנגן את השיר', 'trying_next': 'מנסה את הבא…', 'show_player': 'הצג את נגן YouTube',
 'update_ready': 'גרסה {0} מוכנה.', 'restart_to_update': 'הפעל מחדש לעדכון', 'update_downloading': 'מוריד עדכון… {0}%', 'up_to_date': 'Stalow Music מעודכנת.',
 'update_check_failed': 'לא ניתן לבדוק עדכונים: {0}', 'updates_installed_only': 'עדכונים עובדים באפליקציה המותקנת.',
 'stalow_lyrics': 'מילים', 'lyrics_hidden': 'המילים כבויות בהגדרות > מילים.',
 'appearance_desc': 'ערכת נושא, צבעים, עטיפות ודף הבית', 'player_and_audio_desc': 'צליל, התור וכפתורי הנגן', 'lyrics_settings_desc': 'מילים במסך המתנגן כעת, המקורות שלהן והגלילה',
 'content_desc': 'שפה וסינון תוכן', 'privacy_desc': 'היסטוריית האזנה וחיפוש', 'storage_desc': 'מטמון ונוגנו לאחרונה',
 'backup_restore_desc': 'שמירת ההגדרות, התור וההיסטוריה לקובץ, או שחזורם', 'account_desc': 'התחברות ל-YouTube ונגן YouTube', 'about_desc': 'גרסה, עדכונים, אמנים מאושרים וקרדיטים',
 'theme_desc': 'כהה, בהיר, שחור מלא, או לפי Windows', 'pure_black': 'שחור מלא', 'color_palette': 'פלטת צבעים', 'color_palette_desc': 'צבע ההדגשה של כפתורים, קישורים והלשונית הפעילה',
 'palette_mint': 'מנטה', 'palette_sky': 'שמיים', 'palette_violet': 'סגול', 'palette_rose': 'ורוד', 'palette_amber': 'ענבר',
 'album_art': 'עטיפות', 'crop_album_art_desc': 'למלא את הריבוע בתמונה; כבוי מציג את כל התמונה', 'hide_album_art': 'הסתר עטיפות', 'hide_album_art_desc': 'להציג אות במקום תמונות בכל מקום',
 'show_recently_played': 'הצג נוגנו לאחרונה', 'show_recently_played_desc': 'השירים האחרונים שניגנת, ראשונים בדף הבית', 'show_genres': 'הצג סגנונות', 'show_genres_desc': 'קיצורי סגנונות בדף הבית',
 'default_open_tab_desc': 'הדף שהאפליקציה נפתחת בו', 'audio_quality_desc': 'ככל שנגן YouTube מאפשר: נמוכה חוסכת נתונים', 'audio_normalization_desc': 'לשמור על עוצמה דומה בין שירים',
 'skip_silence_desc': 'קטעים שקטים (פתיחות ארוכות, הפסקות) מתנגנים מהר עד שהמוזיקה חוזרת', 'progressive_seek': 'דילוג מדורג', 'progressive_seek_desc': 'מקשי החצים מדלגים 5 שניות; לחיצה חוזרת מהירה מדלגת יותר בכל פעם',
 'disable_load_more_when_repeat_all': 'בטל טעינת שירים נוספים בחזרה על התור', 'disable_load_more_when_repeat_all_desc': 'כשחזרה על התור פועלת, לנגן שוב את אותו תור במקום להוסיף שירים',
 'player_buttons': 'כפתורי הנגן', 'shuffle_desc': 'לנגן את התור בסדר אקראי (גם כפתור הערבוב בסרגל הנגן)', 'repeat_desc': 'גם כפתור החזרה בסרגל הנגן',
 'show_lyrics': 'הצג מילים', 'show_lyrics_desc': 'מילים בדף המתנגן כעת (לחצו על השיר בסרגל הנגן)',
 'lyrics_provider_priority_desc_windows': 'הפעילו או כבו מקורות וסדרו אותם בעזרת החצים. המקור הראשון שיש לו את המילים משמש; מילים מסונכרנות מועדפות.',
 'lyrics_display': 'תצוגה', 'lyrics_text_position_desc': 'היכן השורות מופיעות בדף', 'left': 'שמאל', 'center': 'מרכז', 'right': 'ימין',
 'lyrics_auto_scroll': 'גלילה אוטומטית', 'lyrics_auto_scroll_desc': 'להשאיר את השורה הנוכחית בתצוגה', 'lyrics_sync_offset_desc': 'להקדים (+) או לאחר (−) את המילים אם הן מקדימות או מאחרות את השיר',
 'move_up': 'הזז למעלה', 'move_down': 'הזז למטה', 'app_language': 'שפת האפליקציה', 'app_language_desc': 'שפת האפליקציה ושל הכותרות ב-YouTube Music', 'system_default': 'ברירת המחדל של המערכת',
 'allow_female_singers_desc': 'להציג גם זמרות מאושרות', 'block_podcasts': 'חסום פודקאסטים', 'block_podcasts_desc': 'להסתיר פרקי פודקאסט בכל מקום', 'block_videos_desc': 'לא להציג תמונות וידאו: סרטונים מתנגנים כשמע, עם אות',
 'pause_listen_history_desc': 'שירים שמנוגנים לא נשמרים', 'history_duration': 'משך ההיסטוריה', 'history_duration_desc': 'כמה זמן שירים שנוגנו נשמרים', 'days_n': '{0} ימים', 'one_year': 'שנה', 'forever': 'לתמיד',
 'songs_in_history': '{0} שירים שמורים', 'clear': 'נקה', 'pause_search_history_desc': 'חיפושים לא נשמרים', 'searches_in_history': '{0} חיפושים שמורים',
 'max_cache_size_desc': 'מקום לשירים ותמונות שנשמרים במחשב (חל אחרי הפעלה מחדש)', 'clear_cache': 'נקה מטמון', 'cache_in_use': '{0} בשימוש',
 'clear_recently_played': 'נקה נוגנו לאחרונה', 'clear_recently_played_desc': 'לרוקן את שורת נוגנו לאחרונה בדף הבית',
 'backup_desc': 'שמירת ההגדרות, התור, היסטוריית ההאזנה והחיפוש לקובץ', 'restore_desc': 'טעינת קובץ גיבוי; האפליקציה נטענת מחדש איתו', 'restore_success': 'הגיבוי שוחזר',
 'youtube_account': 'חשבון YouTube', 'youtube_sign_in': 'חשבון YouTube (לא חובה)', 'youtube_sign_in_desc': 'התחברות לחשבון Google שלך יכולה להפחית הפרעות. החלון נסגר מעצמו אחרי ההתחברות.',
 'sign_in': 'התחבר', 'show_player_desc': 'לפתרון בעיות: מציג את חלון YouTube Music הנסתר שמנגן את השירים. לחצו שוב כדי להסתיר.', 'show_hide': 'הצג / הסתר',
 'updates': 'עדכונים', 'version_n': 'גרסה {0}', 'updates_desc': 'עדכונים מותקנים אוטומטית מ-stalow.netlify.app.', 'check_for_updates': 'בדוק עדכונים',
 'lyrics_from': 'מילים מ-{0}', 'lyrics_synced': 'מסונכרן', 'lyrics_plain': 'לא מסונכרן', 'dark_theme_follow_system': 'לפי המערכת', 'dark_theme_on': 'כהה', 'dark_theme_off': 'בהיר',
 'enable_simpmusic_desc': 'מילים מהקהילה לפי השיר המדויק', 'enable_lrclib_desc': 'מאגר קהילתי של מילים מסונכרנות', 'enable_youtube_lyrics_desc': 'לשונית המילים של YouTube Music; נוסה אחרון',
 'lyrics_word_sync': 'מילים מילה אחר מילה', 'lyrics_word_sync_description': 'להדגיש כל מילה כשהיא מושרת, כשמקור המילים מספק תזמון למילים', 'lyrics_sync_offset_title': 'הזזת תזמון המילים', 'block_videos': 'חסום סרטונים',
 'downloads': 'הורדות', 'downloads_hint': 'שירים שנשמרו במחשב. הם מתנגנים גם בלי אינטרנט.', 'open_folder': 'פתח תיקייה',
 'downloads_count': '{0} שירים, {1} MB', 'downloads_empty': 'אין עדיין הורדות. פתחו את מתנגן כעת ולחצו הורדה כדי לשמור את השיר שמתנגן.',
 'remove_download': 'מחק הורדה', 'remove_download_confirm': 'למחוק את ההורדה של „{0}”?', 'remove_from_queue': 'הסר מהתור',
 'clear_up_next': 'נקה את הבאים בתור', 'play_next': 'נגן הבא', 'downloaded': 'הורד', 'download_saving': 'שומר… (לחצו לביטול)',
 'download_saving_hint': 'השיר נשמר בזמן שהוא מתנגן עד הסוף.', 'action_download': 'הורדה',
 'download_failed': 'לא ניתן לשמור את השיר: {0}', 'download_done': 'השיר נשמר. עכשיו הוא מתנגן גם בלי אינטרנט.',
 'download_stopped': 'השיר לא נשמר כי הוא לא התנגן עד הסוף.', 'stalow_up_next': 'הבאים בתור',
 'downloads_folder': 'תיקיית ההורדות', 'downloads_folder_desc': 'שירים שמורים נמצאים ב-Music\\Stalow Music',
 'download_all_saved': 'כבר הורד.', 'download_added': '{0} נוספו להורדות. הם נשמרים ברקע, שלושה בכל פעם.',
 'download_all': 'הורד הכול', 'downloading_n': 'בהורדה ({0})', 'try_again': 'נסה שוב', 'cancel_all': 'בטל הכול', 'cancel': 'ביטול',
 'downloading_hint': 'נשמרים ברקע על ידי נגנים שקטים, שלושה בכל פעם; כל שיר לוקח בערך את אורכו. אפשר להמשיך להאזין.',
 'download_saving_n': 'שומר… {0} מתוך {1}', 'download_failed_short': 'לא נשמר ({0})', 'download_waiting': 'ממתין לשמירה', 'download_saving_pct': 'שומר… {0}% (לחצו לביטול)',
 'approved_artists': 'אמנים מאושרים', 'approved_artists_desc': '{0} אמנים, גרסת רשימה {1}', 'credits': 'קרדיטים', 'credits_desc': 'מבוסס על Zemer של ZemerTeam ועל Metrolist; תוכנה חופשית לפי GNU GPL v3.', 'open': 'פתח',
}

def android(res, folder):
    out = {}
    for f in (Path(res) / folder).glob('*strings*.xml'):
        for m in re.finditer(r'<string name="([a-z0-9_]+)"[^>]*>(.*?)</string>', f.read_text(encoding='utf8'), re.S):
            v = html.unescape(m.group(2)).replace("\\'", "'").replace('\\"', '"').replace('\\n', '\n')
            v = re.sub(r'%(\d)\$[sd]', lambda x: '{%d}' % (int(x.group(1)) - 1), v).replace('%s', '{0}').replace('%d', '{0}')
            out[m.group(1)] = v.strip()
    return out

res = sys.argv[1]
langs = {'en': EN}
# The Android app has Hebrew; its Yiddish is empty and its French covers only part of these texts, so the
# Windows app offers English and Hebrew.
for code, folder, extra in (('iw', 'values-iw', HE),):
    tr = android(res, folder)
    langs[code] = {k: tr[k] for k in EN if k in tr}
    langs[code].update({k: v for k, v in extra.items() if k not in langs[code]})
out = Path(__file__).resolve().parent.parent / 'renderer' / 'i18n.js'
counts = {k: len(v) for k, v in langs.items()}
out.write_text(
    "'use strict';\n// Generated by scripts/make-i18n.py from the Android app's translations - edit the script, not this file.\n"
    "// English is complete; a text missing in another language shows in English.\n"
    f"const STRINGS = {json.dumps(langs, ensure_ascii=False, indent=0, sort_keys=True)};\n"
    "const RTL = ['iw'];\nlet LANG = 'en';\n"
    "/** The UI language: a setting (en, iw) or 'system' (the Windows language). */\n"
    "function setLanguage(setting, systemLocale) {\n"
    "  const sys = String(systemLocale || navigator.language || 'en').toLowerCase();\n"
    "  const fromSystem = sys.startsWith('he') || sys.startsWith('iw') ? 'iw' : 'en';\n"
    "  LANG = setting && setting !== 'system' && STRINGS[setting] ? setting : fromSystem;\n"
    "  document.documentElement.lang = LANG === 'iw' ? 'he' : LANG;\n"
    "  document.documentElement.dir = RTL.includes(LANG) ? 'rtl' : 'ltr';\n"
    "}\n"
    "/** A text in the current language, with {0}, {1}... filled in. */\n"
    "function t(key, ...args) {\n"
    "  const s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;\n"
    "  return s.replace(/\\{(\\d)\\}/g, (_, i) => (args[i] !== undefined ? String(args[i]) : ''));\n"
    "}\n", encoding='utf8')
print('written', out, counts)
missing = [k for k in EN if k not in langs['iw']]
print('hebrew missing:', missing)
