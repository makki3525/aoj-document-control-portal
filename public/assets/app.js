// AOJ Portal — shared client-side helpers.

const API = '/api/drive';

// ─── Theme ──────────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('aoj-theme');
  const dark  = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('aoj-theme', cur);
}

// ─── Data: projects ─────────────────────────────────────────────────────────
const PROJECTS = [
  {
    id: 'kirby-sudair',
    name: 'Kirby Factory – Sudair',
    reference: 'KSA003',
    location: 'Sudair, Riyadh Province, KSA',
    status: 'ongoing',
    client: 'Kirby Contracting Co. SPC LLC',
    consultant: 'ACEC',
    developer: 'MODON',
    value: 'SAR 48,022,000',
    duration: '8 months (from July 2026)',
    description: 'Civil works for factory building — architectural + structural, masonry, plaster, tiling/flooring/cladding, painting, metal/iron/aluminum works.',
    cover: 1,
  },
  {
    id: 'rak-yanbu',
    name: 'RAK Ceramics Production Factory – Yanbu',
    reference: 'KSA002',
    location: 'Yanbu Industrial City, KSA',
    status: 'ongoing',
    client: 'RAK Ceramic',
    pmc: 'Stonehaven',
    engineer: 'Al Bawardi',
    value: 'SAR 31,280,000 (incl. VAT)',
    duration: '9 months',
    description: 'Civil engineering works for factory building (56,320 m²) and raw materials storage.',
    cover: 2,
  },
  {
    id: 'mada-plasterboard-yanbu',
    name: 'Mada Gypsum – Plaster Board Expansion',
    reference: '—',
    location: 'Royal Commission, Yanbu, KSA',
    status: 'tender',
    client: 'Mada Gypsum Company Ltd.',
    description: 'Civil, architectural, MEP, fire protection, landscaping and hangar steel erection works.',
    cover: 3,
  },
  {
    id: 'mada-modon-riyadh',
    name: 'Mada Gypsum – Modon Steel Factory',
    reference: 'AOJ/Offer/124/R2',
    location: 'Modon, Riyadh, KSA',
    status: 'tender',
    client: 'Mada Gypsum Company Ltd.',
    consultant: 'Masar Al Enjaz Engineering Consultancy',
    value: 'SAR 23,222,000 (excl. VAT)',
    duration: '12 months from IFC Drawings & Building Permit',
    description: 'Full civil, structural, architectural, electrical, mechanical, fire protection and fire alarm works.',
    cover: 4,
  },
];
window.PROJECTS = PROJECTS;

// ─── Icons ──────────────────────────────────────────────────────────────────
const ICONS = {
  search:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  location:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  moon:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  folder:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  file:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  lock:    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  open:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>',
  google:  '<svg width="22" height="22" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>',
};

// ─── API helpers ────────────────────────────────────────────────────────────
async function apiGet(action, params = {}) {
  const q = new URLSearchParams({ action, ...params });
  const r = await fetch(`${API}?${q}`, { credentials: 'same-origin' });
  return r.json();
}

// ─── Navbar ─────────────────────────────────────────────────────────────────
function renderNav(active) {
  const items = [
    ['/',         'Home',     'home'],
    ['/projects', 'Projects', 'projects'],
    ['/about',    'About',    'about'],
    ['/contact',  'Contact',  'contact'],
  ];
  return `
    <nav class="nav">
      <div class="nav-inner">
        <a href="/" class="brand">
          <div class="brand-mark">AOJ</div>
          <div class="brand-name">AOJ Contracting Co LLC<small>DOCUMENT CONTROL PORTAL</small></div>
        </a>
        <div class="nav-links">
          ${items.map(([h,l,k]) => `<a href="${h}" class="${active===k?'active':''}">${l}</a>`).join('')}
        </div>
        <div class="nav-cta">
          <button class="icon-btn" onclick="toggleTheme()" title="Toggle theme">${ICONS.moon}</button>
          <div id="navAuth"></div>
        </div>
      </div>
    </nav>`;
}

async function refreshAuthArea() {
  const el = document.getElementById('navAuth');
  if (!el) return;
  const me = await apiGet('me');
  if (me.connected) {
    el.innerHTML = `
      <div class="cb-user" style="border:1px solid var(--border); padding:4px 12px 4px 4px; border-radius:999px;">
        ${me.photo ? `<img src="${me.photo}" referrerpolicy="no-referrer" alt="">` : ''}
        <div><b style="font-size:12.5px;">${me.name || me.email}</b></div>
        <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="logout()">Sign out</button>
      </div>`;
  } else {
    el.innerHTML = `<a href="${API}?action=oauth_start" class="btn btn-primary">${ICONS.google} Connect Drive</a>`;
  }
}
async function logout() {
  await apiGet('logout');
  location.href = '/';
}

// ─── Footer ─────────────────────────────────────────────────────────────────
function renderFooter() {
  return `
    <footer>
      <div class="foot-inner">
        <div>
          <p><strong>AOJ Contracting Co LLC</strong> — Document Control Portal</p>
          <p style="margin-top:4px;">Contact: <a href="mailto:dc@aoj-sa.com" style="color:var(--brand);">dc@aoj-sa.com</a></p>
        </div>
        <div class="foot-links">
          <a href="/">Home</a>
          <a href="/projects">Projects</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </div>
      </div>
    </footer>`;
}

// ─── Project card ───────────────────────────────────────────────────────────
function projectCard(p) {
  return `
    <a href="/project/${p.id}" class="card">
      <div class="card-cover c-${p.cover}">
        ${ICONS.folder.replace('width="16" height="16"','width="80" height="80"')}
        <span class="card-badge badge-${p.status}">${p.status}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${p.name}</h3>
        <div class="card-loc">${ICONS.location} ${p.location}</div>
        <p class="card-desc">${p.description}</p>
        <div class="card-footer">
          <button class="btn btn-ghost btn-sm">View Project ${ICONS.open}</button>
        </div>
      </div>
    </a>`;
}

// ─── Global search (debounced) ─────────────────────────────────────────────
function attachSearch(input, resultsEl) {
  let t; let last = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { resultsEl.classList.remove('open'); resultsEl.innerHTML = ''; return; }
    t = setTimeout(async () => {
      const my = ++last;
      resultsEl.classList.add('open');
      resultsEl.innerHTML = `<div class="loading"><span class="spinner"></span></div>`;
      const r = await apiGet('search', { q });
      if (my !== last) return;
      if (r.error) {
        resultsEl.innerHTML = `<div class="sr-empty">${r.error === 'Not connected' ? 'Connect your Google Drive to search files.' : r.error}</div>`;
        return;
      }
      if (!r.items || !r.items.length) {
        resultsEl.innerHTML = `<div class="sr-empty">No files match "${q}"</div>`;
        return;
      }
      resultsEl.innerHTML = r.items.slice(0, 20).map(it => `
        <a class="sr-item" href="${it.link}" target="_blank" rel="noopener">
          <div class="sr-icon">${it.type === 'folder' ? ICONS.folder : ICONS.file}</div>
          <div class="sr-body">
            <div class="sr-name">${escapeHtml(it.name)}</div>
            <div class="sr-meta">${it.folder ? escapeHtml(it.folder) + ' · ' : ''}${it.type === 'folder' ? 'Folder' : (it.size || 'File')}</div>
          </div>
        </a>`).join('');
    }, 280);
  });
  document.addEventListener('click', (e) => {
    if (!resultsEl.contains(e.target) && e.target !== input) resultsEl.classList.remove('open');
  });
  input.addEventListener('focus', () => { if (input.value.trim()) resultsEl.classList.add('open'); });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
