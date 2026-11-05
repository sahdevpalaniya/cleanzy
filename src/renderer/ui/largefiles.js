// Large Files tab: big files, duplicates and local AI models. All rows are the
// user's own files: Check First, never preselected, cleaned to Trash only.
typeof Shell !== 'undefined' && Shell.tab({ key: 'largefiles', label: 'Large Files', group: 'review', icon: 'files', scan: true,
  mount(el) {
    const MB = 1 << 20, DAY = 864e5;
    const CATS = { all: 'All', videos: 'Videos', audio: 'Audio', images: 'Images', pdfs: 'PDFs', archives: 'Archives',
      documents: 'Documents', models: 'AI models', other: 'Other', dups: 'Duplicates' };
    const SIZES = [[5, '5 MB'], [10, '10 MB'], [50, '50 MB'], [100, '100 MB'], [500, '500 MB'], [1024, '1 GB']];
    const AGES = [[0, 'Any time'], [30, 'Over 1 month ago'], [182, 'Over 6 months ago'], [365, 'Over 1 year ago']];   // by last opened
    let cat = 'all', min = 5, age = 0, q = '';   // 5 MB = the scanner's floor, so the tab matches the sidebar
    const keeper = new Map();   // dupKey -> id of the copy to keep
    const copies = n => `${n} other cop${n === 1 ? 'y' : 'ies'}`;

    el.innerHTML = `<p class="lf-sub muted">Your own files, biggest first. Nothing is selected for you, and everything goes to the Trash.</p>
      <div class="lhead lf-bar">
        <input type="search" data-search placeholder="Search name or folder" aria-label="Search name or folder">
        <label>At least <select data-size aria-label="Minimum size">${SIZES.map(([v, l]) => `<option value="${v}"${v === min ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Last opened <select data-age aria-label="Last opened">${AGES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>
      <div class="lf-chips" role="radiogroup" aria-label="Category"></div>
      <div class="lf-dup" hidden><span class="muted">Byte-identical copies. Pick the one to keep in each group, or let Cleanzy keep the oldest.</span>
        <button class="btn" type="button" data-keep>Keep one of each</button></div>
      <div class="empty lf-wait" hidden><span class="spin"></span> Looking through your folders…</div>
      <div class="lf-list"></div>`;
    const $ = s => el.querySelector(s), chips = $('.lf-chips'), host = $('.lf-list');

    const isKeeper = i => keeper.get(i.meta.dupKey) === i.id;
    const list = UI.list(host, { items: [], filters: false, defaultFilter: 'all', preselect: () => false, selectAll: false,
      // note: two duplicate sets whose kept copy has the same name share one header
      groupBy: i => cat === 'dups' ? `${all().find(x => x.id === keeper.get(i.meta.dupKey))?.name || i.name} · ${i.meta.copies} copies` : i.group,
      empty: 'No large files found',
      note: 'These are your own files. They go to the Trash, so you can put them back until you empty it.',
      row: i => `<span class="rname">${UI.esc(i.name)}${i.meta?.copies > 1 ? ` <span class="lf-copies">${copies(i.meta.copies - 1)}</span>` : ''}</span>
        <span class="rwhy">${UI.esc(i.meta?.dir || '')}</span>
        ${cat === 'dups' ? `<span class="lf-keep"><input type="radio" name="keep-${UI.esc(i.meta.dupKey)}" aria-label="Keep this copy of ${UI.esc(i.name)}"${isKeeper(i) ? ' checked' : ''}> Keep this</span>` : ''}` });

    list.focusSearch = () => $('[data-search]').focus();   // Ctrl+F: the box sits outside the list
    const all = () => Shell.results.largefiles?.items || [];
    const base = () => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean), old = Date.now() - age * DAY;
      return all().filter(i => i.size >= min * MB && (!age || ((i.meta?.atime || i.mtime) && (i.meta?.atime || i.mtime) < old)) &&
        words.every(w => `${i.name} ${i.meta?.dir || ''}`.toLowerCase().includes(w)));
    };
    const inCat = (i, c) => c === 'all' || (c === 'dups' ? i.meta?.copies > 1 : i.meta?.cat === c);
    const apply = () => {
      const b = base();
      chips.innerHTML = Object.entries(CATS).map(([c, l]) => {
        const n = b.filter(i => inCat(i, c)).length;
        return `<button type="button" class="lf-chip${c === 'dups' ? ' lf-dchip' : ''}" role="radio" data-cat="${c}" aria-checked="${c === cat}"
          ${n || c === cat || c === 'all' ? '' : 'hidden'}>${l}<span class="n">${n}</span></button>`;
      }).join('');
      // the oldest copy is the default keeper
      for (const i of all()) if (i.meta?.dupKey) {
        const k = all().find(x => x.id === keeper.get(i.meta.dupKey));
        if (!k || (i.mtime || 0) < (k.mtime || 0)) keeper.set(i.meta.dupKey, i.id);
      }
      $('.lf-dup').hidden = cat !== 'dups';
      chips.hidden = !b.length; host.querySelector('.lhead').hidden = !b.length;   // no lone 'All 0' + Sort rows over an empty list
      $('.lf-wait').hidden = !(host.hidden = !!Shell.results.largefiles?.scanning && !all().length);
      const keep = list.selected().map(i => i.id);
      list.set(b.filter(i => inCat(i, cat)));
      list.select(keep);
      if (cat === 'dups') list.select(all().filter(i => i.meta?.dupKey && isKeeper(i)).map(i => i.id), false);   // the kept copy is never ticked
    };
    Shell.bus.addEventListener('results', e => { if (e.detail.key === 'largefiles') apply(); });

    $('.lf-bar').addEventListener('input', e => {
      if (e.target.dataset.search !== undefined) q = e.target.value;
      else if (e.target.dataset.size) min = +e.target.value;
      else if (e.target.dataset.age !== undefined) age = +e.target.value;
      apply();
    });
    chips.addEventListener('click', e => { const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; apply(); } });
    chips.addEventListener('keydown', e => {   // arrow keys move between chips, like any radio group
      const bs = [...chips.querySelectorAll('button:not([hidden])')], i = bs.indexOf(document.activeElement);
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (i < 0 || !d) return;
      e.preventDefault(); cat = bs[(i + d + bs.length) % bs.length].dataset.cat; apply();
      chips.querySelector(`[data-cat="${cat}"]`).focus();
    });
    // select every copy except the keeper, in every duplicate group on screen
    const keepOne = groups => {
      const shown = base().filter(i => groups.includes(i.meta?.dupKey));
      list.select(shown.map(i => i.id), false);
      list.select(shown.filter(i => !isKeeper(i)).map(i => i.id));
    };
    $('[data-keep]').addEventListener('click', () => keepOne([...new Set(base().map(i => i.meta?.dupKey).filter(Boolean))]));
    // 'Keep this' radio: captured before the shared list's change handler, which would tick the row
    host.addEventListener('change', e => {
      if (e.target.type !== 'radio') return;
      e.stopPropagation();
      const i = all().find(x => x.id === e.target.closest('.row').dataset.id), k = i.meta.dupKey;
      const touched = list.selected().some(x => x.meta?.dupKey === k);
      keeper.set(k, i.id);
      touched ? keepOne([k]) : list.select([i.id], false);
    }, true);
    // 'Keep this' text picks the radio instead of ticking the row through its <label>
    host.addEventListener('click', e => {
      const k = e.target.closest('.lf-keep');
      if (k && e.target.type !== 'radio') { e.preventDefault(); k.querySelector('input').click(); }
    }, true);
  } });
