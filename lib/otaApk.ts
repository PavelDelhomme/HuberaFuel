/**
 * Fichiers OTA internes (pas le dossier Téléchargements Android).
 */

export function otaApkFileName(version: string, versionCode: number): string {
  const v = String(version || '0').replace(/[^\w.\-]/g, '');
  const vc = Number.isFinite(versionCode) ? Math.trunc(versionCode) : 0;
  return `gasoil-${v}-vc${vc}.apk`;
}

/** Taille cohérente avec le serveur — 64 Kio de marge (headers / FS). */
export function isOtaFileComplete(
  actualSize?: number | null,
  expectedSize?: number | null
): boolean {
  if (actualSize == null || !Number.isFinite(actualSize) || actualSize < 1_000_000) {
    return false;
  }
  if (expectedSize == null || !Number.isFinite(expectedSize) || expectedSize <= 0) {
    return actualSize >= 5_000_000;
  }
  return Math.abs(actualSize - expectedSize) <= 64 * 1024;
}

export function shouldReuseOtaFile(opts: {
  exists: boolean;
  actualSize?: number | null;
  expectedSize?: number | null;
  fileVersionCode?: number | null;
  remoteVersionCode?: number | null;
}): boolean {
  if (!opts.exists) return false;
  if (
    opts.fileVersionCode != null &&
    opts.remoteVersionCode != null &&
    opts.fileVersionCode !== opts.remoteVersionCode
  ) {
    return false;
  }
  return isOtaFileComplete(opts.actualSize, opts.expectedSize);
}

/** `PK` en base64 (`UEs…`). */
export function apkZipMagicBase64(head: string | null | undefined): boolean {
  return typeof head === 'string' && head.startsWith('UEs');
}

export function apkZipMagicBytes(head: number[]): boolean {
  return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
}

export function decodeBase64Bytes(b64: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/\s/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === '=') break;
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function bytesContainAscii(data: number[], needle: string): boolean {
  if (!needle || data.length < needle.length) return false;
  const units = Array.from(needle).map((c) => c.charCodeAt(0));
  const last = data.length - units.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < units.length; j++) {
      if (data[i + j] !== units[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Fin d’archive ZIP `PK\\x05\\x06` dans la queue (commentaire ≤ 64 Ko). */
export function zipEndOfCentralDirectory(tail: number[]): boolean {
  if (tail.length < 22) return false;
  const min = tail.length > 65557 ? tail.length - 65557 : 0;
  for (let i = tail.length - 22; i >= min; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

export type OtaCacheAction = 'fresh' | 'reuse' | 'resume' | 'discard';

/**
 * Cache PK incomplet : reprise. Zip clos + manifeste + taille : réutiliser.
 * HTML ou zip qui n’est pas une APK : jeter, en le disant.
 */
export function decideOtaCache(opts: {
  exists: boolean;
  actualSize?: number | null;
  expectedSize?: number | null;
  zipMagic: boolean;
  zipComplete: boolean;
  hasAndroidManifest: boolean;
  fileVersionCode?: number | null;
  remoteVersionCode?: number | null;
}): OtaCacheAction {
  if (!opts.exists) return 'fresh';
  const size = opts.actualSize ?? 0;
  if (
    opts.fileVersionCode != null &&
    opts.remoteVersionCode != null &&
    opts.fileVersionCode !== opts.remoteVersionCode
  ) {
    return 'discard';
  }
  if (!opts.zipMagic || size < 100_000) return 'discard';
  const ready =
    opts.zipComplete &&
    opts.hasAndroidManifest &&
    isOtaFileComplete(size, opts.expectedSize);
  if (ready) return 'reuse';
  if (opts.zipComplete) return 'discard';
  return 'resume';
}

/** Après install réussie : on peut jeter le cache si l’app a au moins ce versionCode. */
export function shouldDeleteOtaAfterInstall(
  localVersionCode: number,
  cachedVersionCode: number
): boolean {
  if (!Number.isFinite(localVersionCode) || !Number.isFinite(cachedVersionCode)) return false;
  return localVersionCode >= cachedVersionCode && cachedVersionCode > 0;
}
