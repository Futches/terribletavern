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
    const m = new Date().getMonth(); // 0-indexed
    if (m <= 1 || m === 11) return 'Winter';
    if (m <= 4)             return 'Spring';
    if (m <= 7)             return 'Summer';
    return 'Fall';
  }

  let cocktails = [];
  let substitutions = {};
  let state = { mood: null, spirit: null, sequence: null };
  let results = [];
  let resultIndex = 0;
  let history = []; // stack of resultIndex values for Back

  async function loadData() {
    const [cRes, sRes] = await Promise.all([
      fetch('../data/cocktails.json'),
      fetch('../data/substitutions.json'),
    ]);
    cocktails = await cRes.json();
    substitutions = await sRes.json();
  }

  function showStep(id) {
    document.querySelectorAll('.finder-step').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
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

  function filter() {
    const season = getSeason();
    return cocktails
      .filter(d => {
        const seasonOk = d.season === season || d.season === 'All-Season';
        const moodOk   = !state.mood    || d.moods.includes(state.mood);
        const spiritOk = !state.spirit  || d.category === state.spirit;
        const seqOk    = !state.sequence || d.sequence === state.sequence || d.sequence === 'Any Time';
        return seasonOk && moodOk && spiritOk && seqOk;
      })
      .sort((a, b) => b.mood_score - a.mood_score);
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

    document.getElementById('result-count').textContent =
      `Result ${resultIndex + 1} of ${results.length}`;
    document.getElementById('result-season').textContent = `${season}`;
    document.getElementById('drink-name').textContent = drink.name;

    const meta = [drink.category, drink.glass, drink.ice].filter(Boolean).join(' · ');
    document.getElementById('drink-meta').textContent = meta;

    const ingredients = parseIngredients(drink.ingredients);
    const list = document.getElementById('ingredient-list');
    list.innerHTML = '';

    ingredients.forEach(ing => {
      const sub = lookupSub(ing);
      const li = document.createElement('li');
      li.className = 'ingredient-item';

      const row = document.createElement('div');
      row.className = 'ingredient-row';

      const name = document.createElement('span');
      name.className = 'ingredient-name';
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

  function restart() {
    state = { mood: null, spirit: null, sequence: null };
    results = [];
    resultIndex = 0;
    history = [];
    showStep('step-welcome');
  }

  // Init
  loadData().catch(console.error);

  return { start, next, back, restart };
})();
