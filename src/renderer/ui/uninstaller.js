// Uninstaller tab: installed apps (list + per-app review sheet) and leftovers of deleted apps.
// darwin: app + leftovers go to the Trash through Shell.clean. linux: apt/snap/flatpak removal
// with the admin password. win32: opens the vendor's own uninstaller.
typeof Shell !== 'undefined' && Shell.tab({ key: 'uninstaller', label: 'Remove Apps', group: 'review', icon: 'apps', scan: true,
  mount(el) {
    const P = Shell.info.platform, esc = UI.esc, $ = s => el.querySelector(s);
    const KIND = { apt: 'Debian package', snap: 'Snap', flatpak: 'Flatpak' };
    let view = 'apps', q = '', sort = 'size', sys = false, apps = [], picked = new Set();

    el.innerHTML = `
      <div class="un-tools">
        <div class="seg" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" data-v="apps" aria-checked="true">Apps<span class="n"></span></button>
          <button type="button" role="radio" data-v="left" aria-checked="false"${P === 'win32' ? ' hidden' : ''}>Leftovers<span class="n"></span></button></div>
        <input type="search" data-search placeholder="Search apps" aria-label="Search apps">
        ${P === 'linux' ? '<label class="un-sys"><input type="checkbox"><span>Show system packages (<span class="num un-n">0</span>)</span></label>' : ''}
        <span class="sp"></span>
        <div class="seg un-view" role="radiogroup" aria-label="View"><button type="button" role="radio" data-g="list">List</button><button type="button" role="radio" data-g="grid">Grid</button></div>
        <label class="un-sort">Sort <select aria-label="Sort apps by"><option value="size">Size</option><option value="name">Name</option>
          ${P === 'darwin' ? '<option value="used">Last opened</option>' : ''}</select></label>
      </div>
      <div class="un-appv">
        <div class="un-apps" role="list" aria-label="Installed apps"></div>
        ${P === 'win32' ? '' : `<div class="bar"><div class="in"><span class="tot num">Tick apps to uninstall several at once, or click one to review it.</span>
          <span class="sp"></span><button class="btn primary" type="button" data-a="go" disabled>Uninstall</button></div></div>`}
      </div>
      <div class="un-left" hidden></div>`;
    let grid = false;
    try { grid = localStorage.getItem('un.grid') === '1'; } catch {}
    const left = UI.list($('.un-left'), { defaultFilter: 'all', search: true, groupBy: i => i.meta?.bundleId || i.group,
      empty: 'No leftovers from deleted apps. Nice and tidy.' });

    const tile = a => a.meta?.icon ? `<img class="un-ico" src="${esc(a.meta.icon)}" alt="">`
      : `<span class="un-ico un-mono" aria-hidden="true">${esc((a.name.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase())}</span>`;
    const opened = ms => { const t = UI.ago(ms); return !ms ? 'Not opened' : t === 'now' ? 'Last opened just now' : `Last opened ${t} ago`; };
    const sub = a => a.meta.kind === 'app' ? opened(a.meta.lastUsed)
      : a.meta.kind === 'win' ? (a.meta.publisher || 'Windows app')
      : [KIND[a.meta.kind], a.meta.locked && 'Part of the system'].filter(Boolean).join(' · ');
    const visible = () => apps.filter(a => sys || P !== 'linux' || a.meta.launcher);
    const shown = () => {
      const w = q.toLowerCase().split(/\s+/).filter(Boolean);
      const cmp = { size: (a, b) => b.size - a.size, name: (a, b) => a.name.localeCompare(b.name),
        used: (a, b) => (a.meta.lastUsed || 0) - (b.meta.lastUsed || 0) }[sort];   // least recently opened first
      return visible().filter(a => w.every(x => `${a.name} ${a.meta.pkgId || ''} ${a.meta.bundleId || ''} ${a.meta.publisher || ''}`.toLowerCase().includes(x))).sort(cmp);
    };

    function draw() {
      const r = Shell.results.uninstaller || {};
      const lefts = (r.items || []).filter(i => i.group === 'Leftover Files');
      el.querySelectorAll('.un-tools [data-v]').forEach(b => {
        b.setAttribute('aria-checked', b.dataset.v === view);
        b.querySelector('.n').textContent = r.at ? (b.dataset.v === 'apps' ? visible().length : lefts.length) : '';
      });
      $('.un-appv').hidden = view !== 'apps'; $('.un-left').hidden = view !== 'left';
      for (const s of ['[data-search]', '.un-sort', '.un-sys', '.un-view']) if ($(s)) $(s).hidden = view !== 'apps';
      if ($('.un-sys')) $('.un-n').textContent = apps.filter(a => !a.meta.launcher).length;
      const box = $('.un-apps'), v = shown();
      box.classList.toggle('grid', grid);
      el.querySelectorAll('.un-view button').forEach(b => b.setAttribute('aria-checked', (b.dataset.g === 'grid') === grid));
      box.classList.toggle('stale', !!r.stale);
      box.innerHTML = !r.at && r.scanning ? '<div class="empty"><span class="spin"></span>Looking for installed apps…</div>'
        : !v.length ? `<div class="empty">${apps.length ? 'No apps match your search.' : r.error ? esc(r.error) : r.at ? 'No apps found.' : 'Scan to list your apps.'}</div>`
        : v.map(a => `<div class="un-row${picked.has(a.id) ? ' on' : ''}" role="listitem" data-id="${esc(a.id)}">
            ${P === 'win32' ? '' : `<input type="checkbox" aria-label="Select ${esc(a.name)}"${picked.has(a.id) ? ' checked' : ''}${a.meta.locked ? ' disabled title="Part of the system"' : ''}>`}
            <button class="un-open" type="button" aria-label="Review ${esc(a.name)}, ${UI.fmt(a.size)}">${tile(a)}
              <span class="rmain"><span class="rname">${esc(a.name)}</span><span class="rwhy">${esc(sub(a))}</span></span>
              <span class="rsize">${a.size ? UI.fmt(a.size) : '—'}</span>${UI.icon('chevron')}</button></div>`).join('');
      bar();
    }
    function bar() {
      const go = $('[data-a=go]'); if (!go) return;
      const s = apps.filter(a => picked.has(a.id)), size = s.reduce((t, a) => t + a.size, 0);
      $('.bar .tot').textContent = s.length ? `${s.length} selected · ${UI.fmt(size)}` : 'Tick apps to uninstall several at once, or click one to review it.';
      go.textContent = s.length ? `Uninstall ${s.length} app${s.length === 1 ? '' : 's'}…` : 'Uninstall';
      go.disabled = !s.length || Shell.busy;
    }

    // ── review sheet: the app(s), their leftovers, what else goes ─────
    async function review(list) {
      const one = list.length === 1;
      const title = one ? `Uninstall ${list[0].name}?` : `Uninstall ${list.length} apps?`;
      const s = UI.sheet(`<h2>${esc(title)}</h2><div class="un-rv"><div class="empty"><span class="spin"></span>Checking what goes with ${one ? esc(list[0].name) : 'them'}…</div></div>`, { label: title });
      const plans = await Promise.all(list.map(a => api.mod('uninstaller', 'plan', a.id)));
      const live = await Promise.all(list.map(a => api.mod('uninstaller', 'running', a.id)));
      if (!s.el.isConnected) return;
      const items = new Map(), sel = new Set();
      const body = list.map((a, k) => {
        const p = plans[k] || {}, rows = Array.isArray(p.items) ? p.items : [a];
        rows.forEach(i => { items.set(i.id, i); if (i === rows[0] || i.pre) sel.add(i.id); });
        const lf = rows.slice(1), errs = p.error ? [p.error] : p.errors || [];
        return `<section class="un-app" data-k="${k}">
          <div class="un-ah">${tile(a)}<span class="rmain"><span class="rname">${esc(a.name)}</span><span class="rwhy">${esc(sub(a))}</span></span><b class="num">${UI.fmt(a.size)}</b></div>
          ${live[k] === true ? (P === 'darwin'
            ? `<div class="un-run" role="alert"><span>Quit ${esc(a.name)} first. It's open right now.</span><button class="btn" type="button" data-quit="${k}">Quit ${esc(a.name)}</button></div>`
            : `<p class="note" role="alert">${esc(a.name)} is running. Close it first so nothing is lost. <button class="btn" type="button" data-recheck="${k}">I've closed it</button></p>`) : ''}
          ${errs.map(e => `<p class="note">${esc(e)}</p>`).join('')}
          ${p.alsoRemoved?.length ? `<p class="muted">Also removes ${p.alsoRemoved.map(esc).join(', ')}</p>` : ''}
          ${a.meta.kind === 'app' || lf.length ? `<ul class="clist un-files">
            ${a.meta.kind !== 'app' ? '' : `<li><input type="checkbox" checked disabled aria-label="${esc(a.name)} app"><span class="rmain"><span class="rname">${esc(a.name)}.app</span><span class="rwhy">${esc(a.paths[0])}</span></span><span class="badge check">Check First</span><span class="rsize">${UI.fmt(a.size)}</span></li>`}
            ${lf.map(i => `<li><input type="checkbox" data-id="${esc(i.id)}"${sel.has(i.id) ? ' checked' : ''} aria-label="${esc(i.name)}"><span class="rmain"><span class="rname">${esc(i.name)}</span><span class="rwhy" title="${esc(i.paths[0])}">${esc(i.paths[0])}</span></span><span class="badge check">Check First</span><span class="rsize">${UI.fmt(i.size)}</span></li>`).join('')}
            ${(p.shared || []).map(x => `<li class="un-shared"><input type="checkbox" disabled aria-label="${esc(x.name)}, shared"><span class="rmain"><span class="rname">${esc(x.name)} · shared with another app</span><span class="rwhy">${esc(x.path)}</span></span><span class="rsize">${UI.fmt(x.size)}</span></li>`).join('')}
          </ul>` : ''}${a.meta.kind !== 'win' && !lf.length ? '<p class="muted">No leftovers found.</p>' : ''}
          ${a.meta.kind === 'win' ? `<p class="muted">Opens ${esc(a.name)}'s own uninstaller. Follow its steps, then scan again.</p>` : ''}
        </section>`;
      }).join('');
      const blocked = () => live.some(x => x === true);
      const ok = list.filter(a => !a.meta.locked);
      const total = () => [...items.values()].filter(i => sel.has(i.id)).reduce((t, i) => t + (i.size || 0), 0);
      const lefts = () => [...items.values()].filter(i => sel.has(i.id) && i.meta?.kind === 'leftover');
      const freed = () => P === 'linux' ? ok.reduce((t, a) => t + (plans[list.indexOf(a)]?.freed || a.size), 0) + lefts().reduce((t, i) => t + i.size, 0) : total();
      const verb = P === 'win32' ? 'Open Uninstaller' : 'Uninstall';
      s.el.querySelector('.un-rv').innerHTML = `${body}<div class="ctot"><span>${P === 'win32' ? 'Size' : 'Frees'}</span><b class="num"></b></div>
        <div class="acts"><button class="btn ghost" type="button" data-a="no">Cancel</button>
          <button class="btn primary" type="button" data-a="go">${verb}</button></div>`;
      const go = s.el.querySelector('[data-a=go]');
      const sync = () => { s.el.querySelector('.ctot b').textContent = UI.fmt(freed()); go.disabled = !ok.length || blocked() || Shell.busy; };
      sync(); s.el.querySelector('[data-a=no]').focus();   // Enter must not start a removal, like Empty Trash
      s.el.querySelector('[data-a=no]').onclick = s.close;
      s.el.addEventListener('change', e => { const id = e.target.dataset.id; if (id) { e.target.checked ? sel.add(id) : sel.delete(id); sync(); } });
      s.el.addEventListener('click', async e => {
        const rc = e.target.closest('[data-recheck]');
        if (rc) {
          const k = +rc.dataset.recheck;
          rc.disabled = true;
          live[k] = await api.mod('uninstaller', 'running', list[k].id);
          if (live[k] === true) { rc.disabled = false; UI.toast(`${list[k].name} is still running`, { kind: 'warn' }); }
          else { rc.closest('p').remove(); sync(); }
          return;
        }
        const b = e.target.closest('[data-quit]'); if (!b) return;
        const k = +b.dataset.quit, a = list[k];
        b.disabled = true; b.textContent = 'Quitting…';
        const r = await api.mod('uninstaller', 'quit', a.id);
        for (let t = 0; t < 10 && (live[k] = await api.mod('uninstaller', 'running', a.id)) === true; t++) await new Promise(r => setTimeout(r, 500));
        if (live[k] === true) { b.disabled = false; b.textContent = `Quit ${a.name}`; UI.toast(r?.error ? `Couldn't quit ${a.name}: ${r.error}` : `${a.name} is still open`, { kind: 'warn' }); return; }
        b.closest('.un-run').remove(); sync();
      });
      go.onclick = async () => {
        s.close();
        if (P === 'darwin') return Shell.clean([...items.values()].filter(i => sel.has(i.id)), { title, note: 'Files the app left behind. Reinstalling starts it with fresh settings.' });
        if (P === 'win32') {
          const r = await api.mod('uninstaller', 'winUninstall', list[0].id);
          return UI.toast(r?.started ? `Opened ${list[0].name}'s uninstaller. Scan again when it's done.` : `Couldn't start it: ${r?.error || 'unknown error'}`, { kind: r?.started ? 'ok' : 'warn' });
        }
        const pw = await UI.password({ title, why: `Removing ${ok.length === 1 ? 'an app' : 'apps'} needs your administrator password.` });
        if (pw == null) return;
        await remove(ok, pw, lefts());
      };
    }

    async function remove(list, password, lefts = []) {
      const go = $('[data-a=go]');
      if (go) { go.disabled = true; go.textContent = 'Removing…'; }
      const r = await api.mod('uninstaller', 'remove', { ids: list.map(a => a.id), password });
      const errs = Array.isArray(r) ? r : [{ path: '', msg: r?.error || 'failed' }];
      const n = list.length - errs.length;
      UI.toast(errs.length ? `${n ? `Removed ${n} · ` : ''}${errs[0].path}: ${errs[0].msg}` : `Removed ${list.length === 1 ? list[0].name : list.length + ' apps'}`,
        { kind: errs.length ? 'warn' : 'ok' });
      picked.clear();
      // the app's own folders go to the Trash once the package is gone (their own confirm sheet)
      const gone = Array.isArray(r) ? lefts.filter(i => !errs.some(e => e.path.split(', ').includes(i.group))) : [];
      if (gone.length) await Shell.clean(gone, { title: 'Move leftovers to Trash?', note: 'Settings and caches the removed apps left behind. Reinstalling starts them fresh.' });
      Shell.markStale(['uninstaller', 'caches']);
      Shell.refreshDisk();
      await Shell.scan('uninstaller');
    }

    // ── events ───────────────────────────────────────────────────────
    el.addEventListener('error', e => { if (e.target.matches?.('img.un-ico')) e.target.outerHTML = tile({ name: e.target.closest('[data-id]')?.querySelector('.rname')?.textContent || '?', meta: {} }); }, true);
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !el.contains(b) || $('.un-left').contains(b)) return;
      if (b.dataset.v) { view = b.dataset.v; draw(); }
      else if (b.dataset.g) { grid = b.dataset.g === 'grid'; try { localStorage.setItem('un.grid', grid ? '1' : ''); } catch {} draw(); }
      else if (b.classList.contains('un-open')) review([apps.find(a => a.id === b.closest('[data-id]').dataset.id)]);
      else if (b.dataset.a === 'go') review(apps.filter(a => picked.has(a.id)));
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if ($('.un-left').contains(t)) return;
      if (t.closest('.un-row')) { const id = t.closest('.un-row').dataset.id; t.checked ? picked.add(id) : picked.delete(id); t.closest('.un-row').classList.toggle('on', t.checked); bar(); }
      else if (t.closest('.un-sys')) { sys = t.checked; draw(); }
      else if (t.tagName === 'SELECT') { sort = t.value; draw(); }
    });
    $('[data-search]').addEventListener('input', e => { q = e.target.value; draw(); });
    addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && Shell.current === 'uninstaller' && view === 'apps' && !document.querySelector('.scrim')) {
        e.preventDefault(); $('[data-search]').focus();
      }
    });
    Shell.bus.addEventListener('busy', bar);
    Shell.bus.addEventListener('results', e => {
      if (e.detail.key !== 'uninstaller') return;
      const items = Shell.results.uninstaller.items || [];
      apps = items.filter(i => i.group === 'Apps');
      const ids = new Set(apps.map(a => a.id));
      for (const id of picked) if (!ids.has(id)) picked.delete(id);
      left.set(items.filter(i => i.group === 'Leftover Files'));
      draw();
    });
    draw();
  } });
