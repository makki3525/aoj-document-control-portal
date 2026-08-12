// AOJ Portal — v2 shared client helpers.
const API = '/api/drive';

// Theme
(function () {
  const saved = localStorage.getItem('aoj-theme');
  const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
function toggleTheme() {
  const c = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', c);
  localStorage.setItem('aoj-theme', c);
}

// Icons
const ICONS = {
  search:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  location:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  moon:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun:     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  folder:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  file:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  sheet:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>',
  lock:    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  lockBig: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  logs:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M9 13h6M9 17h6M14 2v6h6"/></svg>',
  files:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-5-5z"/><path d="M15 2v5h5"/></svg>',
  open:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>',
  chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  google:  '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>',
  shield:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  check:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x:       '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  bolt:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  users:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  building:'<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>',
};

// API helpers
async function apiGet(action, params = {}) {
  const q = new URLSearchParams({ action, ...params });
  const r = await fetch(`${API}?${q}`, { credentials: 'same-origin' });
  return r.json();
}
async function apiPost(action, body = {}) {
  const r = await fetch(`${API}?action=${action}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Toasts
function toast(msg, kind = 'ok') {
  let h = document.querySelector('.toast-holder');
  if (!h) { h = document.createElement('div'); h.className = 'toast-holder'; document.body.appendChild(h); }
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  h.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// Nav
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
          <div class="brand-name">AOJ Contracting Co LLC<small>Document Control Portal</small></div>
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
  const el = document.getElementById('navAuth'); if (!el) return;
  const me = await apiGet('me');
  window.__me = me;
  // Hide admin session entirely on the public site. Admins access via /admin directly.
  const isMasterAdmin = me.connected && me.email === 'master-admin@aoj.local';
  if (isMasterAdmin) { el.innerHTML = ''; return; }

  if (me.connected) {
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; border:1px solid var(--border); padding:4px 12px 4px 4px; border-radius:999px; background:var(--surface);">
        ${me.photo ? `<img src="${me.photo}" referrerpolicy="no-referrer" alt="" style="width:30px; height:30px; border-radius:50%;">` : ''}
        <b style="font-size:13px;">${escapeHtml(me.name || me.email)}</b>
        <button class="icon-btn" style="width:26px; height:26px;" onclick="logout()" title="Sign out">${ICONS.x}</button>
      </div>`;
  } else {
    el.innerHTML = `
      <a href="/login" class="btn btn-ghost btn-sm">Sign in</a>
      <a href="/login?mode=register" class="btn btn-primary btn-sm">Sign up</a>`;
  }
}
async function logout() { await apiGet('logout'); location.reload(); }

// Footer
function renderFooter() {
  const y = new Date().getFullYear();
  return `
    <footer>
      <div class="foot-inner">
        <div class="foot-col">
          <div class="brand" style="margin-bottom:12px;">
            <div class="brand-mark">AOJ</div>
            <div class="brand-name">AOJ Contracting Co LLC<small>Document Control Portal</small></div>
          </div>
          <p style="color:var(--muted); font-size:13.5px; max-width:340px;">Enterprise document control for civil, structural and MEP works across the Kingdom of Saudi Arabia.</p>
        </div>
        <div class="foot-col">
          <h5>Portal</h5>
          <a href="/">Home</a><a href="/projects">Projects</a><a href="/about">About</a><a href="/contact">Contact</a>
        </div>
        <div class="foot-col">
          <h5>Contact</h5>
          <a href="mailto:dc@aoj-sa.com">dc@aoj-sa.com</a>
          <a href="https://aoj-sa.com/" target="_blank" rel="noopener">aoj-sa.com</a>
        </div>
        <div class="foot-col">
          <h5>Security</h5>
          <p style="color:var(--muted); font-size:13px; margin:0;">Google OAuth · role-based access · audit logged · files never leave Drive.</p>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© ${y} Itihad Awj Company For Contracting. All rights reserved.</span>
        <span>Portal v2.0</span>
      </div>
    </footer>`;
}

// Project card
function projectCard(p) {
  return `
    <a href="/project/${p.slug}" class="pcard">
      <div class="pcard-cover c-${p.cover || 1}">
        ${ICONS.building}
        <span class="pcard-badge badge-${p.status}">${p.status}</span>
      </div>
      <div class="pcard-body">
        ${p.reference ? `<div class="pcard-ref">${escapeHtml(p.reference)}</div>` : ''}
        <h3 class="pcard-title">${escapeHtml(p.name)}</h3>
        <div class="pcard-loc">${ICONS.location} ${escapeHtml(p.location || '')}</div>
        <p class="pcard-desc">${escapeHtml(p.description || '')}</p>
        <div class="pcard-meta">
          ${p.client   ? `<div><b>Client</b><span>${escapeHtml(shorten(p.client, 24))}</span></div>` : ''}
          ${p.duration ? `<div><b>Duration</b><span>${escapeHtml(shorten(p.duration, 22))}</span></div>` : ''}
        </div>
        <div class="pcard-footer">
          <span class="btn btn-outline">View Documents ${ICONS.open}</span>
        </div>
      </div>
    </a>`;
}
function shorten(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Global search
function attachSearch(input, resultsEl) {
  let t, last = 0;
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
      if (r.error && (!r.items || !r.items.length)) {
        resultsEl.innerHTML = `<div class="sr-empty">${escapeHtml(r.error)}</div>`;
        return;
      }
      if (!r.items || !r.items.length) { resultsEl.innerHTML = `<div class="sr-empty">No files match "${escapeHtml(q)}"</div>`; return; }
      resultsEl.innerHTML = r.items.slice(0, 20).map(it => it.restricted
        ? `<div class="sr-item restricted">
             <div class="sr-icon">${ICONS.lockBig}</div>
             <div class="sr-body">
               <div class="sr-name">${escapeHtml(it.name)}</div>
               <div class="sr-meta">${it.folder ? escapeHtml(it.folder) + ' · ' : ''}Confidential — request access</div>
             </div>
             <span class="sr-tag rest">Restricted</span>
           </div>`
        : `<a class="sr-item" href="${it.link}" target="_blank" rel="noopener">
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
