// App Caches tab: per-app caches and system junk, opens on Safe to Clean.
typeof Shell !== 'undefined' && Shell.tab({ key: 'caches', label: 'Temporary Files', group: 'clean', icon: 'caches', scan: true,
  mount(el) {
    el.innerHTML = `<p class="cc-sub muted">Rebuilt automatically — apps won't notice.</p><div></div>`;
    const list = UI.list(el.lastChild, { items: [], groupBy: i => i.group, defaultFilter: 'safe', sorts: ['size', 'date'], search: true,
      empty: 'No app caches to clean' });
    Shell.bus.addEventListener('results', e => {
      if (e.detail.key !== 'caches') return;
      const items = Shell.results.caches.items;
      el.firstChild.hidden = !items.some(i => i.safety === 'safe');   // the promise only holds for Safe rows
      list.set(items);
    });
  } });
