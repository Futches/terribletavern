const JSONBIN = 'https://api.jsonbin.io/v3';
const STORAGE = 'tavernAdmin';
const TIER_ORDER = ['Essentials', 'Advanced', 'Deep Cuts'];

let config = {};
let barIngredients = {};
let tonight = new Set();
let activeTier = 2; // Default to Deep Cuts so all options are visible

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

  async function init() {
    loadConfig();
    const res = await fetch('../data/bar-ingredients.json');
    barIngredients = await res.json();

    if (config.binId && config.masterKey) {
      // Load what was last published so Peter can adjust from there
      try {
        const r = await fetch(`${JSONBIN}/b/${config.binId}/latest`);
        const d = await r.json();
        tonight = new Set(d.record.items || []);
      } catch(e) { tonight = new Set(); }
      showAdmin();
    } else {
      showScreen('screen-setup');
    }
  }

  async function connect() {
    const key = document.getElementById('api-key-input').value.trim();
    const btn = document.getElementById('connect-btn');
    const err = document.getElementById('setup-error');
    if (!key) { err.textContent = 'Please paste your Master Key.'; return; }
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    err.textContent = '';
    try {
      const res = await fetch(`${JSONBIN}/b`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': key,
          'X-Bin-Name': 'Terrible Tavern Tonight',
          'X-Bin-Private': 'false'
        },
        body: JSON.stringify({ items: [] })
      });
      if (!res.ok) {
        const err2 = await res.json().catch(() => ({}));
        throw new Error(err2.message || 'Invalid API key — check and try again.');
      }
      const data = await res.json();
      config = { masterKey: key, binId: data.metadata.id };
      saveConfig();
      showQR();
    } catch(e) {
      err.textContent = e.message || 'Connection failed. Check your key and try again.';
      btn.textContent = 'Connect & Create';
      btn.disabled = false;
    }
  }

  function showQR() {
    showScreen('screen-qr');
    const url = `https://terribletavern.com/finder?tavern=1&bin=${config.binId}`;
    const qrEl = document.getElementById('qr-code');
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: url,
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
      const res = await fetch(`${JSONBIN}/b/${config.binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': config.masterKey
        },
        body: JSON.stringify({ items: [...tonight] })
      });
      if (!res.ok) throw new Error();
      btn.textContent = '✓ Published!';
      setTimeout(() => { btn.textContent = 'Publish Tonight\'s Bar'; btn.disabled = false; }, 2500);
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
    if (!confirm('This will disconnect this device. The QR code will stop working until you reconnect. Continue?')) return;
    localStorage.removeItem(STORAGE);
    config = {};
    tonight = new Set();
    document.getElementById('api-key-input').value = '';
    document.getElementById('setup-error').textContent = '';
    document.getElementById('connect-btn').textContent = 'Connect & Create';
    document.getElementById('connect-btn').disabled = false;
    showScreen('screen-setup');
  }

  init().catch(console.error);

  return { connect, showQR, showAdmin, publish, clearAll, resetSetup };
})();
