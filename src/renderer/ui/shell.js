// Shell: sidebar, header, router, scan orchestration and the shared UI kit
// (UI.list / UI.confirm / UI.sheet …) every tab renders with. No framework.
(() => {
const $ = (s, r = document) => r.querySelector(s);
const sum = a => a.reduce((t, i) => t + (i.size || 0), 0);
const isSafe = i => i.safety === 'safe';
const SUDO_CMDS = ['aptClean', 'journal', 'snapRev'];
// what to look at before cleaning a Check First item: the scanner's reasons, else what is lost
const checkNote = i => {
  if (isSafe(i) && !i.check) return '';
  const c = i.check || [i.restore ? `Downloaded or rebuilt again with ${i.restore}, which can take a while.` : 'Cannot be restored once cleaned.'];
  return `<span class="rcheck"><b>Check:</b> ${c.map(UI.esc).join(' · ')}</span>`;
};
const needsPw = i => i.action === 'cmd' && SUDO_CMDS.includes(i.cmd?.id);
// what one click may take: Safe, preselectable, no apps, nothing that needs a password
const oneClick = i => isSafe(i) && i.pre !== false && i.action !== 'pkg' && !needsPw(i);

// ── UI kit ───────────────────────────────────────────────────────────
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  caches: '<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6"/>',
  dev: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  apps: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><path d="M17.25 14v6.5M14 17.25h6.5"/>',
  disk: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  reveal: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
};

const stack = [];   // open sheets / menus, topmost last; Esc closes the top one
const UI = window.UI = {
  fmt(b) {
    b = +b || 0;
    if (b < 1000) return b + ' B';
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { b /= 1000; i++; } while (b >= 1000 && i < u.length - 1);
    return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i];
  },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  ago(ms) {
    if (!ms) return '';
    const d = (Date.now() - ms) / 864e5;
    return d < 1 / 24 ? 'now' : d < 1 ? Math.floor(d * 24) + ' h' : d < 14 ? Math.floor(d) + ' d'
      : d < 60 ? Math.floor(d / 7) + ' wk' : d < 365 ? Math.floor(d / 30.4) + ' mo' : Math.floor(d / 365) + ' yr';
  },
  icon: (n, size = 16) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`,

  toast(text, { kind = 'ok', action } = {}) {
    const box = $('#toast');
    box.innerHTML = `<div class="toast ${kind}"><span>${UI.esc(text)}</span>${action ? `<button class="link" type="button">${UI.esc(action.label)}</button>` : ''}</div>`;
    const t = box.firstChild;
    t.querySelector('button')?.addEventListener('click', () => { t.remove(); action.fn(); });
    clearTimeout(UI._tt);
    UI._tt = setTimeout(() => t.remove(), action ? 10000 : 5000);
  },

  sheet(html, { label = '', onClose } = {}) {
    const prev = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${UI.esc(label)}">${html}</div>`;
    $('#sheets').append(scrim);
    const el = scrim.firstChild;
    let open = true;
    const close = () => {
      if (!open) return; open = false;
      scrim.remove(); stack.splice(stack.indexOf(close), 1);
      onClose?.(); prev?.focus?.();
    };
    stack.push(close);
    // keep Tab inside the dialog
    el.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll('button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    });
    (el.querySelector('[autofocus]') || el.querySelector('input,button,select,textarea'))?.focus();
    return { el, close };
  },

  confirm({ items, title, verb, note } = {}) {
    const check = items.filter(i => !isSafe(i)), safe = items.filter(isSafe);
    const total = sum(items), trashOnly = items.some(i => i.trashOnly), cmd = items.some(i => i.action === 'cmd');
    let mode = Shell.settings.deleteMode === 'delete' && !trashOnly ? 'delete' : 'trash';
    // commands (apt clean, snap remove, docker prune) never reach the Trash, so don't promise it
    const label = () => verb ? `${verb} ${UI.fmt(total)}` : mode === 'delete' ? `Delete ${UI.fmt(total)}` : cmd ? `Clean ${UI.fmt(total)}` : `Move ${UI.fmt(total)} to Trash`;
    const li = i => `<li><span class="rmain"><span class="rname">${UI.esc(i.name)}</span><span class="rwhy">${UI.esc(i.why || '')}${needsPw(i) ? ' · <span class="note">Needs your password</span>' : ''}</span></span><span class="rsize">${UI.fmt(i.size)}</span></li>`;
    const pw = items.some(needsPw);
    return new Promise(resolve => {
      let done = null;
      const s = UI.sheet(`
        <h2>${UI.esc(title || `Clean ${items.length} item${items.length === 1 ? '' : 's'}?`)}</h2>
        ${check.length ? `<h3>Check first</h3><p class="muted">${UI.esc(note || 'Nothing is lost, but these cost a re-download or a slower next build.')}</p><ul class="clist">${check.map(li).join('')}</ul>` : ''}
        ${safe.length ? `<div class="prow"><span class="badge safe">Safe to Clean</span> ${safe.length} item${safe.length === 1 ? '' : 's'} · <b class="num">${UI.fmt(sum(safe))}</b></div>
          <ul class="clist">${safe.slice(0, 5).map(li).join('')}</ul>${safe.length > 5 ? `<details><summary>${safe.length - 5} more</summary><ul class="clist">${safe.slice(5).map(li).join('')}</ul></details>` : ''}` : ''}
        ${cmd ? `<p class="note">${pw ? 'Needs your password. ' : ''}Items run as a command are removed permanently, not moved to the Trash.</p>` : ''}
        <div class="ctot"><span>Total</span><b class="num">${UI.fmt(total)}</b></div>
        <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button>
          ${!trashOnly && !verb ? `<button class="btn danger${mode === 'delete' ? ' solid' : ''}" type="button" data-a="del">Delete Permanently</button>` : ''}
          <button class="btn${mode === 'delete' && !trashOnly && !verb ? '' : ' primary'}" type="button" data-a="go">${UI.esc(verb ? label() : cmd ? `Clean ${UI.fmt(total)}` : `Move ${UI.fmt(total)} to Trash`)}</button></div>`,
        { label: title || 'Confirm clean', onClose: () => resolve(done) });
      const go = s.el.querySelector('[data-a=go]');
      s.el.querySelector('[data-a=no]').onclick = s.close;
      go.onclick = () => { done = { mode: 'trash' }; s.close(); };   // permanent only via its own button
      const del = s.el.querySelector('[data-a=del]');
      if (del) del.onclick = () => { done = { mode: 'delete' }; s.close(); };
      go.focus();   // Enter never deletes permanently; that takes a click on its own button
    });
  },

  // Resolves with a password sudo accepted, or null if cancelled.
  password({ title = 'Administrator password', why = '' } = {}) {
    return new Promise(resolve => {
      let done = null;
      const s = UI.sheet(`<h2>${UI.esc(title)}</h2>${why ? `<p class="muted">${UI.esc(why)}</p>` : ''}
        <input type="password" autocomplete="current-password" aria-label="Password" placeholder="Your password" autofocus>
        <div class="err" aria-live="polite"></div>
        <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button>
          <button class="btn primary" type="button" data-a="go">Continue</button></div>`,
        { label: title, onClose: () => resolve(done) });
      const input = s.el.querySelector('input'), err = s.el.querySelector('.err'), go = s.el.querySelector('[data-a=go]');
      const submit = async () => {
        const pw = input.value; if (!pw) return;
        go.disabled = true; err.textContent = 'Checking…';
        const ok = await api.checkPassword(pw);
        go.disabled = false;
        if (!ok) { err.textContent = 'That password was not accepted. Try again.'; input.select(); return; }
        done = pw; input.value = ''; s.close();
      };
      go.onclick = submit;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      s.el.querySelector('[data-a=no]').onclick = s.close;
    });
  },

  menu(x, y, entries) {
    const prev = document.activeElement;
    const m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = entries.map((e, i) => `<button type="button" role="menuitem" data-i="${i}">${e.icon ? UI.icon(e.icon) : ''}${UI.esc(e.label)}</button>`).join('');
    document.body.append(m);
    m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
    const close = () => {
      if (!m.isConnected) return;
      m.remove(); stack.splice(stack.indexOf(close), 1);
      removeEventListener('pointerdown', outside, true); prev?.focus?.();
    };
    const outside = e => { if (!m.contains(e.target)) close(); };
    addEventListener('pointerdown', outside, true);
    stack.push(close);
    const btns = [...m.children];
    m.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { close(); entries[+b.dataset.i].fn(); } });
    m.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      if (e.key === 'Tab') close();
    });
    btns[0]?.focus();
    return { el: m, close };
  },

  // The shared result list: groups, Safe/Check filter, selection, action bar.
  list(el, opts = {}) {
    const o = { items: [], groupBy: i => i.group || '', defaultFilter: 'safe', filters: true, search: false,
      sorts: ['size', 'date', 'name'], preselect: i => isSafe(i) && i.pre !== false,
      empty: 'Nothing to clean here', actions: true, ...opts };
    let items = [], sel = new Set(), filter = o.defaultFilter, sort = o.sorts[0], q = '';
    const closed = new Set();
    const byId = id => items.find(i => i.id === id);
    el.classList.add('lst');
    const F = { all: 'All', safe: 'Safe to Clean', check: 'Check First' };
    el.innerHTML = `
      ${o.filters || o.search || o.sorts.length > 1 ? `<div class="lhead">
        ${o.filters ? `<div class="seg" role="radiogroup" aria-label="Show">${Object.keys(F).map(f => `<button type="button" role="radio" data-f="${f}">${F[f]}<span class="n"></span></button>`).join('')}</div>` : ''}
        ${o.search ? '<input type="search" placeholder="Search" aria-label="Search">' : ''}
        <span class="sp"></span>
        ${o.sorts.length > 1 ? `<label>Sort <select aria-label="Sort by">${o.sorts.map(s => `<option value="${s}">${{ size: 'Size', date: 'Oldest first', name: 'Name' }[s] || s}</option>`).join('')}</select></label>` : ''}
      </div>` : ''}
      <div class="list"></div>
      ${o.actions ? `<div class="bar"><div class="in">
        <button class="btn ghost" type="button" data-a="safe">Select All Safe</button>
        <button class="btn ghost" type="button" data-a="shown" hidden>Select Shown</button>
        <button class="btn ghost" type="button" data-a="none">Select None</button>
        <button class="link" type="button" data-a="check" hidden></button>
        <span class="sp"></span><span class="tot num"></span>
        <button class="btn primary" type="button" data-a="clean">Clean</button></div></div>` : ''}`;
    const body = $('.list', el);

    const shown = () => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const v = items.filter(i => (filter === 'all' || (filter === 'safe') === isSafe(i)) &&
        words.every(w => `${i.name} ${i.group || ''} ${i.paths?.[0] || ''}`.toLowerCase().includes(w)));
      const cmp = { size: (a, b) => b.size - a.size, date: (a, b) => (a.mtime || Infinity) - (b.mtime || Infinity),
        name: (a, b) => String(a.name).localeCompare(b.name) }[sort] || (() => 0);
      return v.sort(cmp);
    };
    const bar = () => {
      if (!o.actions) return;
      const s = self.selected(), chk = items.filter(i => !isSafe(i) && !sel.has(i.id));
      $('.tot', el).textContent = s.length ? `${s.length} selected · ${UI.fmt(sum(s))}` : 'Nothing selected';
      const c = $('[data-a=check]', el);
      const anySafe = items.some(isSafe);
      c.hidden = !chk.length || (!anySafe && o.selectAll === false);   // a list of your own files has no 'Select all'
      c.textContent = anySafe ? `Also select ${chk.length} Check First item${chk.length === 1 ? '' : 's'} (${UI.fmt(sum(chk))})` : `Select All (${chk.length})`;
      $('[data-a=none]', el).disabled = !s.length;
      $('[data-a=shown]', el).hidden = !q || o.selectAll === false;   // while searching: take just the matches
      const go = $('[data-a=clean]', el);
      go.textContent = s.length ? `Clean ${UI.fmt(sum(s))}` : 'Clean';
      go.disabled = !s.length || Shell.busy;
      $('[data-a=safe]', el).hidden = !anySafe;
    };
    const draw = () => {
      if (o.filters) for (const b of el.querySelectorAll('.seg button')) {
        b.setAttribute('aria-checked', b.dataset.f === filter);
        b.querySelector('.n').textContent = items.filter(i => b.dataset.f === 'all' || (b.dataset.f === 'safe') === isSafe(i)).length;
      }
      const v = shown();
      // a filter that matches nothing (e.g. Safe after a clean) falls back to All rather than a dead end
      if (!v.length && !q && items.length && filter !== 'all') { filter = 'all'; return draw(); }
      if (!v.length) { body.innerHTML = `<div class="empty">${items.length ? 'Nothing matches this filter' : typeof o.empty === 'function' ? o.empty() : UI.esc(o.empty)}</div>`; bar(); return; }
      const groups = new Map();
      for (const i of v) { const g = o.groupBy ? o.groupBy(i) : ''; groups.has(g) || groups.set(g, []); groups.get(g).push(i); }
      let gs = [...groups];
      if (sort === 'size') gs.sort((a, b) => (o.groupOrder?.(a[0], b[0]) || 0) || sum(b[1]) - sum(a[1]));
      body.innerHTML = gs.map(([g, rows], gi) => {
        const open = !closed.has(g);
        return `<div class="group" data-g="${gi}">
          ${g ? `<div class="ghead"><input type="checkbox" class="gcb" aria-label="Select all in ${UI.esc(g)}">
            <button class="gtog" type="button" aria-expanded="${open}">${UI.icon('chevron')}<b>${UI.esc(g)}</b><span class="n">${rows.length} item${rows.length === 1 ? '' : 's'}</span></button>
            <span class="gsize">${UI.fmt(sum(rows))}</span></div>` : ''}
          <div class="gbody"${open ? '' : ' hidden'}>${rows.map(row).join('')}</div></div>`;
      }).join('');
      body._groups = gs;
      syncChecks(); bar();
    };
    const row = i => `<label class="row" data-id="${UI.esc(i.id)}">
        <input type="checkbox" aria-label="${UI.esc(i.name)}"${sel.has(i.id) ? ' checked' : ''}>
        <span class="rmain">${o.row ? o.row(i) : `<span class="rname">${UI.esc(i.name)}</span><span class="rwhy" title="${UI.esc(i.why || '')}">${UI.esc(i.why || '')}</span>`}${checkNote(i)}</span>
        ${i.restore ? `<button class="chip" type="button" title="Copy restore command">${UI.esc(i.restore)}</button>` : ''}
        <span class="badge ${isSafe(i) ? 'safe' : 'check'}">${isSafe(i) ? 'Safe to Clean' : 'Check First'}</span>
        <span class="age">${UI.ago(i.mtime)}</span>
        <span class="rsize">${i.size ? UI.fmt(i.size) : "—"}</span>
        ${o.actions !== false ? `<button class="btn ghost icon more" type="button" aria-label="More for ${UI.esc(i.name)}">${UI.icon('more')}</button>` : ''}
      </label>`;
    const syncChecks = () => {
      for (const g of body.querySelectorAll('.group')) {
        const ids = (body._groups[+g.dataset.g]?.[1] || []).map(i => i.id), n = ids.filter(id => sel.has(id)).length;
        const cb = $('.gcb', g);
        if (cb) { cb.checked = n > 0 && n === ids.length; cb.indeterminate = n > 0 && n < ids.length; }
      }
    };
    const rowMenu = (i, x, y) => i.paths?.length && UI.menu(x, y, [
      { label: 'Show in folder', icon: 'reveal', fn: () => window.api.reveal(i.paths[0]) },
      { label: 'Copy path', icon: 'copy', fn: () => { window.api.copy(i.paths.join('\n')); UI.toast('Path copied'); } },
      { label: 'Exclude', icon: 'stop', fn: async () => {
        await Shell.saveSettings({ exclusions: [...new Set([...(Shell.settings.exclusions || []), ...i.paths])] });   // every path of a merged row
        items = items.filter(x => x !== i); sel.delete(i.id); draw();
        UI.toast(`${i.name} will be left alone. Manage exclusions in Settings.`);
      } },
    ]);

    el.addEventListener('change', e => {
      const t = e.target;
      if (t.type === 'radio') return;   // tab-owned controls inside a row (e.g. Large Files' keeper)
      if (t.classList.contains('gcb')) {
        const rows = body._groups[+t.closest('.group').dataset.g][1];
        for (const i of rows) t.checked ? sel.add(i.id) : sel.delete(i.id);
        draw();
      } else if (t.closest('.row')) {
        const id = t.closest('.row').dataset.id;
        t.checked ? sel.add(id) : sel.delete(id);
        syncChecks(); bar();
      } else if (t.tagName === 'SELECT') { sort = t.value; draw(); }
    });
    el.addEventListener('input', e => { if (e.target.type === 'search') { q = e.target.value; draw(); } });
    el.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      const i = byId(t.closest('.row')?.dataset.id);
      if (t.classList.contains('more')) { e.preventDefault(); const r = t.getBoundingClientRect(); rowMenu(i, r.right - 180, r.bottom + 4); }
      else if (t.classList.contains('chip')) { e.preventDefault(); window.api.copy(i.restore); UI.toast(`Copied: ${i.restore}`); }
      else if (t.classList.contains('gtog')) {
        const g = body._groups[+t.closest('.group').dataset.g][0], open = closed.has(g);
        open ? closed.delete(g) : closed.add(g);
        t.setAttribute('aria-expanded', open); t.closest('.group').querySelector('.gbody').hidden = !open;
      }
      else if (t.dataset.f) self.filter(t.dataset.f);
      else if (t.dataset.a === 'safe') self.select(items.filter(isSafe).map(i => i.id));
      else if (t.dataset.a === 'none') { sel.clear(); draw(); }
      else if (t.dataset.a === 'shown') self.select(shown().map(i => i.id));
      else if (t.dataset.a === 'check') self.select(items.filter(i => !isSafe(i)).map(i => i.id));
      else if (t.dataset.a === 'clean') Shell.clean(self.selected(), { note: o.note });
    });
    el.addEventListener('contextmenu', e => {
      const r = e.target.closest('.row'); if (!r) return;
      e.preventDefault(); rowMenu(byId(r.dataset.id), e.clientX, e.clientY);
    });

    const self = {
      el,
      set(list) { items = [...(list || [])]; sel = new Set(items.filter(o.preselect).map(i => i.id)); draw(); },
      selected: () => items.filter(i => sel.has(i.id)),
      select(ids, on = true) { for (const id of ids) on ? sel.add(id) : sel.delete(id); draw(); },
      filter(f) { if (o.filters && F[f]) { filter = f; draw(); } },
      selectNone() { sel.clear(); draw(); },
      selectShown() { if (o.selectAll !== false || items.some(isSafe)) self.select(shown().map(i => i.id)); },
      focusSearch() { $('input[type=search]', el)?.focus(); },
      _bar: bar,
    };
    lists.add(self);
    self.set(o.items);
    return self;
  },
};
const lists = new Set();
// long cleans (docker rmi one image at a time) must show they are moving
// and free space counts up as each item goes, not only once the whole clean ends
api.onCleanProgress?.(({ i, n, name }) => { UI.toast(`Cleaning ${i + 1} of ${n}${name ? ` · ${name}` : ''}…`); Shell.refreshDisk(); });

// ── Shell ────────────────────────────────────────────────────────────
const tabs = [];
let busyN = 0, stopped = false, allRunning = false, current = null;
const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
const setBusy = d => { busyN += d; lists.forEach(l => l._bar()); header(); emit('busy'); };

const Shell = window.Shell = {
  info: {}, settings: {}, results: {}, bus, trash: { size: 0 }, disk: { size: 0, used: 0, avail: 0 },
  get busy() { return busyN > 0; },
  get current() { return current; },

  tab(t) { tabs.push(t); },

  async saveSettings(patch) {
    Object.assign(Shell.settings, await api.setSettings(patch));
    theme(); emit('settings');
    return Shell.settings;
  },

  show(key, opts = {}) {
    const t = visible().find(t => t.key === key); if (!t) return;
    current = key;
    for (const x of visible()) {
      x.view.hidden = x !== t;
      x.btn.toggleAttribute('aria-current', x === t);
      if (x === t) x.btn.setAttribute('aria-current', 'page');
    }
    $('#title').textContent = t.label;
    const r = t.onShow?.(opts);
    if (typeof r === 'function') t.rescan = r;
    const l = activeList();
    if (l && opts.filter) l.filter(opts.filter);
    if (l && opts.preselectSafe) l.select(Shell.results[key]?.items.filter(oneClick).map(i => i.id) || []);
    header(); emit('show', { key });
  },

  async scan(key) {
    const t = tabs.find(t => t.key === key && t.scan && t.view);
    if (!t || Shell.results[key]?.scanning) return;
    const r = Shell.results[key] = { items: [], size: 0, safeSize: 0, at: 0, ...Shell.results[key], scanning: true, error: null };
    setBusy(1); side(); emit('results', { key });
    const res = await api.mod(key, 'scan');
    const items = Array.isArray(res) ? res : [];
    Object.assign(r, { items, size: sum(items), safeSize: sum(items.filter(isSafe)), at: Date.now(),
      scanning: false, error: res?.error || null, stale: stopped });
    setBusy(-1); side(); emit('results', { key });
  },

  // scan tabs one at a time, in sidebar order, until done or stopped
  async scanAll() {
    if (allRunning) return;
    allRunning = true; stopped = false; header();
    if (!Shell.settings.onboarded) Shell.saveSettings({ onboarded: true });   // the header Scan counts too
    try { for (const t of visible().filter(t => t.scan)) { if (stopped) break; await Shell.scan(t.key); } }
    finally { allRunning = false; header(); }
  },

  stop() { stopped = true; api.stop(); },

  async clean(items, { title, verb, note } = {}) {
    items = (items || []).filter(Boolean);
    if (!items.length || Shell.busy) return null;
    const ok = await UI.confirm({ items, title, verb, note });
    if (!ok) return null;
    let password;
    if (items.some(needsPw)) {
      password = await UI.password({ why: 'Some of these are system files that only an administrator can clean.' });
      if (password == null) return null;
    }
    setBusy(1);
    UI.toast(`Cleaning ${items.length} item${items.length === 1 ? '' : 's'}…`);
    let r;
    try { r = await api.clean({ ids: items.map(i => i.id), mode: ok.mode, password }); }
    finally { setBusy(-1); }
    const msg = [r.trashed && `Moved ${UI.fmt(r.trashed)} to Trash`, r.freed && `Freed ${UI.fmt(r.freed)}`].filter(Boolean).join(' · ')
      || (r.errors.length ? 'Nothing was cleaned' : 'Already clean');
    const err = r.errors[0] ? ` · ${r.errors.length} skipped: ${r.errors[0].msg}` : '';
    UI.toast(msg + err, { kind: r.errors.length ? 'warn' : 'ok', action: r.trashed ? { label: 'Empty Trash', fn: emptyTrash } : undefined });
    await afterClean([...new Set(items.map(i => i.module))], r, items.map(i => i.id));
    return r;
  },

  cleanSafe() {
    return Shell.clean(safeItems(), { title: 'Clean Safe Items' });
  },

  // other tabs (Disk, Uninstaller) changed the disk under these results
  markStale(keys) {
    for (const k of keys) if (Shell.results[k]) { Shell.results[k].stale = true; emit('results', { key: k }); }
    side();
  },

  async refreshTrash() {
    Shell.trash = await api.trashInfo().catch(() => ({ size: 0 }));
    storage();
  },
  async refreshDisk() {
    Shell.disk = await api.df('/').catch(() => Shell.disk);
    storage();
  },
};

const visible = () => tabs.filter(t => t.view);
const activeList = () => [...lists].find(l => l.el.isConnected && l.el.closest('.view') && !l.el.closest('.view').hidden && l.el.offsetParent);
// one-click cleans: Safe items of the scan tabs, never apps, never anything that needs a password
const safeItems = () => visible().filter(t => t.scan && t.key !== 'uninstaller')
  .flatMap(t => (Shell.results[t.key]?.items || []).filter(oneClick));

async function afterClean(keys, r, ids = []) {
  // drop what was just cleaned so the rescan doesn't count it as Safe and in the Trash at once
  const gone = new Set(ids);
  for (const k of keys) {
    const x = Shell.results[k]; if (!x) continue;
    x.items = x.items.filter(i => !gone.has(i.id));
    Object.assign(x, { stale: true, size: sum(x.items), safeSize: sum(x.items.filter(isSafe)) });
  }
  side();
  Object.assign(Shell.settings, await api.settings()); emit('settings');   // lastClean
  emit('cleaned', { result: r });
  Shell.refreshTrash(); Shell.refreshDisk();
  for (const k of keys) await Shell.scan(k);
}

function emptyTrash() {
  const s = UI.sheet(`<h2>Empty Trash?</h2>
    <p>This permanently deletes ${UI.fmt(Shell.trash.size)} in the Trash. It can't be undone.</p>
    <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button>
      <button class="btn danger solid" type="button" data-a="go">Empty Trash</button></div>`, { label: 'Empty Trash' });
  s.el.querySelector('[data-a=no]').onclick = s.close;
  s.el.querySelector('[data-a=go]').onclick = async () => {
    s.close();
    const { errors } = await api.emptyTrash();
    UI.toast(errors.length ? `Trash not fully emptied: ${errors[0].msg}` : 'Trash emptied', { kind: errors.length ? 'warn' : 'ok' });
    Shell.refreshTrash(); Shell.refreshDisk();
  };
}
Shell.emptyTrash = emptyTrash;

function theme() {
  const t = Shell.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ── sidebar, header, storage card ───────────────────────────────────
function side() {
  for (const t of visible()) {
    const r = Shell.results[t.key], sz = t.btn.querySelector('.sz');
    if (!r) { sz.innerHTML = ''; continue; }
    const n = OvLib.shownSize(t.key, r);   // overview.js: Linux system packages hidden like in the tab
    sz.innerHTML = r.scanning ? '<span class="spin" aria-label="Scanning"></span>' : n ? UI.fmt(n) : '';
    sz.classList.toggle('stale', !!r.stale);
  }
  header();
}

function header() {
  const scanning = allRunning || tabs.some(t => Shell.results[t.key]?.scanning);
  document.body.classList.toggle('scanning', scanning);   // toolbar shimmer
  const b = $('#scanBtn');
  b.innerHTML = scanning ? `${UI.icon('stop')}Stop` : `${UI.icon('refresh')}Scan`;
  const t = tabs.find(t => t.key === current);
  b.title = scanning ? 'Stop scanning' : t?.scan || t?.rescan ? 'Scan this tab (Ctrl+R)' : 'Scan Everything (Shift+Ctrl+R)';
  const total = sum(safeItems());
  const c = $('#cleanSafe');
  c.textContent = total ? `Clean Safe Items · ${UI.fmt(total)}` : 'Clean Safe Items';
  c.disabled = !total || Shell.busy;
  c.title = total ? '' : Object.values(Shell.results).some(r => r.at) ? 'Nothing safe left to clean' : 'Scan first to find safe items';
}

function storage() {
  const d = Shell.disk;
  $('#stFree').textContent = d.size ? `${UI.fmt(d.avail)} free` : '—';
  $('#stOf').textContent = d.size ? `of ${UI.fmt(d.size)}` : '';
  $('#stBar').style.width = d.size ? (100 * d.used / d.size).toFixed(1) + '%' : '0';
  $('#stTrash').textContent = Shell.trash.denied ? 'no access' : UI.fmt(Shell.trash.size);
  emit('storage');
}

function rescan() {
  if (allRunning) return;   // scans run one at a time
  if (current === 'overview' || !current) return Shell.scanAll();
  const t = tabs.find(t => t.key === current);
  if (t?.scan) return Shell.scan(current);
  if (t?.rescan) return t.rescan();
  return Shell.scanAll();
}

function popover() {
  const rows = visible().filter(t => t.scan && t.key !== 'uninstaller').map(t => {
    const s = sum((Shell.results[t.key]?.items || []).filter(oneClick));
    return s ? `<div class="prow"><span>${UI.esc(t.label)}</span><b class="num">${UI.fmt(s)}</b><button class="link" type="button" data-k="${t.key}">Review</button></div>` : '';
  }).join('');
  const r = $('#cleanSafe').getBoundingClientRect();
  const m = document.createElement('div');
  m.className = 'pop'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Safe items');
  m.innerHTML = `<h3>Safe to Clean</h3><p class="muted">Rebuilt automatically. You won't notice they're gone.</p>${rows}
    <button class="btn primary" type="button" data-a="go">Clean Safe Items…</button>`;
  document.body.append(m);
  m.style.top = r.bottom + 8 + 'px';
  m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
  const prev = document.activeElement;
  const close = () => { if (!m.isConnected) return; m.remove(); stack.splice(stack.indexOf(close), 1); removeEventListener('pointerdown', outside, true); prev?.focus?.(); };
  const outside = e => { if (!m.contains(e.target) && e.target !== $('#cleanSafe')) close(); };
  addEventListener('pointerdown', outside, true);
  stack.push(close);
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    close();
    if (b.dataset.k) Shell.show(b.dataset.k, { filter: 'safe', preselectSafe: true });
    else Shell.cleanSafe();
  });
  m.addEventListener('keydown', e => { if (e.key === 'Tab') close(); });
  m.querySelector('[data-a=go]').focus();
}

// ── keyboard ─────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack.at(-1)(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || stack.length) return;
  const k = e.key.toLowerCase();
  if (k === 'r') { e.preventDefault(); e.shiftKey ? Shell.scanAll() : rescan(); }
  else if (k === 'a' && !(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !/checkbox|radio/.test(document.activeElement.type))) {
    const l = activeList(); if (l) { e.preventDefault(); e.shiftKey ? l.selectNone() : l.selectShown(); }
  }
  else if (k === 'f') { const l = activeList(); if (l) { e.preventDefault(); l.focusSearch(); } }
  else if (e.key === ',') { e.preventDefault(); Shell.show('settings'); }
  else if (/^Digit[1-9]$/.test(e.code)) {
    const n = +e.code.slice(5);
    e.preventDefault();
    if (e.altKey) { if (n <= 3) activeList()?.filter(['all', 'safe', 'check'][n - 1]); }
    else { const t = visible().filter(t => t.key !== 'about')[n - 1]; if (t) Shell.show(t.key); }
  }
});

// ── About (owned by the shell) ──────────────────────────────────────
Shell.tab({ key: 'about', label: 'About', group: 'footer', icon: 'about', mount(el) {
  el.innerHTML = `<div class="about">
    <img class="logo" src="../../assets/icons/icon-128.png" alt="">
    <h2>Cleanzy ${UI.esc(Shell.info.version || '')}</h2>
    <p>Finds caches, build leftovers and big forgotten files, and clears them the safe way.</p>
    <p class="muted">${UI.esc({ linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[Shell.info.platform] || Shell.info.platform || '')}</p>
    <ul>
      <li><b>Safe to Clean</b> items are rebuilt automatically. <b>Check First</b> items cost a re-download or a slower next build.</li>
      <li>Only folders a scan recognised can be cleaned. Your documents, keys, mail and settings are never touched.</li>
      <li>Everything goes to the Trash unless you choose Delete Permanently. System commands (like clearing the package cache) are permanent, and you are told first.</li>
      <li>No telemetry. Settings and history stay on this computer.</li>
    </ul></div>`;
} });

// ── startup ──────────────────────────────────────────────────────────
addEventListener('DOMContentLoaded', async () => {
  setTimeout(() => $('#splash')?.remove(), 8000);   // never stuck on the launch screen if startup fails
  const [info, settings] = await Promise.all([api.info(), api.settings()]);
  Shell.info = info; Object.assign(Shell.settings, settings); theme();
  document.documentElement.dataset.platform = info.platform;
  const order = { clean: 0, review: 1, footer: 2 };
  tabs.sort((a, b) => order[a.group] - order[b.group] || (a.key === 'about') - (b.key === 'about'));   // stable: registration order within a group
  for (const t of tabs) {
    if (t.platforms && !t.platforms.includes(info.platform)) continue;
    t.view = document.createElement('section');
    t.view.className = 'view'; t.view.id = 'view-' + t.key; t.view.hidden = true;
    t.view.setAttribute('aria-label', t.label);
    $('#views').append(t.view);
    const li = document.createElement('li');
    li.innerHTML = `<button class="tab" type="button" data-key="${t.key}">${UI.icon(t.icon)}<span class="lbl">${UI.esc(t.label)}</span><span class="sz"></span></button>`;
    t.btn = li.firstChild;
    t.btn.onclick = () => Shell.show(t.key);
    $('#nav-' + t.group).append(li);
  }
  for (const t of visible()) {
    try { t.mount(t.view); } catch (e) { console.error(t.key, e); t.view.innerHTML = `<div class="empty">This tab failed to load.</div>`; }
  }
  $('#scanBtn').onclick = () => (allRunning || tabs.some(t => Shell.results[t.key]?.scanning)) ? Shell.stop() : rescan();
  $('#cleanSafe').onclick = popover;
  api.onMenu(cmd => {
    if (cmd === 'scanAll') Shell.scanAll();
    else if (cmd === 'cleanSafe') Shell.cleanSafe();
    else if (cmd === 'cleaned') afterClean(['caches', 'devtools'], null);
    else if (cmd.startsWith('show:')) Shell.show(cmd.slice(5));
  });
  Shell.refreshDisk(); Shell.refreshTrash();
  Shell.show('overview');
  const sp = $('#splash');   // shown at least ~1 s so it reads as a launch screen, not a flicker
  setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 450); }, Math.max(0, 1000 - performance.now()));
  if (Shell.settings.onboarded) Shell.scanAll();
});
})();
