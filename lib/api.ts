import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

function resolveApiUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const host = window.location.hostname.toLowerCase();
    if (
      host.endsWith('.hubera.cloud') ||
      host.endsWith('.delhomme.ovh') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return window.location.origin.replace(/\/$/, '');
    }
  }
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    Constants.expoConfig?.extra?.apiUrl ||
    'https://fuel.hubera.cloud'
  ).replace(/\/$/, '');
}

/** Recalculé à chaque appel : le web doit rester same-origin (évite CORS fuel → gasoil-tracking). */
export function getApiUrl(): string {
  return resolveApiUrl();
}

/** Compat imports existants (`${API_URL}`). Toujours same-origin sur le site. */
export const API_URL = new Proxy(
  {},
  {
    get(_target, prop) {
      const s = getApiUrl();
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
        return () => s;
      }
      const v = (s as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
    },
  }
) as unknown as string;

const TOKEN_KEY = 'gasoil_auth_token';
const REFRESH_KEY = 'gasoil_refresh_token';
const USER_KEY = 'gasoil_auth_user';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_KEY);
}

export type HuberaIdentityLink = {
  cloudity_email: string;
  cloudity_user_id?: string | null;
  satellite_email?: string | null;
  linked_at: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  isManager?: boolean;
  huberaLink?: HuberaIdentityLink | null;
};

export async function setSession(
  token: string,
  user: AuthUser,
  refreshToken?: string | null
) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  if (refreshToken) {
    await AsyncStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]);
}

export async function getStoredUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function accessExpMs(token: string): number | null {
  try {
    const mid = token.split('.')[1];
    if (!mid) return null;
    const json = JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/')));
    if (!json.exp) return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

function accessExpiresSoon(token: string, skewMs = 120_000): boolean {
  const exp = accessExpMs(token);
  if (exp == null) return true;
  return exp - Date.now() < skewMs;
}

function accessFullyExpired(token: string, skewMs = 5_000): boolean {
  const exp = accessExpMs(token);
  if (exp == null) return true;
  return exp <= Date.now() + skewMs;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Routes auth publiques : pas de Bearer, pas de retry refresh sur 401. */
function isPublicAuthPath(path: string): boolean {
  return (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/register') ||
    path.startsWith('/api/auth/refresh') ||
    path.startsWith('/api/auth/forgot-password') ||
    path.startsWith('/api/auth/reset-password') ||
    path.startsWith('/api/auth/verify-email') ||
    path.startsWith('/api/auth/resend-verification') ||
    path.startsWith('/api/auth/qr/start') ||
    path.startsWith('/api/auth/qr/poll') ||
    path.startsWith('/api/auth/qr/status')
  );
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${getApiUrl()}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // Un refresh parallèle a pu déjà stocker le nouveau jeton
          const latest = await getRefreshToken();
          if (latest && latest !== refreshToken) {
            return true;
          }
          const access = await getToken();
          if (!access || accessFullyExpired(access)) {
            await clearSession();
          }
        }
        return false;
      }
      await setSession(data.token, data.user, data.refreshToken);
      return true;
    } catch {
      // Réseau / 5xx : garder l’ancienne session pour retenter plus tard
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Renouvelle silencieusement l’access token à partir du refresh (session déjà connectée). */
export async function ensureFreshAccessToken(): Promise<string | null> {
  let token = await getToken();
  const refresh = await getRefreshToken();
  // Access absent mais refresh présent (ex. race web / storage)
  if (!token && refresh) {
    const ok = await refreshSession();
    return ok ? getToken() : null;
  }
  if (!token) return null;
  if (accessExpiresSoon(token)) {
    const ok = await refreshSession();
    if (ok) {
      token = await getToken();
    } else if (accessFullyExpired(token)) {
      return null;
    }
  }
  return token;
}

async function request(path: string, options: RequestInit = {}, retried = false): Promise<any> {
  const token = isPublicAuthPath(path) ? null : await ensureFreshAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  let data: any = {};
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(`${getApiUrl()}${path}`, { ...options, headers });
    } catch (e) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw e;
    }
    data = await res.json().catch(() => ({}));
    // 502/503/504 = proxy temporaire (redeploy / DNS nginx) — retenter
    if ([502, 503, 504].includes(res.status) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    break;
  }

  // Important : /api/auth/me, /qr/pair, /qr/approve, etc. doivent aussi renouveler
  // (avant : exclus à cause de startsWith('/api/auth/') → « Non authentifié » à tort)
  if (res!.status === 401 && !retried && !isPublicAuthPath(path)) {
    const ok = await refreshSession();
    if (ok) return request(path, options, true);
  }

  if (!res!.ok) {
    const msg =
      (typeof data?.error === 'string' && data.error) ||
      (res!.status === 413
        ? 'Payload trop volumineux'
        : res!.status === 502 || res!.status === 503
          ? 'Serveur indisponible — réessayez dans un instant'
          : `Erreur ${res!.status}`);
    const err = new Error(msg) as Error & { status?: number };
    err.status = res!.status;
    throw err;
  }
  return data;
}

export function register(
  email: string,
  password: string,
  name: string,
  inviteCode: string,
  platform: 'web' | 'mobile' = 'web'
) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name, inviteCode, platform }),
  }) as Promise<{ ok: boolean; pending?: boolean; message?: string }>;
}

export function resendVerificationEmail(email: string) {
  return request('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }) as Promise<{ ok: boolean; message?: string; alreadyActive?: boolean }>;
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  }) as Promise<{ ok: boolean; message: string }>;
}

export function forgotPassword(email: string) {
  return request('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }) as Promise<{ ok: boolean; message: string; mailed?: boolean }>;
}

export function resetPassword(token: string, newPassword: string) {
  return request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  }) as Promise<{ ok: boolean; message: string }>;
}

export function deleteAccount(password: string, confirm = 'SUPPRIMER') {
  return request('/api/auth/delete-account', {
    method: 'POST',
    body: JSON.stringify({ password, confirm }),
  }) as Promise<{ ok: boolean; message: string }>;
}

export async function login(email: string, password: string) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await setSession(data.token, data.user, data.refreshToken);
  return data;
}

export type QrLoginStart = {
  challengeId: string;
  expiresAt: string;
  ttlSeconds: number;
  qrPayload: string;
  qrDataUrl: string;
  deepLink: string;
};

export async function startQrLogin(): Promise<QrLoginStart> {
  const res = await fetch(`${getApiUrl()}/api/auth/qr/start`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Impossible de créer le QR');
  return data as QrLoginStart;
}

/** Compte connecté : QR pour connecter un autre appareil (session pré-approuvée). */
export async function startQrPair(): Promise<QrLoginStart> {
  return request('/api/auth/qr/pair', { method: 'POST' }) as Promise<QrLoginStart>;
}

export async function pollQrLogin(challengeId: string): Promise<{
  status: string;
  token?: string;
  refreshToken?: string;
  user?: AuthUser;
  expiresAt?: string;
  error?: string;
}> {
  const res = await fetch(
    `${getApiUrl()}/api/auth/qr/poll?challengeId=${encodeURIComponent(challengeId)}`
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return { status: 'missing', error: data.error };
  if (res.status === 429) return { status: 'rate_limited', error: data.error };
  if (!res.ok && res.status !== 410) {
    throw new Error(data.error || 'Erreur QR');
  }
  return data;
}

/** Suivi QR sans consommer la session (appareil qui affiche le QR pair). */
export async function statusQrLogin(challengeId: string): Promise<{
  status: string;
  expiresAt?: string;
  error?: string;
}> {
  const res = await fetch(
    `${getApiUrl()}/api/auth/qr/status?challengeId=${encodeURIComponent(challengeId)}`
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return { status: 'missing', error: data.error };
  if (res.status === 429) return { status: 'rate_limited', error: data.error };
  if (!res.ok) throw new Error(data.error || 'Erreur statut QR');
  return data;
}

export async function approveQrLogin(challenge: string) {
  return request('/api/auth/qr/approve', {
    method: 'POST',
    body: JSON.stringify({ challenge }),
  }) as Promise<{ ok: boolean; message: string }>;
}

/** Extrait le challenge opaque depuis un QR / deep link. */
export function parseQrLoginChallenge(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    if (s.startsWith('{')) {
      const j = JSON.parse(s) as { c?: string; challenge?: string };
      const c = j.c || j.challenge;
      if (c && String(c).length >= 16) return String(c);
    }
  } catch {
    /* ignore */
  }
  try {
    if (/^https?:\/\//i.test(s) || s.includes('://')) {
      const u = new URL(s);
      const c = u.searchParams.get('c') || u.searchParams.get('challenge');
      if (c && c.length >= 16) return c;
    }
  } catch {
    /* ignore */
  }
  const m = s.match(/[?&]c=([^&]+)/i);
  if (m?.[1]) {
    try {
      const c = decodeURIComponent(m[1]);
      if (c.length >= 16) return c;
    } catch {
      /* ignore */
    }
  }
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export async function logoutRemote() {
  const token = await getToken();
  const refreshToken = await getRefreshToken();
  if (!token) return;
  try {
    await fetch(`${getApiUrl()}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    /* ignore */
  }
}

export function fetchSync() {
  return request('/api/sync');
}

export function pushSync(data: unknown) {
  return request('/api/sync', {
    method: 'PUT',
    body: JSON.stringify({ data }),
  });
}

export function isPayloadTooLargeError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const msg = err instanceof Error ? err.message : String(err || '');
  return status === 413 || /413|volumineux|too large|payload/i.test(msg);
}

/** Message utilisateur pour une erreur de sync (évite le faux « hors ligne »). */
export function syncFailureMessage(err: unknown): { offline: boolean; message: string } {
  if (isPayloadTooLargeError(err)) {
    return { offline: false, message: 'Sauvegarde trop lourde — tracés compressés, réessayez' };
  }
  const status = (err as { status?: number } | null)?.status;
  const msg = err instanceof Error ? err.message : String(err || '');
  if (status === 401 || status === 403) {
    return { offline: false, message: 'Session expirée — reconnectez-vous' };
  }
  if (status != null && status >= 500) {
    return { offline: false, message: 'Serveur indisponible — réessayez dans un instant' };
  }
  // Failed to fetch couvre aussi CORS / mauvaise URL / abort — ne pas coller « hors ligne ».
  if (/ECONNREFUSED|ENOTFOUND|ERR_INTERNET_DISCONNECTED|network is offline/i.test(msg)) {
    return { offline: true, message: 'Hors ligne — données locales affichées' };
  }
  if (/timeout|timed out/i.test(msg)) {
    return { offline: false, message: 'Délai serveur dépassé — réessayez' };
  }
  if (/network request failed|failed to fetch/i.test(msg)) {
    return { offline: false, message: 'Connexion cloud impossible — données locales OK' };
  }
  if (msg && msg.length < 120 && !/^Error$/i.test(msg)) {
    return { offline: false, message: msg };
  }
  return { offline: false, message: 'Sync impossible — données locales conservées' };
}

/** Ping léger pour savoir si l’API répond (ne bloque pas l’UI longtemps). */
export async function pingApiHealth(timeoutMs = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${getApiUrl()}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export type AdminOverview = {
  adminEmail: string;
  personalMail: string | null;
  inviteCode: string | null;
  users: { id: string; email: string; name: string; email_verified: number; created_at: string }[];
  pending: {
    id?: string;
    email: string;
    name?: string;
    platform: string;
    expires_at: string;
    created_at: string;
  }[];
  userCount: number;
  pendingCount: number;
  apkVersion?: string;
  apkAvailable?: boolean;
  webUrl?: string;
  downloadPage?: string;
  iosInstallUrl?: string;
  channels?: {
    android: boolean;
    web: boolean;
    iosPwa: boolean;
    iosAppStore: boolean;
  };
  downloadLinks?: {
    id: string;
    label: string | null;
    max_uses: number;
    use_count: number;
    expires_at: string;
    created_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    created_by: string;
  }[];
};

export function fetchAdminOverview(): Promise<AdminOverview> {
  return request('/api/admin/overview') as Promise<AdminOverview>;
}

export function fetchMe() {
  return request('/api/auth/me') as Promise<{
    user: AuthUser & { email_verified?: number; created_at?: string };
    pendingRegistrationsCount: number;
    pendingRegistrations?: PendingRegistrationSummary[];
  }>;
}

export type PendingRegistrationSummary = {
  email: string;
  name?: string;
  platform?: string;
  expires_at?: string;
  created_at?: string;
};

export function createDownloadLink(opts?: { days?: number; maxUses?: number; label?: string }) {
  return request('/api/admin/download-links', {
    method: 'POST',
    body: JSON.stringify(opts || {}),
  }) as Promise<{ id: string; url: string; expiresAt: string; maxUses: number }>;
}

export function sendDownloadLinkEmail(email: string, opts?: { days?: number; maxUses?: number }) {
  return request('/api/admin/send-download-link', {
    method: 'POST',
    body: JSON.stringify({ email, ...opts }),
  }) as Promise<{
    ok: boolean;
    mailed: boolean;
    url: string;
    webUrl?: string;
    downloadPage?: string;
    iosInstallUrl?: string;
    inviteCode?: string | null;
    apkIncluded?: boolean;
    message: string;
  }>;
}

export function revokeDownloadLink(id: string) {
  return request(`/api/admin/download-links/${id}/revoke`, { method: 'POST', body: '{}' });
}

export function approvePendingRegistration(email: string) {
  return request('/api/admin/approve-pending', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }) as Promise<{ ok: boolean; message: string }>;
}

export function rejectPendingRegistration(email: string) {
  return request('/api/admin/reject-pending', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }) as Promise<{ ok: boolean; message: string }>;
}

export function resendPendingVerification(email: string) {
  return request('/api/admin/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }) as Promise<{ ok: boolean; mailed?: boolean; message: string }>;
}

export type QaLabStatus = {
  email: string;
  exists: boolean;
  user?: { id: string; email: string; name: string; created_at?: string } | null;
  sync?: { updated_at?: string; bytes?: number } | null;
};

export function fetchQaLabStatus() {
  return request('/api/admin/qa-lab') as Promise<QaLabStatus>;
}

export function manageQaLab(action: 'create' | 'reset' | 'delete' | 'status', password?: string) {
  return request('/api/admin/qa-lab', {
    method: 'POST',
    body: JSON.stringify({ action, password: password || undefined }),
  }) as Promise<{
    ok: boolean;
    action: string;
    email: string;
    password?: string;
    message?: string;
    deleted?: boolean;
    exists?: boolean;
  }>;
}

/** Gestionnaires : admin@… + paveldelhomme@gmail.com (+ EXPO_PUBLIC / extra). */
export function isManagerEmail(email?: string | null, userFlag?: boolean | null): boolean {
  if (userFlag === true) return true;
  const e = String(email || '')
    .toLowerCase()
    .trim();
  if (!e) return false;
  if (e === 'admin@delhomme.ovh') return true;
  if (e === 'paveldelhomme@gmail.com') return true;
  const personal = (
    process.env.EXPO_PUBLIC_PERSONAL_MAIL ||
    Constants.expoConfig?.extra?.personalMail ||
    ''
  )
    .toString()
    .toLowerCase()
    .trim();
  return Boolean(personal && e === personal);
}

export type HuberaNotice = {
  brand?: string;
  message?: string;
  canonical_url?: string;
  legacy_url?: string;
  keep_package?: string;
  channel?: string;
};

export type AppVersionInfo = {
  version: string;
  minVersion: string;
  forceUpdate: boolean;
  apkUrl: string | null;
  apkAvailable?: boolean;
  /** SHA-256 hex de l’APK publiée (vérif OTA). */
  apkSha256?: string | null;
  apkSize?: number | null;
  versionCode?: number | null;
  webUrl?: string;
  iosInstallUrl?: string;
  releaseNotes: string;
  downloadPage: string;
  installPage?: string;
  /** Version EAS en cours de build (pas encore téléchargeable). */
  buildingVersion?: string | null;
  buildingSince?: string | null;
  buildingNotes?: string;
  channels?: {
    android: boolean;
    web: boolean;
    iosPwa: boolean;
    iosAppStore: boolean;
  };
  hubera?: HuberaNotice | null;
};

const HUBERA_INSTALL_KEY = 'hubera_install_id';

async function huberaInstallId(): Promise<string> {
  const existing = await AsyncStorage.getItem(HUBERA_INSTALL_KEY);
  if (existing) return existing;
  const created =
    (globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await AsyncStorage.setItem(HUBERA_INSTALL_KEY, created);
  return created;
}

export async function fetchAppVersion(): Promise<AppVersionInfo> {
  const install = await huberaInstallId();
  const qs = new URLSearchParams({
    clientVersion: getLocalAppVersion(),
    clientVersionCode: String(getLocalVersionCode()),
    clientPackage: Constants.expoConfig?.android?.package || 'cloud.hubera.fuel',
    install,
    huberaAware: '1',
  });
  const res = await fetch(`${getApiUrl()}/api/version?${qs.toString()}`);
  if (!res.ok) throw new Error('Impossible de vérifier la version');
  return res.json();
}

import { compareSemver } from '@/lib/semver';

export function compareVersions(a: string, b: string): number {
  return compareSemver(a, b);
}

export function getLocalAppVersion(): string {
  return Constants.expoConfig?.version || '1.0.0';
}

/** versionCode Android (entier) — base de l’OTA, plus fiable que le seul semver. */
export function getLocalVersionCode(): number {
  const raw = Constants.expoConfig?.android?.versionCode;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}
