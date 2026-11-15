'use strict';
/* global stalow, el, t, icon, S, setSetting, views, go, clearHistory, clearSearches, listenHistory, searches, state, saveSession */
// Settings, laid out like the Android app: a list of sections (icon, title, short description); each section is a
// page of rows with a title, a short description and its control. Values are stored by the main process.

const CATEGORIES = [
  ['appearance', 'palette', 'appearance', 'appearance_desc'],
  ['player', 'audio', 'player_and_audio', 'player_and_audio_desc'],
  ['lyrics', 'lyrics', 'stalow_lyrics', 'lyrics_settings_desc'],
  ['content', 'content', 'content', 'content_desc'],
  ['privacy', 'privacy', 'privacy', 'privacy_desc'],
  ['storage', 'storage', 'storage', 'storage_desc'],
  ['sync', 'sync', 'sync_title', 'sync_desc'],
  ['backup', 'backup', 'backup_restore', 'backup_restore_desc'],
  ['account', 'account', 'account', 'account_desc'],
  ['about', 'about', 'about', 'about_desc'],
];

// ---------- row builders ----------
function row(title, desc, control, { block = false } = {}) {
  return el('div', { class: 'item' + (block ? ' block' : '') },
    el('div', { class: 'grow' }, el('div', {}, el('div', { class: 'it', text: title }), desc ? el('div', { class: 'id', text: desc }) : '')),
    control ? el('div', { class: 'ctl' }, control) : '');
}
function toggle(key, title, desc) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': title });
  input.checked = !!S[key];
  input.addEventListener('change', () => setSetting(key, input.checked).catch((e) => { input.checked = !!S[key]; alert(e.message); }));
  return row(title, desc, el('label', { class: 'switch' }, input, el('span')));
}
function select(key, title, desc, options, { onChange } = {}) {
  const s = el('select', { 'aria-label': title }, options.map(([v, label]) => el('option', { value: String(v), text: label })));
  s.value = String(S[key]);
  s.addEventListener('change', async () => {
    const raw = options.find(([v]) => String(v) === s.value)[0];
    await setSetting(key, raw);
    if (onChange) onChange(raw);
  });
  return row(title, desc, s);
}
function button(title, desc, label, action, { danger = false } = {}) {
  const b = el('button', { class: 'btn ' + (danger ? 'danger' : 'secondary'), text: label });
  b.addEventListener('click', async () => { b.disabled = true; try { await action(b); } finally { b.disabled = false; } });
  return row(title, desc, b);
}
function group(title, ...rows) { return el('div', { class: 'group' }, title ? el('div', { class: 'group-title', text: title }) : '', rows.flat()); }
function confirmThen(question, fn) { return async (b) => { if (window.confirm(question)) await fn(b); }; }
const page = (titleKey, ...groups) => document.getElementById('view').replaceChildren(el('h1', { text: t(titleKey) }), el('div', { class: 'settings' }, groups));
const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;

// ---------- the list of sections ----------
views.settings = async () => {
  Object.assign(S, await stalow.settings());
  document.getElementById('view').replaceChildren(el('h1', { text: t('settings') }), el('div', { class: 'settings' },
    el('div', { class: 'group' }, CATEGORIES.map(([id, ic, title, desc]) => el('button', { class: 'item category', onclick: () => go('settingsPage', id) },
      el('div', { class: 'grow' }, el('span', { class: 'icon' }, icon(ic)), el('div', {}, el('div', { class: 'it', text: t(title) }), el('div', { class: 'id', text: t(desc) }))),
      icon('chevron'))))));
};

// ---------- each section ----------
const PAGES = {
  appearance: () => page('appearance',
    group(t('theme'),
      select('theme', t('theme'), t('theme_desc'), [['system', t('dark_theme_follow_system')], ['dark', t('dark_theme_on')], ['light', t('dark_theme_off')], ['black', t('pure_black')]]),
      select('palette', t('color_palette'), t('color_palette_desc'), [['stalow', 'Stalow blue'], ['mint', t('palette_mint')], ['sky', t('palette_sky')], ['violet', t('palette_violet')], ['rose', t('palette_rose')], ['amber', t('palette_amber')]])),
    group(t('album_art'),
      toggle('cropAlbumArt', t('crop_album_art'), t('crop_album_art_desc')),
      toggle('hideAlbumArt', t('hide_album_art'), t('hide_album_art_desc'))),
    group(t('home'),
      toggle('showRecentlyPlayed', t('show_recently_played'), t('show_recently_played_desc')),
      toggle('showGenres', t('show_genres'), t('show_genres_desc')),
      select('startPage', t('default_open_tab'), t('default_open_tab_desc'), [['home', t('home')], ['search', t('search')], ['artists', t('artists')], ['queue', t('queue')]]))),

  player: () => page('player_and_audio',
    group(t('player'),
      select('audioQuality', t('audio_quality'), t('audio_quality_desc'), [['auto', t('audio_quality_auto')], ['high', t('audio_quality_high')], ['low', t('audio_quality_low')]]),
      toggle('audioNormalization', t('audio_normalization'), t('audio_normalization_desc')),
      toggle('skipSilence', t('skip_silence'), t('skip_silence_desc')),
      toggle('progressiveSeek', t('progressive_seek'), t('progressive_seek_desc'))),
    group(t('queue'),
      toggle('persistentQueue', t('persistent_queue'), t('persistent_queue_desc')),
      toggle('videoFirst', t('video_first'), t('video_first_desc')),
      toggle('autoLoadMore', t('auto_load_more'), t('auto_load_more_desc')),
      toggle('disableLoadMoreWhenRepeatAll', t('disable_load_more_when_repeat_all'), t('disable_load_more_when_repeat_all_desc')),
      toggle('autoSkipNextOnError', t('auto_skip_next_on_error'), t('auto_skip_next_on_error_desc'))),
    group(t('player_buttons'),
      toggle('shuffle', t('shuffle'), t('shuffle_desc')),
      select('repeat', t('repeat'), t('repeat_desc'), [['off', t('repeat_mode_off')], ['all', t('repeat_mode_all')], ['one', t('repeat_mode_one')]]))),

  lyrics: () => page('stalow_lyrics',
    group('',
      toggle('showLyrics', t('show_lyrics'), t('show_lyrics_desc'))),
    group(t('lyrics_provider_selection'), providerEditor()),
    group(t('lyrics_display'),
      select('lyricsPosition', t('lyrics_text_position'), t('lyrics_text_position_desc'), [['left', t('left')], ['center', t('center')], ['right', t('right')]]),
      toggle('lyricsWordSync', t('lyrics_word_sync'), t('lyrics_word_sync_description')),
      toggle('lyricsAutoScroll', t('lyrics_auto_scroll'), t('lyrics_auto_scroll_desc')),
      offsetRow())),

  content: () => page('content',
    group(t('app_language'),
      select('language', t('app_language'), t('app_language_desc'), [['system', t('system_default')], ['en', 'English'], ['iw', 'עברית']], { onChange: () => go('settingsPage', 'content', false) })),
    group(t('content_filters'),
      toggle('allowFemale', t('allow_female_singers'), t('allow_female_singers_desc')),
      toggle('blockPodcasts', t('block_podcasts'), t('block_podcasts_desc')),
      toggle('blockVideos', t('block_videos'), t('block_videos_desc')))),

  privacy: () => page('privacy',
    group(t('listen_history'),
      toggle('pauseListenHistory', t('pause_listen_history'), t('pause_listen_history_desc')),
      select('historyDays', t('history_duration'), t('history_duration_desc'), [[7, t('days_n', 7)], [30, t('days_n', 30)], [90, t('days_n', 90)], [365, t('one_year')], [0, t('forever')]]),
      button(t('clear_listen_history'), t('songs_in_history', listenHistory.length), t('clear'), confirmThen(t('clear_listen_history_confirm'), async () => { await clearHistory(); PAGES.privacy(); }), { danger: true })),
    group(t('search_history'),
      toggle('pauseSearchHistory', t('pause_search_history'), t('pause_search_history_desc')),
      button(t('clear_search_history'), t('searches_in_history', searches.length), t('clear'), confirmThen(t('clear_search_history_confirm'), async () => { await clearSearches(); PAGES.privacy(); }), { danger: true }))),

  storage: async () => {
    const size = await stalow.cacheSize().catch(() => 0);
    page('storage',
      group(t('song_cache'),
        select('maxCacheMB', t('max_cache_size'), t('max_cache_size_desc'), [128, 256, 512, 1024, 2048, 4096].map((v) => [v, v >= 1024 ? `${v / 1024} GB` : `${v} MB`])),
        button(t('clear_cache'), t('cache_in_use', mb(size)), t('clear'), async () => { await stalow.clearCache(); PAGES.storage(); }, { danger: true })),
      group(t('downloads'),
        button(t('downloads_folder'), t('downloads_folder_desc'), t('open_folder'), () => stalow.openDownloadsFolder())),
      group(t('keep_listening'),
        button(t('clear_recently_played'), t('clear_recently_played_desc'), t('clear'), confirmThen(t('clear_listen_history_confirm'), async () => { await clearHistory(); PAGES.storage(); }), { danger: true })));
  },

  backup: () => page('backup_restore',
    group('',
      button(t('action_backup'), t('backup_desc'), t('action_backup'), async () => {
        const r = await stalow.exportBackup({});
        if (r && r.file) alert(t('backup_create_success'));
      }),
      button(t('action_restore'), t('restore_desc'), t('action_restore'), async () => {
        try {
          const r = await stalow.importBackup();
          if (r && r.restored) { alert(t('restore_success')); await startApp(); } // eslint-disable-line no-undef
        } catch (e) { alert(t('restore_failed') + ': ' + e.message); }
      }))),

  sync: async () => {
    const info = await stalow.syncInfo().catch(() => ({ state: 'off' }));
    syncInfo = info; // eslint-disable-line no-undef
    const when = info.lastSync ? new Date(info.lastSync).toLocaleString() : t('never');
    if (!info.code) {
      const input = el('input', { class: 'searchbox', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', 'aria-label': t('sync_code'), maxlength: '35' });
      return page('sync_title',
        group('', el('div', { class: 'item block' }, el('div', {}, el('div', { class: 'it', text: t('sync_title') }), el('div', { class: 'id', text: t('sync_explain') })))),
        group(t('sync_first_device'),
          button(t('sync_create'), t('sync_create_desc'), t('sync_create_button'), async () => { await stalow.syncCreate(); PAGES.sync(); })),
        group(t('sync_other_device'),
          el('div', { class: 'item block' },
            el('div', {}, el('div', { class: 'it', text: t('sync_enter') }), el('div', { class: 'id', text: t('sync_enter_desc') })),
            el('div', { class: 'actions' }, input, el('button', { class: 'btn', text: t('sync_join'), onclick: async () => {
              try { await stalow.syncJoin(input.value); PAGES.sync(); } catch (e) { alert(e.message); }
            } })))));
    }
    page('sync_title',
      group(t('sync_code'),
        el('div', { class: 'item block' },
          el('div', {}, el('div', { class: 'it', text: t('sync_your_code') }), el('div', { class: 'id', text: t('sync_your_code_desc') })),
          el('div', { class: 'actions' }, el('div', { class: 'sync-code mono', text: info.code }),
            el('button', { class: 'btn secondary', text: t('copy'), onclick: () => navigator.clipboard.writeText(info.code).then(() => alert(t('copied'))) })))),
      group(t('sync_status'),
        button(info.state === 'error' ? t('sync_error', info.error) : info.state === 'syncing' ? t('syncing') : t('sync_last', when), t('sync_what'), t('sync_now'), async () => { await stalow.syncNow(); PAGES.sync(); })),
      group('',
        button(t('sync_stop'), t('sync_stop_desc'), t('sync_stop_button'), confirmThen(t('sync_stop_confirm'), async () => { await stalow.syncLeave(false); PAGES.sync(); })),
        button(t('sync_erase'), t('sync_erase_desc'), t('sync_erase_button'), confirmThen(t('sync_erase_confirm'), async () => { await stalow.syncLeave(true); PAGES.sync(); }), { danger: true })));
  },

  account: () => page('account',
    group(t('youtube_account'),
      button(t('youtube_sign_in'), t('youtube_sign_in_desc'), t('sign_in'), () => stalow.signIn()),
      button(t('show_player'), t('show_player_desc'), t('show_hide'), () => stalow.togglePlayer()))),

  about: async () => {
    const s = await stalow.settings();
    page('about',
      group(t('updates'),
        button(t('version_n', s.version), t('updates_desc'), t('check_for_updates'), () => stalow.checkUpdates())),
      group(t('approved_artists'),
        row(t('approved_artists'), t('approved_artists_desc', s.artistCount, s.listVersion))),
      group(t('credits'),
        row('Stalow Music', t('credits_desc')),
        button('DM Sans', 'SIL Open Font License 1.1', t('open'), () => stalow.openExternal('https://github.com/googlefonts/dm-fonts')),
        button('Zemer', 'ZemerTeam · GNU GPL v3', t('open'), () => stalow.openExternal('https://github.com/ZemerTeam/zemer-app'))));
  },
};

views.settingsPage = async (id) => {
  Object.assign(S, await stalow.settings());
  await (PAGES[id] || PAGES.about)();
};

/** Lyrics providers: on/off and their order (the first one that has the song's lyrics is used). */
function providerEditor() {
  const box = el('div', { class: 'providers' });
  const DESC = { SimpMusic: t('enable_simpmusic_desc'), LrcLib: t('enable_lrclib_desc'), YouTube: t('enable_youtube_lyrics_desc') };
  const render = () => {
    const list = S.lyricsProviders;
    box.replaceChildren(...list.map((p, i) => {
      const sw = el('input', { type: 'checkbox', role: 'switch', 'aria-label': p.name });
      sw.checked = p.enabled;
      sw.addEventListener('change', () => save(list.map((x, j) => (j === i ? { ...x, enabled: sw.checked } : x))));
      const move = (d) => { const l = list.slice(); [l[i], l[i + d]] = [l[i + d], l[i]]; save(l); };
      return el('div', { class: 'provider' },
        el('span', { class: 'pos', text: String(i + 1) }),
        el('div', { class: 'name' }, el('div', { text: p.name }), el('div', { class: 'id muted', text: DESC[p.name] || '' })),
        el('button', { class: 'icon-btn', 'aria-label': t('move_up'), disabled: i === 0, onclick: () => move(-1) }, icon('up')),
        el('button', { class: 'icon-btn', 'aria-label': t('move_down'), disabled: i === list.length - 1, onclick: () => move(1) }, icon('down')),
        el('label', { class: 'switch' }, sw, el('span')));
    }));
  };
  const save = async (list) => { await setSetting('lyricsProviders', list); render(); };
  render();
  return el('div', { class: 'item block' },
    el('div', {}, el('div', { class: 'it', text: t('lyrics_provider_priority') }), el('div', { class: 'id', text: t('lyrics_provider_priority_desc_windows') })), box);
}

/** Lyrics timing offset, -5 s to +5 s in 50 ms steps. */
function offsetRow() {
  const label = el('span', { class: 'mono', text: '' });
  const r = el('input', { type: 'range', min: '-2000', max: '2000', step: '50', 'aria-label': t('lyrics_sync_offset_title') });
  const show = (v) => { label.textContent = `${v > 0 ? '+' : ''}${v} ms`; };
  r.value = String(S.lyricsOffsetMs || 0); show(Number(r.value));
  r.addEventListener('input', () => show(Number(r.value)));
  r.addEventListener('change', () => setSetting('lyricsOffsetMs', Number(r.value)));
  return row(t('lyrics_sync_offset_title'), t('lyrics_sync_offset_desc'), el('div', { class: 'ctl' }, r, label));
}

/* exported state, saveSession */
