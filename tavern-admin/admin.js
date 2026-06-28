const GITHUB_API = 'https://api.github.com';
const REPO = 'Futches/terribletavern';
const BRANCH = 'claude/create-tavern-website-Q10zE';
const FILE_PATH = 'data/tavern-tonight.json';
const TAVERN_URL = 'https://terribletavern.com/finder?tavern=1';
const STORAGE = 'tavernAdmin';
const TIER_ORDER = ['Essentials', 'Advanced', 'Deep Cuts'];

let config = {};
let barIngredients = {};
let cocktails = [];
let tonight = new Set();
let activeTier = 2;
let adminCustomItems = []; // [{name, category}]
let recipeIngIndex = [];

const adminApp = (() => {

  function loadConfig() {
    try { config = JSON.parse(localStorage.getItem(STORAGE) || '{}'); } catch(e) { config = {}; }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE, JSON.stringify(config));
  }

  function showScreen(id) {
    document.querySelectorAll('.admin-screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function ghHeaders() {
    return {
      'Authorization': `token ${config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  async function getFileSha() {
    const r = await fetch(
      `${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers: ghHeaders() }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d.sha;
  }

  async function readCurrentInventory() {
    try {
      const r = await fetch(
        `${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
        { headers: ghHeaders() }
      );
      if (!r.ok) return;
      const d = await r.json();
      const decoded = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\s/g, '')))));
      tonight = new Set(decoded.items || []);
    } catch(e) { tonight = new Set(); }
  }

  function loadCustomItems() {
    try { adminCustomItems = JSON.parse(localStorage.getItem('tavernAdminCustom') || '[]').filter(i => i && i.name && i.category && i.category !== 'undefined'); } catch(e) { adminCustomItems = []; }
  }

  function saveCustomItems() {
    localStorage.setItem('tavernAdminCustom', JSON.stringify(adminCustomItems));
  }

  function allCategories() {
    const seen = new Set();
    const cats = [];
    TIER_ORDER.forEach(tierName => {
      const tier = barIngredients[tierName];
      if (!tier) return;
      Object.keys(tier.categories).forEach(cat => {
        if (!seen.has(cat)) { seen.add(cat); cats.push(cat); }
      });
    });
    return cats;
  }

  function parseIngredients(raw) {
    if (!raw) return [];
    return raw.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  }

  function buildRecipeIngredientIndex() {
    const seen = new Set();
    cocktails.forEach(drink => {
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

  async function init() {
    loadConfig();
    const [biRes, cRes] = await Promise.all([
      fetch('../data/bar-ingredients.json'),
      fetch('../data/cocktails.json')
    ]);
    barIngredients = await biRes.json();
    cocktails = await cRes.json();
    recipeIngIndex = buildRecipeIngredientIndex();
    loadCustomItems();

    if (config.token) {
      await readCurrentInventory();
      showAdmin();
    } else {
      showScreen('screen-setup');
    }
  }

  async function connect() {
    const token = document.getElementById('api-key-input').value.trim();
    const btn = document.getElementById('connect-btn');
    const errEl = document.getElementById('setup-error');
    if (!token) { errEl.textContent = 'Please paste your GitHub token.'; return; }
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    errEl.textContent = '';
    try {
      // Verify token works by checking the repo
      const r = await fetch(`${GITHUB_API}/repos/${REPO}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!r.ok) throw new Error('Token not accepted — make sure you checked public_repo scope.');
      config = { token };
      saveConfig();
      await readCurrentInventory();
      showAdmin();
    } catch(e) {
      errEl.textContent = e.message || 'Connection failed. Check your token and try again.';
      btn.textContent = 'Connect';
      btn.disabled = false;
    }
  }

  function showQR() {
    showScreen('screen-qr');
    const qrEl = document.getElementById('qr-code');
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: TAVERN_URL,
      width: 240,
      height: 240,
      colorDark: '#1A1A1A',
      colorLight: '#F5E6D3',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  function showAdmin() {
    showScreen('screen-admin');
    renderTierSelector();
    renderChipArea();
    updateCount();
    setupSearch();
  }

  function setupSearch() {
    const input = document.getElementById('admin-search');
    const resultsEl = document.getElementById('admin-search-results');
    if (!input) return;
    input.value = '';

    // Build flat item index across all tiers
    const searchIndex = [];
    TIER_ORDER.forEach((tierName, t) => {
      const tier = barIngredients[tierName];
      if (!tier) return;
      Object.values(tier.categories).forEach(items => {
        items.forEach(item => searchIndex.push({ name: item.name, tier: t }));
      });
    });

    function scrollToChip(name, tierIndex) {
      if (activeTier < tierIndex) {
        activeTier = tierIndex;
        document.querySelectorAll('.admin-tier-btn').forEach((b, j) => b.classList.toggle('active', j === tierIndex));
        renderChipArea();
      }
      const chip = Array.from(document.querySelectorAll('#admin-chip-area .mybar-chip'))
        .find(c => c.textContent.trim() === name);
      if (chip) {
        chip.scrollIntoView({ behavior: 'smooth', block: 'center' });
        chip.classList.add('admin-chip-highlight');
        setTimeout(() => chip.classList.remove('admin-chip-highlight'), 1400);
      }
    }

    function scrollToCustomAdd() {
      const addInput = document.querySelector('#admin-custom-section .custom-add-input');
      if (addInput) {
        addInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => addInput.focus(), 350);
      }
    }

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      resultsEl.innerHTML = '';
      if (!q) return;
      const matches = searchIndex.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
      if (matches.length === 0) {
        const li = document.createElement('li');
        li.className = 'admin-search-result no-match';
        li.textContent = 'No match — tap to add as custom item';
        li.addEventListener('mousedown', () => {
          const addInput = document.querySelector('#admin-custom-section .custom-add-input');
          if (addInput) addInput.value = input.value.trim();
          resultsEl.innerHTML = '';
          input.value = '';
          scrollToCustomAdd();
        });
        resultsEl.appendChild(li);
      } else {
        matches.forEach(item => {
          const li = document.createElement('li');
          li.className = 'admin-search-result';
          li.textContent = item.name;
          li.addEventListener('mousedown', () => {
            resultsEl.innerHTML = '';
            input.value = '';
            scrollToChip(item.name, item.tier);
          });
          resultsEl.appendChild(li);
        });
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { resultsEl.innerHTML = ''; }, 150);
    });
  }

  function renderTierSelector() {
    const selector = document.getElementById('admin-tier-selector');
    selector.innerHTML = '';
    TIER_ORDER.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'admin-tier-btn' + (i === activeTier ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        activeTier = i;
        selector.querySelectorAll('.admin-tier-btn').forEach((b, j) => b.classList.toggle('active', j === i));
        renderChipArea();
      });
      selector.appendChild(btn);
    });
  }

  function showCustomChipMenu(e, itemName) {
    document.querySelectorAll('.custom-chip-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'custom-chip-menu';
    const oosBtn = document.createElement('button');
    oosBtn.className = 'custom-chip-menu-btn';
    oosBtn.textContent = 'Out of Stock';
    oosBtn.addEventListener('mousedown', () => {
      tonight.delete(itemName);
      updateCount(); menu.remove(); renderChipArea();
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'custom-chip-menu-btn delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('mousedown', () => {
      adminCustomItems = adminCustomItems.filter(i => i.name !== itemName);
      tonight.delete(itemName);
      saveCustomItems(); updateCount(); menu.remove(); renderChipArea();
    });
    menu.appendChild(oosBtn);
    menu.appendChild(delBtn);
    document.body.appendChild(menu);
    const rect = e.target.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    menu.style.left = Math.max(8, rect.left) + 'px';
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  function renderChipArea() {
    const area = document.getElementById('admin-chip-area');
    area.innerHTML = '';

    const merged = {};
    const order = [];
    for (let t = 0; t <= activeTier; t++) {
      const tier = barIngredients[TIER_ORDER[t]];
      if (!tier) continue;
      for (const [catName, items] of Object.entries(tier.categories)) {
        if (!merged[catName]) { merged[catName] = []; order.push(catName); }
        merged[catName].push(...items.map(i => ({ ...i, isCustom: false })));
      }
    }
    // Inject custom items into their categories
    adminCustomItems.forEach(item => {
      const cat = item.category;
      if (!merged[cat]) { merged[cat] = []; order.push(cat); }
      merged[cat].push({ name: item.name, isCustom: true });
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
          chip.className = 'mybar-chip custom-bar-chip' + (tonight.has(item.name) ? ' checked' : '');
          chip.innerHTML = `<span class="custom-chip-label">${item.name}</span><span class="custom-chip-x">×</span>`;
          chip.querySelector('.custom-chip-label').addEventListener('click', () => {
            if (tonight.has(item.name)) tonight.delete(item.name);
            else tonight.add(item.name);
            updateCount(); renderChipArea();
          });
          chip.querySelector('.custom-chip-x').addEventListener('click', e => { e.stopPropagation(); showCustomChipMenu(e, item.name); });
        } else {
          chip.className = 'mybar-chip' + (tonight.has(item.name) ? ' checked' : '');
          chip.textContent = item.name;
          chip.addEventListener('click', () => {
            if (tonight.has(item.name)) { tonight.delete(item.name); chip.classList.remove('checked'); }
            else { tonight.add(item.name); chip.classList.add('checked'); }
            updateCount();
          });
        }
        chips.appendChild(chip);
      });
      section.appendChild(chips);
      area.appendChild(section);
    }
    renderCustomSection(area);
  }

  function renderCustomSection(area) {
    const existing = document.getElementById('admin-custom-section');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.className = 'mybar-category';
    section.id = 'admin-custom-section';

    const title = document.createElement('div');
    title.className = 'mybar-category-title';
    title.textContent = 'Add Custom Item';
    section.appendChild(title);

    const addRow = document.createElement('div');
    addRow.className = 'custom-add-row';
    const cats = allCategories();
    const selectOpts = cats.map(c => `<option value="${c}">${c}</option>`).join('');
    addRow.innerHTML = `
      <select class="custom-add-select"><option value="">Category…</option>${selectOpts}</select>
      <input type="text" class="custom-add-input" placeholder="Item name" autocomplete="off" autocorrect="off" spellcheck="false">
      <button class="custom-add-btn">Add</button>`;
    const select = addRow.querySelector('.custom-add-select');
    const input = addRow.querySelector('.custom-add-input');
    const btn = addRow.querySelector('.custom-add-btn');

    const suggBox = document.createElement('ul');
    suggBox.className = 'mybar-search-results custom-sugg-list';
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
      adminCustomItems.push({ name: val, category: cat });
      tonight.add(val);
      saveCustomItems();
      input.value = '';
      suggBox.innerHTML = '';
      updateCount();
      renderChipArea();
    });
    section.appendChild(addRow);
    area.appendChild(section);
  }

  function updateCount() {
    const el = document.getElementById('admin-count');
    if (el) el.textContent = tonight.size > 0 ? `${tonight.size} items` : '';
  }

  async function publish() {
    const btn = document.getElementById('publish-btn');
    btn.textContent = 'Publishing…';
    btn.disabled = true;
    try {
      const content = { items: [...tonight] };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
      const sha = await getFileSha();
      const body = {
        message: 'Update tavern inventory',
        content: encoded,
        branch: BRANCH
      };
      if (sha) body.sha = sha;

      const r = await fetch(
        `${GITHUB_API}/repos/${REPO}/contents/${FILE_PATH}`,
        { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) }
      );
      if (!r.ok) throw new Error();
      localStorage.setItem('terribleTavernBar', JSON.stringify([...tonight]));
      localStorage.setItem('terribleTavernCustomBar', JSON.stringify(adminCustomItems));
      btn.textContent = '✓ Published! Live in ~1 min';
      setTimeout(() => { btn.textContent = 'Publish Tonight\'s Bar'; btn.disabled = false; }, 3000);
    } catch(e) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }

  function clearAll() {
    tonight.clear();
    adminCustomItems = [];
    saveCustomItems();
    document.querySelectorAll('#admin-chip-area .mybar-chip').forEach(c => c.classList.remove('checked'));
    renderCustomSection(document.getElementById('admin-chip-area'));
    updateCount();
  }

  function resetSetup() {
    if (!confirm('This will disconnect this device from admin. Continue?')) return;
    localStorage.removeItem(STORAGE);
    config = {};
    tonight = new Set();
    document.getElementById('api-key-input').value = '';
    document.getElementById('setup-error').textContent = '';
    document.getElementById('connect-btn').textContent = 'Connect';
    document.getElementById('connect-btn').disabled = false;
    showScreen('screen-setup');
  }

  init().catch(console.error);

  return { connect, showQR, showAdmin, publish, clearAll, resetSetup };
})();
