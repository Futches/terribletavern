const GITHUB_API = 'https://api.github.com';
const REPO = 'Futches/terribletavern';
const BRANCH = 'claude/create-tavern-website-Q10zE';
const FILE_PATH = 'data/tavern-tonight.json';
const TAVERN_URL = 'https://terribletavern.com/finder?tavern=1';
const STORAGE = 'tavernAdmin';
const TIER_ORDER = ['Essentials', 'Advanced', 'Deep Cuts'];

let config = {};
let barIngredients = {};
let tonight = new Set();
let activeTier = 2;

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

  async function init() {
    loadConfig();
    const res = await fetch('../data/bar-ingredients.json');
    barIngredients = await res.json();

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

  function renderChipArea() {
    const area = document.getElementById('admin-chip-area');
    area.innerHTML = '';
    for (let t = 0; t <= activeTier; t++) {
      const tier = barIngredients[TIER_ORDER[t]];
      if (!tier) continue;
      for (const [catName, items] of Object.entries(tier.categories)) {
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
          chip.className = 'mybar-chip' + (tonight.has(item.name) ? ' checked' : '');
          chip.textContent = item.name;
          chip.addEventListener('click', () => {
            if (tonight.has(item.name)) {
              tonight.delete(item.name);
              chip.classList.remove('checked');
            } else {
              tonight.add(item.name);
              chip.classList.add('checked');
            }
            updateCount();
          });
          chips.appendChild(chip);
        });
        section.appendChild(chips);
        area.appendChild(section);
      }
    }
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
      btn.textContent = '✓ Published! Live in ~1 min';
      setTimeout(() => { btn.textContent = 'Publish Tonight\'s Bar'; btn.disabled = false; }, 3000);
    } catch(e) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }

  function clearAll() {
    tonight.clear();
    document.querySelectorAll('#admin-chip-area .mybar-chip').forEach(c => c.classList.remove('checked'));
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
