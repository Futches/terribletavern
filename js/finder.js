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
  let spiritSubs = {};
  let barIngredients = {};
  let myBar = new Set();
  let customBar = []; // [{name, category}]
  let tavernMode = false;
  let state = { mood: null, spirit: null, sequence: null, pendingStart: false };
  let results = [];
  let resultIndex = 0;
  let history = [];

  async function loadData() {
    const params = new URLSearchParams(window.location.search);
    tavernMode = params.has('tavern');

    const [cRes, sRes, bRes, ssRes] = await Promise.all([
      fetch('../data/cocktails.json'),
      fetch('../data/substitutions.json'),
      fetch('../data/bar-ingredients.json'),
      fetch('../data/spirit-subs.json'),
    ]);
    cocktails = await cRes.json();
    substitutions = await sRes.json();
    barIngredients = await bRes.json();
    spiritSubs = await ssRes.json();

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
            if (item.match.some(kw => lower.includes(kw))) return true;
          }
        }
      }
    } catch(e) { return true; }
    for (const custom of customBar) {
      if (custom.checked === false) continue;
      if (lower.includes(custom.name.toLowerCase())) return true;
    }
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

  function buildRecipeIngredientIndex() {
    const seen = new Set();
    (cocktails || []).forEach(drink => {
      parseIngredients(drink.ingredients).forEach(ing => {
        const name = ing
          .replace(/^\d[\d./\s]*(oz|ml|dashes?|tsp|tbsp|cups?|rinse|splash|drops?|parts?|bar\s?spoons?|pinch|scoop|whole|large|small|medium)\.?\s*/i, '')
          .replace(/^(fresh|frozen|muddled|dried|ground|crushed|cracked|grated|sliced|cubed|chilled|warm|hot)\s+/i, '')
          .trim();
        if (name && name.length > 2) seen.add(name);
      });
    });
    return Array.from(seen).sort();
  }

  function lookupSub(ingredient) {
    const lower = ingredient.toLowerCase().replace(/^\d[\d./ ]*oz\s*/i, '').replace(/fresh\s+/i, '').trim();
    for (const key of Object.keys(substitutions)) {
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
      startFlow();
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

  function start() {
    if (myBar.size === 0 && !tavernMode) {
      state.pendingStart = true;
      showStep('step-barcheck');
      return;
    }
    state.pendingStart = false;
    startFlow();
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
    startFlow();
  }

  function stockMyBar() {
    // Go to My Bar; on save, continue into the flow instead of returning to welcome
    state.pendingStart = true;
    openMyBar();
  }

  function skipBarCheck() {
    state.pendingStart = false;
    startFlow();
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
    state = { mood: null, spirit: null, sequence: null, pendingStart: false };
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

  return { start, next, back, restart, share, openSearch, onSearch, openMyBar, saveMyBar, clearMyBar, useDefaultBar, stockMyBar, skipBarCheck, tavernBannerTap, closeTavernModal, returnToHomeBar, closeSubModal };
})();
