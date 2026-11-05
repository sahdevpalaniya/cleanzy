// Dev Tools tab: global tool caches, simulators, worktrees, then projects by size.
typeof Shell !== 'undefined' && Shell.tab({ key: 'devtools', label: 'Developer Junk', group: 'clean', icon: 'dev', scan: true,
  mount(el) {
    const AGES = window.STALE;   // settings.js, so both places read the same
    el.insertAdjacentHTML('beforeend', `<div class="dvbar">
      <label>Hide projects used in the last <select aria-label="Hide projects used recently">${AGES.map(([d, l]) =>
        `<option value="${d}">${l}</option>`).join('')}</select></label>
      <span class="muted dvnote" role="status"></span></div><div></div>`);
    const sel = el.querySelector('.dvbar select'), note = el.querySelector('.dvnote');
    const sync = () => {
      sel.value = AGES.some(([d]) => d === Shell.settings.staleDays) ? Shell.settings.staleDays : 90;
      sel.closest('label').firstChild.textContent = +sel.value ? 'Hide projects used in the last ' : 'Projects: ';
    };
    sync();
    sel.addEventListener('change', async () => {
      await Shell.saveSettings({ staleDays: +sel.value });
      Shell.scan('devtools');
    });
    Shell.bus.addEventListener('settings', sync);
    const RANK = { 'Global caches': 0, 'Tool leftovers': 1, Docker: 2, Simulators: 3, Worktrees: 4 };
    const rank = g => RANK[g] ?? 5;
    let hid = 0;   // recent projects the recency filter left out
    const hint = () => `${hid} recent project${hid === 1 ? '' : 's'} hidden (used in the last ${UI.esc(sel.selectedOptions[0].text)})`;
    const list = UI.list(el.lastElementChild, { items: [], defaultFilter: 'safe', search: true, groupOrder: (a, b) => rank(a) - rank(b),
      // an empty list must not read as "the scan missed it" when the filter hid projects
      empty: () => hid ? `${hint()} · <button class="link" type="button" data-all>Show all</button>` : 'No developer caches or stale project folders found' });
    el.addEventListener('click', e => {
      if (!e.target.closest('[data-all]')) return;
      sel.value = 0; sel.dispatchEvent(new Event('change'));
    });
    Shell.bus.addEventListener('results', async e => {
      if (e.detail.key !== 'devtools') return;
      const r = Shell.results.devtools, tot = new Map();
      note.textContent = r.scanning ? 'Scanning projects…' : r.error ? r.error : '';
      // say when the recency filter hid projects, so an empty list isn't mistaken for "nothing there"
      hid = !r.scanning && +sel.value ? +await api.mod('devtools', 'hidden') || 0 : 0;
      if (hid && !note.textContent) note.innerHTML = `${hint()} · <button class="link" type="button" data-all>Show all</button>`;
      for (const i of r.items) tot.set(i.group, (tot.get(i.group) || 0) + i.size);
      list.set([...r.items].sort((a, b) => rank(a.group) - rank(b.group) || tot.get(b.group) - tot.get(a.group)
        || a.group.localeCompare(b.group) || b.size - a.size));
    });
  } });
