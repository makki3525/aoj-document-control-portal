'use strict';
// AOJ Document Control Portal — v2 backend.
// Single-file API handler (Vercel-friendly). Action-based dispatch.

const mongoose = require('mongoose');
const { google } = require('googleapis');
const crypto   = require('crypto');
const cookie   = require('cookie');
const jwt      = require('jsonwebtoken');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const MONGO_URI  = 'mongodb+srv://makki3525873_db_user:Karan786youme@makki786.88sw6dj.mongodb.net/aoj_portal?appName=aoj';
const JWT_SECRET = 'aoj_jwt_secret_change_me_5f9c1b_a83d4e2f9b7c6d5e';
const ENC_KEY    = 'UtAC2SOoMgVup25BMcTOUL2vcVoel74it4prz2oqMzA=';
const GOOGLE_ID     = '601058518061-a0q7e2gc85afbn397vp431be5vjuqb0f.apps.googleusercontent.com';
const GOOGLE_SECRET = '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';

// First Google account to sign in whose email is in this list becomes the initial admin.
// Leave empty to auto-promote the very first sign-in as admin.
const BOOTSTRAP_ADMINS = []; // e.g. ['dc@aoj-sa.com']

// Master admin credentials (username/password login — bypasses Google OAuth for admin panel)
const MASTER_ADMIN_USER = 'mad6755';
const MASTER_ADMIN_PASS = 'mad@(675)';

// Auto-detect redirect URI from request (works local + Vercel).
// You must still register each host under Authorized redirect URIs in Google Cloud.
function getRedirectURI(req) {
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/drive?action=oauth_callback`;
}

const ALGO        = 'aes-256-cbc';
const COOKIE_NAME = 'aoj_sid';

// ─── DB ──────────────────────────────────────────────────────────────────────
let _ready = false;
async function connectDB() {
  if (_ready || mongoose.connection.readyState === 1) { _ready = true; return; }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  _ready = true;
}

const UserSchema = new mongoose.Schema({
  email:         { type: String, index: true, unique: true },
  name:          String,
  photo:         String,
  role:          { type: String, enum: ['admin','staff','viewer'], default: 'viewer' },
  approved:      { type: Boolean, default: false },      // for confidential access
  refresh_token: String,                                 // encrypted Drive refresh token
  // Master Drive attached by admin — used for ALL public search/browse
  drive_email:   String,
  drive_name:    String,
  drive_photo:   String,
  drive_connected_at: Date,
  created_at:    { type: Date, default: Date.now },
  last_login:    { type: Date, default: Date.now },
});
const User = mongoose.models.AojUser || mongoose.model('AojUser', UserSchema);

const ProjectSchema = new mongoose.Schema({
  slug:            { type: String, unique: true, index: true },
  name:            String,
  reference:       String,
  location:        String,
  status:          { type: String, enum: ['ongoing','tender','completed'], default: 'ongoing' },
  client:          String,
  consultant:      String,
  engineer:        String,
  pmc:             String,
  developer:       String,
  master_developer:String,
  value:           String,
  duration:        String,
  scope:           String,
  description:     String,
  cover:           { type: Number, default: 1 },   // 1-4 color variant
  sort:            { type: Number, default: 0 },
  active:          { type: Boolean, default: true },
  drive_root:      String,                          // optional: root Drive folder ID for scoped search
  created_at:      { type: Date, default: Date.now },
});
const Project = mongoose.models.AojProject || mongoose.model('AojProject', ProjectSchema);

const CategorySchema = new mongoose.Schema({
  projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'AojProject', index: true },
  section:     { type: String, enum: ['confidential','logs','softcopies'], index: true },
  name:        String,
  drive_url:   String,
  drive_type:  { type: String, enum: ['folder','file','sheet','doc'], default: 'folder' },
  sort:        { type: Number, default: 0 },
  active:      { type: Boolean, default: true },
  created_at:  { type: Date, default: Date.now },
});
const Category = mongoose.models.AojCategory || mongoose.model('AojCategory', CategorySchema);

const AccessRequestSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'AojUser' },
  email:       String,
  projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'AojProject' },
  categoryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'AojCategory' },
  section:     String,
  note:        String,
  status:      { type: String, enum: ['pending','approved','denied'], default: 'pending' },
  decided_by:  String,
  decided_at:  Date,
  created_at:  { type: Date, default: Date.now },
});
const AccessRequest = mongoose.models.AojAccessRequest || mongoose.model('AojAccessRequest', AccessRequestSchema);

const AuditLogSchema = new mongoose.Schema({
  email:       String,
  role:        String,
  action:      String,
  target:      String,
  meta:        mongoose.Schema.Types.Mixed,
  ip:          String,
  ua:          String,
  created_at:  { type: Date, default: Date.now, index: true },
});
const AuditLog = mongoose.models.AojAudit || mongoose.model('AojAudit', AuditLogSchema);

// ─── Crypto ──────────────────────────────────────────────────────────────────
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const c  = crypto.createCipheriv(ALGO, Buffer.from(ENC_KEY, 'base64'), iv);
  return iv.toString('hex') + ':' + Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex');
}
function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const d  = crypto.createDecipheriv(ALGO, Buffer.from(ENC_KEY, 'base64'), iv);
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
}

// ─── Session ─────────────────────────────────────────────────────────────────
function issueSession(res, userId, req) {
  const token = jwt.sign({ uid: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
  const secure = getRedirectURI(req).startsWith('https://');
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30,
  }));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 }));
}
async function getSessionUser(req) {
  const raw = req.headers.cookie ? cookie.parse(req.headers.cookie)[COOKIE_NAME] : null;
  if (!raw) return null;
  try {
    const { uid } = jwt.verify(raw, JWT_SECRET);
    return await User.findById(uid);
  } catch (_) { return null; }
}

// ─── Google helpers ──────────────────────────────────────────────────────────
function oauthClient(req) {
  return new google.auth.OAuth2(GOOGLE_ID, GOOGLE_SECRET, getRedirectURI(req));
}
function getDrive(user, req) {
  const auth = oauthClient(req);
  auth.setCredentials({ refresh_token: decrypt(user.refresh_token) });
  return google.drive({ version: 'v3', auth });
}
// Master admin whose connected Drive backs the whole portal
async function getMasterAdmin() {
  return await User.findOne({ email: 'master-admin@aoj.local' });
}
async function getMasterDrive(req) {
  const admin = await getMasterAdmin();
  if (!admin || !admin.refresh_token) return null;
  return { drive: getDrive(admin, req), admin };
}
function isInvalidGrant(e) {
  const blob = ((e && e.message) || '') + ' ' + JSON.stringify((e && e.response && e.response.data) || {});
  return /invalid_grant|token has been expired or revoked/i.test(blob);
}
function extractDriveId(url) {
  if (!url) return null;
  const m = String(url).match(/\/(?:file\/d|folders|d)\/([a-zA-Z0-9_-]{15,})/);
  return m ? m[1] : null;
}
function formatBytes(b) {
  if (!b) return '—';
  const k = 1024, u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + u[i];
}
function mapFile(f) {
  const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
  return {
    id: f.id, name: f.name,
    type: isFolder ? 'folder' : 'file',
    mimeType: f.mimeType,
    size: f.size ? formatBytes(parseInt(f.size)) : (isFolder ? '' : ''),
    modified: f.modifiedTime,
    link: f.webViewLink || (isFolder
      ? `https://drive.google.com/drive/folders/${f.id}`
      : `https://drive.google.com/file/d/${f.id}`),
  };
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body) return req.body;
  return await new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
async function audit(req, user, action, target, meta) {
  try {
    await AuditLog.create({
      email: user?.email, role: user?.role, action, target, meta,
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
      ua: req.headers['user-agent'] || null,
    });
  } catch (_) {}
}

// ─── Seed default projects (idempotent) ──────────────────────────────────────
const DEFAULT_PROJECTS = [
  { slug: 'kirby-sudair', name: 'Kirby Factory – Sudair', reference: 'KSA003',
    location: 'Sudair, Riyadh Province, KSA', status: 'ongoing',
    client: 'Kirby Contracting Co. SPC LLC', consultant: 'ACEC', master_developer: 'MODON',
    value: 'SAR 48,022,000', duration: '8 months (from July 2026)',
    description: 'Civil works for factory building — architectural + structural, masonry, plaster, tiling/flooring/cladding, painting, metal/iron/aluminum works.',
    cover: 1, sort: 1 },
  { slug: 'rak-yanbu', name: 'RAK Ceramics Production Factory – Yanbu', reference: 'KSA002',
    location: 'Yanbu Industrial City, KSA', status: 'ongoing',
    client: 'RAK Ceramic', pmc: 'Stonehaven', engineer: 'Al Bawardi',
    value: 'SAR 31,280,000 (incl. VAT)', duration: '9 months',
    description: 'Civil engineering works for factory building (56,320 m²) and raw materials storage.',
    cover: 2, sort: 2 },
  { slug: 'mada-plasterboard-yanbu', name: 'Mada Gypsum – Plaster Board Expansion',
    location: 'Royal Commission, Yanbu, KSA', status: 'tender',
    client: 'Mada Gypsum Company Ltd.',
    description: 'Civil, architectural, MEP, fire protection, landscaping and hangar steel erection works.',
    cover: 3, sort: 3 },
  { slug: 'mada-modon-riyadh', name: 'Mada Gypsum – Modon Steel Factory', reference: 'AOJ/Offer/124/R2',
    location: 'Modon, Riyadh, KSA', status: 'tender',
    client: 'Mada Gypsum Company Ltd.', consultant: 'Masar Al Enjaz Engineering Consultancy',
    value: 'SAR 23,222,000 (excl. VAT)', duration: '12 months from IFC Drawings & Building Permit',
    description: 'Full civil, structural, architectural, electrical, mechanical, fire protection and fire alarm works.',
    cover: 4, sort: 4 },
];
const DEFAULT_CATEGORIES = {
  confidential: ['Contracts', 'Letters', 'RFIs'],
  logs:         ['Master Log','WIR & MIR Logs','Request to Start Work Log','Letters Log','Request for Information Log','RTS Log','Other Logs'],
  softcopies:   ['Tender Drawings','BOQ','IFC Drawings','Shop Drawings','Method Statements','Pre Qualification Documents','Material Submittals','Sample Submittals','WIR','MIR','NCR','Other Non Confidential Documents'],
};
let _seeded = false;
async function seedIfEmpty() {
  if (_seeded) return; _seeded = true;
  const n = await Project.countDocuments();
  if (n > 0) return;
  for (const p of DEFAULT_PROJECTS) {
    const proj = await Project.create(p);
    for (const [section, cats] of Object.entries(DEFAULT_CATEGORIES)) {
      await Category.insertMany(cats.map((name, i) => ({
        projectId: proj._id, section, name, sort: i,
      })));
    }
  }
  console.log('[seed] created default projects and categories');
}

// ═════════════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.end();

  const url    = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let   action = url.searchParams.get('action') || '';
  let   body   = null;
  if (req.method !== 'GET') { body = await readBody(req); action = action || body.action || ''; }

  try { await connectDB(); await seedIfEmpty(); }
  catch (e) { console.error('[db]', e.message); return json(res, 503, { error: 'Database unavailable' }); }

  try {
    // ────────────────────────────────────────────────────────────────────────
    // AUTH
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'oauth_start' && req.method === 'GET') {
      const isAdminDrive = url.searchParams.get('admin_drive') === '1';
      const state = isAdminDrive
        ? 'admin_drive:' + Date.now()
        : (url.searchParams.get('return') || '/');
      const auth = oauthClient(req);
      const authUrl = auth.generateAuthUrl({
        access_type: 'offline', prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        state,
      });
      res.statusCode = 302; res.setHeader('Location', authUrl); return res.end();
    }

    if (action === 'oauth_callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const err  = url.searchParams.get('error');
      const state = url.searchParams.get('state') || '/';
      if (err)  { res.statusCode = 302; res.setHeader('Location', '/?err=' + encodeURIComponent(err)); return res.end(); }
      if (!code) return json(res, 400, { error: 'Missing code' });

      const auth = oauthClient(req);
      const { tokens } = await auth.getToken(code);
      auth.setCredentials(tokens);
      const me = (await google.oauth2({ version: 'v2', auth }).userinfo.get()).data;

      // Admin-Drive connect flow: state starts with 'admin_drive:'
      if (state.startsWith('admin_drive:')) {
        const current = await getSessionUser(req);
        if (!current || current.role !== 'admin') {
          res.statusCode = 302; res.setHeader('Location', '/admin?err=' + encodeURIComponent('Admin session required')); return res.end();
        }
        if (!tokens.refresh_token && !current.refresh_token) {
          res.statusCode = 302; res.setHeader('Location', '/admin?err=' + encodeURIComponent('No refresh token — revoke previous access at myaccount.google.com/permissions and try again')); return res.end();
        }
        if (tokens.refresh_token) current.refresh_token = encrypt(tokens.refresh_token);
        current.drive_email = me.email;
        current.drive_name  = me.name;
        current.drive_photo = me.picture;
        current.drive_connected_at = new Date();
        await current.save();
        await audit(req, current, 'admin_drive_connect', me.email, {});
        res.statusCode = 302; res.setHeader('Location', '/admin?drive=connected'); return res.end();
      }

      // Regular user login flow
      let user = await User.findOne({ email: me.email });
      if (!user) user = new User({ email: me.email });
      user.name  = me.name  || user.name;
      user.photo = me.picture || user.photo;
      user.last_login = new Date();
      if (tokens.refresh_token) user.refresh_token = encrypt(tokens.refresh_token);

      const anyAdmin = await User.exists({ role: 'admin' });
      if (!anyAdmin) {
        if (!BOOTSTRAP_ADMINS.length || BOOTSTRAP_ADMINS.includes(me.email)) {
          user.role = 'admin'; user.approved = true;
        }
      } else if (BOOTSTRAP_ADMINS.includes(me.email) && user.role !== 'admin') {
        user.role = 'admin'; user.approved = true;
      }
      await user.save();
      issueSession(res, user._id, req);
      await audit(req, user, 'login', 'auth', {});
      res.statusCode = 302; res.setHeader('Location', state.startsWith('/') ? state : '/'); return res.end();
    }

    if (action === 'me' && req.method === 'GET') {
      const user = await getSessionUser(req);
      if (!user) return json(res, 200, { connected: false });
      return json(res, 200, {
        connected: true, email: user.email, name: user.name, photo: user.photo,
        role: user.role, approved: user.approved,
      });
    }

    if (action === 'logout') {
      clearSession(res);
      return json(res, 200, { ok: true });
    }

    // ── Master admin login (username / password) ────────────────────────────
    if (action === 'admin_login' && req.method === 'POST') {
      const { username, password } = body || {};
      if (username !== MASTER_ADMIN_USER || password !== MASTER_ADMIN_PASS) {
        return json(res, 401, { error: 'Invalid username or password.' });
      }
      let u = await User.findOne({ email: 'master-admin@aoj.local' });
      if (!u) u = await User.create({ email: 'master-admin@aoj.local', name: 'Master Admin', role: 'admin', approved: true });
      else if (u.role !== 'admin' || !u.approved) { u.role = 'admin'; u.approved = true; await u.save(); }
      issueSession(res, u._id, req);
      await audit(req, u, 'admin_login', 'master', {});
      return json(res, 200, { ok: true });
    }

    // ────────────────────────────────────────────────────────────────────────
    // PUBLIC: projects + project detail
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'projects' && req.method === 'GET') {
      const list = await Project.find({ active: true }).sort({ sort: 1, name: 1 }).lean();
      return json(res, 200, { projects: list });
    }

    if (action === 'project' && req.method === 'GET') {
      const slug = url.searchParams.get('slug');
      if (!slug) return json(res, 400, { error: 'slug required' });
      const project = await Project.findOne({ slug, active: true }).lean();
      if (!project) return json(res, 404, { error: 'Not found' });
      const cats = await Category.find({ projectId: project._id, active: true }).sort({ sort: 1 }).lean();
      const grouped = { confidential: [], logs: [], softcopies: [] };
      for (const c of cats) if (grouped[c.section]) grouped[c.section].push(c);
      return json(res, 200, { project, categories: grouped });
    }

    // ────────────────────────────────────────────────────────────────────────
    // SEARCH — always uses the MASTER admin's Drive (single shared source).
    // No login needed to search. Confidential hits are marked restricted for
    // non-approved / non-admin users.
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json(res, 200, { items: [], q });

      const m = await getMasterDrive(req);
      if (!m) return json(res, 200, { items: [], q, error: 'The administrator has not connected a Google Drive yet.' });
      const drive = m.drive;
      const currentUser = await getSessionUser(req);
      const canSeeConfidential = currentUser?.role === 'admin' || currentUser?.approved;

      const safe = q.replace(/'/g, "\\'");
      const query = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
      const list = await drive.files.list({
        q: query,
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
        pageSize: 40, orderBy: 'modifiedTime desc',
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });

      const cats = await Category.find({ drive_url: { $ne: null } }).lean();
      const confidentialIds = new Set(cats.filter(c => c.section === 'confidential').map(c => extractDriveId(c.drive_url)).filter(Boolean));

      const parentIds = [...new Set(list.data.files.flatMap(f => f.parents || []))].slice(0, 30);
      const parentMap = {};
      await Promise.all(parentIds.map(async pid => {
        try { const md = await drive.files.get({ fileId: pid, fields: 'id,name', supportsAllDrives: true }); parentMap[pid] = md.data.name; }
        catch (_) {}
      }));

      const items = list.data.files.map(f => {
        const inConfidential = (f.parents || []).some(p => confidentialIds.has(p));
        const restricted = inConfidential && !canSeeConfidential;
        return {
          ...mapFile(f),
          folder: (f.parents && parentMap[f.parents[0]]) || null,
          restricted,
          link: restricted ? null : (f.webViewLink || null),
        };
      });
      return json(res, 200, { q, count: items.length, items });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACCESS REQUESTS (confidential)
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'request_access' && req.method === 'POST') {
      const user = await getSessionUser(req);
      if (!user) return json(res, 401, { error: 'Sign in first' });
      const { projectId, categoryId, section, note } = body || {};
      if (!projectId) return json(res, 400, { error: 'projectId required' });
      const existing = await AccessRequest.findOne({
        userId: user._id, projectId, categoryId: categoryId || null, status: 'pending',
      });
      if (existing) return json(res, 200, { ok: true, existing: true });
      await AccessRequest.create({
        userId: user._id, email: user.email, projectId, categoryId: categoryId || null,
        section: section || 'confidential', note: (note || '').slice(0, 500),
      });
      await audit(req, user, 'access_request', projectId, { categoryId, section });
      return json(res, 200, { ok: true });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ADMIN — everything below requires role=admin
    // ────────────────────────────────────────────────────────────────────────
    const guard = async () => {
      const u = await getSessionUser(req);
      if (!u || u.role !== 'admin') { json(res, 403, { error: 'Admin only' }); return null; }
      return u;
    };

    if (action === 'admin_stats' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const master = await getMasterAdmin();
      const [projects, categories, users, pending, audit24] = await Promise.all([
        Project.countDocuments({ active: true }),
        Category.countDocuments({ active: true }),
        User.countDocuments({}),
        AccessRequest.countDocuments({ status: 'pending' }),
        AuditLog.countDocuments({ created_at: { $gte: new Date(Date.now() - 86400000) } }),
      ]);
      return json(res, 200, {
        projects, categories, users, pending_requests: pending, actions_24h: audit24,
        drive: master && master.refresh_token ? {
          connected: true, email: master.drive_email, name: master.drive_name,
          photo: master.drive_photo, connected_at: master.drive_connected_at,
        } : { connected: false },
      });
    }

    // Master Drive status
    if (action === 'admin_drive_status' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const m = await getMasterAdmin();
      if (!m || !m.refresh_token) return json(res, 200, { connected: false });
      try {
        const drive = getDrive(m, req);
        const info = await drive.about.get({ fields: 'user(emailAddress,displayName,photoLink),storageQuota(limit,usage)' });
        return json(res, 200, {
          connected: true,
          email: info.data.user.emailAddress,
          name:  info.data.user.displayName,
          photo: info.data.user.photoLink,
          storage: {
            limit: info.data.storageQuota?.limit ? formatBytes(parseInt(info.data.storageQuota.limit)) : 'Unlimited',
            used:  formatBytes(parseInt(info.data.storageQuota?.usage || 0)),
          },
          connected_at: m.drive_connected_at,
        });
      } catch (e) {
        if (isInvalidGrant(e)) {
          m.refresh_token = undefined; await m.save();
          return json(res, 200, { connected: false, error: 'Access revoked. Please reconnect.' });
        }
        return json(res, 200, { connected: true, error: e.message });
      }
    }

    // Disconnect master Drive
    if (action === 'admin_drive_disconnect' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterAdmin();
      if (m) {
        m.refresh_token = undefined; m.drive_email = undefined; m.drive_name = undefined;
        m.drive_photo = undefined; m.drive_connected_at = undefined;
        await m.save();
      }
      await audit(req, u, 'admin_drive_disconnect', 'master', {});
      return json(res, 200, { ok: true });
    }

    // Projects CRUD
    if (action === 'admin_projects' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const list = await Project.find({}).sort({ sort: 1 }).lean();
      return json(res, 200, { projects: list });
    }
    if (action === 'admin_project_save' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id, ...data } = body;
      if (!data.slug || !data.name) return json(res, 400, { error: 'slug and name required' });
      let saved;
      if (_id) { saved = await Project.findByIdAndUpdate(_id, data, { new: true }); }
      else     { saved = await Project.create(data); }
      // Auto-create default categories on new project
      if (!_id) {
        for (const [section, cats] of Object.entries(DEFAULT_CATEGORIES)) {
          await Category.insertMany(cats.map((name, i) => ({ projectId: saved._id, section, name, sort: i })));
        }
      }
      await audit(req, u, _id ? 'project_update' : 'project_create', String(saved._id), data);
      return json(res, 200, { project: saved });
    }
    if (action === 'admin_project_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id } = body;
      await Project.findByIdAndUpdate(_id, { active: false });
      await audit(req, u, 'project_delete', _id, {});
      return json(res, 200, { ok: true });
    }

    // Categories CRUD
    if (action === 'admin_categories' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const projectId = url.searchParams.get('projectId');
      const q = projectId ? { projectId } : {};
      const list = await Category.find(q).sort({ section: 1, sort: 1 }).lean();
      return json(res, 200, { categories: list });
    }
    if (action === 'admin_category_save' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id, ...data } = body;
      let saved;
      if (_id) saved = await Category.findByIdAndUpdate(_id, data, { new: true });
      else     saved = await Category.create(data);
      await audit(req, u, _id ? 'category_update' : 'category_create', String(saved._id), data);
      return json(res, 200, { category: saved });
    }
    if (action === 'admin_category_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      await Category.findByIdAndUpdate(body._id, { active: false });
      await audit(req, u, 'category_delete', body._id, {});
      return json(res, 200, { ok: true });
    }

    // Users
    if (action === 'admin_users' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const list = await User.find({}).select('-refresh_token').sort({ last_login: -1 }).lean();
      return json(res, 200, { users: list });
    }
    if (action === 'admin_user_update' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id, role, approved } = body;
      const patch = {};
      if (role !== undefined) patch.role = role;
      if (approved !== undefined) patch.approved = !!approved;
      const saved = await User.findByIdAndUpdate(_id, patch, { new: true }).select('-refresh_token');
      await audit(req, u, 'user_update', _id, patch);
      return json(res, 200, { user: saved });
    }

    // Access requests
    if (action === 'admin_requests' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const list = await AccessRequest.find({}).sort({ created_at: -1 }).limit(200)
        .populate('projectId', 'name slug').populate('categoryId', 'name section').lean();
      return json(res, 200, { requests: list });
    }
    if (action === 'admin_request_decide' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id, decision } = body; // 'approved' | 'denied'
      const r = await AccessRequest.findByIdAndUpdate(_id, {
        status: decision, decided_by: u.email, decided_at: new Date(),
      }, { new: true });
      if (decision === 'approved' && r?.userId) {
        await User.findByIdAndUpdate(r.userId, { approved: true });
      }
      await audit(req, u, 'request_' + decision, _id, {});
      return json(res, 200, { request: r });
    }

    // Audit log
    if (action === 'admin_audit' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const list = await AuditLog.find({}).sort({ created_at: -1 }).limit(200).lean();
      return json(res, 200, { audit: list });
    }

    return json(res, 400, { error: 'Unknown action: ' + action });
  } catch (e) {
    if (isInvalidGrant(e)) {
      const user = await getSessionUser(req);
      if (user) { user.refresh_token = undefined; await user.save(); }
      clearSession(res);
      return json(res, 401, { error: 'Google access revoked. Please reconnect.', revoked: true });
    }
    console.error('[api]', action, e.message);
    return json(res, 500, { error: e.message });
  }
};
