'use strict';
// AOJ Document Control Portal — Google Drive backend.
// Same shape as driveup.js: one handler, action-based dispatch, Mongo session store.

const mongoose = require('mongoose');
const { google } = require('googleapis');
const crypto   = require('crypto');
const cookie   = require('cookie');
const jwt      = require('jsonwebtoken');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — edit these values directly. No env vars needed.
// ═══════════════════════════════════════════════════════════════════════════

// MongoDB connection string
const MONGO_URI = 'mongodb+srv://makki3525873_db_user:Karan786youme@makki786.88sw6dj.mongodb.net/aoj_portal?appName=aoj';

// Secret for signing session cookies (change to any long random string)
const JWT_SECRET = 'aoj_jwt_secret_change_me_5f9c1b_a83d4e2f9b7c6d5e';

// AES-256 key (base64, 32 bytes) — used to encrypt Drive refresh tokens
const ENC_KEY = 'UtAC2SOoMgVup25BMcTOUL2vcVoel74it4prz2oqMzA=';

// Google OAuth credentials (from Google Cloud Console → OAuth 2.0 Client)
const GOOGLE_ID     = '39499304287-l9g5dasjm3r2hrburjnn6ud66qsvv3g0.apps.googleusercontent.com';
const GOOGLE_SECRET = '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';

// REDIRECT URI is auto-detected from the incoming request (works on localhost,
// Vercel preview URLs, and your production domain — no config needed).
// You STILL must register each domain you use under "Authorized redirect URIs"
// in Google Cloud Console. Add ALL of these that apply:
//   http://localhost:3000/api/drive?action=oauth_callback
//   https://<your-project>.vercel.app/api/drive?action=oauth_callback
//   https://<your-custom-domain>/api/drive?action=oauth_callback
function getRedirectURI(req) {
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/drive?action=oauth_callback`;
}

// ═══════════════════════════════════════════════════════════════════════════
const ALGO          = 'aes-256-cbc';
const COOKIE_NAME   = 'aoj_sid';

// ─── DB ──────────────────────────────────────────────────────────────────────
let _ready = false;
async function connectDB() {
  if (_ready || mongoose.connection.readyState === 1) { _ready = true; return; }
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  _ready = true;
}

const UserSchema = new mongoose.Schema({
  email:         { type: String, index: true },
  name:          String,
  photo:         String,
  refresh_token: String,   // encrypted
  created_at:    { type: Date, default: Date.now },
  last_login:    { type: Date, default: Date.now },
});
const User = mongoose.models.AojUser || mongoose.model('AojUser', UserSchema);

// ─── Crypto ──────────────────────────────────────────────────────────────────
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const c  = crypto.createCipheriv(ALGO, Buffer.from(ENC_KEY, 'base64'), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}
function decrypt(text) {
  const [ivHex, encHex] = text.split(':');
  const iv  = Buffer.from(ivHex, 'hex');
  const d   = crypto.createDecipheriv(ALGO, Buffer.from(ENC_KEY, 'base64'), iv);
  return Buffer.concat([d.update(Buffer.from(encHex, 'hex')), d.final()]).toString('utf8');
}

// ─── Session helpers ─────────────────────────────────────────────────────────
function issueSession(res, userId, req) {
  const token   = jwt.sign({ uid: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
  const isHttps = getRedirectURI(req).startsWith('https://');
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: isHttps,
    path: '/', maxAge: 60 * 60 * 24 * 30,
  }));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true, path: '/', maxAge: 0,
  }));
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
function isInvalidGrant(e) {
  const blob = ((e && e.message) || '') + ' ' + JSON.stringify((e && e.response && e.response.data) || {});
  return /invalid_grant|token has been expired or revoked/i.test(blob);
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
    id: f.id,
    name: f.name,
    type: isFolder ? 'folder' : 'file',
    mimeType: f.mimeType,
    size: f.size ? formatBytes(parseInt(f.size)) : (isFolder ? '' : '—'),
    modified: f.modifiedTime,
    icon: f.iconLink,
    thumb: f.thumbnailLink,
    link: f.webViewLink || (isFolder
      ? `https://drive.google.com/drive/folders/${f.id}`
      : `https://drive.google.com/file/d/${f.id}`),
  };
}

// ─── CORS / JSON ─────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// ═════════════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.end();

  const url    = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || (req.body && req.body.action) || '';

  try { await connectDB(); }
  catch (e) { return json(res, 503, { error: 'Database unavailable' }); }

  // ── OAuth start ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'oauth_start') {
    const auth = oauthClient(req);
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
    });
    res.statusCode = 302;
    res.setHeader('Location', authUrl);
    return res.end();
  }

  // ── OAuth callback ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'oauth_callback') {
    const code = url.searchParams.get('code');
    const err  = url.searchParams.get('error');
    if (err)  { res.statusCode = 302; res.setHeader('Location', '/?err=' + encodeURIComponent(err)); return res.end(); }
    if (!code) return json(res, 400, { error: 'Missing code' });

    try {
      const auth = oauthClient(req);
      const { tokens } = await auth.getToken(code);
      auth.setCredentials(tokens);

      // fetch profile
      const oauth2 = google.oauth2({ version: 'v2', auth });
      const me = (await oauth2.userinfo.get()).data;

      let user = await User.findOne({ email: me.email });
      if (!user) user = new User({ email: me.email });
      user.name  = me.name  || user.name;
      user.photo = me.picture || user.photo;
      user.last_login = new Date();
      if (tokens.refresh_token) user.refresh_token = encrypt(tokens.refresh_token);
      else if (!user.refresh_token) {
        return json(res, 400, { error: 'No refresh token. Revoke access at myaccount.google.com/permissions and try again.' });
      }
      await user.save();

      issueSession(res, user._id, req);
      res.statusCode = 302;
      res.setHeader('Location', '/?connected=1');
      return res.end();
    } catch (e) {
      console.error('[oauth_callback]', e.message);
      res.statusCode = 302;
      res.setHeader('Location', '/?err=' + encodeURIComponent(e.message));
      return res.end();
    }
  }

  // ── Who am I ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'me') {
    const user = await getSessionUser(req);
    if (!user) return json(res, 200, { connected: false });
    return json(res, 200, {
      connected: true,
      email: user.email, name: user.name, photo: user.photo,
    });
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  if ((req.method === 'GET' || req.method === 'POST') && action === 'logout') {
    clearSession(res);
    return json(res, 200, { ok: true });
  }

  // ── Everything below requires a session ────────────────────────────────────
  const user = await getSessionUser(req);
  if (!user || !user.refresh_token) return json(res, 401, { error: 'Not connected' });

  const drive = getDrive(user, req);

  try {
    // ── List a folder (default: My Drive root) ───────────────────────────────
    if (req.method === 'GET' && action === 'list') {
      const folderId = url.searchParams.get('folder') || 'root';
      const pageToken = url.searchParams.get('pageToken') || undefined;

      const meta = folderId === 'root'
        ? { id: 'root', name: 'My Drive', link: 'https://drive.google.com/drive/my-drive' }
        : (await drive.files.get({
            fileId: folderId,
            fields: 'id,name,mimeType,webViewLink,parents',
            supportsAllDrives: true,
          })).data;

      const list = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink)',
        pageSize: 100,
        orderBy: 'folder,name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageToken,
      });

      return json(res, 200, {
        folder: { id: meta.id, name: meta.name, link: meta.webViewLink || null, parents: meta.parents || [] },
        items: list.data.files.map(mapFile),
        nextPageToken: list.data.nextPageToken || null,
      });
    }

    // ── Search across Drive ──────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'search') {
      const q     = (url.searchParams.get('q') || '').trim();
      const scope = url.searchParams.get('scope') || null; // optional folder id to scope search under
      if (!q) return json(res, 200, { items: [], q });

      // escape single quotes in the query
      const safe = q.replace(/'/g, "\\'");
      let query = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
      if (scope) query += ` and '${scope}' in parents`;

      const list = await drive.files.list({
        q: query,
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents)',
        pageSize: 50,
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      // resolve parent folder names for context
      const parentIds = [...new Set(list.data.files.flatMap(f => f.parents || []))].slice(0, 30);
      const parentMap = {};
      await Promise.all(parentIds.map(async pid => {
        try {
          const m = await drive.files.get({ fileId: pid, fields: 'id,name', supportsAllDrives: true });
          parentMap[pid] = m.data.name;
        } catch (_) {}
      }));

      const items = list.data.files.map(f => ({
        ...mapFile(f),
        folder: (f.parents && parentMap[f.parents[0]]) || null,
      }));
      return json(res, 200, { q, count: items.length, items });
    }

    // ── Storage / account info ───────────────────────────────────────────────
    if (req.method === 'GET' && action === 'account') {
      const a = await drive.about.get({
        fields: 'user(emailAddress,displayName,photoLink), storageQuota(limit,usage)',
      });
      const q = a.data.storageQuota || {};
      return json(res, 200, {
        email: a.data.user.emailAddress,
        name:  a.data.user.displayName,
        photo: a.data.user.photoLink,
        storage: {
          limit: q.limit ? formatBytes(parseInt(q.limit)) : 'Unlimited',
          used:  formatBytes(parseInt(q.usage || 0)),
        },
      });
    }

    return json(res, 400, { error: 'Unknown action: ' + action });
  } catch (e) {
    if (isInvalidGrant(e)) {
      user.refresh_token = undefined;
      await user.save();
      clearSession(res);
      return json(res, 401, { error: 'Google access revoked. Please reconnect.', revoked: true });
    }
    console.error('[drive api]', action, e.message);
    return json(res, 500, { error: e.message });
  }
};
