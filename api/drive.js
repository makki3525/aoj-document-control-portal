'use strict';
// AOJ Document Control Portal — v2.1 backend.
// - Password auth (register/login), Google OAuth for admin master Drive
// - Email approval flow with one-click URLs via Gmail API
// - Auto-manages Drive permissions (confidential = private, others = anyone-with-link)
// - Full Drive file/folder management for admins (rename, move, delete)

const mongoose = require('mongoose');
const { google } = require('googleapis');
const crypto   = require('crypto');
const cookie   = require('cookie');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — reads from env vars in production, falls back to dev defaults.
// For production, set these in Vercel dashboard → Project → Settings → Env Vars.
// ═══════════════════════════════════════════════════════════════════════════
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb+srv://makki3525873_db_user:Karan786youme@makki786.88sw6dj.mongodb.net/aoj_portal?appName=aoj';
const JWT_SECRET = process.env.JWT_SECRET || 'aoj_jwt_secret_change_me_5f9c1b_a83d4e2f9b7c6d5e';
const ENC_KEY    = process.env.ENC_KEY    || 'UtAC2SOoMgVup25BMcTOUL2vcVoel74it4prz2oqMzA=';

const GOOGLE_ID     = process.env.GOOGLE_CLIENT_ID     || '601058518061-a0q7e2gc85afbn397vp431be5vjuqb0f.apps.googleusercontent.com';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

const MASTER_ADMIN_USER = process.env.MASTER_ADMIN_USER || 'mad6755';
const MASTER_ADMIN_PASS = process.env.MASTER_ADMIN_PASS || 'mad@(675)';

const GMAIL_FROM          = process.env.GMAIL_FROM          || 'service@nayapay.com';
const GMAIL_ADMIN_INBOX   = process.env.ADMIN_EMAIL         || 'dc@aoj-sa.com';
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '1//01ruq0Ak4LcJuCgYIARAAGAESNwF-L9IrcwaAR3VSwU7n-fkhTHz9u4CTCWtQ8fp_JfmRpD7F5uAvAg44H9cnqtuRxMO4YYQXHaw';

const APP_URL_ENV = process.env.APP_URL || '';

function getBaseURL(req) {
  if (APP_URL_ENV) return APP_URL_ENV.replace(/\/$/, '');
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
function getRedirectURI(req) { return `${getBaseURL(req)}/api/drive?action=oauth_callback`; }

const ALGO        = 'aes-256-cbc';
const COOKIE_NAME = 'aoj_sid';
const MASTER_EMAIL = 'master-admin@aoj.local';

// ─── DB ──────────────────────────────────────────────────────────────────────
let _ready = false;
async function connectDB() {
  if (_ready || mongoose.connection.readyState === 1) { _ready = true; return; }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  _ready = true;
}

const UserSchema = new mongoose.Schema({
  email:         { type: String, index: true, unique: true, lowercase: true, trim: true },
  name:          String,
  photo:         String,
  password_hash: String,                                 // for registered users
  role:          { type: String, enum: ['admin','staff','viewer'], default: 'viewer' },
  access_level:  { type: String, enum: ['none','viewer','editor','admin'], default: 'none' }, // confidential access
  approved:      { type: Boolean, default: false },      // legacy flag, kept
  refresh_token: String,                                 // master Drive token (admin only)
  drive_email:   String, drive_name: String, drive_photo: String, drive_connected_at: Date,
  created_at:    { type: Date, default: Date.now },
  last_login:    { type: Date, default: Date.now },
});
const User = mongoose.models.AojUser || mongoose.model('AojUser', UserSchema);

const ProjectSchema = new mongoose.Schema({
  slug: { type: String, unique: true, index: true },
  name: String, reference: String, location: String,
  status: { type: String, enum: ['ongoing','tender','completed'], default: 'ongoing' },
  client: String, consultant: String, engineer: String, pmc: String,
  developer: String, master_developer: String,
  value: String, duration: String, scope: String, description: String,
  cover: { type: Number, default: 1 }, sort: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  drive_root: String,
  created_at: { type: Date, default: Date.now },
});
const Project = mongoose.models.AojProject || mongoose.model('AojProject', ProjectSchema);

const CategorySchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'AojProject', index: true },
  section:   { type: String, enum: ['confidential','logs','softcopies'], index: true },
  name: String,
  drive_url: String,
  drive_type: { type: String, enum: ['folder','file','sheet','doc'], default: 'folder' },
  sort: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});
const Category = mongoose.models.AojCategory || mongoose.model('AojCategory', CategorySchema);

const AccessRequestSchema = new mongoose.Schema({
  email:        { type: String, lowercase: true, trim: true },
  name:         String,
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'AojUser' },
  projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'AojProject' },
  categoryId:   { type: mongoose.Schema.Types.ObjectId, ref: 'AojCategory' },
  section:      String,
  note:         String,
  requested_level: { type: String, enum: ['viewer','editor'], default: 'viewer' },
  status:       { type: String, enum: ['pending','viewer','editor','denied'], default: 'pending' },
  decided_by:   String, decided_at: Date,
  created_at:   { type: Date, default: Date.now },
});
const AccessRequest = mongoose.models.AojAccessRequest || mongoose.model('AojAccessRequest', AccessRequestSchema);

// One-time secure tokens for the 3 email approval URLs.
// tokenHash = sha256 of raw random token. Raw token never stored.
const ActionTokenSchema = new mongoose.Schema({
  requestId:  { type: mongoose.Schema.Types.ObjectId, ref: 'AojAccessRequest', index: true },
  action:     { type: String, enum: ['viewer','editor','denied'] },
  token_hash: { type: String, unique: true, index: true },
  expires_at: { type: Date, index: true },
  used_at:    Date,
  created_at: { type: Date, default: Date.now },
});
const ActionToken = mongoose.models.AojActionToken || mongoose.model('AojActionToken', ActionTokenSchema);

const AuditLogSchema = new mongoose.Schema({
  email: String, role: String, action: String, target: String,
  meta: mongoose.Schema.Types.Mixed, ip: String, ua: String,
  created_at: { type: Date, default: Date.now, index: true },
});
const AuditLog = mongoose.models.AojAudit || mongoose.model('AojAudit', AuditLogSchema);

// ─── Crypto & session ────────────────────────────────────────────────────────
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

// ─── Google Drive helpers ────────────────────────────────────────────────────
function oauthClient(req) { return new google.auth.OAuth2(GOOGLE_ID, GOOGLE_SECRET, getRedirectURI(req)); }
function getDrive(user, req) {
  const auth = oauthClient(req);
  auth.setCredentials({ refresh_token: decrypt(user.refresh_token) });
  return google.drive({ version: 'v3', auth });
}
async function getMasterAdmin() { return await User.findOne({ email: MASTER_EMAIL }); }
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
    id: f.id, name: f.name, type: isFolder ? 'folder' : 'file', mimeType: f.mimeType,
    size: f.size ? formatBytes(parseInt(f.size)) : (isFolder ? '' : ''),
    modified: f.modifiedTime,
    link: f.webViewLink || (isFolder ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}`),
  };
}

// Set a Drive item + all descendants to public (anyone with link → viewer)
async function setPublic(drive, fileId) {
  try {
    // remove existing anyone perms (idempotent)
    const perms = await drive.permissions.list({ fileId, fields: 'permissions(id,type,role)', supportsAllDrives: true });
    const has = (perms.data.permissions || []).some(p => p.type === 'anyone');
    if (!has) {
      await drive.permissions.create({
        fileId, supportsAllDrives: true,
        requestBody: { type: 'anyone', role: 'reader', allowFileDiscovery: false },
      });
    }
  } catch (e) { console.error('[setPublic]', e.message); }
}
// Set a Drive item to private (remove anyone-with-link)
async function setPrivate(drive, fileId) {
  try {
    const perms = await drive.permissions.list({ fileId, fields: 'permissions(id,type,role)', supportsAllDrives: true });
    for (const p of (perms.data.permissions || [])) {
      if (p.type === 'anyone') {
        try { await drive.permissions.delete({ fileId, permissionId: p.id, supportsAllDrives: true }); } catch (_) {}
      }
    }
  } catch (e) { console.error('[setPrivate]', e.message); }
}
// Share a file with a specific email (viewer/editor)
async function shareWithEmail(drive, fileId, email, role) {
  try {
    await drive.permissions.create({
      fileId, supportsAllDrives: true, sendNotificationEmail: true,
      requestBody: { type: 'user', role: role === 'editor' ? 'writer' : 'reader', emailAddress: email },
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
// Remove a specific email from a file's permissions
async function unshareEmail(drive, fileId, email) {
  try {
    const perms = await drive.permissions.list({ fileId, fields: 'permissions(id,emailAddress,type)', supportsAllDrives: true });
    for (const p of (perms.data.permissions || [])) {
      if (p.emailAddress && p.emailAddress.toLowerCase() === email.toLowerCase()) {
        try { await drive.permissions.delete({ fileId, permissionId: p.id, supportsAllDrives: true }); } catch (_) {}
      }
    }
  } catch (_) {}
}

// ─── Gmail sender ────────────────────────────────────────────────────────────
function gmailClient() {
  const auth = new google.auth.OAuth2(GOOGLE_ID, GOOGLE_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}
function buildRawEmail({ from, to, subject, html }) {
  const boundary = '=_boundary_' + Date.now();
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(msg).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sendEmail({ to, subject, html }) {
  try {
    const gmail = gmailClient();
    const raw = buildRawEmail({ from: GMAIL_FROM, to, subject, html });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return { ok: true };
  } catch (e) { console.error('[gmail send]', e.message); return { ok: false, error: e.message }; }
}
function emailTemplate({ title, body, actions }) {
  return `
  <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 600px; margin: 0 auto; background:#fafafa; padding:20px;">
    <div style="background:#fff; border-radius:14px; padding:32px; box-shadow: 0 2px 10px rgba(0,0,0,.06);">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
        <div style="width:44px; height:44px; border-radius:11px; background:linear-gradient(135deg,#b40e2c,#8a0a21); color:#fff; font-weight:800; display:grid; place-items:center; font-size:14px;">AOJ</div>
        <div><b style="font-size:16px;">AOJ Document Control</b><br><small style="color:#888;">Notification</small></div>
      </div>
      <h2 style="margin:0 0 12px; font-size:20px; color:#0d1626;">${title}</h2>
      <div style="color:#33405a; font-size:14.5px; line-height:1.6;">${body}</div>
      ${actions ? `<div style="margin-top:24px; display:flex; gap:10px; flex-wrap:wrap;">${actions}</div>` : ''}
      <p style="color:#999; font-size:12px; margin-top:28px; padding-top:16px; border-top:1px solid #eee;">This is an automated message from the AOJ Document Control Portal.</p>
    </div>
  </div>`;
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
  res.end(JSON.stringify(obj, null, 2));
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

// ─── Seed default projects ───────────────────────────────────────────────────
const DEFAULT_PROJECTS = [
  { slug: 'kirby-sudair', name: 'Kirby Factory – Sudair', reference: 'KSA003', location: 'Sudair, Riyadh Province, KSA', status: 'ongoing', client: 'Kirby Contracting Co. SPC LLC', consultant: 'ACEC', master_developer: 'MODON', value: 'SAR 48,022,000', duration: '8 months (from July 2026)', description: 'Civil works for factory building — architectural + structural, masonry, plaster, tiling/flooring/cladding, painting, metal/iron/aluminum works.', cover: 1, sort: 1 },
  { slug: 'rak-yanbu', name: 'RAK Ceramics Production Factory – Yanbu', reference: 'KSA002', location: 'Yanbu Industrial City, KSA', status: 'ongoing', client: 'RAK Ceramic', pmc: 'Stonehaven', engineer: 'Al Bawardi', value: 'SAR 31,280,000 (incl. VAT)', duration: '9 months', description: 'Civil engineering works for factory building (56,320 m²) and raw materials storage.', cover: 2, sort: 2 },
  { slug: 'mada-plasterboard-yanbu', name: 'Mada Gypsum – Plaster Board Expansion', location: 'Royal Commission, Yanbu, KSA', status: 'tender', client: 'Mada Gypsum Company Ltd.', description: 'Civil, architectural, MEP, fire protection, landscaping and hangar steel erection works.', cover: 3, sort: 3 },
  { slug: 'mada-modon-riyadh', name: 'Mada Gypsum – Modon Steel Factory', reference: 'AOJ/Offer/124/R2', location: 'Modon, Riyadh, KSA', status: 'tender', client: 'Mada Gypsum Company Ltd.', consultant: 'Masar Al Enjaz Engineering Consultancy', value: 'SAR 23,222,000 (excl. VAT)', duration: '12 months from IFC Drawings & Building Permit', description: 'Full civil, structural, architectural, electrical, mechanical, fire protection and fire alarm works.', cover: 4, sort: 4 },
];
const DEFAULT_CATEGORIES = {
  confidential: ['Contracts', 'Letters', 'RFIs'],
  logs: ['Master Log','WIR & MIR Logs','Request to Start Work Log','Letters Log','Request for Information Log','RTS Log','Other Logs'],
  softcopies: ['Tender Drawings','BOQ','IFC Drawings','Shop Drawings','Method Statements','Pre Qualification Documents','Material Submittals','Sample Submittals','WIR','MIR','NCR','Other Non Confidential Documents'],
};
let _seeded = false;
async function seedIfEmpty() {
  if (_seeded) return; _seeded = true;
  const n = await Project.countDocuments();
  if (n > 0) return;
  for (const p of DEFAULT_PROJECTS) {
    const proj = await Project.create(p);
    for (const [section, cats] of Object.entries(DEFAULT_CATEGORIES)) {
      await Category.insertMany(cats.map((name, i) => ({ projectId: proj._id, section, name, sort: i })));
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.end();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let action = url.searchParams.get('action') || '';
  let body = null;
  if (req.method !== 'GET') { body = await readBody(req); action = action || body.action || ''; }

  try { await connectDB(); await seedIfEmpty(); }
  catch (e) { console.error('[db]', e.message); return json(res, 503, { error: 'Database unavailable' }); }

  try {
    // ────────────────────────────────────────────────────────────────────────
    // PASSWORD AUTH — public site
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'register' && req.method === 'POST') {
      const { name, email, password } = body || {};
      if (!name || !email || !password) return json(res, 400, { error: 'Name, email and password are required.' });
      if (password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
      const cleanEmail = String(email).toLowerCase().trim();
      const existing = await User.findOne({ email: cleanEmail });
      if (existing && existing.password_hash) return json(res, 409, { error: 'An account with that email already exists — try signing in.' });
      const hash = await bcrypt.hash(password, 10);
      let user = existing || new User({ email: cleanEmail });
      user.name = name.trim(); user.password_hash = hash; user.last_login = new Date();
      await user.save();
      issueSession(res, user._id, req);
      await audit(req, user, 'register', 'user', {});
      return json(res, 200, { ok: true });
    }

    if (action === 'login' && req.method === 'POST') {
      const { email, password } = body || {};
      if (!email || !password) return json(res, 400, { error: 'Email and password are required.' });
      const cleanEmail = String(email).toLowerCase().trim();
      const user = await User.findOne({ email: cleanEmail });
      if (!user || !user.password_hash) return json(res, 401, { error: 'Invalid email or password.' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return json(res, 401, { error: 'Invalid email or password.' });
      user.last_login = new Date(); await user.save();
      issueSession(res, user._id, req);
      await audit(req, user, 'login', 'password', {});
      return json(res, 200, { ok: true });
    }

    // ────────────────────────────────────────────────────────────────────────
    // GOOGLE OAUTH — admin master Drive only
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'oauth_start' && req.method === 'GET') {
      const isAdminDrive = url.searchParams.get('admin_drive') === '1';
      const state = isAdminDrive ? 'admin_drive:' + Date.now() : '/';
      const auth = oauthClient(req);
      const authUrl = auth.generateAuthUrl({
        access_type: 'offline', prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/drive',
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
      if (err)  { res.statusCode = 302; res.setHeader('Location', '/admin?err=' + encodeURIComponent(err)); return res.end(); }
      if (!code) return json(res, 400, { error: 'Missing code' });

      const auth = oauthClient(req);
      const { tokens } = await auth.getToken(code);
      auth.setCredentials(tokens);
      const me = (await google.oauth2({ version: 'v2', auth }).userinfo.get()).data;

      if (state.startsWith('admin_drive:')) {
        const current = await getSessionUser(req);
        if (!current || current.role !== 'admin') {
          res.statusCode = 302; res.setHeader('Location', '/admin?err=' + encodeURIComponent('Admin session required')); return res.end();
        }
        if (!tokens.refresh_token && !current.refresh_token) {
          res.statusCode = 302; res.setHeader('Location', '/admin?err=' + encodeURIComponent('No refresh token — revoke at myaccount.google.com/permissions and retry')); return res.end();
        }
        if (tokens.refresh_token) current.refresh_token = encrypt(tokens.refresh_token);
        current.drive_email = me.email; current.drive_name = me.name;
        current.drive_photo = me.picture; current.drive_connected_at = new Date();
        await current.save();
        await audit(req, current, 'admin_drive_connect', me.email, {});
        res.statusCode = 302; res.setHeader('Location', '/admin?drive=connected'); return res.end();
      }
      res.statusCode = 302; res.setHeader('Location', '/'); return res.end();
    }

    if (action === 'me' && req.method === 'GET') {
      const user = await getSessionUser(req);
      if (!user) return json(res, 200, { connected: false });
      return json(res, 200, {
        connected: true, email: user.email, name: user.name, photo: user.photo,
        role: user.role, access_level: user.access_level, approved: user.approved,
      });
    }
    if (action === 'logout') { clearSession(res); return json(res, 200, { ok: true }); }

    // Master admin (username/password) login
    if (action === 'admin_login' && req.method === 'POST') {
      const { username, password } = body || {};
      if (username !== MASTER_ADMIN_USER || password !== MASTER_ADMIN_PASS) {
        return json(res, 401, { error: 'Invalid username or password.' });
      }
      let u = await User.findOne({ email: MASTER_EMAIL });
      if (!u) u = await User.create({ email: MASTER_EMAIL, name: 'Master Admin', role: 'admin', approved: true, access_level: 'admin' });
      else if (u.role !== 'admin') { u.role = 'admin'; u.approved = true; u.access_level = 'admin'; await u.save(); }
      issueSession(res, u._id, req);
      await audit(req, u, 'admin_login', 'master', {});
      return json(res, 200, { ok: true });
    }

    // ────────────────────────────────────────────────────────────────────────
    // PUBLIC — projects + search
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'projects' && req.method === 'GET') {
      const list = await Project.find({ active: true }).sort({ sort: 1, name: 1 }).lean();
      return json(res, 200, { projects: list });
    }
    if (action === 'project' && req.method === 'GET') {
      const slug = url.searchParams.get('slug');
      const p = await Project.findOne({ slug, active: true }).lean();
      if (!p) return json(res, 404, { error: 'Not found' });
      const cats = await Category.find({ projectId: p._id, active: true }).sort({ sort: 1 }).lean();
      const currentUser = await getSessionUser(req);
      const canSeeConfidential = currentUser?.role === 'admin' || ['viewer','editor','admin'].includes(currentUser?.access_level);
      const grouped = { confidential: [], logs: [], softcopies: [] };
      for (const c of cats) {
        if (!grouped[c.section]) continue;
        // CRITICAL: strip drive_url and drive_type from confidential categories for unauthorized users.
        if (c.section === 'confidential' && !canSeeConfidential) {
          grouped.confidential.push({
            _id: c._id, projectId: c.projectId, section: c.section, name: c.name,
            sort: c.sort, active: c.active, drive_url: null, drive_type: null,
          });
        } else {
          grouped[c.section].push(c);
        }
      }
      return json(res, 200, { project: p, categories: grouped });
    }

    if (action === 'search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json(res, 200, { items: [], q });
      const m = await getMasterDrive(req);
      if (!m) return json(res, 200, { items: [], q, error: 'The administrator has not connected a Google Drive yet.' });
      const drive = m.drive;
      const currentUser = await getSessionUser(req);
      const canSeeConfidential = currentUser?.role === 'admin' || ['viewer','editor','admin'].includes(currentUser?.access_level);

      const safe = q.replace(/'/g, "\\'");
      const query = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
      const list = await drive.files.list({
        q: query,
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
        pageSize: 40, orderBy: 'modifiedTime desc',
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      const cats = await Category.find({ drive_url: { $ne: null }, active: true }).lean();
      const confidentialRoots = cats.filter(c => c.section === 'confidential').map(c => extractDriveId(c.drive_url)).filter(Boolean);
      const confidentialSet   = new Set(confidentialRoots);

      // Walk each file's ancestor chain (cached) to determine if it descends from any confidential folder.
      const parentNameCache = {}, parentParentsCache = {};
      async function getParents(fileId) {
        if (parentParentsCache[fileId] !== undefined) return parentParentsCache[fileId];
        try {
          const md = await drive.files.get({ fileId, fields: 'id,name,parents', supportsAllDrives: true });
          parentNameCache[fileId] = md.data.name;
          parentParentsCache[fileId] = md.data.parents || [];
          return parentParentsCache[fileId];
        } catch (_) { parentParentsCache[fileId] = []; return []; }
      }
      async function isDescendantOfConfidential(fileParents) {
        if (!fileParents || !fileParents.length) return false;
        const stack = [...fileParents];
        const seen = new Set();
        while (stack.length) {
          const id = stack.pop();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (confidentialSet.has(id)) return true;
          const grandparents = await getParents(id);
          for (const g of grandparents) if (!seen.has(g)) stack.push(g);
          if (seen.size > 50) break; // safety cap
        }
        return false;
      }

      const items = [];
      for (const f of list.data.files) {
        const inConf = await isDescendantOfConfidential(f.parents || []);
        if (inConf && !canSeeConfidential) continue; // CRITICAL: fully exclude, do not leak name
        const folderId = f.parents && f.parents[0];
        const folderName = folderId ? (parentNameCache[folderId] || (await getParents(folderId), parentNameCache[folderId])) : null;
        items.push({
          ...mapFile(f),
          folder: folderName || null,
          confidential: inConf,
          link: (inConf && !canSeeConfidential) ? null : (f.webViewLink || null),
        });
      }
      return json(res, 200, { q, count: items.length, items });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACCESS REQUEST — public users request confidential access by email
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'request_access' && req.method === 'POST') {
      const { email, name, projectId, categoryId, section, note, requested_level } = body || {};
      if (!email || !String(email).includes('@')) return json(res, 400, { error: 'Valid email is required.' });
      const cleanEmail = String(email).toLowerCase().trim();
      const level = (requested_level === 'editor') ? 'editor' : 'viewer';
      const proj = projectId ? await Project.findById(projectId) : null;
      const cat  = categoryId ? await Category.findById(categoryId) : null;

      // If the email already has confidential access, no request needed
      const alreadyUser = await User.findOne({ email: cleanEmail });
      if (alreadyUser && ['viewer','editor','admin'].includes(alreadyUser.access_level)) {
        return json(res, 200, { ok: true, already_approved: true, message: 'You already have access. Please sign in.' });
      }

      // De-dupe pending
      const existing = await AccessRequest.findOne({
        email: cleanEmail, projectId: projectId || null, categoryId: categoryId || null, status: 'pending',
      });
      if (existing) return json(res, 200, { ok: true, existing: true, message: 'You already have a pending request for this file.' });

      const rq = await AccessRequest.create({
        email: cleanEmail, name: name || '', projectId: projectId || null,
        categoryId: categoryId || null, section: section || 'confidential',
        note: (note || '').slice(0, 500), requested_level: level,
      });
      await audit(req, { email: cleanEmail }, 'access_request', String(rq._id), { level });

      // Generate 3 cryptographically random one-time tokens (never store raw)
      const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
      const mkTok = async (a) => {
        const raw = crypto.randomBytes(32).toString('hex');
        await ActionToken.create({
          requestId: rq._id, action: a, token_hash: sha(raw),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });
        return raw;
      };
      const base = getBaseURL(req);
      const urlView = `${base}/api/drive?action=decide&t=${await mkTok('viewer')}`;
      const urlEdit = `${base}/api/drive?action=decide&t=${await mkTok('editor')}`;
      const urlDeny = `${base}/api/drive?action=decide&t=${await mkTok('denied')}`;

      const html = emailTemplate({
        title: `🔑 New confidential access request`,
        body: `
          <p><b>${escapeHtml(cleanEmail)}</b>${name ? ` (${escapeHtml(name)})` : ''} is requesting <b>${level}</b> access to:</p>
          <div style="background:#f5f6fa; border-radius:10px; padding:14px 16px; margin:14px 0;">
            <b>Project:</b> ${escapeHtml(proj?.name || '—')}<br>
            <b>Category:</b> ${escapeHtml(cat?.name || section || '—')}<br>
            ${note ? `<b>Note:</b> ${escapeHtml(note)}<br>` : ''}
          </div>
          <p>Click one of the buttons below to decide. Each link is a single one-click action — no login required.</p>`,
        actions: `
          <a href="${urlView}" style="background:#067647; color:#fff; padding:12px 20px; border-radius:9px; text-decoration:none; font-weight:600; display:inline-block;">✓ Grant Viewer Access</a>
          <a href="${urlEdit}" style="background:#175cd3; color:#fff; padding:12px 20px; border-radius:9px; text-decoration:none; font-weight:600; display:inline-block;">✎ Grant Editor Access</a>
          <a href="${urlDeny}" style="background:#b42318; color:#fff; padding:12px 20px; border-radius:9px; text-decoration:none; font-weight:600; display:inline-block;">✗ Reject</a>`,
      });
      sendEmail({ to: GMAIL_ADMIN_INBOX, subject: `Access request — ${cleanEmail}`, html }).catch(() => {});

      return json(res, 200, { ok: true, message: 'Request submitted. The administrator has been notified.' });
    }

    // One-click approval from email — DB-backed single-use tokens
    if (action === 'decide' && req.method === 'GET') {
      const t = url.searchParams.get('t');
      if (!t || t.length < 20) return renderDecisionPage(res, 'error', 'Invalid approval link.');
      const tokenHash = crypto.createHash('sha256').update(t).digest('hex');
      const tok = await ActionToken.findOne({ token_hash: tokenHash });
      if (!tok) return renderDecisionPage(res, 'error', 'Invalid approval link.');
      if (tok.used_at) return renderDecisionPage(res, 'error', 'This approval link has already been used.');
      if (tok.expires_at && tok.expires_at < new Date()) return renderDecisionPage(res, 'error', 'This approval link has expired.');

      const rq = await AccessRequest.findById(tok.requestId);
      if (!rq) return renderDecisionPage(res, 'error', 'Access request not found.');
      if (rq.status !== 'pending') {
        // Consume the token so it can't be reused
        tok.used_at = new Date(); await tok.save();
        return renderDecisionPage(res, 'info', `This request has already been processed (status: ${rq.status}).`);
      }

      const decision = tok.action;
      rq.status = decision;
      rq.decided_by = 'email-link'; rq.decided_at = new Date();
      await rq.save();

      // Invalidate all sibling tokens for this request (single-decision)
      tok.used_at = new Date(); await tok.save();
      await ActionToken.updateMany(
        { requestId: rq._id, _id: { $ne: tok._id }, used_at: null },
        { $set: { used_at: new Date() } }
      );

      // Update user record + share Drive item if approved
      if (decision === 'viewer' || decision === 'editor') {
        let u = await User.findOne({ email: rq.email });
        if (!u) u = await User.create({ email: rq.email, name: rq.name || '' });
        u.access_level = decision; u.approved = true; await u.save();

        // If category maps to a specific Drive item, share directly with the user
        if (rq.categoryId) {
          const cat = await Category.findById(rq.categoryId);
          const fileId = cat && extractDriveId(cat.drive_url);
          if (fileId) {
            const m = await getMasterDrive(req);
            if (m) await shareWithEmail(m.drive, fileId, rq.email, decision);
          }
        }

        sendEmail({
          to: rq.email,
          subject: `Your access to AOJ Document Control has been approved`,
          html: emailTemplate({
            title: `✓ Access granted`,
            body: `<p>You now have <b>${decision}</b> access to confidential documents on the AOJ Document Control Portal.</p><p>Sign in at <a href="${getBaseURL(req)}/login" style="color:#b40e2c;">${getBaseURL(req)}/login</a> with the email <b>${escapeHtml(rq.email)}</b>.</p>`,
          }),
        }).catch(() => {});
      } else if (decision === 'denied') {
        sendEmail({
          to: rq.email, subject: `Your access request was declined`,
          html: emailTemplate({
            title: `Access request declined`,
            body: `<p>Your request for confidential access was declined by the administrator. Please contact <a href="mailto:${GMAIL_ADMIN_INBOX}">${GMAIL_ADMIN_INBOX}</a> for details.</p>`,
          }),
        }).catch(() => {});
      }
      await audit(req, { email: 'email-link' }, 'decide_' + decision, String(rq._id), {});

      const map = { viewer: ['Viewer access granted', '#067647'], editor: ['Editor access granted', '#175cd3'], denied: ['Request rejected', '#b42318'] };
      const [msg] = map[decision] || ['Decision recorded'];
      return renderDecisionPage(res, decision === 'denied' ? 'reject' : decision, msg, {
        email: rq.email, decision, request_id: String(rq._id), decided_at: new Date().toISOString(),
      });
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
        Project.countDocuments({ active: true }), Category.countDocuments({ active: true }),
        User.countDocuments({}), AccessRequest.countDocuments({ status: 'pending' }),
        AuditLog.countDocuments({ created_at: { $gte: new Date(Date.now() - 86400000) } }),
      ]);
      return json(res, 200, {
        projects, categories, users, pending_requests: pending, actions_24h: audit24,
        drive: master && master.refresh_token ? { connected: true, email: master.drive_email, name: master.drive_name, photo: master.drive_photo, connected_at: master.drive_connected_at } : { connected: false },
      });
    }

    if (action === 'admin_drive_status' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const m = await getMasterAdmin();
      if (!m || !m.refresh_token) return json(res, 200, { connected: false });
      try {
        const drive = getDrive(m, req);
        const info = await drive.about.get({ fields: 'user(emailAddress,displayName,photoLink),storageQuota(limit,usage)' });
        return json(res, 200, {
          connected: true, email: info.data.user.emailAddress, name: info.data.user.displayName, photo: info.data.user.photoLink,
          storage: { limit: info.data.storageQuota?.limit ? formatBytes(parseInt(info.data.storageQuota.limit)) : 'Unlimited', used: formatBytes(parseInt(info.data.storageQuota?.usage || 0)) },
          connected_at: m.drive_connected_at,
        });
      } catch (e) {
        if (isInvalidGrant(e)) { m.refresh_token = undefined; await m.save(); return json(res, 200, { connected: false, error: 'Access revoked.' }); }
        return json(res, 200, { connected: true, error: e.message });
      }
    }
    if (action === 'admin_drive_disconnect' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterAdmin();
      if (m) { m.refresh_token = undefined; m.drive_email = undefined; m.drive_name = undefined; m.drive_photo = undefined; m.drive_connected_at = undefined; await m.save(); }
      await audit(req, u, 'admin_drive_disconnect', 'master', {});
      return json(res, 200, { ok: true });
    }

    // Drive file browser — list any folder in master Drive
    if (action === 'admin_drive_list' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req);
      if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const folderId = url.searchParams.get('folder') || 'root';
      const meta = folderId === 'root'
        ? { id: 'root', name: 'My Drive' }
        : (await m.drive.files.get({ fileId: folderId, fields: 'id,name,mimeType,parents', supportsAllDrives: true })).data;
      const list = await m.drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
        pageSize: 500, orderBy: 'folder,name',
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      return json(res, 200, { folder: meta, items: list.data.files.map(mapFile) });
    }

    // Rename Drive item
    if (action === 'admin_drive_rename' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { fileId, name } = body || {};
      if (!fileId || !name) return json(res, 400, { error: 'fileId and name required' });
      await m.drive.files.update({ fileId, requestBody: { name: name.trim() }, supportsAllDrives: true });
      await audit(req, u, 'drive_rename', fileId, { name });
      return json(res, 200, { ok: true });
    }

    // Move Drive item
    if (action === 'admin_drive_move' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { fileId, newParentId } = body || {};
      if (!fileId || !newParentId) return json(res, 400, { error: 'fileId and newParentId required' });
      const cur = await m.drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
      const oldParents = (cur.data.parents || []).join(',');
      await m.drive.files.update({ fileId, addParents: newParentId, removeParents: oldParents, supportsAllDrives: true });
      await audit(req, u, 'drive_move', fileId, { newParentId });
      return json(res, 200, { ok: true });
    }

    // Delete Drive item (moves to trash)
    if (action === 'admin_drive_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { fileId } = body || {};
      if (!fileId) return json(res, 400, { error: 'fileId required' });
      await m.drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
      await audit(req, u, 'drive_delete', fileId, {});
      return json(res, 200, { ok: true });
    }

    // Create folder
    if (action === 'admin_drive_mkdir' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { parentId, name } = body || {};
      if (!name) return json(res, 400, { error: 'name required' });
      const r = await m.drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId || 'root'] },
        fields: 'id,name,webViewLink', supportsAllDrives: true,
      });
      return json(res, 200, { folder: r.data });
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
      if (_id) saved = await Project.findByIdAndUpdate(_id, data, { new: true });
      else {
        saved = await Project.create(data);
        for (const [section, cats] of Object.entries(DEFAULT_CATEGORIES)) {
          await Category.insertMany(cats.map((name, i) => ({ projectId: saved._id, section, name, sort: i })));
        }
      }
      await audit(req, u, _id ? 'project_update' : 'project_create', String(saved._id), data);
      return json(res, 200, { project: saved });
    }
    if (action === 'admin_project_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      await Project.findByIdAndUpdate(body._id, { active: false });
      await audit(req, u, 'project_delete', body._id, {});
      return json(res, 200, { ok: true });
    }
    if (action === 'admin_project_reorder' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { order } = body || {}; // array of ids in desired order
      if (!Array.isArray(order)) return json(res, 400, { error: 'order array required' });
      for (let i = 0; i < order.length; i++) await Project.findByIdAndUpdate(order[i], { sort: i });
      return json(res, 200, { ok: true });
    }

    // Categories CRUD + auto Drive permission on save
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
      else saved = await Category.create(data);

      // Auto-set Drive permissions
      const fileId = extractDriveId(saved.drive_url);
      if (fileId) {
        const m = await getMasterDrive(req);
        if (m) {
          if (saved.section === 'confidential') await setPrivate(m.drive, fileId);
          else await setPublic(m.drive, fileId);
        }
      }
      await audit(req, u, _id ? 'category_update' : 'category_create', String(saved._id), data);
      return json(res, 200, { category: saved });
    }
    if (action === 'admin_category_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      await Category.findByIdAndUpdate(body._id, { active: false });
      await audit(req, u, 'category_delete', body._id, {});
      return json(res, 200, { ok: true });
    }
    if (action === 'admin_category_reorder' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { order } = body || {};
      if (!Array.isArray(order)) return json(res, 400, { error: 'order array required' });
      for (let i = 0; i < order.length; i++) await Category.findByIdAndUpdate(order[i], { sort: i });
      return json(res, 200, { ok: true });
    }

    // Users
    if (action === 'admin_users' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const list = await User.find({}).select('-refresh_token -password_hash').sort({ last_login: -1 }).lean();
      return json(res, 200, { users: list });
    }
    if (action === 'admin_user_update' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { _id, role, access_level, approved } = body;
      const patch = {};
      if (role !== undefined) patch.role = role;
      if (access_level !== undefined) patch.access_level = access_level;
      if (approved !== undefined) patch.approved = !!approved;
      const saved = await User.findByIdAndUpdate(_id, patch, { new: true }).select('-refresh_token -password_hash');
      await audit(req, u, 'user_update', _id, patch);
      return json(res, 200, { user: saved });
    }

    // List permissions on a Drive file/folder (admin only)
    if (action === 'admin_permissions_list' && req.method === 'GET') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const fileId = url.searchParams.get('fileId');
      if (!fileId) return json(res, 400, { error: 'fileId required' });
      try {
        const r = await m.drive.permissions.list({
          fileId, supportsAllDrives: true,
          fields: 'permissions(id,type,role,emailAddress,displayName)',
        });
        return json(res, 200, { permissions: r.data.permissions || [] });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // Change an existing Drive permission's role
    if (action === 'admin_permission_update' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { fileId, permissionId, role } = body || {};
      if (!fileId || !permissionId || !role) return json(res, 400, { error: 'fileId, permissionId, role required' });
      const driveRole = role === 'editor' ? 'writer' : 'reader';
      await m.drive.permissions.update({ fileId, permissionId, requestBody: { role: driveRole }, supportsAllDrives: true });
      await audit(req, u, 'permission_update', permissionId, { role });
      return json(res, 200, { ok: true });
    }

    // Remove a Drive permission
    if (action === 'admin_permission_delete' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const m = await getMasterDrive(req); if (!m) return json(res, 400, { error: 'Master Drive not connected' });
      const { fileId, permissionId } = body || {};
      if (!fileId || !permissionId) return json(res, 400, { error: 'fileId and permissionId required' });
      await m.drive.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
      await audit(req, u, 'permission_delete', permissionId, { fileId });
      return json(res, 200, { ok: true });
    }

    // Admin grants access directly by email (no request needed)
    if (action === 'admin_grant_access' && req.method === 'POST') {
      const u = await guard(); if (!u) return;
      const { email, access_level, categoryId } = body;
      if (!email || !access_level) return json(res, 400, { error: 'email and access_level required' });
      const clean = String(email).toLowerCase().trim();
      let user = await User.findOne({ email: clean });
      if (!user) user = await User.create({ email: clean, name: '', access_level, approved: true });
      else { user.access_level = access_level; user.approved = true; await user.save(); }

      // Share the specific category's Drive item, if any
      if (categoryId) {
        const cat = await Category.findById(categoryId);
        const fileId = cat && extractDriveId(cat.drive_url);
        if (fileId) {
          const m = await getMasterDrive(req);
          if (m) await shareWithEmail(m.drive, fileId, clean, access_level);
        }
      }
      sendEmail({
        to: clean, subject: `You've been granted access to AOJ Document Control`,
        html: emailTemplate({
          title: `✓ Access granted by administrator`,
          body: `<p>You've been granted <b>${access_level}</b> access to confidential documents on the AOJ Document Control Portal.</p><p>Sign in at <a href="${getBaseURL(req)}/login" style="color:#b40e2c;">${getBaseURL(req)}/login</a>.</p>`,
        }),
      }).catch(() => {});
      await audit(req, u, 'grant_access', clean, { access_level, categoryId });
      return json(res, 200, { ok: true });
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
      const { _id, decision } = body;
      const r = await AccessRequest.findByIdAndUpdate(_id, {
        status: decision, decided_by: u.email, decided_at: new Date(),
      }, { new: true });
      if ((decision === 'viewer' || decision === 'editor') && r?.email) {
        let usr = await User.findOne({ email: r.email });
        if (!usr) usr = await User.create({ email: r.email, name: r.name || '' });
        usr.access_level = decision; usr.approved = true; await usr.save();
        if (r.categoryId) {
          const cat = await Category.findById(r.categoryId);
          const fileId = cat && extractDriveId(cat.drive_url);
          if (fileId) { const m = await getMasterDrive(req); if (m) await shareWithEmail(m.drive, fileId, r.email, decision); }
        }
        sendEmail({ to: r.email, subject: 'Your access has been approved', html: emailTemplate({ title: 'Access granted', body: `<p>You now have <b>${decision}</b> access. Sign in at <a href="${getBaseURL(req)}/login">${getBaseURL(req)}/login</a>.</p>` }) }).catch(() => {});
      }
      await audit(req, u, 'request_' + decision, _id, {});
      return json(res, 200, { request: r });
    }

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderDecisionPage(res, kind, msg, payload) {
  const colors = { viewer: '#067647', editor: '#175cd3', reject: '#b42318', error: '#b42318', info: '#667085' };
  const icons  = { viewer: '✓', editor: '✎', reject: '✗', error: '!', info: 'i' };
  const c = colors[kind] || '#667085', ic = icons[kind] || 'i';
  const jsonBlock = payload ? `<pre style="background:#eef2f8;padding:14px;border-radius:10px;text-align:left;font-size:11.5px;overflow:auto;margin-top:18px;">${escapeHtml(JSON.stringify({ ok: kind !== 'error', ...payload }, null, 2))}</pre>` : '';
  res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(msg)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,sans-serif;background:#e8ecf3;margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;color:#0d1626;}
      .card{background:#eef2f8;border-radius:20px;padding:38px;max-width:460px;width:100%;text-align:center;box-shadow:8px 8px 20px rgba(163,177,198,0.55),-8px -8px 20px rgba(255,255,255,0.9);}
      .dot{width:72px;height:72px;border-radius:50%;background:${c};color:#fff;display:grid;place-items:center;font-size:36px;font-weight:800;margin:0 auto 20px;box-shadow:4px 4px 10px rgba(163,177,198,0.5),-4px -4px 10px rgba(255,255,255,0.9);}
      h1{margin:0 0 10px;font-size:22px;letter-spacing:-0.02em;} p{color:#667085;margin:0;font-size:14.5px;}
    </style></head>
    <body><div class="card"><div class="dot">${ic}</div><h1>${escapeHtml(msg)}</h1>${jsonBlock}</div></body></html>`);
}
