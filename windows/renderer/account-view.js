'use strict';
/* global stalow, el, t, icon, img, views, go, page, group, row, PAGES, rerender, currentView */
// Accounts: nothing opens until an admin approves this PC (same accounts as the phone app). Admins also get two
// settings pages: Users (approve, admin or not, block) and Channels & artists (find, move, remove, add).

let ACCOUNT = { status: 'none', isAdmin: false, name: '' };

/** Shows the sign-up / waiting screen until this PC is approved. Resolves once it is. */
async function accountGate() {
  try { ACCOUNT = await stalow.account(); } catch { /* keep none */ }
  if (ACCOUNT.status === 'approved') { stalow.accountRefresh().then((s) => { ACCOUNT = s; }).catch(() => {}); return; }
  const gate = el('div', { class: 'gate', id: 'gate' });
  document.body.append(gate);
  await new Promise((resolve) => {
    let timer = null;
    const done = (st) => {
      ACCOUNT = st;
      if (st.status === 'approved') { clearInterval(timer); gate.remove(); resolve(); return true; }
      render(); return false;
    };
    const run = async (fn, msg) => {
      msg.textContent = '';
      try { done(await fn()); } catch (e) { msg.textContent = /fetch|network|ERR_/i.test(e.message) ? t('gate_offline') : e.message; }
    };
    function render() {
      const msg = el('div', { class: 'gate-error' });
      let box;
      if (ACCOUNT.status === 'pending' || ACCOUNT.status === 'blocked') {
        const pending = ACCOUNT.status === 'pending';
        const check = el('button', { class: 'btn secondary', text: t('gate_check'), onclick: () => run(() => stalow.accountRefresh(), msg) });
        box = [el('h1', { text: t(pending ? 'gate_waiting' : 'gate_blocked') }),
          el('p', { class: 'muted', text: pending ? t('gate_waiting_explain', ACCOUNT.name) : t('gate_blocked_explain') }), check];
      } else {
        const name = el('input', { class: 'searchbox', placeholder: t('gate_name'), maxlength: '60', 'aria-label': t('gate_name') });
        name.value = ACCOUNT.name || '';
        const ask = el('button', { class: 'btn', text: t('gate_ask'), onclick: () => { if (name.value.trim()) run(() => stalow.accountRegister(name.value.trim()), msg); } });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask.click(); });
        const code = el('input', { class: 'searchbox', placeholder: t('gate_code'), maxlength: '40', 'aria-label': t('gate_code') });
        const codeBox = el('div', { class: 'gate-code', hidden: true }, code,
          el('button', { class: 'btn secondary', text: t('gate_use_code'), onclick: () => { if (name.value.trim() && code.value.trim()) run(() => stalow.accountClaim(name.value.trim(), code.value.trim()), msg); } }));
        const showCode = el('button', { class: 'link', text: t('gate_owner'), onclick: () => { codeBox.hidden = false; showCode.hidden = true; code.focus(); } });
        box = [el('h1', { text: t('gate_title') }), el('p', { class: 'muted', text: t('gate_explain') }), name, ask, showCode, codeBox];
        setTimeout(() => name.focus(), 0);
      }
      gate.replaceChildren(el('div', { class: 'gate-box' }, el('span', { class: 'gate-icon' }, icon('shield')), box, msg));
    }
    render();
    // waiting: look again every 15 seconds
    timer = setInterval(() => { if (ACCOUNT.status !== 'none') stalow.accountRefresh().then(done).catch(() => {}); }, 15000);
  });
}

// An admin blocked this PC while it was open, or the admins changed the channel list
stalow.onAccount((st) => {
  ACCOUNT = st;
  if (st.status !== 'approved' && !document.getElementById('gate')) accountGate();
});
stalow.onCatalogChanged(() => { if (typeof rerender === 'function') rerender(); });

// ---------- Settings: the two admin sections ----------
const showSettingsList = views.settings;
views.settings = async () => {
  await showSettingsList();
  if (!ACCOUNT.isAdmin) return;
  const list = document.querySelector('#view .settings .group');
  const entry = (id, ic, title, desc) => el('button', { class: 'item category', onclick: () => go('settingsPage', id) },
    el('div', { class: 'grow' }, el('span', { class: 'icon' }, icon(ic)), el('div', {}, el('div', { class: 'it', text: t(title) }), el('div', { class: 'id', text: t(desc) }))),
    icon('chevron'));
  list.prepend(entry('users', 'account', 'admin_users', 'admin_users_desc'), entry('channels', 'artist', 'admin_channels', 'admin_channels_desc'));
};

const CAT_LABEL = { music: 'cat_music', podcasts: 'podcasts', shiurim: 'shiurim', videos: 'videos' };
function categorySelect(value, onChange) {
  const s = el('select', { 'aria-label': t('admin_category') }, Object.keys(CAT_LABEL).map((c) => el('option', { value: c, text: t(CAT_LABEL[c]) })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value, s));
  return s;
}
const failed = (e) => alert(t('admin_failed', e.message));

PAGES.users = async () => {
  page('admin_users', group('', row(t('loading'), '')));
  let list;
  try { list = await stalow.adminAccounts(); } catch (e) { page('admin_users', group('', row(t('admin_failed', e.message), ''))); return; }
  const act = (fn) => async (ev) => { ev.target.disabled = true; try { await fn(); } catch (e) { failed(e); } PAGES.users(); };
  const who = (a) => el('div', { class: 'grow' }, el('div', {},
    el('div', { class: 'it', text: a.name + (a.id === ACCOUNT.id ? ' ' + t('admin_you') : '') }),
    el('div', { class: 'id', text: [a.device, (a.last_seen || '').slice(0, 16).replace('T', ' ')].filter(Boolean).join(' · ') })));
  const pending = list.filter((a) => a.status === 'pending');
  const approved = list.filter((a) => a.status === 'approved');
  const blocked = list.filter((a) => a.status === 'blocked');
  page('admin_users',
    group(`${t('admin_pending')} (${pending.length})`, pending.length ? pending.map((a) => el('div', { class: 'item' }, who(a), el('div', { class: 'ctl' },
      el('button', { class: 'btn', text: t('admin_approve'), onclick: act(() => stalow.adminDecide(a.id, 'approved', 'user')) }),
      el('button', { class: 'btn secondary', text: t('admin_approve_admin'), onclick: act(() => stalow.adminDecide(a.id, 'approved', 'admin')) }),
      el('button', { class: 'btn danger', text: t('admin_deny'), onclick: act(() => stalow.adminDecide(a.id, 'blocked')) }))))
      : row(t('admin_none_pending'), '')),
    group(`${t('admin_approved')} (${approved.length})`, approved.map((a) => {
      if (a.role === 'owner') return el('div', { class: 'item' }, who(a), el('div', { class: 'ctl' }, el('span', { class: 'muted', text: t('admin_role_owner') })));
      const role = el('select', { 'aria-label': t('admin_role') }, el('option', { value: 'user', text: t('admin_role_user') }), el('option', { value: 'admin', text: t('admin_role_admin') }));
      role.value = a.role === 'admin' ? 'admin' : 'user';
      role.addEventListener('change', act(() => stalow.adminDecide(a.id, undefined, role.value)));
      return el('div', { class: 'item' }, who(a), el('div', { class: 'ctl' }, role,
        a.id === ACCOUNT.id ? '' : el('button', { class: 'btn danger', text: t('admin_block'), onclick: act(() => stalow.adminDecide(a.id, 'blocked')) })));
    })),
    blocked.length ? group(`${t('admin_blocked')} (${blocked.length})`, blocked.map((a) => el('div', { class: 'item' }, who(a), el('div', { class: 'ctl' },
      el('button', { class: 'btn secondary', text: t('admin_unblock'), onclick: act(() => stalow.adminDecide(a.id, 'approved')) }))))) : '');
};

PAGES.channels = async () => {
  page('admin_channels', group('', row(t('loading'), '')));
  let rows;
  try { rows = await stalow.adminRows(); } catch (e) { page('admin_channels', group('', row(t('admin_failed', e.message), ''))); return; }
  let filter = '';
  const find = el('input', { class: 'searchbox', type: 'search', placeholder: t('admin_find'), 'aria-label': t('admin_find') });
  const chips = el('div', { class: 'chips' });
  const count = el('span', { class: 'muted' });
  const listBox = el('div', { class: 'group admin-list' });
  const save = async (entry, ctl) => {
    if (ctl) ctl.disabled = true;
    try { await stalow.adminSet(entry); rows = await stalow.adminRows(); draw(); } catch (e) { failed(e); if (ctl) ctl.disabled = false; }
  };
  const LIMIT = 300;
  function draw() {
    chips.replaceChildren(...[['', 'cat_all'], ...Object.entries(CAT_LABEL)].map(([c, label]) =>
      el('button', { class: 'chip' + (filter === c ? ' on' : ''), text: t(label), onclick: () => { filter = c; draw(); } })));
    const q = find.value.trim().toLowerCase();
    const shown = rows.filter((r) => (!filter || r.category === filter) && (!q || r.name.toLowerCase().includes(q) || r.id.toLowerCase() === q));
    count.textContent = t('admin_count', shown.length);
    listBox.replaceChildren(...shown.slice(0, LIMIT).map((r) => {
      const ctl = r.removed
        ? el('button', { class: 'btn secondary', text: t('admin_restore'), onclick: (e) => save({ ...r, removed: false }, e.target) })
        : [categorySelect(r.category, (c, s) => save({ ...r, category: c }, s)),
          el('button', { class: 'btn secondary', text: t('admin_picture'), onclick: () => pictureDialog(r, save) }),
          el('button', { class: 'btn danger', text: t('admin_delete'), onclick: (e) => { if (confirm(t('admin_delete_q', r.name))) save({ ...r, removed: true }, e.target); } })];
      return el('div', { class: 'item admin-row' + (r.removed ? ' removed' : '') },
        el('div', { class: 'grow' }, img(r.thumbnail, r.name), el('div', { class: 'it', text: r.name })),
        el('div', { class: 'ctl' }, ctl));
    }), shown.length > LIMIT ? row(t('showing_n_of', LIMIT, shown.length), '') : '');
  }
  find.addEventListener('input', draw);
  const add = el('button', { class: 'btn', onclick: () => addDialog(rows, save) }, icon('search'), t('admin_add'));
  document.getElementById('view').replaceChildren(el('h1', { text: t('admin_channels') }),
    el('div', { class: 'settings' }, el('div', { class: 'admin-top' }, find, add), chips, count, listBox));
  draw();
  find.focus();
};

/** Search YouTube Music and YouTube (or paste a channel link / @handle), choose where it goes, add. */
function addDialog(rows, save) {
  const known = new Map(rows.filter((r) => !r.removed).map((r) => [r.id, r]));
  const q = el('input', { class: 'searchbox', type: 'search', placeholder: t('admin_search_hint'), 'aria-label': t('admin_search_hint') });
  const results = el('div', { class: 'admin-results' });
  const go2 = el('button', { class: 'btn', text: t('search'), onclick: async () => {
    if (!q.value.trim()) return;
    go2.disabled = true; results.replaceChildren(el('div', { class: 'muted', text: t('searching') }));
    try {
      const found = await stalow.adminSearch(q.value.trim());
      results.replaceChildren(...(found.length ? found.map((f) => {
        const k = known.get(f.id);
        const cat = categorySelect(f.kind === 'artist' ? 'music' : 'podcasts', () => {});
        const ctl = k ? el('span', { class: 'muted', text: t('admin_already', t(CAT_LABEL[k.category])) })
          : [cat, el('button', { class: 'btn', text: t('admin_add_one'), onclick: async (e) => {
            await save({ id: f.id, name: f.name, thumbnail: f.thumbnail, category: cat.value, removed: false }, e.target);
            e.target.replaceWith(el('span', { class: 'muted', text: t('admin_added') })); cat.disabled = true;
          } })];
        return el('div', { class: 'item admin-row' }, el('div', { class: 'grow' }, img(f.thumbnail, f.name), el('div', { class: 'it', text: f.name })), el('div', { class: 'ctl' }, ctl));
      }) : [el('div', { class: 'muted', text: t('admin_no_results') })]));
    } catch (e) { results.replaceChildren(el('div', { class: 'muted', text: t('admin_failed', e.message) })); }
    go2.disabled = false;
  } });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2.click(); });
  const dlg = el('dialog', { class: 'admin-dialog' },
    el('div', { class: 'admin-top' }, el('h2', { text: t('admin_add') }), el('button', { class: 'icon-btn', 'aria-label': t('close'), onclick: () => dlg.close() }, icon('close'))),
    el('div', { class: 'admin-top' }, q, go2), results);
  dlg.addEventListener('close', () => { dlg.remove(); if (currentView && currentView[1] === 'channels') PAGES.channels(); });
  document.body.append(dlg);
  dlg.showModal();
  q.focus();
}

/** Possible pictures for one channel / artist (its own pages, and a search by name); pick one for everyone. */
function pictureDialog(r, save) {
  const q = el('input', { class: 'searchbox', type: 'search', placeholder: t('admin_picture_hint'), 'aria-label': t('admin_picture_hint') });
  q.value = r.name;
  const grid = el('div', { class: 'picture-grid' });
  let chosen = null;
  const use = el('button', { class: 'btn', text: t('admin_picture_use'), disabled: true, onclick: async () => {
    if (!chosen) return;
    use.disabled = true;
    await save({ ...r, thumbnail: chosen });
    dlg.close();
  } });
  const load = async () => {
    find.disabled = true; grid.replaceChildren(el('div', { class: 'muted', text: t('searching') }));
    try {
      const list = await stalow.adminPictures(r.id, q.value.trim());
      grid.replaceChildren(...(list.length ? list.map((p) => {
        const b = el('button', { class: 'picture', title: p.from, onclick: () => {
          chosen = p.url; use.disabled = false;
          grid.querySelectorAll('.picture').forEach((x) => x.classList.toggle('on', x === b));
        } }, el('img', { src: p.url, alt: '', loading: 'lazy' }));
        b.querySelector('img').addEventListener('error', () => b.remove());
        return b;
      }) : [el('div', { class: 'muted', text: t('admin_no_results') })]));
    } catch (e) { grid.replaceChildren(el('div', { class: 'muted', text: t('admin_failed', e.message) })); }
    find.disabled = false;
  };
  const find = el('button', { class: 'btn secondary', text: t('search'), onclick: load });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  const dlg = el('dialog', { class: 'admin-dialog' },
    el('div', { class: 'admin-top' }, el('h2', { text: t('admin_picture_for', r.name) }), el('button', { class: 'icon-btn', 'aria-label': t('close'), onclick: () => dlg.close() }, icon('close'))),
    el('div', { class: 'admin-top' }, q, find),
    el('div', { class: 'muted', text: t('admin_picture_tap') }), grid,
    el('div', { class: 'admin-top end' }, use));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  load();
}
