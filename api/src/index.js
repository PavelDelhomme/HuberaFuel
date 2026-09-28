import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';
import multer from 'multer';
import QRCode from 'qrcode';
import { compareSemver, pickLatestRelease } from './semver.js';
import { assertApkIdentity } from './apkMeta.js';
import { applyPersonalCommute, applyPersonalFillUp, fetchCommuteRoute } from './personalCommute.js';
import { huberaLegacyStatus, huberaNotice, pingFromRequest } from './huberaLegacy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = process.env.DATA_DIR || './data';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const SHIPPED_VERSION = '1.4.154';
const APP_VERSION = (() => {
  const env = process.env.APP_VERSION || SHIPPED_VERSION;
  try {
    if (compareSemver(SHIPPED_VERSION, env) > 0) return SHIPPED_VERSION;
  } catch {
    /* ignore */
  }
  return env;
})();
const MIN_VERSION = process.env.MIN_APP_VERSION || '1.0.0';

function brandUserText(s) {
  return String(s || '')
    .replace(/Gasoil Tracking/gi, 'Hubera Fuel')
    .replace(/GasoilTracking/g, 'Hubera Fuel');
}
const INVITE_CODE = process.env.INVITE_CODE || '';
const RELEASE_UPLOAD_TOKEN = process.env.RELEASE_UPLOAD_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://fuel.hubera.cloud').replace(/\/$/, '');

/** Dual alias Hubera : les liens OTA suivent l’hôte de la requête (même stack, même volume). */
function requestPublicUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (host.endsWith('.hubera.cloud') || host.endsWith('.delhomme.ovh')) {
    return `https://${host}`;
  }
  return PUBLIC_URL;
}
const APP_SCHEME = process.env.APP_SCHEME || 'gasoiltracking';
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@delhomme.ovh')
  .toLowerCase()
  .trim();
const PERSONAL_MAIL = String(process.env.PERSONAL_MAIL || '')
  .toLowerCase()
  .trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

function isManagerEmail(email) {
  const e = String(email || '')
    .toLowerCase()
    .trim();
  if (!e) return false;
  if (e === ADMIN_EMAIL) return true;
  if (PERSONAL_MAIL && e === PERSONAL_MAIL) return true;
  // Fallback si PERSONAL_MAIL n’est pas injecté en prod
  if (e === 'paveldelhomme@gmail.com') return true;
  if (e === 'paul@delhomme.ovh') return true;
  return false;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'apks'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'gasoil.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending_registrations (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL DEFAULT 'web',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip TEXT
  );
  CREATE TABLE IF NOT EXISTS sync_data (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS app_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    apk_filename TEXT,
    release_notes TEXT,
    force_update INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    replaced_by TEXT,
    user_agent TEXT,
    ip TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
  CREATE TABLE IF NOT EXISTS download_links (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    label TEXT,
    max_uses INTEGER NOT NULL DEFAULT 50,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS qr_login_challenges (
    id TEXT PRIMARY KEY,
    challenge_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    user_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    approved_at TEXT,
    consumed_at TEXT,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS hubera_identity_links (
    user_id TEXT PRIMARY KEY,
    cloudity_email TEXT NOT NULL,
    cloudity_user_id TEXT,
    satellite_email TEXT,
    linked_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_email_aliases (
    email TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

try {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
} catch {
  /* déjà présent */
}
for (const sql of [
  'ALTER TABLE app_releases ADD COLUMN apk_sha256 TEXT',
  'ALTER TABLE app_releases ADD COLUMN apk_size INTEGER',
  'ALTER TABLE app_releases ADD COLUMN version_code INTEGER',
]) {
  try {
    db.exec(sql);
  } catch {
    /* déjà présent */
  }
}

/** Access JWT court ; refresh opaque rotatif (révocation possible) */
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '20m';
const REFRESH_TTL_MS = Number(process.env.JWT_REFRESH_TTL_MS || 30 * 24 * 60 * 60 * 1000);

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, typ: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL, algorithm: 'HS256' }
  );
}

function issueRefreshToken(userId, meta = {}) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const id = uuid();
  const now = new Date();
  const expires = new Date(now.getTime() + REFRESH_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, hashToken(raw), expires, now.toISOString(), meta.userAgent || null, meta.ip || null);
  return { refreshToken: raw, refreshExpiresAt: expires };
}

function revokeRefreshFamily(userId) {
  db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`
  ).run(new Date().toISOString(), userId);
}

function createSession(user, meta = {}) {
  const token = issueAccessToken(user);
  const { refreshToken, refreshExpiresAt } = issueRefreshToken(user.id, meta);
  return {
    token,
    refreshToken,
    expiresIn: ACCESS_TTL,
    refreshExpiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isManager: isManagerEmail(user.email),
    },
  };
}

/** Crée / met à jour le compte admin (email vérifié, sans passer par l’invite) */
function bootstrapAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn('[admin] ADMIN_PASSWORD non défini — pas de bootstrap admin');
    return;
  }
  if (ADMIN_PASSWORD.length < 10) {
    console.warn('[admin] ADMIN_PASSWORD trop court (min 10) — bootstrap ignoré');
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  if (existing) {
    if (process.env.ADMIN_RESET_PASSWORD === '1') {
      db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, name = ? WHERE email = ?').run(
        hash,
        ADMIN_NAME,
        ADMIN_EMAIL
      );
      console.log(`[admin] Mot de passe réinitialisé pour ${ADMIN_EMAIL}`);
    } else {
      console.log(`[admin] Compte déjà présent: ${ADMIN_EMAIL}`);
    }
    return;
  }
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, name, email_verified, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(id, ADMIN_EMAIL, hash, ADMIN_NAME, now);
  db.prepare('INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify({ vehicles: [], fillUps: [], budgets: [], trips: [] }),
    now
  );
  console.log(`[admin] Compte admin créé: ${ADMIN_EMAIL}`);
}

bootstrapAdmin();

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // fuel.hubera.cloud et les alias historiques doivent pouvoir lire l’API
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = new Set([
  PUBLIC_URL,
  'https://gasoil-tracking.hubera.cloud',
  'https://fuel.hubera.cloud',
  'https://gasoil-tracking.delhomme.ovh',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
]);
const allowedOriginHosts = new Set([
  'gasoil-tracking.hubera.cloud',
  'fuel.hubera.cloud',
  'gasoil-tracking.delhomme.ovh',
]);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.has(origin) || origin.startsWith('exp://')) {
        return cb(null, true);
      }
      try {
        const host = new URL(origin).hostname.toLowerCase();
        if (
          allowedOriginHosts.has(host) ||
          host.endsWith('.hubera.cloud') ||
          host.endsWith('.delhomme.ovh')
        ) {
          return cb(null, true);
        }
      } catch {
        /* ignore */
      }
      return cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

/** Poll QR web (~1,5 s) : large, séparé du login pour ne pas saturer authLimiter. */
const qrPollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const cid = String(req.query?.challengeId || '').trim();
    return cid ? `qr-poll:${cid}` : `qr-poll-ip:${clientIp(req)}`;
  },
  message: { error: 'Trop de requêtes QR. Réessayez dans un instant.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Trop d’inscriptions depuis cette IP. Réessayez plus tard.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  message: { error: 'Trop de requêtes. Ralentissez.' },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${clientIp(req)}:${req.user?.sub || 'anon'}`,
  message: { error: 'Sync trop fréquente.' },
});

app.use('/api/', apiLimiter);

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload?.sub) return res.status(401).json({ error: 'Token invalide' });
    // Accepte les anciens JWT sans typ ; refuse les refresh JWT s’il y en avait
    if (payload.typ && payload.typ !== 'access') {
      return res.status(401).json({ error: 'Token invalide' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function sessionMeta(req) {
  return {
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function mailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    process.env.SMTP_USE_SSL === 'true' ||
    port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  });
}

async function sendVerificationEmail({ to, name, token, platform }) {
  // Page de confirmation (GET sans effet) — résiste au pré-scan Gmail/Outlook
  const verifyUrl = `${PUBLIC_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&platform=${encodeURIComponent(platform || 'web')}`;
  const from = process.env.SMTP_FROM || 'Hubera Fuel <noreply@maily.ovh>';
  const transport = mailer();
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
      <h2>Confirmez votre email</h2>
      <p>Bonjour ${String(name).replace(/[<>&]/g, '')},</p>
      <p>Pour activer votre compte Hubera Fuel, ouvrez le lien ci-dessous puis cliquez sur <strong>«&nbsp;Confirmer mon email&nbsp;»</strong> (valide 24&nbsp;h)&nbsp;:</p>
      <p style="margin:28px 0">
        <a href="${verifyUrl}" style="background:#e94560;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
          Ouvrir la page de validation
        </a>
      </p>
      <p style="color:#666;font-size:13px">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br/><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color:#666;font-size:12px">Si vous n’êtes pas à l’origine de cette inscription, ignorez ce message.</p>
    </div>
  `;
  if (!transport) {
    console.warn('[mail] SMTP non configuré — lien de vérif:', verifyUrl);
    return { ok: false, verifyUrl, logged: true };
  }
  await transport.sendMail({
    from,
    to,
    subject: 'Hubera Fuel — vérifiez votre email',
    html,
    text: `Bonjour ${name},\n\nOuvrez ce lien puis confirmez : ${verifyUrl}\n`,
  });
  return { ok: true, verifyUrl };
}

function confirmEmailPageHtml({ token, platform, email, name }) {
  const safeName = String(name).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const safeEmail = String(email).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const tokenJson = JSON.stringify(token);
  const platformJson = JSON.stringify(platform);
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Confirmer votre email — Hubera Fuel</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f0f1a;color:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#1a1a2e;padding:28px;border-radius:16px;max-width:440px;width:100%;text-align:center}
button.btn{background:#e94560;color:#fff;padding:14px 22px;border-radius:10px;border:none;font-weight:600;font-size:16px;cursor:pointer;width:100%}
button.btn:disabled{opacity:.6;cursor:wait}
.err{color:#f87171;margin-top:12px;font-size:14px}
.hint{color:#94a3b8;font-size:13px;margin-top:16px;line-height:1.5}
</style></head><body>
<div class="card">
  <h1>Confirmer votre email</h1>
  <p>Bonjour <strong>${safeName}</strong>,</p>
  <p style="color:#94a3b8">Compte&nbsp;: ${safeEmail}</p>
  <p style="margin:20px 0">Cliquez ci-dessous pour activer votre compte utilisateur (pas admin).</p>
  <button class="btn" id="confirmBtn" type="button">Confirmer mon email</button>
  <p id="err" class="err" hidden></p>
  <p class="hint">Gmail peut ouvrir les liens automatiquement : seul ce bouton active le compte.</p>
</div>
<script>
(function(){
  var btn = document.getElementById('confirmBtn');
  var err = document.getElementById('err');
  btn.addEventListener('click', function(){
    btn.disabled = true;
    err.hidden = true;
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ${tokenJson}, platform: ${platformJson} })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
      .then(function(res){
        if (res.d && res.d.redirectUrl) {
          window.location.replace(res.d.redirectUrl);
          return;
        }
        err.textContent = (res.d && res.d.error) || 'Erreur de validation';
        err.hidden = false;
        btn.disabled = false;
      })
      .catch(function(){
        err.textContent = 'Erreur réseau. Réessayez.';
        err.hidden = false;
        btn.disabled = false;
      });
  });
})();
</script>
</body></html>`;
}

function verifyPageHtml({ ok, message, platform, token, refreshToken, showLogin = false }) {
  const parts = [
    `ok=${ok ? '1' : '0'}`,
    `msg=${encodeURIComponent(message)}`,
  ];
  if (token) parts.push(`session=${encodeURIComponent(token)}`);
  if (refreshToken) parts.push(`refresh=${encodeURIComponent(refreshToken)}`);
  const q = parts.join('&');
  const webUrl = `${PUBLIC_URL}/verify?${q}`;
  const deep = `${APP_SCHEME}://verify?${q}`;
  const primary = platform === 'mobile' ? deep : webUrl;
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vérification email — Hubera Fuel</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f0f1a;color:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1a1a2e;padding:28px;border-radius:16px;max-width:420px;width:90%;text-align:center}
a.btn{display:inline-block;margin-top:16px;background:#e94560;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}
.ok{color:#34d399}.err{color:#f87171}
</style></head><body>
<div class="card">
  <h1 class="${ok ? 'ok' : 'err'}">${ok ? 'Email vérifié' : 'Échec'}</h1>
  <p>${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>
  <a class="btn" href="${primary}">Continuer</a>
  ${showLogin ? `<p style="margin-top:16px"><a class="btn" href="${PUBLIC_URL}/auth" style="display:inline-block">Se connecter</a></p>` : ''}
  ${platform === 'mobile' ? `<p style="margin-top:16px;font-size:13px;color:#94a3b8"><a href="${webUrl}" style="color:#94a3b8">Ouvrir sur le web</a></p>` : `<p style="margin-top:16px;font-size:13px;color:#94a3b8"><a href="${deep}" style="color:#94a3b8">Ouvrir l’app mobile</a></p>`}
</div>
</body></html>`;
}

function buildVerifyRedirect({ ok, message, platform, session }) {
  const parts = [
    `ok=${ok ? '1' : '0'}`,
    `msg=${encodeURIComponent(message)}`,
  ];
  if (session?.token) parts.push(`session=${encodeURIComponent(session.token)}`);
  if (session?.refreshToken) parts.push(`refresh=${encodeURIComponent(session.refreshToken)}`);
  const q = parts.join('&');
  const webUrl = `${PUBLIC_URL}/verify?${q}`;
  const deep = `${APP_SCHEME}://verify?${q}`;
  return { webUrl, deep, primary: platform === 'mobile' ? deep : webUrl };
}

function finalizeEmailVerification(req, res, raw, platform) {
  const plat = platform === 'mobile' ? 'mobile' : 'web';
  if (!raw || raw.length < 20) {
    const msg = 'Lien invalide.';
    if (req.method === 'POST') return res.status(400).json({ error: msg });
    return res.status(400).type('html').send(verifyPageHtml({ ok: false, message: msg, platform: plat, showLogin: true }));
  }

  const tokenHash = hashToken(raw);
  const pending = db.prepare('SELECT * FROM pending_registrations WHERE token_hash = ?').get(tokenHash);

  if (!pending) {
    const msg =
      'Ce lien a déjà été utilisé ou a expiré. Si votre compte est actif, connectez-vous avec votre email et mot de passe.';
    if (req.method === 'POST') {
      return res.status(400).json({ error: msg, loginUrl: `${PUBLIC_URL}/auth` });
    }
    return res
      .status(200)
      .type('html')
      .send(verifyPageHtml({ ok: false, message: msg, platform: plat, showLogin: true }));
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pending.id);
    const msg = 'Lien expiré. Demandez un nouvel email de validation ou réinscrivez-vous.';
    if (req.method === 'POST') return res.status(400).json({ error: msg });
    return res.status(400).type('html').send(verifyPageHtml({ ok: false, message: msg, platform: plat, showLogin: true }));
  }

  const existingUser = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(pending.email);
  if (existingUser) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pending.id);
    const session = createSession(existingUser, sessionMeta(req));
    const msg = 'Votre compte est déjà actif. Connectez-vous.';
    const redirect = buildVerifyRedirect({ ok: true, message: msg, platform: plat, session });
    if (req.method === 'POST') {
      return res.json({ ok: true, alreadyActive: true, redirectUrl: redirect.primary, ...redirect });
    }
    return res.type('html').send(
      verifyPageHtml({
        ok: true,
        message: msg,
        platform: plat,
        token: session.token,
        refreshToken: session.refreshToken,
      })
    );
  }

  const userId = uuid();
  try {
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, name, email_verified, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).run(userId, pending.email, pending.password_hash, pending.name, new Date().toISOString());
      db.prepare('INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)').run(
        userId,
        JSON.stringify({ vehicles: [], fillUps: [], budgets: [], trips: [] }),
        new Date().toISOString()
      );
      db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pending.id);
    });
    tx();
  } catch {
    const msg = 'Compte déjà créé. Connectez-vous.';
    if (req.method === 'POST') {
      return res.status(409).json({ error: msg, loginUrl: `${PUBLIC_URL}/auth` });
    }
    return res
      .status(409)
      .type('html')
      .send(verifyPageHtml({ ok: false, message: msg, platform: plat, showLogin: true }));
  }

  const session = createSession(
    { id: userId, email: pending.email, name: pending.name },
    sessionMeta(req)
  );
  const msg = 'Votre email est confirmé. Bienvenue sur Hubera Fuel !';
  const redirect = buildVerifyRedirect({ ok: true, message: msg, platform: plat, session });

  if (req.method === 'POST') {
    return res.json({
      ok: true,
      redirectUrl: redirect.primary,
      user: session.user,
      ...redirect,
    });
  }

  return res.type('html').send(
    verifyPageHtml({
      ok: true,
      message: msg,
      platform: plat,
      token: session.token,
      refreshToken: session.refreshToken,
    })
  );
}

app.get('/health', (req, res) => {
  const accept = String(req.headers.accept || '');
  const uptimeSec = Math.floor(process.uptime());
  res.setHeader('X-App-Version', APP_VERSION);
  if (accept.includes('application/json')) {
    return res.json({
      status: 'ok',
      version: APP_VERSION,
      uptimeSec,
      time: new Date().toISOString(),
    });
  }
  res.type('text').send(`ok · v${APP_VERSION} · ${uptimeSec}s`);
});
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  const uptimeSec = Math.floor(process.uptime());
  res.json({
    status: 'ok',
    version: APP_VERSION,
    uptimeSec,
    time: new Date().toISOString(),
  });
});

/** Taux FX via proxy (évite CORS web : frankfurter.app → 301 sans ACAO). */
const FX_FALLBACK = {
  EUR: 1,
  GBP: 0.86,
  CHF: 0.94,
  NOK: 11.5,
  SEK: 11.2,
  DKK: 7.46,
  ISK: 150,
  PLN: 4.3,
  CZK: 25.2,
  HUF: 395,
  RON: 4.97,
  BGN: 1.96,
  HRK: 7.53,
  TRY: 36,
  UAH: 43,
  RSD: 117,
  BAM: 1.96,
  ALL: 100,
  MKD: 61.5,
  MDL: 19.5,
};
let fxCache = { rates: { ...FX_FALLBACK }, date: null, fetchedAt: 0 };

app.get('/api/fx/latest', async (_req, res) => {
  try {
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (fxCache.fetchedAt && Date.now() - fxCache.fetchedAt < maxAgeMs && fxCache.date) {
      res.set('Cache-Control', 'public, max-age=3600');
      return res.json({
        base: 'EUR',
        date: fxCache.date,
        rates: fxCache.rates,
        source: 'cache',
      });
    }
    const upstream = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const data = await upstream.json();
    const rates = { ...FX_FALLBACK, ...(data.rates || {}), EUR: 1 };
    fxCache = {
      rates,
      date: data.date || new Date().toISOString().slice(0, 10),
      fetchedAt: Date.now(),
    };
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      base: 'EUR',
      date: fxCache.date,
      rates: fxCache.rates,
      source: 'frankfurter',
    });
  } catch (e) {
    console.warn('[fx]', e.message || e);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      base: 'EUR',
      date: fxCache.date || new Date().toISOString().slice(0, 10),
      rates: fxCache.rates,
      source: 'fallback',
      stale: true,
    });
  }
});

/** Catalogue véhicules public (seed APK + MAJ app). */
app.get('/api/vehicle-catalog', (_req, res) => {
  try {
    const candidates = [
      path.join(__dirname, '../static/vehicle-catalog.json'),
      path.join(DATA_DIR, 'vehicle-catalog.json'),
      path.join(process.cwd(), 'static/vehicle-catalog.json'),
    ];
    let file = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        file = p;
        break;
      }
    }
    if (!file) {
      return res.status(404).json({ error: 'Catalogue introuvable — lancez scripts/build-vehicle-catalog.mjs' });
    }
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (data.version) res.setHeader('X-Catalog-Version', String(data.version));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Catalogue illisible' });
  }
});

app.get('/api/hubera/legacy-status', (_req, res) => {
  res.json(huberaLegacyStatus());
});

app.get('/api/version', (req, res) => {
  pingFromRequest(req.query || {}, String(req.headers['user-agent'] || ''));
  const rows = db
    .prepare('SELECT * FROM app_releases WHERE apk_filename IS NOT NULL')
    .all();
  const latest = pickLatestRelease(rows);
  const clientVer = String(req.query.clientVersion || '').trim();
  const clientVc = Number(req.query.clientVersionCode || 0) || 0;
  const apkOlderThanClient =
    Boolean(latest) &&
    ((clientVer && compareSemver(latest.version, clientVer) < 0) ||
      (clientVc > 0 &&
        Number(latest.version_code) > 0 &&
        Number(latest.version_code) < clientVc));
  // Jamais proposer / forcer un APK plus vieux que le téléphone.
  const offerApk = Boolean(latest?.apk_filename) && !apkOlderThanClient;
  let version = offerApk ? latest.version : APP_VERSION;
  if (clientVer && compareSemver(version, clientVer) < 0) {
    version = clientVer;
  }
  if (!offerApk && compareSemver(version, APP_VERSION) < 0) {
    version = APP_VERSION;
  }
  const apkAvailable = offerApk;
  const pub = requestPublicUrl(req);
  const apkUrl = apkAvailable
    ? `${pub}/api/download/${latest.apk_filename}`
    : null;

  let buildingVersion = null;
  let buildingSince = null;
  let buildingNotes = '';
  try {
    const pendingPath = path.join(DATA_DIR, 'build-pending.json');
    if (fs.existsSync(pendingPath)) {
      const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
      const pv = String(pending?.version || '');
      // N'afficher « en cours » que si plus récent que l’APK déjà publiée
      if (pv && compareSemver(pv, version) > 0) {
        buildingVersion = pv;
        buildingSince = pending.startedAt || null;
        buildingNotes = pending.notes || '';
      }
    }
  } catch {
    /* ignore */
  }

  res.json({
    version,
    minVersion: MIN_VERSION,
    forceUpdate:
      apkAvailable &&
      Boolean(latest?.force_update) &&
      ((clientVc > 0 && Number(latest.version_code) > clientVc) ||
        (clientVer && compareSemver(latest.version, clientVer) > 0) ||
        (!clientVer && !clientVc)),
    apkUrl,
    apkAvailable,
    apkSha256: apkAvailable ? latest?.apk_sha256 || null : null,
    apkSize: apkAvailable ? latest?.apk_size || null : null,
    versionCode: apkAvailable ? latest?.version_code || null : null,
    webUrl: pub,
    /** Hub multi-plateformes (Android APK + iPhone PWA + web) */
    downloadPage: `${pub}/download`,
    iosInstallUrl: `${pub}/download#ios`,
    releaseNotes: (() => {
      const notes = brandUserText(latest?.release_notes || '');
      if (/hubera fuel/i.test(notes)) return notes;
      return `Hubera Fuel — l’app s’appelle désormais Hubera Fuel. Tes trajets, véhicules et ton compte restent. ${notes}`.trim();
    })(),
    buildingVersion,
    buildingSince,
    buildingNotes: brandUserText(buildingNotes),
    channels: {
      android: apkAvailable,
      web: true,
      iosPwa: true,
      iosAppStore: false,
    },
    hubera: huberaNotice(),
  });
});

/** Inscription : envoie un email de vérification (pas de compte actif tant que non cliqué) */
app.post('/api/auth/register', authLimiter, registerLimiter, async (req, res) => {
  try {
    const { email, password, name, inviteCode, platform } = req.body || {};
    if (!INVITE_CODE) {
      return res.status(403).json({ error: 'Inscriptions fermées (INVITE_CODE non configuré)' });
    }
    if (String(inviteCode || '') !== INVITE_CODE) {
      return res.status(403).json({ error: 'Code d’invitation invalide' });
    }
    const cleanEmail = String(email || '')
      .toLowerCase()
      .trim();
    const cleanName = String(name || '').trim().slice(0, 80);
    const plat = platform === 'mobile' ? 'mobile' : 'web';
    if (!cleanEmail || !password || !cleanName) {
      return res.status(400).json({ error: 'email, password et name requis' });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (String(password).length < 8 || String(password).length > 128) {
      return res.status(400).json({ error: 'Mot de passe : 8 à 128 caractères' });
    }
    const existing = emailTaken(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }

    db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(cleanEmail);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const id = uuid();
    const hash = bcrypt.hashSync(String(password), 12);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO pending_registrations (id, email, password_hash, name, token_hash, platform, expires_at, created_at, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, cleanEmail, hash, cleanName, tokenHash, plat, expires, new Date().toISOString(), clientIp(req));

    const mail = await sendVerificationEmail({
      to: cleanEmail,
      name: cleanName,
      token: rawToken,
      platform: plat,
    });
    // Log serveur uniquement (jamais exposé au client si mail OK) — utile pour ops
    console.log(`[mail] verification ${mail.ok ? 'sent' : 'fallback'} to=${cleanEmail}`);

    // Prévenir les admins (dont PERSONAL_MAIL) qu’un compte attend validation
    void notifyManagersPendingRegistration({
      email: cleanEmail,
      name: cleanName,
      platform: plat,
    });

    res.status(201).json({
      ok: true,
      pending: true,
      message:
        'Un email de vérification a été envoyé. Cliquez le lien pour activer votre compte (valide 24 h). Un administrateur a aussi été prévenu.',
      ...(mail.ok
        ? {}
        : { debugVerifyUrl: mail.verifyUrl }),
    });
  } catch (e) {
    console.error('register', e);
    res.status(500).json({ error: 'Erreur lors de l’inscription' });
  }
});

/** GET : page de confirmation (sans consommer le token — anti pré-scan Gmail) */
app.get('/api/auth/verify-email', authLimiter, (req, res) => {
  const raw = String(req.query.token || '');
  const platform = req.query.platform === 'mobile' ? 'mobile' : 'web';
  if (!raw || raw.length < 20) {
    return res
      .status(400)
      .type('html')
      .send(verifyPageHtml({ ok: false, message: 'Lien invalide.', platform, showLogin: true }));
  }

  const tokenHash = hashToken(raw);
  const pending = db.prepare('SELECT * FROM pending_registrations WHERE token_hash = ?').get(tokenHash);
  if (!pending) {
    return res
      .status(200)
      .type('html')
      .send(
        verifyPageHtml({
          ok: false,
          message:
            'Ce lien a déjà été utilisé ou a expiré. Si votre compte est actif, connectez-vous.',
          platform,
          showLogin: true,
        })
      );
  }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pending.id);
    return res
      .status(400)
      .type('html')
      .send(
        verifyPageHtml({
          ok: false,
          message: 'Lien expiré. Réinscrivez-vous ou demandez un nouvel email.',
          platform,
          showLogin: true,
        })
      );
  }

  return res.type('html').send(
    confirmEmailPageHtml({
      token: raw,
      platform,
      email: pending.email,
      name: pending.name,
    })
  );
});

/** POST : validation réelle après clic utilisateur */
app.post('/api/auth/verify-email', authLimiter, (req, res) => {
  const raw = String(req.body?.token || '');
  const platform = req.body?.platform === 'mobile' ? 'mobile' : 'web';
  return finalizeEmailVerification(req, res, raw, platform);
});

/** Renvoi public si inscription en attente (rate-limit) */
app.post('/api/auth/resend-verification', authLimiter, registerLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (user) {
      return res.json({
        ok: true,
        alreadyActive: true,
        message: 'Compte déjà actif. Connectez-vous avec votre email et mot de passe.',
      });
    }

    const pending = db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
    if (!pending) {
      return res.status(404).json({
        error: 'Aucune inscription en attente. Inscrivez-vous avec le code d’invitation.',
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'UPDATE pending_registrations SET token_hash = ?, expires_at = ? WHERE id = ?'
    ).run(tokenHash, expires, pending.id);

    const mail = await sendVerificationEmail({
      to: pending.email,
      name: pending.name,
      token: rawToken,
      platform: pending.platform || 'web',
    });

    res.json({
      ok: true,
      message: mail.ok
        ? 'Nouvel email de validation envoyé. Ouvrez-le et cliquez sur « Confirmer mon email ».'
        : 'SMTP indisponible — contactez l’admin.',
    });
  } catch (e) {
    console.error('resend-verification-public', e);
    res.status(500).json({ error: 'Impossible d’envoyer l’email de vérification. Réessayez plus tard.' });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = String(req.body?.email || '')
    .toLowerCase()
    .trim();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'email et password requis' });
  }
  const user = findUserByLoginEmail(email);
  // message générique anti-énumération
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  if (user.email_verified === 0) {
    return res.status(403).json({ error: 'Email non vérifié. Consultez votre boîte mail.' });
  }
  res.json(createSession(user, sessionMeta(req)));
});

const QR_LOGIN_TTL_MS = 2 * 60 * 1000;

/** Web : démarre un challenge QR (connexion site via app mobile). */
app.post('/api/auth/qr/start', authLimiter, async (req, res) => {
  try {
    const id = uuid();
    const raw = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + QR_LOGIN_TTL_MS);
    const meta = sessionMeta(req);
    db.prepare(
      `INSERT INTO qr_login_challenges
       (id, challenge_hash, status, expires_at, created_at, ip, user_agent)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`
    ).run(id, hashToken(raw), expires.toISOString(), now.toISOString(), meta.ip, meta.userAgent);

    const payload = `${requestPublicUrl(req)}/qr-login?c=${encodeURIComponent(raw)}`;
    const qrDataUrl = await QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });

    res.json({
      challengeId: id,
      expiresAt: expires.toISOString(),
      ttlSeconds: Math.round(QR_LOGIN_TTL_MS / 1000),
      qrPayload: payload,
      qrDataUrl,
      deepLink: `${APP_SCHEME}://qr-login?c=${encodeURIComponent(raw)}`,
    });
  } catch (e) {
    console.error('qr-start', e);
    res.status(500).json({ error: 'Impossible de créer le QR' });
  }
});

/** Mobile connecté : valide le challenge scanné. */
app.post('/api/auth/qr/approve', auth, authLimiter, (req, res) => {
  const raw = String(req.body?.challenge || req.body?.c || '').trim();
  if (!raw || raw.length < 16) {
    return res.status(400).json({ error: 'Challenge QR invalide' });
  }
  const row = db
    .prepare('SELECT * FROM qr_login_challenges WHERE challenge_hash = ?')
    .get(hashToken(raw));
  if (!row) {
    return res.status(404).json({ error: 'QR inconnu ou déjà utilisé' });
  }
  if (row.status !== 'pending') {
    return res.status(409).json({ error: 'Ce QR a déjà été utilisé' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE qr_login_challenges SET status = 'expired' WHERE id = ?`).run(row.id);
    return res.status(410).json({ error: 'QR expiré — régénérez-le sur le site' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user || user.email_verified === 0) {
    return res.status(403).json({ error: 'Compte non autorisé' });
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE qr_login_challenges SET status = 'approved', user_id = ?, approved_at = ? WHERE id = ? AND status = 'pending'`
  ).run(user.id, now, row.id);
  res.json({ ok: true, message: 'Connexion web autorisée' });
});

/** Web : poll jusqu’à obtenir la session. */
app.get('/api/auth/qr/poll', qrPollLimiter, (req, res) => {
  const challengeId = String(req.query?.challengeId || '').trim();
  if (!challengeId) {
    return res.status(400).json({ error: 'challengeId requis' });
  }
  const row = db.prepare('SELECT * FROM qr_login_challenges WHERE id = ?').get(challengeId);
  if (!row) {
    return res.status(404).json({ error: 'Challenge introuvable' });
  }
  if (row.status === 'consumed') {
    return res.status(410).json({ status: 'consumed', error: 'Session déjà récupérée' });
  }
  if (row.status === 'expired' || new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status === 'pending') {
      db.prepare(`UPDATE qr_login_challenges SET status = 'expired' WHERE id = ?`).run(row.id);
    }
    return res.json({ status: 'expired' });
  }
  if (row.status === 'pending') {
    return res.json({ status: 'pending', expiresAt: row.expires_at });
  }
  if (row.status !== 'approved' || !row.user_id) {
    return res.json({ status: row.status });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur introuvable' });
  }
  const session = createSession(user, sessionMeta(req));
  db.prepare(
    `UPDATE qr_login_challenges SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'approved'`
  ).run(new Date().toISOString(), row.id);
  res.json({ status: 'approved', ...session });
});

/** Statut QR sans consommer la session (suivi côté appareil qui affiche le QR pair). */
app.get('/api/auth/qr/status', qrPollLimiter, (req, res) => {
  const challengeId = String(req.query?.challengeId || '').trim();
  if (!challengeId) {
    return res.status(400).json({ error: 'challengeId requis' });
  }
  const row = db.prepare('SELECT * FROM qr_login_challenges WHERE id = ?').get(challengeId);
  if (!row) {
    return res.status(404).json({ status: 'missing', error: 'Challenge introuvable' });
  }
  if (row.status === 'expired' || new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status === 'pending' || row.status === 'approved') {
      db.prepare(`UPDATE qr_login_challenges SET status = 'expired' WHERE id = ?`).run(row.id);
    }
    return res.json({ status: 'expired', expiresAt: row.expires_at });
  }
  return res.json({
    status: row.status,
    expiresAt: row.expires_at,
    mode: row.status === 'approved' && row.user_id ? 'pair_or_approved' : undefined,
  });
});

/**
 * Compte déjà connecté (web) : crée un QR pour connecter un *autre* appareil.
 * Le challenge est pré-approuvé pour l’utilisateur courant ; l’autre device poll et récupère la session.
 */
app.post('/api/auth/qr/pair', auth, authLimiter, async (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!user || user.email_verified === 0) {
      return res.status(403).json({ error: 'Compte non autorisé' });
    }
    const id = uuid();
    const raw = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + QR_LOGIN_TTL_MS);
    const meta = sessionMeta(req);
    db.prepare(
      `INSERT INTO qr_login_challenges
       (id, challenge_hash, status, user_id, approved_at, expires_at, created_at, ip, user_agent)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      hashToken(raw),
      user.id,
      now.toISOString(),
      expires.toISOString(),
      now.toISOString(),
      meta.ip,
      meta.userAgent
    );

    const payload = `${requestPublicUrl(req)}/qr-login?claim=${encodeURIComponent(id)}`;
    const qrDataUrl = await QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });

    res.json({
      challengeId: id,
      expiresAt: expires.toISOString(),
      ttlSeconds: Math.round(QR_LOGIN_TTL_MS / 1000),
      qrPayload: payload,
      qrDataUrl,
      deepLink: `${APP_SCHEME}://qr-login?claim=${encodeURIComponent(id)}`,
      mode: 'pair',
    });
  } catch (e) {
    console.error('qr-pair', e);
    res.status(500).json({ error: 'Impossible de créer le QR d’appareil' });
  }
});

/** Rotation du refresh token → nouvel access + nouveau refresh */
app.post('/api/auth/refresh', authLimiter, (req, res) => {
  const raw = String(req.body?.refreshToken || '');
  if (!raw || raw.length < 20) {
    return res.status(400).json({ error: 'refreshToken requis' });
  }
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hashToken(raw));
  if (!row) {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
  if (row.revoked_at) {
    // Réutilisation d’un token déjà tourné → révoque toute la famille (vol possible)
    revokeRefreshFamily(row.user_id);
    return res.status(401).json({ error: 'Session invalidée. Reconnectez-vous.' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      row.id
    );
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) {
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }

  const now = new Date().toISOString();
  const next = issueRefreshToken(user.id, sessionMeta(req));
  const newRow = db
    .prepare('SELECT id FROM refresh_tokens WHERE token_hash = ?')
    .get(hashToken(next.refreshToken));
  db.prepare('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?').run(
    now,
    newRow?.id || null,
    row.id
  );

  res.json({
    token: issueAccessToken(user),
    refreshToken: next.refreshToken,
    expiresIn: ACCESS_TTL,
    refreshExpiresAt: next.refreshExpiresAt,
    user: { id: user.id, email: user.email, name: user.name },
  });
});

app.post('/api/auth/logout', auth, (req, res) => {
  const raw = String(req.body?.refreshToken || '');
  if (raw) {
    db.prepare(
      `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL`
    ).run(new Date().toISOString(), hashToken(raw), req.user.sub);
  } else {
    revokeRefreshFamily(req.user.sub);
  }
  res.json({ ok: true });
});

function findUserByLoginEmail(email) {
  const e = String(email || '')
    .toLowerCase()
    .trim();
  if (!e) return undefined;
  const primary = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
  if (primary) return primary;
  try {
    return db
      .prepare(
        `SELECT u.* FROM users u
         JOIN user_email_aliases a ON a.user_id = u.id
         WHERE a.email = ?`
      )
      .get(e);
  } catch {
    return undefined;
  }
}

function emailTaken(email) {
  const e = String(email || '')
    .toLowerCase()
    .trim();
  if (!e) return false;
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(e)) return true;
  try {
    if (db.prepare('SELECT user_id FROM user_email_aliases WHERE email = ?').get(e)) return true;
  } catch {
    /* table absente */
  }
  return false;
}

function huberaLinkForUser(userId) {
  try {
    return (
      db
        .prepare(
          'SELECT cloudity_email, cloudity_user_id, satellite_email, linked_at FROM hubera_identity_links WHERE user_id = ?'
        )
        .get(userId) || null
    );
  } catch {
    return null;
  }
}

app.get('/api/auth/me', auth, (req, res) => {
  const user = db
    .prepare('SELECT id, email, name, created_at, email_verified FROM users WHERE id = ?')
    .get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const manager = isManagerEmail(user.email);
  let pendingRegistrationsCount = 0;
  let pendingRegistrations = [];
  if (manager) {
    pendingRegistrations = db
      .prepare(
        'SELECT email, name, platform, expires_at, created_at FROM pending_registrations ORDER BY created_at DESC LIMIT 20'
      )
      .all();
    pendingRegistrationsCount = pendingRegistrations.length;
  }
  const huberaLink = huberaLinkForUser(user.id);
  res.json({
    user: {
      ...user,
      isManager: manager,
      huberaLink,
    },
    pendingRegistrationsCount,
    pendingRegistrations,
  });
});

/** Changer le mot de passe (connecté) */
app.post('/api/auth/change-password', auth, authLimiter, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (!current || !next) {
    return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  }
  if (next.length < 8 || next.length > 128) {
    return res.status(400).json({ error: 'Nouveau mot de passe : 8 à 128 caractères' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(next, 12),
    user.id
  );
  revokeRefreshFamily(user.id);
  res.json({ ok: true, message: 'Mot de passe mis à jour. Reconnectez-vous sur vos autres appareils.' });
});

/** Demande de réinitialisation (lien email) — réponse anti-énumération */
app.post('/api/auth/forgot-password', authLimiter, registerLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    const generic =
      'Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.';
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    const user = findUserByLoginEmail(email);
    if (!user) {
      return res.json({ ok: true, message: generic });
    }
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    const raw = crypto.randomBytes(32).toString('hex');
    const id = uuid();
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, user.id, hashToken(raw), expires, new Date().toISOString());

    const resetUrl = `${PUBLIC_URL}/reset-password?token=${encodeURIComponent(raw)}`;
    const transport = mailer();
    const from = process.env.SMTP_FROM || 'Hubera Fuel <noreply@maily.ovh>';
    if (transport) {
      await transport.sendMail({
        from,
        to: user.email,
        subject: 'Hubera Fuel — réinitialiser le mot de passe',
        html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
          <h2>Réinitialisation</h2>
          <p>Bonjour ${String(user.name).replace(/[<>&]/g, '')},</p>
          <p>Cliquez pour choisir un nouveau mot de passe (lien valable 2 h) :</p>
          <p style="margin:24px 0"><a href="${resetUrl}" style="background:#e94560;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Réinitialiser</a></p>
          <p style="color:#666;font-size:12px">${resetUrl}</p>
        </div>`,
        text: `Réinitialiser : ${resetUrl}\n`,
      });
    } else {
      console.warn('[mail] forgot-password', resetUrl);
    }
    res.json({ ok: true, message: generic, mailed: Boolean(transport) });
  } catch (e) {
    console.error('forgot-password', e);
    res.status(500).json({ error: 'Impossible de traiter la demande de réinitialisation. Réessayez plus tard.' });
  }
});

app.post('/api/auth/reset-password', authLimiter, (req, res) => {
  const raw = String(req.body?.token || '');
  const next = String(req.body?.newPassword || '');
  if (!raw || next.length < 8 || next.length > 128) {
    return res.status(400).json({ error: 'Token et nouveau mot de passe (8+ car.) requis' });
  }
  const row = db
    .prepare('SELECT * FROM password_resets WHERE token_hash = ?')
    .get(hashToken(raw));
  if (!row || row.used_at) {
    return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Lien expiré — redemandez une réinitialisation' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(next, 12),
    row.user_id
  );
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id
  );
  revokeRefreshFamily(row.user_id);
  res.json({ ok: true, message: 'Mot de passe mis à jour. Vous pouvez vous connecter.' });
});

/** Suppression de compte (RGPD) — efface sync + sessions */
app.post('/api/auth/delete-account', auth, authLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');
  if (confirm !== 'SUPPRIMER') {
    return res.status(400).json({ error: 'Saisissez SUPPRIMER pour confirmer' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const uid = user.id;
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM sync_data WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  res.json({ ok: true, message: 'Compte et données cloud supprimés.' });
});

app.get('/api/sync', auth, syncLimiter, (req, res) => {
  const row = db.prepare('SELECT payload, updated_at FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.json({ data: null, updatedAt: null });
  try {
    res.json({ data: JSON.parse(row.payload), updatedAt: row.updated_at });
  } catch {
    res.status(500).json({ error: 'Données sync corrompues' });
  }
});

app.put('/api/sync', auth, syncLimiter, (req, res) => {
  const body = req.body?.data ?? req.body ?? {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Payload sync invalide' });
  }
  const payload = JSON.stringify(body);
  if (payload.length > 12_000_000) {
    return res.status(413).json({ error: 'Payload trop volumineux' });
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(req.user.sub, payload, now);
  res.json({ ok: true, updatedAt: now });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hubera Maps API — endpoints pour l'app Maps externe
// ─────────────────────────────────────────────────────────────────────────────

/** Récupère les véhicules de l'utilisateur (pour sélection dans Maps). */
app.get('/api/maps/vehicles', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.json({ vehicles: [] });
  try {
    const data = JSON.parse(row.payload);
    const vehicles = (data.vehicles || []).map((v) => ({
      id: v.id,
      name: v.name,
      brand: v.brand,
      model: v.model,
      year: v.year,
      fuelType: v.fuelType,
      tankCapacity: v.tankCapacity,
      lastKnownKm: v.lastKnownKm,
      avgConsumption: v.avgConsumption,
      licensePlate: v.licensePlate,
      isDefault: v.isDefault,
    }));
    res.json({ vehicles });
  } catch {
    res.status(500).json({ error: 'Données véhicules corrompues' });
  }
});

/** Récupère l'historique des trajets (tous modes). */
app.get('/api/maps/trips', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.json({ trips: [] });
  try {
    const data = JSON.parse(row.payload);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const mode = req.query.mode; // 'driving', 'walking', 'transit', ou undefined pour tous
    
    let trips = data.trips || [];
    
    // Filtre par mode si spécifié
    if (mode) {
      trips = trips.filter((t) => t.mode === mode || (!t.mode && mode === 'driving'));
    }
    
    // Tri par date décroissante
    trips.sort((a, b) => new Date(b.startTime || b.date || 0) - new Date(a.startTime || a.date || 0));
    
    // Pagination
    const total = trips.length;
    trips = trips.slice(offset, offset + limit);
    
    // Enrichit avec données véhicule si trajet voiture
    const vehiclesById = Object.fromEntries((data.vehicles || []).map((v) => [v.id, v]));
    
    const enriched = trips.map((t) => {
      const vehicle = t.vehicleId ? vehiclesById[t.vehicleId] : null;
      return {
        id: t.id,
        mode: t.mode || 'driving',
        startTime: t.startTime || t.date,
        endTime: t.endTime,
        startLocation: t.startLocation,
        endLocation: t.endLocation || t.destinationName,
        distance: t.distance,
        duration: t.duration,
        fuelUsed: t.fuelUsed,
        avgSpeed: t.avgSpeed,
        maxSpeed: t.maxSpeed,
        // Données véhicule
        vehicleId: t.vehicleId,
        vehicleName: vehicle?.name,
        vehicleBrand: vehicle?.brand,
        vehicleModel: vehicle?.model,
        // Consommation
        consumption: t.fuelUsed && t.distance > 0 
          ? ((t.fuelUsed / t.distance) * 100).toFixed(2) 
          : null,
        // Route GPS (optionnel, peut être volumineux)
        hasRoute: !!(t.route && t.route.length > 0),
        routePointCount: t.route?.length || 0,
      };
    });
    
    res.json({ 
      trips: enriched, 
      total, 
      limit, 
      offset,
      hasMore: offset + limit < total,
    });
  } catch (e) {
    res.status(500).json({ error: 'Données trajets corrompues' });
  }
});

/** Récupère un trajet spécifique avec route GPS complète. */
app.get('/api/maps/trips/:id', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.status(404).json({ error: 'Trajet non trouvé' });
  try {
    const data = JSON.parse(row.payload);
    const trip = (data.trips || []).find((t) => String(t.id) === String(req.params.id));
    if (!trip) return res.status(404).json({ error: 'Trajet non trouvé' });
    
    const vehicle = trip.vehicleId 
      ? (data.vehicles || []).find((v) => v.id === trip.vehicleId) 
      : null;
    
    res.json({
      ...trip,
      vehicle: vehicle ? {
        id: vehicle.id,
        name: vehicle.name,
        brand: vehicle.brand,
        model: vehicle.model,
        fuelType: vehicle.fuelType,
        tankCapacity: vehicle.tankCapacity,
      } : null,
      consumption: trip.fuelUsed && trip.distance > 0 
        ? ((trip.fuelUsed / trip.distance) * 100).toFixed(2) 
        : null,
    });
  } catch {
    res.status(500).json({ error: 'Données trajet corrompues' });
  }
});

/** Récupère les lieux enregistrés (domicile, travail, favoris). */
app.get('/api/maps/places', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.json({ places: [] });
  try {
    const data = JSON.parse(row.payload);
    const places = (data.places || []).map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      type: p.type, // 'home', 'work', 'favorite', 'recent'
      visitCount: p.visitCount || 0,
      lastVisit: p.lastVisit,
    }));
    res.json({ places });
  } catch {
    res.status(500).json({ error: 'Données lieux corrompues' });
  }
});

/** Démarre un trajet depuis Maps (crée l'entrée dans Fuel). */
app.post('/api/maps/trips/start', auth, (req, res) => {
  const row = db.prepare('SELECT payload, updated_at FROM sync_data WHERE user_id = ?').get(req.user.sub);
  const data = row ? JSON.parse(row.payload) : { vehicles: [], trips: [], places: [], fillUps: [] };
  
  const { mode, vehicleId, startLocation, destination, destinationCoords } = req.body || {};
  
  // Valide le véhicule si mode voiture
  if (mode === 'driving' && vehicleId) {
    const vehicle = (data.vehicles || []).find((v) => String(v.id) === String(vehicleId));
    if (!vehicle) return res.status(400).json({ error: 'Véhicule non trouvé' });
  }
  
  const tripId = Date.now();
  const newTrip = {
    id: tripId,
    mode: mode || 'driving',
    vehicleId: mode === 'driving' ? vehicleId : null,
    startTime: new Date().toISOString(),
    startLocation: startLocation || null,
    destinationName: destination || null,
    destinationLat: destinationCoords?.latitude,
    destinationLon: destinationCoords?.longitude,
    status: 'active',
    route: [],
    distance: 0,
    duration: 0,
    fuelUsed: null,
  };
  
  data.trips = data.trips || [];
  data.trips.push(newTrip);
  
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(req.user.sub, JSON.stringify(data), now);
  
  res.status(201).json({ 
    ok: true, 
    tripId,
    trip: newTrip,
    // Deep link pour ouvrir Fuel et commencer le tracking GPS
    fuelDeepLink: `gasoiltracking://trip/control?action=start&tripId=${tripId}&vehicleId=${vehicleId || ''}&mode=${mode || 'driving'}`,
  });
});

/** Met à jour un trajet (pause, stop, position). */
app.put('/api/maps/trips/:id', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.status(404).json({ error: 'Trajet non trouvé' });
  
  try {
    const data = JSON.parse(row.payload);
    const tripIndex = (data.trips || []).findIndex((t) => String(t.id) === String(req.params.id));
    if (tripIndex === -1) return res.status(404).json({ error: 'Trajet non trouvé' });
    
    const { action, position, endLocation, fuelUsed } = req.body || {};
    const trip = data.trips[tripIndex];
    
    if (action === 'pause') {
      trip.status = 'paused';
      trip.pausedAt = new Date().toISOString();
    } else if (action === 'resume') {
      trip.status = 'active';
      delete trip.pausedAt;
    } else if (action === 'stop') {
      trip.status = 'completed';
      trip.endTime = new Date().toISOString();
      if (endLocation) trip.endLocation = endLocation;
      if (fuelUsed != null) trip.fuelUsed = fuelUsed;
      // Calcule durée
      if (trip.startTime) {
        trip.duration = Math.round((new Date(trip.endTime) - new Date(trip.startTime)) / 1000);
      }
    }
    
    // Ajoute position à la route si fournie
    if (position && position.latitude && position.longitude) {
      trip.route = trip.route || [];
      trip.route.push({
        lat: position.latitude,
        lon: position.longitude,
        ts: Date.now(),
        speed: position.speed,
      });
    }
    
    data.trips[tripIndex] = trip;
    
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE sync_data SET payload = ?, updated_at = ? WHERE user_id = ?`
    ).run(JSON.stringify(data), now, req.user.sub);
    
    res.json({ ok: true, trip });
  } catch {
    res.status(500).json({ error: 'Erreur mise à jour trajet' });
  }
});

/** Statistiques trajets pour le dashboard Maps. */
app.get('/api/maps/stats', auth, (req, res) => {
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(req.user.sub);
  if (!row) return res.json({ stats: { totalTrips: 0, totalDistance: 0, totalDuration: 0 } });
  
  try {
    const data = JSON.parse(row.payload);
    const trips = data.trips || [];
    const period = req.query.period || 'all'; // 'week', 'month', 'year', 'all'
    
    let filtered = trips;
    const now = Date.now();
    if (period === 'week') {
      filtered = trips.filter((t) => new Date(t.startTime || t.date) > now - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      filtered = trips.filter((t) => new Date(t.startTime || t.date) > now - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'year') {
      filtered = trips.filter((t) => new Date(t.startTime || t.date) > now - 365 * 24 * 60 * 60 * 1000);
    }
    
    const byMode = {
      driving: filtered.filter((t) => !t.mode || t.mode === 'driving'),
      walking: filtered.filter((t) => t.mode === 'walking'),
      transit: filtered.filter((t) => t.mode === 'transit'),
      cycling: filtered.filter((t) => t.mode === 'cycling'),
    };
    
    const modeStats = (arr) => ({
      count: arr.length,
      distance: arr.reduce((s, t) => s + (t.distance || 0), 0),
      duration: arr.reduce((s, t) => s + (t.duration || 0), 0),
      fuelUsed: arr.reduce((s, t) => s + (t.fuelUsed || 0), 0),
    });
    
    res.json({
      stats: {
        totalTrips: filtered.length,
        totalDistance: filtered.reduce((s, t) => s + (t.distance || 0), 0),
        totalDuration: filtered.reduce((s, t) => s + (t.duration || 0), 0),
        totalFuelUsed: filtered.reduce((s, t) => s + (t.fuelUsed || 0), 0),
        byMode: {
          driving: modeStats(byMode.driving),
          walking: modeStats(byMode.walking),
          transit: modeStats(byMode.transit),
          cycling: modeStats(byMode.cycling),
        },
      },
      period,
    });
  } catch {
    res.status(500).json({ error: 'Erreur calcul statistiques' });
  }
});

const upload = multer({
  dest: path.join(DATA_DIR, 'apks'),
  limits: { fileSize: 120 * 1024 * 1024 },
});

function unlinkQuiet(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

/** Refuse un faux APK (HTML, truncature, versionCode EAS remote) — « package non validé » Android. */
function assertValidApkFile(filePath, expected = {}) {
  const st = fs.statSync(filePath);
  if (st.size < 5_000_000) {
    throw new Error(`APK trop petit (${st.size} o) — upload incomplet`);
  }
  // Builds prod = arm64-v8a seul (~40–55 Mo). Les APK « fat » multi-ABI (~120 Mo)
  // ont souvent un versionCode périmé → échec OTA (« package non validé »).
  if (st.size > 80_000_000) {
    throw new Error(
      `APK trop volumineux (${st.size} o) — refuse le build multi-ABI ; utiliser ./scripts/build-release-apk.sh (arm64)`
    );
  }
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Fichier non-APK (magique ZIP manquante)');
  }
  // Lit le versionCode DANS le binaire — EAS remote a déjà publié un APK vc137
  // alors que l’API annonçait 146, et Android refuse l’install.
  const meta = assertApkIdentity(filePath, expected);
  return meta.size || st.size;
}

function saveRelease({ version, notes, force, file, versionCode }) {
  const rows = db
    .prepare('SELECT * FROM app_releases WHERE apk_filename IS NOT NULL')
    .all();
  const best = pickLatestRelease(rows);
  if (best && compareSemver(version, best.version) < 0) {
    unlinkQuiet(file?.path);
    return {
      ok: false,
      skipped: true,
      reason: 'older-than-current',
      version,
      current: best.version,
    };
  }

  let filename = null;
  let apkSha256 = null;
  let apkSize = null;
  const vcRaw = versionCode != null && versionCode !== '' ? Number(versionCode) : NaN;
  const vc = Number.isFinite(vcRaw) ? Math.trunc(vcRaw) : null;

  if (file) {
    if (vc == null) {
      unlinkQuiet(file.path);
      return {
        ok: false,
        skipped: true,
        reason: 'versionCode-required',
        error: 'versionCode obligatoire à l’upload (évite OTA avec ancien code Android)',
      };
    }
    try {
      apkSize = assertValidApkFile(file.path, {
        packageName: 'com.gasoiltracking.app',
        versionName: version,
        versionCode: vc,
      });
    } catch (e) {
      unlinkQuiet(file.path);
      return {
        ok: false,
        skipped: true,
        reason: 'invalid-apk',
        error: e instanceof Error ? e.message : String(e),
      };
    }
    // Garde anti-régression : un versionCode déclaré plus bas que le précédent casse l’OTA
    // (Android refuse le « downgrade » → « package n’a pas pu être validé »).
    const bestVc = rows
      .map((r) => Number(r.version_code))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => Math.max(a, b), 0);
    if (bestVc > 0 && vc < bestVc) {
      unlinkQuiet(file.path);
      return {
        ok: false,
        skipped: true,
        reason: 'versionCode-downgrade',
        versionCode: vc,
        currentVersionCode: bestVc,
      };
    }
    apkSha256 = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
    // Nom unique par versionCode — évite d’écraser un bon APK par un mauvais au même semver.
    filename = `gasoil-tracking-${String(version).replace(/[^\w.\-]/g, '')}-vc${vc}.apk`;
    fs.renameSync(file.path, path.join(DATA_DIR, 'apks', filename));
  }
  db.prepare(
    `INSERT INTO app_releases
      (version, platform, apk_filename, release_notes, force_update, created_at, apk_sha256, apk_size, version_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    version,
    'android',
    filename,
    notes,
    force ? 1 : 0,
    new Date().toISOString(),
    apkSha256,
    apkSize,
    vc
  );
  // Clear pending only if this version covers the announced build
  try {
    const pendingPath = path.join(DATA_DIR, 'build-pending.json');
    if (fs.existsSync(pendingPath)) {
      const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
      const pv = String(pending?.version || '');
      if (!pv || compareSemver(version, pv) >= 0) {
        fs.unlinkSync(pendingPath);
      }
    }
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    version,
    versionCode: vc,
    apkSha256,
    apkSize,
    apkUrl: filename ? `${PUBLIC_URL}/api/download/${filename}` : null,
  };
}

/** Annonce une build EAS en cours (avant upload APK) — évite « à jour » trompeur. */
app.post('/api/ci/releases/pending', (req, res) => {
  const header = req.headers['x-release-token'] || req.headers.authorization?.replace('Bearer ', '');
  if (!RELEASE_UPLOAD_TOKEN || header !== RELEASE_UPLOAD_TOKEN) {
    return res.status(401).json({ error: 'Token CI invalide' });
  }
  const version = String(req.body?.version || '').trim();
  if (!version) return res.status(400).json({ error: 'version requise' });
  const notes = String(req.body?.releaseNotes || 'Build EAS en cours').slice(0, 500);
  const payload = {
    version,
    startedAt: new Date().toISOString(),
    notes,
    sha: req.body?.sha || null,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'build-pending.json'), JSON.stringify(payload));
  res.status(201).json({ ok: true, ...payload });
});

function requireReleaseToken(req, res) {
  const header = req.headers['x-release-token'] || req.headers.authorization?.replace('Bearer ', '');
  if (!RELEASE_UPLOAD_TOKEN || header !== RELEASE_UPLOAD_TOKEN) {
    res.status(401).json({ error: 'Token CI invalide' });
    return false;
  }
  return true;
}

/**
 * Patch cloud one-shot (compte perso) : trajet du jour + jauge + odomètre.
 * Pas d’APK. Idempotent.
 */
app.post('/api/ci/personal-commute', async (req, res) => {
  if (!requireReleaseToken(req, res)) return;
  const email = String(req.body?.email || 'paveldelhomme@gmail.com')
    .toLowerCase()
    .trim();
  if (email !== 'paveldelhomme@gmail.com') {
    return res.status(403).json({ error: 'Email non autorisé pour ce patch' });
  }
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(user.id);
  let snapshot = { vehicles: [], trips: [], places: [] };
  try {
    snapshot = row?.payload ? JSON.parse(row.payload) : snapshot;
  } catch {
    return res.status(500).json({ error: 'Payload sync illisible' });
  }
  let route;
  try {
    route = await fetchCommuteRoute();
  } catch (e) {
    console.warn('personal-commute OSRM', e);
    route = { distanceKm: 44.7, durationMinutes: 53, coordinates: [] };
  }
  const body = req.body || {};
  const result = body.fillUp
    ? applyPersonalFillUp(snapshot, route, body)
    : applyPersonalCommute(snapshot, route, body);
  if (!result.ok) {
    return res.status(409).json(result);
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(user.id, JSON.stringify(result.snapshot), now);
  const { snapshot: _omit, ...summary } = result;
  console.log('[personal-commute]', summary);
  res.json({ ...summary, updatedAt: now });
});

/**
 * Plein réel 206 (Intermarché La Guerche) + trajet du jour si absent.
 * Idempotent. Ne remet pas la jauge à 1/4.
 */
app.post('/api/ci/personal-fillup', async (req, res) => {
  if (!requireReleaseToken(req, res)) return;
  const email = String(req.body?.email || 'paveldelhomme@gmail.com')
    .toLowerCase()
    .trim();
  if (email !== 'paveldelhomme@gmail.com') {
    return res.status(403).json({ error: 'Email non autorisé pour ce patch' });
  }
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const row = db.prepare('SELECT payload FROM sync_data WHERE user_id = ?').get(user.id);
  let snapshot = { vehicles: [], trips: [], places: [], fillUps: [] };
  try {
    snapshot = row?.payload ? JSON.parse(row.payload) : snapshot;
  } catch {
    return res.status(500).json({ error: 'Payload sync illisible' });
  }
  let route;
  try {
    route = await fetchCommuteRoute();
  } catch (e) {
    console.warn('personal-fillup OSRM', e);
    route = { distanceKm: 44.7, durationMinutes: 53, coordinates: [] };
  }
  const result = applyPersonalFillUp(snapshot, route, req.body || {});
  if (!result.ok) {
    return res.status(409).json(result);
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).run(user.id, JSON.stringify(result.snapshot), now);
  const { snapshot: _omit, ...summary } = result;
  console.log('[personal-fillup]', summary);
  res.json({ ...summary, updatedAt: now });
});

app.post('/api/ci/releases', upload.single('apk'), (req, res) => {
  const header = req.headers['x-release-token'] || req.headers.authorization?.replace('Bearer ', '');
  if (!RELEASE_UPLOAD_TOKEN || header !== RELEASE_UPLOAD_TOKEN) {
    return res.status(401).json({ error: 'Token CI invalide' });
  }
  if (!req.file) return res.status(400).json({ error: 'APK manquant' });
  const version = req.body?.version || APP_VERSION;
  const notes = req.body?.releaseNotes || 'Mise à jour automatique';
  const force = req.body?.forceUpdate === '1' || req.body?.forceUpdate === true;
  const versionCode = req.body?.versionCode ?? req.body?.version_code ?? null;
  const result = saveRelease({ version, notes, force, file: req.file, versionCode });
  if (result.skipped) return res.status(409).json(result);
  res.status(201).json(result);
});

function requireManager(req, res, next) {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.user.sub);
  if (!user || !isManagerEmail(user.email)) {
    return res.status(403).json({ error: 'Réservé admin / compte gestionnaire' });
  }
  req.adminUser = user;
  next();
}

/** @deprecated alias */
function requireAdmin(req, res, next) {
  return requireManager(req, res, next);
}

function latestApkFile() {
  const rows = db.prepare('SELECT * FROM app_releases WHERE apk_filename IS NOT NULL').all();
  const latest = pickLatestRelease(rows);
  if (!latest?.apk_filename) return null;
  const full = path.join(DATA_DIR, 'apks', latest.apk_filename);
  if (!fs.existsSync(full)) return null;
  return { ...latest, full };
}

function createDownloadLink({ createdBy, label, days = 14, maxUses = 50 }) {
  const raw = crypto.randomBytes(24).toString('base64url');
  const id = uuid();
  const expires = new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO download_links (id, token_hash, created_by, label, max_uses, use_count, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, hashToken(raw), createdBy, label || null, maxUses, expires, new Date().toISOString());
  const url = `${PUBLIC_URL}/get-app?t=${encodeURIComponent(raw)}`;
  return { id, url, token: raw, expiresAt: expires, maxUses };
}

async function sendDownloadInviteEmail({ to, url, fromName, inviteCode, webUrl, downloadPage }) {
  const transport = mailer();
  const from = process.env.SMTP_FROM || 'Hubera Fuel <noreply@maily.ovh>';
  const code = String(inviteCode || INVITE_CODE || '').trim();
  const web = String(webUrl || PUBLIC_URL).replace(/\/$/, '');
  const hub = String(downloadPage || `${PUBLIC_URL}/download`);
  const hubWithCode = code ? `${hub}?code=${encodeURIComponent(code)}` : hub;
  const codeBlock = code
    ? `<p style="margin:24px 0;padding:14px 16px;background:#0f0f1a;border-radius:10px;border:1px solid #334155">
        <strong style="display:block;margin-bottom:6px;color:#f1f5f9">Code d’invitation (parrainage)</strong>
        <span style="font-size:22px;letter-spacing:1px;font-weight:700;color:#e94560">${code.replace(/[<>&]/g, '')}</span>
        <span style="display:block;margin-top:8px;color:#94a3b8;font-size:12px">À saisir lors de la création du compte dans l’app ou sur le web.</span>
      </p>`
    : '';
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2>Hubera Fuel — invitation</h2>
      <p>${String(fromName || 'Un administrateur').replace(/[<>&]/g, '')} vous invite à utiliser Hubera Fuel.</p>
      ${codeBlock}

      <h3 style="margin:28px 0 10px;font-size:16px">📱 iPhone / iPad (recommandé)</h3>
      <p style="margin:0 0 10px;color:#475569;font-size:14px">Pas d’App Store nécessaire : ouvrez l’app web, puis <strong>Partager → Sur l’écran d’accueil</strong> dans Safari.</p>
      <p style="margin:0 0 8px">
        <a href="${web}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Ouvrir l’app (iPhone / web)
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#64748b"><a href="${hubWithCode}#ios">${hubWithCode}#ios</a></p>

      <h3 style="margin:24px 0 10px;font-size:16px">🤖 Android</h3>
      <p style="margin:0 0 10px;color:#475569;font-size:14px">Téléchargez l’APK, ouvrez le fichier, autorisez l’installation.</p>
      <p style="margin:0 0 8px">
        <a href="${url}" style="background:#e94560;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Télécharger l’APK Android
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#64748b"><a href="${url}">${url}</a></p>

      <h3 style="margin:24px 0 10px;font-size:16px">💻 Navigateur</h3>
      <p style="margin:0 0 8px">
        <a href="${web}" style="background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Version web
        </a>
      </p>

      <p style="color:#666;font-size:13px;margin-top:28px">Page d’installation (tous supports) : <a href="${hubWithCode}">${hubWithCode}</a></p>
    </div>`;
  const textParts = [
    `${String(fromName || 'Un administrateur')} vous invite à Hubera Fuel.`,
    code ? `Code d’invitation : ${code}` : '',
    `iPhone / web : ${web}`,
    `Guide iPhone (écran d’accueil) : ${hubWithCode}#ios`,
    `Android APK : ${url}`,
    `Page d’installation : ${hubWithCode}`,
  ].filter(Boolean);
  if (!transport) {
    console.warn('[mail] download+invite', url, web, code ? `code=${code}` : '');
    return { ok: false, url, webUrl: web, downloadPage: hubWithCode, inviteCode: code || null };
  }
  await transport.sendMail({
    from,
    to,
    subject: code
      ? 'Hubera Fuel — iPhone / Android / web + code'
      : 'Hubera Fuel — installer (iPhone, Android, web)',
    html,
    text: textParts.join('\n\n') + '\n',
  });
  return { ok: true, url, webUrl: web, downloadPage: hubWithCode, inviteCode: code || null };
}

async function notifyManagersPendingRegistration({ email, name, platform }) {
  const recipients = [
    ...new Set(
      [ADMIN_EMAIL, PERSONAL_MAIL, 'paveldelhomme@gmail.com'].filter(Boolean).map((e) =>
        String(e).toLowerCase().trim()
      )
    ),
  ];
  if (!recipients.length) return;
  const transport = mailer();
  const from = process.env.SMTP_FROM || 'Hubera Fuel <noreply@maily.ovh>';
  const subject = `Hubera Fuel — compte à valider : ${email}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
      <h2>Nouveau compte en attente</h2>
      <p><strong>${String(name).replace(/[<>&]/g, '')}</strong> (${String(email).replace(/[<>&]/g, '')})</p>
      <p>Plateforme : ${String(platform || 'web')}</p>
      <p>Validez depuis l’app (Administration) ou renvoyez l’email de vérification.</p>
    </div>`;
  if (!transport) {
    console.warn('[mail] pending notify', email, '→', recipients.join(','));
    return;
  }
  for (const to of recipients) {
    try {
      await transport.sendMail({
        from,
        to,
        subject,
        html,
        text: `Compte à valider : ${name} <${email}> (${platform})\n`,
      });
    } catch (e) {
      console.error('[mail] pending notify fail', to, e.message);
    }
  }
}

app.get('/api/download/:file', (req, res) => {
  // Conservé pour CI / rétrocompat — préférer /api/get-app/:token
  const file = path.basename(req.params.file);
  if (!/^[\w.\-]+$/.test(file)) return res.status(400).json({ error: 'Nom invalide' });
  const full = path.join(DATA_DIR, 'apks', file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'APK introuvable' });
  // OTA mobile : pas de CORP same-origin (clients natifs / FileSystem)
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.download(full, file);
});

/** Téléchargement APK via jeton sécurisé */
app.get('/api/get-app/:token', authLimiter, (req, res) => {
  const raw = String(req.params.token || '');
  if (!raw || raw.length < 16) return res.status(400).json({ error: 'Lien invalide' });
  const row = db.prepare('SELECT * FROM download_links WHERE token_hash = ?').get(hashToken(raw));
  if (!row || row.revoked_at) return res.status(404).json({ error: 'Lien invalide ou révoqué' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: 'Lien expiré — demandez un nouveau lien' });
  }
  if (row.use_count >= row.max_uses) {
    return res.status(410).json({ error: 'Lien épuisé (trop de téléchargements)' });
  }
  const apk = latestApkFile();
  if (!apk) return res.status(404).json({ error: 'Aucune APK publiée pour le moment' });

  db.prepare(
    'UPDATE download_links SET use_count = use_count + 1, last_used_at = ? WHERE id = ?'
  ).run(new Date().toISOString(), row.id);

  res.setHeader('Cache-Control', 'no-store');
  res.download(apk.full, apk.apk_filename);
});

/** Page HTML d’atterrissage pour le lien partagé */
app.get('/get-app', (req, res) => {
  const t = String(req.query.t || '');
  const apk = latestApkFile();
  const version = apk?.version || APP_VERSION;
  if (!t || t.length < 16) {
    return res.status(400).type('html').send(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Lien invalide</title></head>
<body style="font-family:system-ui;background:#0f0f1a;color:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="background:#1a1a2e;padding:28px;border-radius:16px;max-width:420px;text-align:center"><h1>Lien invalide</h1>
<p>Demandez un nouveau lien de téléchargement à l’administrateur.</p></div></body></html>`);
  }
  const dl = `${PUBLIC_URL}/api/get-app/${encodeURIComponent(t)}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Télécharger Hubera Fuel</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f0f1a;color:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#1a1a2e;padding:28px;border-radius:16px;max-width:420px;width:100%;text-align:center}
a.btn{display:inline-block;margin-top:16px;background:#e94560;color:#fff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700}
.muted{color:#94a3b8;font-size:13px;line-height:1.5}
</style></head><body>
<div class="card">
  <h1>Hubera Fuel</h1>
  <p class="muted">Version ${String(version).replace(/[<>&]/g, '')} — lien sécurisé</p>
  <a class="btn" href="${dl}">Télécharger l’APK</a>
  <p class="muted" style="margin-top:18px">Android : ouvrez le fichier téléchargé → Autoriser l’installation depuis cette source.</p>
</div>
</body></html>`);
});

app.get('/api/admin/overview', auth, requireManager, (_req, res) => {
  const users = db
    .prepare('SELECT id, email, name, email_verified, created_at FROM users ORDER BY created_at DESC')
    .all();
  const pending = db
    .prepare(
      'SELECT id, email, name, platform, expires_at, created_at FROM pending_registrations ORDER BY created_at DESC'
    )
    .all();
  const links = db
    .prepare(
      `SELECT id, label, max_uses, use_count, expires_at, created_at, revoked_at, last_used_at, created_by
       FROM download_links ORDER BY created_at DESC LIMIT 20`
    )
    .all();
  const apk = latestApkFile();
  res.json({
    adminEmail: ADMIN_EMAIL,
    personalMail: PERSONAL_MAIL || null,
    inviteCode: INVITE_CODE || null,
    users,
    pending,
    userCount: users.length,
    pendingCount: pending.length,
    apkVersion: apk?.version || APP_VERSION,
    apkAvailable: Boolean(apk),
    webUrl: PUBLIC_URL,
    downloadPage: `${PUBLIC_URL}/download`,
    iosInstallUrl: `${PUBLIC_URL}/download#ios`,
    channels: {
      android: Boolean(apk),
      web: true,
      iosPwa: true,
      iosAppStore: false,
    },
    downloadLinks: links,
  });
});

/** Créer un lien de téléchargement sécurisé */
app.post('/api/admin/download-links', auth, requireManager, (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 14));
  const maxUses = Math.min(500, Math.max(1, Number(req.body?.maxUses) || 50));
  const label = String(req.body?.label || 'Partage APK').slice(0, 80);
  if (!latestApkFile()) {
    return res.status(404).json({ error: 'Aucune APK publiée — uploadez d’abord une release' });
  }
  const link = createDownloadLink({
    createdBy: req.adminUser.email,
    label,
    days,
    maxUses,
  });
  res.status(201).json(link);
});

/** Envoyer invitation multi-plateformes (iPhone/web + Android + code) */
app.post('/api/admin/send-download-link', auth, requireManager, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Email destinataire invalide' });
    }
    const days = Math.min(90, Math.max(1, Number(req.body?.days) || 14));
    const maxUses = Math.min(100, Math.max(1, Number(req.body?.maxUses) || 10));
    const apk = latestApkFile();
    let linkUrl = `${PUBLIC_URL}/download`;
    let expiresAt = null;
    if (apk) {
      const link = createDownloadLink({
        createdBy: req.adminUser.email,
        label: `Envoyé à ${email}`,
        days,
        maxUses,
      });
      linkUrl = link.url;
      expiresAt = link.expiresAt;
    }
    const mail = await sendDownloadInviteEmail({
      to: email,
      url: linkUrl,
      fromName: req.adminUser.name || req.adminUser.email,
      inviteCode: INVITE_CODE,
      webUrl: PUBLIC_URL,
      downloadPage: `${PUBLIC_URL}/download`,
    });
    const hub = mail.downloadPage || `${PUBLIC_URL}/download`;
    res.json({
      ok: true,
      mailed: mail.ok,
      url: linkUrl,
      webUrl: mail.webUrl || PUBLIC_URL,
      downloadPage: hub,
      iosInstallUrl: `${hub}#ios`,
      inviteCode: mail.inviteCode || INVITE_CODE || null,
      expiresAt,
      apkIncluded: Boolean(apk),
      message: mail.ok
        ? apk
          ? `Email envoyé à ${email} (iPhone/web + APK Android + code)`
          : `Email envoyé à ${email} (iPhone/web + code — APK pas encore publiée)`
        : 'SMTP indisponible — copiez les liens et le code manuellement',
    });
  } catch (e) {
    console.error('send-download-link', e);
    res.status(500).json({ error: 'Impossible d’envoyer le lien de téléchargement. Réessayez plus tard.' });
  }
});

app.post('/api/admin/download-links/:id/revoke', auth, requireManager, (req, res) => {
  const id = String(req.params.id || '');
  const row = db.prepare('SELECT id FROM download_links WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Lien introuvable' });
  db.prepare('UPDATE download_links SET revoked_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id
  );
  res.json({ ok: true });
});

app.post('/api/admin/resend-verification', auth, requireManager, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    if (!email) return res.status(400).json({ error: 'email requis' });
    const pending = db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
    if (!pending) return res.status(404).json({ error: 'Aucune inscription en attente pour cet email' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'UPDATE pending_registrations SET token_hash = ?, expires_at = ? WHERE id = ?'
    ).run(tokenHash, expires, pending.id);

    const mail = await sendVerificationEmail({
      to: pending.email,
      name: pending.name,
      token: rawToken,
      platform: pending.platform || 'web',
    });
    res.json({
      ok: true,
      mailed: mail.ok,
      verifyUrl: mail.verifyUrl,
      message: mail.ok ? 'Email renvoyé' : 'SMTP KO — utilisez verifyUrl',
    });
  } catch (e) {
    console.error('resend-verification', e);
    res.status(500).json({ error: 'Impossible de renvoyer l’email de vérification. Réessayez plus tard.' });
  }
});

/** Valider un compte en attente (sans attendre le clic email de l’utilisateur) */
app.post('/api/admin/approve-pending', auth, requireManager, (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim();
    if (!email) return res.status(400).json({ error: 'email requis' });
    const pending = db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
    if (!pending) {
      return res.status(404).json({ error: 'Aucune inscription en attente pour cet email' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
      return res.json({ ok: true, alreadyExists: true, message: 'Compte déjà actif' });
    }
    const userId = uuid();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, email_verified, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(userId, pending.email, pending.password_hash, pending.name, now);
    db.prepare(
      `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    ).run(
      userId,
      JSON.stringify({ vehicles: [], fillUps: [], budgets: [], trips: [] }),
      now
    );
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pending.id);
    res.json({
      ok: true,
      user: { id: userId, email: pending.email, name: pending.name },
      message: `Compte validé : ${pending.email}`,
    });
  } catch (e) {
    console.error('approve-pending', e);
    res.status(500).json({ error: 'Impossible de valider le compte en attente. Réessayez plus tard.' });
  }
});

app.post('/api/admin/reject-pending', auth, requireManager, (req, res) => {
  const email = String(req.body?.email || '')
    .toLowerCase()
    .trim();
  if (!email) return res.status(400).json({ error: 'email requis' });
  const r = db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
  if (!r.changes) return res.status(404).json({ error: 'Aucune inscription en attente' });
  res.json({ ok: true, message: `Inscription refusée / annulée : ${email}` });
});

/** Compte QA labo jetable — create / reset / delete / status (managers only). */
const QA_LAB_EMAIL_DEFAULT = String(process.env.QA_LAB_EMAIL || 'qa.lab@maily.ovh')
  .toLowerCase()
  .trim();
const QA_LAB_NAME_DEFAULT = process.env.QA_LAB_NAME || 'QA Lab Gasoil';

function randomQaPassword() {
  return crypto.randomBytes(16).toString('base64url').slice(0, 20);
}

app.get('/api/admin/qa-lab', auth, requireManager, (_req, res) => {
  const email = QA_LAB_EMAIL_DEFAULT;
  const u = db
    .prepare('SELECT id, email, name, email_verified, created_at FROM users WHERE email = ?')
    .get(email);
  const sync = u
    ? db.prepare('SELECT updated_at, length(payload) as bytes FROM sync_data WHERE user_id = ?').get(u.id)
    : null;
  res.json({
    email,
    exists: Boolean(u),
    user: u || null,
    sync: sync || null,
  });
});

app.post('/api/admin/qa-lab', auth, requireManager, (req, res) => {
  try {
    const action = String(req.body?.action || '').toLowerCase().trim();
    const email = QA_LAB_EMAIL_DEFAULT;
    const name = QA_LAB_NAME_DEFAULT;
    if (!['create', 'reset', 'delete', 'status'].includes(action)) {
      return res.status(400).json({ error: 'action = create|reset|delete|status' });
    }
    if (action === 'status') {
      const u = db
        .prepare('SELECT id, email, name, email_verified, created_at FROM users WHERE email = ?')
        .get(email);
      return res.json({ ok: true, action: 'status', email, exists: Boolean(u), user: u || null });
    }
    if (action === 'delete') {
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!u) return res.json({ ok: true, action: 'delete', email, deleted: false });
      db.prepare('DELETE FROM sync_data WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(u.id);
      try {
        db.prepare('DELETE FROM qr_login_challenges WHERE user_id = ?').run(u.id);
      } catch {
        /* table optionnelle */
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
      return res.json({ ok: true, action: 'delete', email, deleted: true, id: u.id });
    }
    // create | reset
    const pass =
      String(req.body?.password || '').trim().length >= 12
        ? String(req.body.password).trim()
        : randomQaPassword();
    const hash = bcrypt.hashSync(pass, 12);
    const now = new Date().toISOString();
    db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, name = ? WHERE email = ?').run(
        hash,
        name,
        email
      );
      return res.json({
        ok: true,
        action: 'reset',
        email,
        id: existing.id,
        password: pass,
        message: 'Mot de passe QA régénéré (affiché une seule fois).',
      });
    }
    const id = uuid();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, email_verified, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    ).run(id, email, hash, name, now);
    db.prepare(
      `INSERT INTO sync_data (user_id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    ).run(id, JSON.stringify({ vehicles: [], fillUps: [], budgets: [], trips: [] }), now);
    return res.json({
      ok: true,
      action: 'create',
      email,
      id,
      password: pass,
      message: 'Compte QA créé (mot de passe affiché une seule fois).',
    });
  } catch (e) {
    console.error('qa-lab', e);
    return res.status(500).json({ error: 'Impossible de gérer le compte QA' });
  }
});

app.post('/api/admin/releases', auth, requireAdmin, upload.single('apk'), (req, res) => {
  const version = req.body?.version || APP_VERSION;
  const notes = req.body?.releaseNotes || '';
  const force = req.body?.forceUpdate === '1' || req.body?.forceUpdate === true;
  res.status(201).json(
    saveRelease({
      version,
      notes,
      force,
      file: req.file,
      versionCode: req.body?.versionCode ?? req.body?.version_code ?? null,
    })
  );
});

app.use((err, _req, res, next) => {
  if (!err) return next();
  const tooLarge =
    err.status === 413 ||
    err.type === 'entity.too.large' ||
    err.name === 'PayloadTooLargeError';
  if (tooLarge) {
    return res.status(413).json({ error: 'Payload trop volumineux' });
  }
  console.error('api error', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gasoil API on :${PORT}`);
});
