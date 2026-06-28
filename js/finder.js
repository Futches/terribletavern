const finder = (() => {
  const MOODS = [
    'Refreshing', 'Celebratory', 'Porch Sipper', 'Date Night',
    'Cozy', 'Adventurous', 'Contemplative', 'Nightcap',
    'Crowd Pleaser', 'Campfire', 'Brunch', 'Dessert'
  ];

  const SPIRITS = [
    { label: 'Whiskey / Bourbon / Rye', value: 'Whiskey / Bourbon / Rye' },
    { label: 'Tequila / Mezcal',        value: 'Tequila / Mezcal' },
    { label: 'Gin',                     value: 'Gin' },
    { label: 'Rum',                     value: 'Rum' },
    { label: 'Vodka',                   value: 'Vodka' },
    { label: 'Spritz / Sparkling',      value: 'Spritz / Sparkling' },
    { label: 'Amaro / Bitter-Forward',  value: 'Amaro / Bitter-Forward' },
    { label: 'Brandy / Cognac',         value: 'Brandy / Cognac' },
    { label: 'Surprise me',             value: null },
  ];

  const SEQUENCES = [
    { label: 'Opening round',  value: 'First Round' },
    { label: 'Mid-evening',    value: 'Any Time' },
    { label: 'Aperitif',       value: 'Aperitif' },
    { label: 'Nightcap',       value: 'Nightcap' },
    { label: 'Any point',      value: null },
  ];

  function getSeason() {
    const m = new Date().getMonth();
    if (m <= 1 || m === 11) return 'Winter';
    if (m <= 4)             return 'Spring';
    if (m <= 7)             return 'Summer';
    return 'Fall';
  }

  let cocktails = [];
  let substitutions = {};
  let barIngredients = {};
  let myBar = new Set();
  let state = { mood: null, spirit: null, sequence: null };
  let results = [];
  let resultIndex = 0;
  let history = [];

  async function loadData() {
    const [cRes, sRes, bRes] = await Promise.all([
      fetch('../data/cocktails.json'),
      fetch('../data/substitutions.json'),
      fetch('../data/bar-ingredients.json'),
    ]);
    cocktails = await cRes.json();
    substitutions = await sRes.json();
    barIngredients = await bRes.json();
    myBar = new Set(JSON.parse(localStorage.getItem('terribleTavernBar') || '[]'));
    updateMyBarLabel();
  }

  function updateMyBarLabel() {
    const label = document.getElementById('my-bar-label');
    if (!label) return;
    label.textContent = myBar.size > 0
      ? `My Bar (${myBar.size} items)`
      : 'Set Up My Bar';
  }

  // Check if a drink ingredient string matches a bar item's keywords
  function ingredientInBar(ingStr) {
    if (myBar.size === 0) return true;
    const lower = ingStr.toLowerCase();
    try {
      for (const tier of Object.values(barIngredients)) {
        if (!tier.categories) continue;
        for (const items of Object.values(tier.categories)) {
          for (const item of items) {
            if (!myBar.has(item.name)) continue;
            if (item.match.some(kw => lower.includes(kw))) return true;
          }
        }
      }
    } catch(e) { return true; }
    return false;
  }

  function drinkMakeability(drink) {
    if (myBar.size === 0) return { makeable: false, missing: [] };
    const ings = parseIngredients(drink.ingredients);
    const missing = ings.filter(i => !ingredientInBar(i));
    return { makeable: missing.length === 0, missing };
  }

  function showStep(id) {
    document.querySelectorAll('.finder-step').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function buildOptions(containerId, items, onSelect) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = typeof item === 'string' ? item : item.label;
      btn.addEventListener('click', () => onSelect(typeof item === 'string' ? item : item.value));
      container.appendChild(btn);
    });
  }

  function filterWith(mood, spirit, sequence, useSeason) {
    const season = getSeason();
    const filtered = cocktails.filter(d => {
      const seasonOk = !useSeason || d.season === season || d.season === 'All-Season';
      const moodOk   = !mood     || d.moods.includes(mood);
      const spiritOk = !spirit   || d.category === spirit;
      const seqOk    = !sequence || d.sequence === sequence || d.sequence === 'Any Time';
      return seasonOk && moodOk && spiritOk && seqOk;
    });

    // Sort: makeable drinks first (if bar is set up), then by mood score
    return filtered.sort((a, b) => {
      if (myBar.size > 0) {
        const aMake = drinkMakeability(a).makeable ? 1 : 0;
        const bMake = drinkMakeability(b).makeable ? 1 : 0;
        if (bMake !== aMake) return bMake - aMake;
      }
      return b.mood_score - a.mood_score;
    });
  }

  function filter() {
    const attempts = [
      () => filterWith(state.mood, state.spirit, state.sequence, true),
      () => filterWith(state.mood, state.spirit, null,           true),
      () => filterWith(state.mood, null,          null,           true),
      () => filterWith(state.mood, state.spirit, state.sequence, false),
      () => filterWith(state.mood, state.spirit, null,           false),
      () => filterWith(state.mood, null,          null,           false),
      () => filterWith(null,       null,          null,           false),
    ];
    for (const attempt of attempts) {
      const r = attempt();
      if (r.length > 0) return r;
    }
    return [];
  }

  function parseIngredients(raw) {
    if (!raw) return [];
    return raw.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  }

  function lookupSub(ingredient) {
    const lower = ingredient.toLowerCase().replace(/^\d[\d./ ]*oz\s*/i, '').replace(/fresh\s+/i, '').trim();
    for (const key of Object.keys(substitutions)) {
      if (lower.includes(key)) return substitutions[key];
    }
    return null;
  }

  function renderResult() {
    const drink = results[resultIndex];
    const season = getSeason();
    const { makeable, missing } = drinkMakeability(drink);

    document.getElementById('result-count').textContent =
      `Result ${resultIndex + 1} of ${results.length}`;
    document.getElementById('result-season').textContent = season;
    document.getElementById('drink-name').textContent = drink.name;

    const meta = [drink.category, drink.glass, drink.ice].filter(Boolean).join(' · ');
    document.getElementById('drink-meta').textContent = meta;

    // Makeable badge
    let badge = document.getElementById('makeable-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'makeable-badge';
      document.getElementById('drink-meta').after(badge);
    }
    if (myBar.size > 0 && makeable) {
      badge.className = 'makeable-badge';
      badge.textContent = '✓ You can make this';
    } else {
      badge.className = '';
      badge.textContent = '';
    }

    const ingredients = parseIngredients(drink.ingredients);
    const list = document.getElementById('ingredient-list');
    list.innerHTML = '';

    ingredients.forEach(ing => {
      const sub = lookupSub(ing);
      const have = ingredientInBar(ing);
      const li = document.createElement('li');
      li.className = 'ingredient-item';

      const row = document.createElement('div');
      row.className = 'ingredient-row';

      const name = document.createElement('span');
      name.className = 'ingredient-name' + (myBar.size > 0 && !have ? ' missing' : '');
      name.textContent = ing;
      row.appendChild(name);

      if (sub) {
        const btn = document.createElement('button');
        btn.className = 'sub-toggle';
        btn.textContent = 'No this?';
        const subEl = document.createElement('div');
        subEl.className = 'substitution';
        subEl.textContent = sub;
        btn.addEventListener('click', () => {
          const open = subEl.classList.toggle('visible');
          btn.classList.toggle('open', open);
          btn.textContent = open ? 'Got it' : 'No this?';
        });
        row.appendChild(btn);
        li.appendChild(row);
        li.appendChild(subEl);
      } else {
        li.appendChild(row);
      }

      list.appendChild(li);
    });

    const methodEl = document.getElementById('drink-method');
    const methodSection = document.getElementById('method-section');
    if (drink.method && drink.method !== 'nan') {
      methodEl.textContent = drink.method;
      methodSection.style.display = '';
    } else {
      methodSection.style.display = 'none';
    }

    const notesEl = document.getElementById('drink-notes');
    const notesSection = document.getElementById('notes-section');
    if (drink.notes && drink.notes !== 'nan') {
      notesEl.textContent = drink.notes;
      notesSection.style.display = '';
    } else {
      notesSection.style.display = 'none';
    }

    showStep('step-result');
  }

  // ── My Bar ──────────────────────────────────────────────────────────────

  function openMyBar() {
    if (!barIngredients || !barIngredients['Essentials']) {
      loadData().then(() => openMyBar()).catch(console.error);
      return;
    }
    const container = document.getElementById('mybar-categories');
    container.innerHTML = '';

    const tierOrder = ['Essentials', 'Advanced', 'Deep Cuts'];

    function buildChip(item) {
      const chip = document.createElement('div');
      chip.className = 'mybar-chip' + (myBar.has(item.name) ? ' checked' : '');
      chip.textContent = item.name;
      chip.dataset.itemName = item.name;
      chip.addEventListener('click', () => {
        if (myBar.has(item.name)) {
          myBar.delete(item.name);
          document.querySelectorAll(`.mybar-chip[data-item-name="${CSS.escape(item.name)}"]`)
            .forEach(c => c.classList.remove('checked'));
        } else {
          myBar.add(item.name);
          document.querySelectorAll(`.mybar-chip[data-item-name="${CSS.escape(item.name)}"]`)
            .forEach(c => c.classList.add('checked'));
        }
        updateCount();
      });
      return chip;
    }

    function appendTierCategories(tierName, body) {
      const tier = barIngredients[tierName];
      for (const [catName, items] of Object.entries(tier.categories)) {
        const section = document.createElement('div');
        section.className = 'mybar-category';
        const title = document.createElement('div');
        title.className = 'mybar-category-title';
        title.textContent = catName;
        section.appendChild(title);
        const chips = document.createElement('div');
        chips.className = 'mybar-items';
        items.forEach(item => chips.appendChild(buildChip(item)));
        section.appendChild(chips);
        body.appendChild(section);
      }
    }

    tierOrder.forEach((tierName, i) => {
      const tier = barIngredients[tierName];
      const tierEl = document.createElement('div');
      tierEl.className = 'mybar-tier';

      const header = document.createElement('div');
      header.className = 'mybar-tier-header';
      header.innerHTML = `
        <div>
          <div class="mybar-tier-title">${tierName}</div>
          <div class="mybar-tier-desc">${tier.description}</div>
        </div>
        <div class="mybar-tier-toggle">${i === 0 ? '▲' : '▼ Show'}</div>
      `;

      const body = document.createElement('div');
      body.className = 'mybar-tier-body' + (i === 0 ? ' open' : '');

      header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        header.querySelector('.mybar-tier-toggle').textContent = isOpen ? '▲' : '▼ Show';
      });

      // Show this tier plus all preceding tiers, with divider labels between them
      const tiersToShow = tierOrder.slice(0, i + 1);
      tiersToShow.forEach(name => {
        if (tiersToShow.length > 1) {
          const divider = document.createElement('div');
          divider.className = 'mybar-tier-divider';
          divider.textContent = name;
          body.appendChild(divider);
        }
        appendTierCategories(name, body);
      });

      tierEl.appendChild(header);
      tierEl.appendChild(body);
      container.appendChild(tierEl);
    });

    updateCount();
    showStep('step-mybar');
  }

  function updateCount() {
    const el = document.getElementById('mybar-count');
    if (el) el.textContent = myBar.size > 0 ? `${myBar.size} selected` : '';
  }

  function saveMyBar() {
    localStorage.setItem('terribleTavernBar', JSON.stringify([...myBar]));
    updateMyBarLabel();
    showStep('step-welcome');
  }

  function clearMyBar() {
    myBar.clear();
    localStorage.removeItem('terribleTavernBar');
    updateMyBarLabel();
    document.querySelectorAll('.mybar-chip').forEach(c => c.classList.remove('checked'));
    updateCount();
  }

  // ── Guided flow ─────────────────────────────────────────────────────────

  function start() {
    buildOptions('mood-options', MOODS, mood => {
      state.mood = mood;
      buildOptions('spirit-options', SPIRITS, spirit => {
        state.spirit = spirit;
        buildOptions('sequence-options', SEQUENCES, sequence => {
          state.sequence = sequence;
          results = filter();
          resultIndex = 0;
          history = [];
          if (results.length === 0) {
            showStep('step-noresults');
          } else {
            renderResult();
          }
        });
        showStep('step-sequence');
      });
      showStep('step-spirit');
    });
    showStep('step-mood');
  }

  function next() {
    if (results.length === 0) return;
    history.push(resultIndex);
    resultIndex = (resultIndex + 1) % results.length;
    renderResult();
  }

  function back() {
    if (history.length > 0) {
      resultIndex = history.pop();
      renderResult();
    } else {
      restart();
    }
  }

  function share() {
    const drink = results[resultIndex];
    if (!drink) return;
    const ingredients = parseIngredients(drink.ingredients).join('\n  • ');
    const text = [
      `🍹 ${drink.name}`,
      `\nIngredients:\n  • ${ingredients}`,
      drink.method && drink.method !== 'nan' ? `\nHow to make it:\n  ${drink.method}` : '',
      drink.notes && drink.notes !== 'nan'   ? `\nNotes:\n  ${drink.notes}` : '',
      `\n— Found at terribletavern.com/finder`,
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      navigator.share({ title: drink.name, text }).catch(() => {});
    } else {
      window.open(`sms:?body=${encodeURIComponent(text)}`);
    }
  }

  function openSearch() {
    showStep('step-search');
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
    setTimeout(() => document.getElementById('search-input').focus(), 100);
  }

  function onSearch(query) {
    const list = document.getElementById('search-results');
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    if (!q) return;

    const matches = cocktails
      .filter(d => d.name.toLowerCase().includes(q))
      .slice(0, 20);

    if (matches.length === 0) {
      list.innerHTML = '<li class="search-empty">No drinks found.</li>';
      return;
    }

    matches.forEach(drink => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      const { makeable } = drinkMakeability(drink);
      const badge = (myBar.size > 0 && makeable) ? ' ✓' : '';
      li.innerHTML = `
        <div class="search-result-name">${drink.name}${badge}</div>
        <div class="search-result-meta">${drink.category}</div>
      `;
      li.addEventListener('click', () => {
        results = [drink];
        resultIndex = 0;
        history = [];
        renderResult();
      });
      list.appendChild(li);
    });
  }

  function restart() {
    state = { mood: null, spirit: null, sequence: null };
    results = [];
    resultIndex = 0;
    history = [];
    showStep('step-welcome');
  }

  loadData().catch(console.error);

  return { start, next, back, restart, share, openSearch, onSearch, openMyBar, saveMyBar, clearMyBar };
})();
