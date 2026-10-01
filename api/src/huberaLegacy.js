import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

const DATA_DIR = process.env.DATA_DIR || './data';
const STORE = path.join(DATA_DIR, 'hubera-legacy-pings.json');
const STALE_MS = Number(process.env.HUBERA_LEGACY_STALE_DAYS || 21) * 86400000;

export function huberaNotice() {
  return {
    brand: 'Hubera Fuel',
    channel: 'fuel',
    keep_package: 'cloud.hubera.fuel',
    identity: 'cloud.hubera.fuel',
    canonical_url: 'https://fuel.hubera.cloud',
    legacy_url: 'https://gasoil-tracking.delhomme.ovh',
    message:
      'Hubera Fuel s’appelle désormais Hubera Fuel. Tes trajets, véhicules et ton compte restent. ' +
      'Nouveau domaine : fuel.hubera.cloud — gasoil-tracking.hubera.cloud et gasoil-tracking.delhomme.ovh continuent. ' +
      'Même application Android (package cloud.hubera.fuel).',
  };
}

function load() {
  if (!fs.existsSync(STORE)) return { clients: {}, clearedMailSentAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return {
      clients: raw.clients || {},
      clearedMailSentAt: raw.clearedMailSentAt || null,
    };
  } catch {
    return { clients: {}, clearedMailSentAt: null };
  }
}

function save(store) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');
}

function alertTo() {
  const raw =
    process.env.HUBERA_ALERT_TO ||
    process.env.ADMIN_EMAIL ||
    process.env.PERSONAL_MAIL ||
    '';
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

function mailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
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

export function recordHuberaPing(input) {
  const id = String(input.install || '').trim() || 'anonymous';
  const store = load();
  store.clients[id] = {
    version: String(input.version || '').trim() || 'unknown',
    versionCode: Number(input.versionCode) || 0,
    huberaAware: Boolean(input.huberaAware),
    lastSeen: new Date().toISOString(),
    userAgent: String(input.userAgent || '').slice(0, 180),
  };
  save(store);
  void maybeNotifyCleared(store);
  return store;
}

export function huberaLegacyStatus() {
  const store = load();
  const now = Date.now();
  const active = Object.values(store.clients).filter(
    (c) => now - Date.parse(c.lastSeen) < STALE_MS,
  );
  const legacy = active.filter((c) => !c.huberaAware);
  const aware = active.filter((c) => c.huberaAware);
  return {
    app: 'fuel',
    name: 'Hubera Fuel',
    package: 'cloud.hubera.fuel',
    stale_days: STALE_MS / 86400000,
    active_installs: active.length,
    legacy_installs: legacy.length,
    hubera_aware_installs: aware.length,
    cleared: active.length > 0 && legacy.length === 0,
    cleared_mail_sent_at: store.clearedMailSentAt,
    notice: huberaNotice(),
  };
}

async function maybeNotifyCleared(store) {
  const status = huberaLegacyStatus();
  if (!status.cleared || store.clearedMailSentAt) return;
  const to = alertTo();
  const transport = mailer();
  if (!to.length || !transport) {
    console.warn('[hubera-legacy] cleared mais SMTP / destinataire manquant');
    return;
  }
  const n = huberaNotice();
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'Hubera Fuel <noreply@maily.ovh>',
      to: to.join(', '),
      subject: 'Hubera — plus aucun client GasoilTracking sur l’ancienne app',
      text:
        `Plus aucun install actif (vu < ${status.stale_days} j) n’utilise une version sans Hubera.\n` +
        `Installs Hubera-aware : ${status.hubera_aware_installs}. Package : ${n.keep_package}.\n` +
        `Stack gasoil-tracking / volume gasoil_api_data inchangés.\n${n.canonical_url}`,
    });
    store.clearedMailSentAt = new Date().toISOString();
    save(store);
  } catch (err) {
    console.error('[hubera-legacy] mail', err);
  }
}

export function pingFromRequest(query, ua) {
  const awareRaw = String(query.huberaAware ?? query.hubera_aware ?? '');
  return recordHuberaPing({
    install: String(query.install || query.installId || ''),
    version: String(query.clientVersion || query.version || ''),
    versionCode: Number(query.clientVersionCode || query.versionCode || 0),
    huberaAware: awareRaw === '1' || awareRaw === 'true',
    userAgent: ua,
  });
}
