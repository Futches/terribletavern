const finder = (() => {
  const MOODS = [
    'Refreshing', 'Celebratory', 'Porch Sipper', 'Date Night',
    'Cozy', 'Adventurous', 'Contemplative', 'Nightcap',
    'Crowd Pleaser', 'Campfire', 'Dessert',
    'Day Drinking', 'Tailgating', 'Venting'
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
  let spiritSubs = {};
  let barIngredients = {};
  let easySubs = [];
  let myBar = new Set();
  let customBar = []; // [{name, category}]
  let tavernMode = false;
  let state = { mode: null, mood: [], spirit: [], sequence: [], pendingStart: false };
  const MAX_SELECT = 3;
  let results = [];
  let lastFilterWasUnmakeable = false;
  let lastMenu = [];
  let searchMode = 'name';       // 'name' | 'ingredient'
  let recipeIngIndex = [];       // lazily built, powers ingredient autocomplete
  let resultIndex = 0;
  let history = [];

  async function loadData() {
    const params = new URLSearchParams(window.location.search);
    tavernMode = params.has('tavern');

    const [cRes, sRes, bRes, ssRes, esRes] = await Promise.all([
      fetch('../data/cocktails.json'),
      fetch('../data/substitutions.json'),
      fetch('../data/bar-ingredients.json'),
      fetch('../data/spirit-subs.json'),
      fetch('../data/easy-substitutions.json'),
    ]);
    cocktails = await cRes.json();
    substitutions = await sRes.json();
    barIngredients = await bRes.json();
    spiritSubs = await ssRes.json();
    easySubs = await esRes.json();

    if (tavernMode) {
      try {
        const r = await fetch('../data/tavern-tonight.json?t=' + Date.now());
        const d = await r.json();
        myBar = new Set(d.items || []);
        const banner = document.getElementById('tavern-banner');
        if (banner) banner.style.display = 'block';
      } catch(e) {
        tavernMode = false;
        myBar = new Set(JSON.parse(localStorage.getItem('terribleTavernBar') || '[]'));
      }
    } else {
      myBar = new Set(JSON.parse(localStorage.getItem('terribleTavernBar') || '[]'));
    }
    customBar = JSON.parse(localStorage.getItem('terribleTavernCustomBar') || '[]').filter(i => i && i.name && i.category && i.category !== 'undefined');
    updateMyBarLabel();
  }

  function updateMyBarLabel() {
    const label = document.getElementById('my-bar-label');
    if (!label) return;
    const total = myBar.size + customBar.length;
    if (tavernMode) {
      label.textContent = `🍸 Tonight's Bar (${myBar.size} items)`;
    } else {
      label.textContent = total > 0 ? `My Bar (${total} items)` : 'Set Up My Bar';
    }
  }

  // Whole-word keyword matcher (allows a trailing plural s/es), compiled once per keyword.
  // Plain substring matching wrongly satisfies "ginger beer" from "gin", "lemonade" from
  // "lemon", "pineapple juice" from "apple juice", etc.
  const kwRegexCache = new Map();
  function keywordMatches(kw, lower) {
    let re = kwRegexCache.get(kw);
    if (!re) {
      re = new RegExp('(?<![a-z])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es)?(?![a-z])', 'i');
      kwRegexCache.set(kw, re);
    }
    return re.test(lower);
  }

  // Check if a drink ingredient string matches a bar item's keywords
  function ingredientInBar(ingStr) {
    if (myBar.size === 0 && customBar.length === 0) return true;
    const lower = ingStr.toLowerCase();
    try {
      for (const tier of Object.values(barIngredients)) {
        if (!tier.categories) continue;
        for (const items of Object.values(tier.categories)) {
          for (const item of items) {
            if (!myBar.has(item.name)) continue;
            if (item.match.some(kw => keywordMatches(kw, lower))) return true;
          }
        }
      }
    } catch(e) { return false; }
    for (const custom of customBar) {
      if (custom.checked === false) continue;
      if (keywordMatches(custom.name.toLowerCase(), lower)) return true;
    }
    return false;
  }

  function drinkMakeability(drink) {
    if (myBar.size === 0 && customBar.length === 0) return { makeable: false, missing: [] };
    const ings = parseIngredients(drink.ingredients);
    const missing = ings.filter(i => !ingredientInBar(i));
    return { makeable: missing.length === 0, missing };
  }

  // Is a missing ingredient covered by an easy 1-for-1 swap the user already has?
  function isEasilySubstitutable(ingredientStr) {
    const lower = ingredientStr.toLowerCase();
    for (const group of easySubs) {
      const matched = group.find(kw => lower.includes(kw));
      if (!matched) continue;
      if (group.some(kw => kw !== matched && ingredientInBar(kw))) return true;
    }
    return false;
  }

  // Menu eligibility: makeable outright, or every missing ingredient has an easy swap in stock
  function menuEligibility(drink) {
    const barIsSetUp = myBar.size > 0 || customBar.length > 0;
    if (!barIsSetUp) return { eligible: true, makeable: true, substituted: false, missing: [] };
    const ings = parseIngredients(drink.ingredients);
    const missing = ings.filter(i => !ingredientInBar(i));
    if (missing.length === 0) return { eligible: true, makeable: true, substituted: false, missing: [] };
    const allSubbable = missing.every(m => isEasilySubstitutable(m));
    return { eligible: allSubbable, makeable: false, substituted: allSubbable, missing };
  }

  function poolForCategory(category) {
    const season = getSeason();
    const attempts = [
      { mood: state.mood, sequence: state.sequence, season: true },
      { mood: state.mood, sequence: [],             season: true },
      { mood: state.mood, sequence: state.sequence, season: false },
      { mood: state.mood, sequence: [],             season: false },
      { mood: [],         sequence: [],             season: false },
    ];
    for (const a of attempts) {
      const pool = cocktails.filter(d => {
        if (d.category !== category) return false;
        const seasonOk = !a.season || d.season === season || d.season === 'All-Season';
        const moodOk   = !a.mood.length     || a.mood.some(m => d.moods.includes(m));
        const seqOk    = !a.sequence.length || a.sequence.some(s => d.sequence === s || d.sequence === 'Any Time');
        return seasonOk && moodOk && seqOk;
      });
      if (pool.length > 0) return pool;
    }
    return [];
  }

  function buildMenu() {
    const spiritOrder = SPIRITS.filter(s => s.value !== null).map(s => s.value);
    const spiritsToUse = state.spirit.length > 0
      ? spiritOrder.filter(v => state.spirit.includes(v))
      : spiritOrder;
    const perCap = state.spirit.length > 0 ? 3 : 2;

    const menu = [];
    spiritsToUse.forEach(category => {
      const pool = poolForCategory(category);
      const scored = pool
        .map(d => ({ d, elig: menuEligibility(d) }))
        .filter(x => x.elig.eligible)
        .sort((a, b) => {
          if (a.elig.makeable !== b.elig.makeable) return (b.elig.makeable ? 1 : 0) - (a.elig.makeable ? 1 : 0);
          return b.d.mood_score - a.d.mood_score;
        });
      if (scored.length === 0) return; // omit category — nothing makeable or easily substitutable
      const top = scored.slice(0, perCap).map(x => Object.assign({}, x.d, { _menuEligibility: x.elig }));
      menu.push({ category, drinks: top });
    });
    return menu;
  }

  function showStep(id) {
    document.querySelectorAll('.finder-step').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function buildOptions(containerId, items, continueBtnId, onAdvance) {
    const container = document.getElementById(containerId);
    const continueBtn = document.getElementById(continueBtnId);
    container.innerHTML = '';
    continueBtn.style.display = 'none';
    const selected = new Set();

    items.forEach(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = label;

      if (value === null) {
        // Wildcard option (e.g. "Surprise me") — bypasses multi-select entirely
        btn.addEventListener('click', () => onAdvance([]));
      } else {
        btn.addEventListener('click', () => {
          if (selected.has(value)) {
            selected.delete(value);
            btn.classList.remove('selected');
          } else {
            if (selected.size >= MAX_SELECT) return;
            selected.add(value);
            btn.classList.add('selected');
          }
          continueBtn.style.display = selected.size > 0 ? 'block' : 'none';
        });
      }
      container.appendChild(btn);
    });

    continueBtn.onclick = () => onAdvance(Array.from(selected));
  }

  function filterWith(moods, spirits, sequences, useSeason, requireMakeable) {
    const season = getSeason();
    const filtered = cocktails.filter(d => {
      const seasonOk = !useSeason || d.season === season || d.season === 'All-Season';
      const moodOk   = !moods.length     || moods.some(m => d.moods.includes(m));
      const spiritOk = !spirits.length   || spirits.includes(d.category);
      const seqOk    = !sequences.length || sequences.some(s => d.sequence === s || d.sequence === 'Any Time');
      const makeOk   = !requireMakeable || drinkMakeability(d).makeable;
      return seasonOk && moodOk && spiritOk && seqOk && makeOk;
    });

    return filtered.sort((a, b) => b.mood_score - a.mood_score);
  }

  function filter() {
    const barIsSetUp = myBar.size > 0 || customBar.length > 0;
    const attempts = [
      () => filterWith(state.mood, state.spirit, state.sequence, true,  barIsSetUp),
      () => filterWith(state.mood, state.spirit, [],             true,  barIsSetUp),
      () => filterWith(state.mood, state.spirit, state.sequence, false, barIsSetUp),
      () => filterWith(state.mood, state.spirit, [],             false, barIsSetUp),
      () => filterWith([],         state.spirit, [],             false, barIsSetUp),
      () => filterWith(state.mood, [],            [],             false, barIsSetUp),
      () => filterWith([],         [],            [],             false, barIsSetUp),
      // Last resort: relax makeability so the user still gets a result,
      // but the caller is told via lastFilterWasUnmakeable.
      () => filterWith(state.mood, state.spirit, state.sequence, true,  false),
      () => filterWith(state.mood, state.spirit, [],             true,  false),
      () => filterWith(state.mood, state.spirit, state.sequence, false, false),
      () => filterWith(state.mood, state.spirit, [],             false, false),
      () => filterWith([],         state.spirit, [],             false, false),
      () => filterWith(state.mood, [],            [],             false, false),
      () => filterWith([],         [],            [],             false, false),
    ];
    for (let idx = 0; idx < attempts.length; idx++) {
      const r = attempts[idx]();
      if (r.length > 0) {
        lastFilterWasUnmakeable = barIsSetUp && idx >= 7;
        return r;
      }
    }
    lastFilterWasUnmakeable = false;
    return [];
  }

  function parseIngredients(raw) {
    if (!raw) return [];
    return raw.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  }

  function stripQuantity(ing) {
    return ing
      .replace(/^\d[\d./\-\s]*(oz|ml|dashes?|tsp|tbsp|cups?|rinse|splash|drops?|parts?|bar\s?spoons?|pinch|scoop|whole|large|small|medium|leaves?|slices?|wedges?|sprigs?)?\.?\s*/i, '')
      .replace(/^(top with|fresh|frozen|muddled|dried|ground|crushed|cracked|grated|sliced|cubed|chilled|warm|hot)\s+/i, '')
      .trim();
  }

  function buildRecipeIngredientIndex() {
    const seen = new Set();
    (cocktails || []).forEach(drink => {
      parseIngredients(drink.ingredients).forEach(ing => {
        const name = stripQuantity(ing);
        if (name && name.length > 2) seen.add(name);
      });
    });
    return Array.from(seen).sort();
  }

  function lookupSub(ingredient) {
    const lower = ingredient.toLowerCase().replace(/^\d[\d./ ]*oz\s*/i, '').replace(/fresh\s+/i, '').trim();
    const keys = Object.keys(substitutions).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const re = new RegExp(`(?<![a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i');
      if (re.test(lower)) return substitutions[key];
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
    const barIsSetUp = myBar.size > 0 || customBar.length > 0;
    if (barIsSetUp && makeable) {
      badge.className = 'makeable-badge';
      badge.innerHTML = '<span class="makeable-check">✓</span> Makeable';
    } else if (barIsSetUp && lastFilterWasUnmakeable) {
      badge.className = 'makeable-badge missing';
      badge.innerHTML = `<span class="makeable-check unmakeable">✗</span> Missing: ${missing.join(', ')}`;
    } else {
      badge.className = '';
      badge.innerHTML = '';
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
      name.className = 'ingredient-name' + (barIsSetUp && !have ? ' missing' : '');
      name.textContent = ing;
      row.appendChild(name);

      if (sub) {
        const btn = document.createElement('button');
        btn.className = 'sub-toggle';
        btn.textContent = 'No this?';
        btn.addEventListener('click', () => openNoThisModal(ing, sub));
        row.appendChild(btn);
      }
      li.appendChild(row);

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
    // In tavern mode show read-only view — hide save/clear actions
    document.querySelector('.mybar-actions').style.display = tavernMode ? 'none' : '';
    document.getElementById('mybar-back-btn').style.display = tavernMode ? 'block' : '';
    const header = document.querySelector('#step-mybar .finder-question');
    if (header) header.textContent = tavernMode ? 'Tonight at Terrible Tavern' : 'My Bar';

    const container = document.getElementById('mybar-categories');
    container.innerHTML = '';

    const tierOrder = ['Essentials', 'Advanced', 'Deep Cuts'];

    // Tier selector buttons
    const selector = document.createElement('div');
    selector.className = 'mybar-tier-selector';

    const chipArea = document.createElement('div');

    let activeTier = 0;

    function showCustomChipMenu(e, itemName) {
      document.querySelectorAll('.custom-chip-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'custom-chip-menu';
      const delBtn = document.createElement('button');
      delBtn.className = 'custom-chip-menu-btn delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('mousedown', () => {
        customBar = customBar.filter(c => c.name !== itemName);
        localStorage.setItem('terribleTavernCustomBar', JSON.stringify(customBar));
        updateCount(); updateMyBarLabel(); menu.remove(); renderChips();
      });
      const oosBtn = document.createElement('button');
      oosBtn.className = 'custom-chip-menu-btn';
      oosBtn.textContent = 'Out of Stock';
      oosBtn.addEventListener('mousedown', () => {
        const ci = customBar.find(c => c.name === itemName);
        if (ci) { ci.checked = false; localStorage.setItem('terribleTavernCustomBar', JSON.stringify(customBar)); }
        updateCount(); menu.remove(); renderChips();
      });
      menu.appendChild(oosBtn);
      menu.appendChild(delBtn);
      document.body.appendChild(menu);
      const rect = e.target.getBoundingClientRect();
      menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      menu.style.left = Math.max(8, rect.left) + 'px';
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    function renderChips() {
      chipArea.innerHTML = '';
      const merged = {};
      const order = [];
      for (let t = 0; t <= activeTier; t++) {
        const tier = barIngredients[tierOrder[t]];
        for (const [catName, items] of Object.entries(tier.categories)) {
          if (!merged[catName]) { merged[catName] = []; order.push(catName); }
          merged[catName].push(...items.map(i => ({ ...i, isCustom: false })));
        }
      }
      // Inject custom items into their categories
      customBar.forEach(item => {
        const cat = item.category;
        if (!merged[cat]) { merged[cat] = []; order.push(cat); }
        merged[cat].push({ name: item.name, isCustom: true, checked: item.checked !== false });
      });

      for (const catName of order) {
        const items = merged[catName];
        const section = document.createElement('div');
        section.className = 'mybar-category';
        const title = document.createElement('div');
        title.className = 'mybar-category-title';
        title.textContent = catName;
        section.appendChild(title);
        const chips = document.createElement('div');
        chips.className = 'mybar-items';
        items.forEach(item => {
          const chip = document.createElement('div');
          if (item.isCustom) {
            chip.className = 'mybar-chip custom-bar-chip' + (item.checked ? ' checked' : '');
            chip.innerHTML = `<span class="custom-chip-label">${item.name}</span><span class="custom-chip-x">×</span>`;
            chip.querySelector('.custom-chip-label').addEventListener('click', () => {
              const ci = customBar.find(c => c.name === item.name);
              if (ci) { ci.checked = !(ci.checked !== false); localStorage.setItem('terribleTavernCustomBar', JSON.stringify(customBar)); }
              updateCount(); renderChips();
            });
            chip.querySelector('.custom-chip-x').addEventListener('click', e => { e.stopPropagation(); showCustomChipMenu(e, item.name); });
          } else {
            chip.className = 'mybar-chip' + (myBar.has(item.name) ? ' checked' : '');
            chip.textContent = item.name;
            chip.addEventListener('click', () => {
              if (myBar.has(item.name)) { myBar.delete(item.name); chip.classList.remove('checked'); }
              else { myBar.add(item.name); chip.classList.add('checked'); }
              updateCount();
            });
          }
          chips.appendChild(chip);
        });
        section.appendChild(chips);
        chipArea.appendChild(section);
      }
    }

    tierOrder.forEach((tierName, i) => {
      const btn = document.createElement('button');
      btn.className = 'mybar-tier-btn' + (i === 0 ? ' active' : '');
      btn.textContent = tierName;
      btn.addEventListener('click', () => {
        activeTier = i;
        selector.querySelectorAll('.mybar-tier-btn').forEach((b, j) => b.classList.toggle('active', j === i));
        renderChips();
      });
      selector.appendChild(btn);
    });

    container.appendChild(selector);
    container.appendChild(chipArea);
    renderChips();

    // Custom items section
    const customSection = document.createElement('div');
    customSection.className = 'mybar-category custom-items-section';
    customSection.id = 'custom-items-section';

    // Build ordered category list from barIngredients
    const allCategories = [];
    const seenCats = new Set();
    ['Essentials', 'Advanced', 'Deep Cuts'].forEach(tier => {
      if (barIngredients[tier]) {
        Object.keys(barIngredients[tier].categories).forEach(cat => {
          if (!seenCats.has(cat)) { allCategories.push(cat); seenCats.add(cat); }
        });
      }
    });

    function renderCustomSection() {
      customSection.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'mybar-category-title';
      title.textContent = 'Add Custom Item';
      customSection.appendChild(title);

      if (!tavernMode) {
        const addRow = document.createElement('div');
        addRow.className = 'custom-add-row';
        const selectOpts = allCategories.map(c => `<option value="${c}">${c}</option>`).join('');
        addRow.innerHTML = `
          <select class="custom-add-select"><option value="">Category…</option>${selectOpts}</select>
          <input type="text" class="custom-add-input" placeholder="Item name" autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="custom-add-btn">Add</button>`;
        const select = addRow.querySelector('.custom-add-select');
        const input = addRow.querySelector('.custom-add-input');
        const btn = addRow.querySelector('.custom-add-btn');
        // Autocomplete from recipe ingredients
        const recipeIngIndex = buildRecipeIngredientIndex();
        const suggBox = document.createElement('ul');
        suggBox.className = 'mybar-search-results custom-sugg-list';
        addRow.style.position = 'relative';
        addRow.appendChild(suggBox);

        function showSugg(q) {
          suggBox.innerHTML = '';
          if (!q || q.length < 2) return;
          const matches = recipeIngIndex.filter(s => s.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
          matches.forEach(m => {
            const li = document.createElement('li');
            li.className = 'mybar-search-result';
            li.textContent = m;
            li.addEventListener('mousedown', () => { input.value = m; suggBox.innerHTML = ''; });
            suggBox.appendChild(li);
          });
        }
        input.addEventListener('input', () => showSugg(input.value.trim()));
        input.addEventListener('blur', () => setTimeout(() => { suggBox.innerHTML = ''; }, 150));

        btn.addEventListener('click', () => {
          const val = input.value.trim();
          const cat = select.value;
          if (!val || !cat) return;
          customBar.push({ name: val, category: cat, checked: true });
          localStorage.setItem('terribleTavernCustomBar', JSON.stringify(customBar));
          input.value = '';
          suggBox.innerHTML = '';
          updateCount(); updateMyBarLabel(); renderChips();
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
        customSection.appendChild(addRow);
      }
    }

    renderCustomSection();
    container.appendChild(customSection);

    // Build flat item index across all tiers for search
    const searchIndex = [];
    ['Essentials', 'Advanced', 'Deep Cuts'].forEach((tierName, t) => {
      const tier = barIngredients[tierName];
      if (!tier) return;
      Object.values(tier.categories).forEach(items => {
        items.forEach(item => searchIndex.push({ name: item.name, tier: t }));
      });
    });

    function scrollToChip(name, tierIndex) {
      if (activeTier < tierIndex) {
        activeTier = tierIndex;
        selector.querySelectorAll('.mybar-tier-btn').forEach((b, j) => b.classList.toggle('active', j === tierIndex));
        renderChips();
      }
      const chip = Array.from(chipArea.querySelectorAll('.mybar-chip')).find(c => c.textContent.trim() === name);
      if (chip) {
        chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        chip.classList.add('mybar-chip-highlight');
        setTimeout(() => chip.classList.remove('mybar-chip-highlight'), 1400);
      }
    }

    function scrollToCustomAdd() {
      const addInput = customSection.querySelector('.custom-add-input');
      if (addInput) {
        addInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => addInput.focus(), 350);
      }
    }

    const searchInput = document.getElementById('mybar-search');
    const searchResults = document.getElementById('mybar-search-results');
    if (searchInput) {
      searchInput.value = '';
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        searchResults.innerHTML = '';
        if (!q) return;
        const matches = searchIndex.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
        if (matches.length === 0) {
          const li = document.createElement('li');
          li.className = 'mybar-search-result no-match';
          li.textContent = 'No match — tap to add as custom item';
          li.addEventListener('mousedown', () => {
            const addInput = customSection.querySelector('.custom-add-input');
            if (addInput) addInput.value = searchInput.value.trim();
            searchResults.innerHTML = '';
            searchInput.value = '';
            scrollToCustomAdd();
          });
          searchResults.appendChild(li);
        } else {
          matches.forEach(item => {
            const li = document.createElement('li');
            li.className = 'mybar-search-result';
            li.textContent = item.name;
            li.addEventListener('mousedown', () => {
              searchResults.innerHTML = '';
              searchInput.value = '';
              scrollToChip(item.name, item.tier);
            });
            searchResults.appendChild(li);
          });
        }
      });
      searchInput.addEventListener('blur', () => {
        setTimeout(() => { searchResults.innerHTML = ''; }, 150);
      });
    }

    updateCount();
    showStep('step-mybar');
  }

  function updateCount() {
    const el = document.getElementById('mybar-count');
    const total = myBar.size + customBar.length;
    if (el) el.textContent = total > 0 ? `${total} selected` : '';
  }

  function saveMyBar() {
    localStorage.setItem('terribleTavernBar', JSON.stringify([...myBar]));
    updateMyBarLabel();
    if (state.pendingStart) {
      state.pendingStart = false;
      showModeStep();
    } else {
      showStep('step-welcome');
    }
  }

  function clearMyBar() {
    myBar.clear();
    customBar = [];
    localStorage.removeItem('terribleTavernBar');
    localStorage.removeItem('terribleTavernCustomBar');
    updateMyBarLabel();
    document.querySelectorAll('.mybar-chip').forEach(c => c.classList.remove('checked'));
    const cs = document.getElementById('custom-items-section');
    if (cs) cs.remove();
    updateCount();
  }

  // ── Guided flow ─────────────────────────────────────────────────────────

  function startFlow() {
    buildOptions('mood-options', MOODS, 'mood-continue-btn', mood => {
      state.mood = mood;
      buildOptions('spirit-options', SPIRITS, 'spirit-continue-btn', spirit => {
        state.spirit = spirit;
        buildOptions('sequence-options', SEQUENCES, 'sequence-continue-btn', sequence => {
          state.sequence = sequence;
          if (state.mode === 'menu') {
            const menu = buildMenu();
            if (menu.length === 0) {
              showStep('step-noresults');
            } else {
              renderMenu(menu);
              showStep('step-menu');
            }
          } else {
            results = filter();
            resultIndex = 0;
            history = [];
            if (results.length === 0) {
              showStep('step-noresults');
            } else {
              renderResult();
            }
          }
        });
        showStep('step-sequence');
      });
      showStep('step-spirit');
    });
    showStep('step-mood');
  }

  function showModeStep() {
    showStep('step-mode');
  }

  function chooseMode(mode) {
    state.mode = mode;
    startFlow();
  }

  function renderMenu(menu) {
    lastMenu = menu;
    const container = document.getElementById('menu-list');
    container.innerHTML = '';
    const flat = [];
    menu.forEach(group => {
      const section = document.createElement('div');
      section.className = 'menu-category-section';
      const title = document.createElement('h3');
      title.className = 'menu-category-title';
      title.textContent = group.category;
      section.appendChild(title);
      const list = document.createElement('div');
      list.className = 'menu-category-drinks';
      group.drinks.forEach(drink => {
        const idx = flat.length;
        flat.push(drink);
        const card = document.createElement('button');
        card.className = 'menu-drink-card';
        let badge = '';
        if (drink._menuEligibility.makeable) {
          badge = '<span class="makeable-check menu-corner-icon" title="Makeable">✓</span>';
        } else if (drink._menuEligibility.substituted) {
          badge = '<span class="makeable-check substitute menu-corner-icon" title="Easy swap available">~</span>';
        }
        const ingredientsLine = parseIngredients(drink.ingredients).map(stripQuantity).join(', ');
        card.innerHTML = `
          ${badge}
          <div class="menu-drink-name">${drink.name}</div>
          <div class="menu-drink-ingredients">${ingredientsLine}</div>`;
        card.addEventListener('click', () => openMenuDrink(idx));
        list.appendChild(card);
      });
      section.appendChild(list);
      container.appendChild(section);
    });
    results = flat;
  }

  function openMenuDrink(idx) {
    resultIndex = idx;
    history = [];
    renderResult();
    showStep('step-result');
  }

  function printMenu() {
    if (!lastMenu.length) return;
    const root = document.getElementById('print-menu-root');
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const categoriesHtml = lastMenu.map(group => {
      const drinksHtml = group.drinks.map(drink => {
        const ingredientsLine = parseIngredients(drink.ingredients).map(stripQuantity).join(' / ');
        return `
          <div class="print-drink">
            <div class="print-drink-name">${drink.name}</div>
            <div class="print-drink-ingredients">${ingredientsLine}</div>
          </div>`;
      }).join('');
      return `
        <div class="print-category">
          <div class="print-category-title">${group.category}</div>
          ${drinksHtml}
        </div>`;
    }).join('');

    const totalDrinks = lastMenu.reduce((sum, g) => sum + g.drinks.length, 0);
    const colClass = totalDrinks > 7 ? 'two-col' : 'one-col';

    root.innerHTML = `
      <div class="print-header">
        <div>
          <h1 class="print-title">Terrible Tavern</h1>
          <div class="print-subtitle">${dateStr}</div>
        </div>
        <img class="print-logo" src="/images/tt-black-logo.png" alt="">
      </div>
      <div class="print-columns ${colClass}">${categoriesHtml}</div>
    `;

    window.print();
  }

  function start() {
    if (myBar.size === 0 && !tavernMode) {
      state.pendingStart = true;
      showStep('step-barcheck');
      return;
    }
    state.pendingStart = false;
    showModeStep();
  }

  function useDefaultBar(tierIndex) {
    const tierOrder = ['Essentials', 'Advanced', 'Deep Cuts'];
    myBar.clear();
    for (let t = 0; t <= tierIndex; t++) {
      const tier = barIngredients[tierOrder[t]];
      if (!tier) continue;
      for (const items of Object.values(tier.categories)) {
        items.forEach(item => myBar.add(item.name));
      }
    }
    localStorage.setItem('terribleTavernBar', JSON.stringify([...myBar]));
    updateMyBarLabel();
    state.pendingStart = false;
    showModeStep();
  }

  function stockMyBar() {
    // Go to My Bar; on save, continue into the flow instead of returning to welcome
    state.pendingStart = true;
    openMyBar();
  }

  function skipBarCheck() {
    state.pendingStart = false;
    showModeStep();
  }

  function next() {
    if (results.length === 0) return;
    history.push(resultIndex);
    resultIndex = (resultIndex + 1) % results.length;
    renderResult();
  }

  function openNoThisModal(ingredientName, quickSub) {
    const titleEl = document.getElementById('spirit-sub-title');
    const contentEl = document.getElementById('spirit-sub-content');
    titleEl.textContent = ingredientName;
    let detail = null;
    for (const [name, data] of Object.entries(spiritSubs)) {
      if (ingredientName.toLowerCase().includes(name.toLowerCase())) {
        detail = data.note;
        break;
      }
    }
    let html = '';
    if (detail) html += `<p style="margin-bottom:16px;">${detail}</p>`;
    html += `<p style="border-top:1px solid rgba(245,230,211,0.1);padding-top:12px;"><span style="color:var(--color-rust);letter-spacing:0.1em;font-size:0.72rem;">ALTERNATIVE</span><br>${quickSub || 'None'}</p>`;
    contentEl.innerHTML = html;
    document.getElementById('spirit-sub-modal').style.display = 'flex';
  }

  function closeSubModal() {
    document.getElementById('spirit-sub-modal').style.display = 'none';
  }

  function back() {
    if (history.length > 0) {
      resultIndex = history.pop();
      renderResult();
    } else if (state.mode === 'menu') {
      showStep('step-menu');
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
    setSearchMode('name');
    const input = document.getElementById('search-input');
    if (!input.dataset.blurBound) {
      // Tapping away (or hitting Return) dismisses the dropdown. mousedown on a
      // suggestion calls preventDefault, so picking one never triggers this.
      input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { closeSuggestions(); input.blur(); } });
      input.dataset.blurBound = '1';
    }
    setTimeout(() => input.focus(), 100);
  }

  // The "only show drinks I can make" checkbox re-runs the search without
  // reopening the suggestion dropdown.
  function onFilterChange() {
    closeSuggestions();
    runSearch(document.getElementById('search-input').value);
  }

  function setSearchMode(mode) {
    searchMode = mode;
    const isIng = mode === 'ingredient';
    document.getElementById('search-mode-name').classList.toggle('active', !isIng);
    document.getElementById('search-mode-ingredient').classList.toggle('active', isIng);
    document.getElementById('search-heading').textContent = isIng ? "What's in the bottle?" : "What's the drink?";
    const input = document.getElementById('search-input');
    input.placeholder = isIng ? 'Start typing an ingredient…' : 'Start typing a name…';
    input.value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-suggestions').innerHTML = '';
    document.getElementById('search-makeable-row').style.display = isIng ? '' : 'none';
    document.getElementById('search-makeable-only').checked = false;
    input.focus();
  }

  // Does a drink reference this ingredient anywhere in its ingredient list?
  function drinkHasIngredient(drink, q) {
    return parseIngredients(drink.ingredients).some(i => i.toLowerCase().includes(q));
  }

  function renderSuggestions(q) {
    const box = document.getElementById('search-suggestions');
    box.innerHTML = '';
    if (searchMode !== 'ingredient' || q.length < 2) return;
    if (!recipeIngIndex.length) recipeIngIndex = buildRecipeIngredientIndex();
    // Suggest distinct ingredient names containing the query, shortest (most generic) first
    const seen = new Set();
    recipeIngIndex
      .filter(s => s.toLowerCase().includes(q))
      .sort((a, b) => a.length - b.length)
      .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 6)
      .forEach(s => {
        const li = document.createElement('li');
        li.className = 'search-suggestion';
        li.textContent = s;
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          pickSuggestion(s);
        });
        box.appendChild(li);
      });
  }

  // Choosing a suggestion runs the search but must NOT reopen the dropdown,
  // so it calls runSearch directly rather than going back through onSearch.
  function pickSuggestion(s) {
    document.getElementById('search-input').value = s;
    closeSuggestions();
    runSearch(s);
  }

  function closeSuggestions() {
    const box = document.getElementById('search-suggestions');
    if (box) box.innerHTML = '';
  }

  // Typing: refresh both the dropdown and the results.
  function onSearch(query) {
    renderSuggestions(query.trim().toLowerCase());
    runSearch(query);
  }

  function runSearch(query) {
    const list = document.getElementById('search-results');
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    if (!q) return;

    const byIngredient = searchMode === 'ingredient';
    const makeableOnly = byIngredient && document.getElementById('search-makeable-only').checked;

    let matches = cocktails.filter(d =>
      byIngredient ? drinkHasIngredient(d, q) : d.name.toLowerCase().includes(q)
    );

    if (byIngredient) {
      // Makeable first, then by mood score — the ✓ ones are what you can pour tonight
      matches = matches
        .map(d => ({ d, makeable: drinkMakeability(d).makeable }))
        .filter(x => !makeableOnly || x.makeable)
        .sort((a, b) => (b.makeable - a.makeable) || (b.d.mood_score - a.d.mood_score))
        .map(x => x.d);
    }

    const total = matches.length;
    const shown = matches.slice(0, byIngredient ? 40 : 20);

    if (total === 0) {
      list.innerHTML = makeableOnly
        ? '<li class="search-empty">Nothing you can make with that right now. Uncheck the filter to see all of them.</li>'
        : '<li class="search-empty">No drinks found.</li>';
      return;
    }

    if (byIngredient) {
      const count = document.createElement('li');
      count.className = 'search-count';
      count.textContent = `${total} drink${total === 1 ? '' : 's'}${total > shown.length ? ` — showing first ${shown.length}` : ''}`;
      list.appendChild(count);
    }

    shown.forEach(drink => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      const { makeable } = drinkMakeability(drink);
      const badge = makeable ? ' <span class="makeable-check">✓</span>' : '';
      // In ingredient mode, show which ingredient matched rather than just the category
      let meta = drink.category;
      if (byIngredient) {
        const hit = parseIngredients(drink.ingredients).find(i => i.toLowerCase().includes(q));
        if (hit) meta = `${drink.category} · ${stripQuantity(hit)}`;
      }
      li.innerHTML = `
        <div class="search-result-name">${drink.name}${badge}</div>
        <div class="search-result-meta">${meta}</div>
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
    state = { mode: null, mood: [], spirit: [], sequence: [], pendingStart: false };
    results = [];
    resultIndex = 0;
    history = [];
    showStep('step-welcome');
  }

  function tavernBannerTap() {
    document.getElementById('tavern-modal').style.display = 'flex';
  }

  function closeTavernModal() {
    document.getElementById('tavern-modal').style.display = 'none';
  }

  function returnToHomeBar() {
    window.location.href = window.location.pathname;
  }

  loadData().catch(console.error);

  function openHelp() {
    document.getElementById('help-modal').style.display = 'flex';
  }

  function closeHelp() {
    document.getElementById('help-modal').style.display = 'none';
  }

  return { start, next, back, restart, share, openSearch, onSearch, openMyBar, saveMyBar, clearMyBar, useDefaultBar, stockMyBar, skipBarCheck, tavernBannerTap, closeTavernModal, returnToHomeBar, closeSubModal, openHelp, closeHelp, chooseMode, printMenu, setSearchMode, onFilterChange };
})();
