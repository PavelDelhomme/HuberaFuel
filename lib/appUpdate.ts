import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import type { AppVersionInfo } from '@/lib/api';
import { getApiUrl, getLocalVersionCode } from '@/lib/api';
import { markUpdatePending, prepareDataForUpdate } from '@/lib/backup';
import {
  apkZipMagicBytes,
  bytesContainAscii,
  decideOtaCache,
  decodeBase64Bytes,
  otaApkFileName,
  shouldDeleteOtaAfterInstall,
  zipEndOfCentralDirectory,
  type OtaCacheAction,
} from '@/lib/otaApk';

export type UpdateProgress = {
  phase: 'check' | 'backup' | 'permission' | 'download' | 'install' | 'done' | 'error';
  progress: number;
  message: string;
};

const PKG = Constants.expoConfig?.android?.package || 'cloud.hubera.fuel';
/** FLAG_GRANT_READ_URI_PERMISSION | FLAG_GRANT_PERSISTABLE_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK */
const INSTALL_FLAGS = 1 | 64 | 268435456;

function otaDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory;
  if (!base) throw new Error('Stockage local indisponible');
  return `${base}ota/`;
}

function otaPathFor(info: AppVersionInfo): string {
  const vc =
    info.versionCode != null && Number.isFinite(Number(info.versionCode))
      ? Number(info.versionCode)
      : 0;
  return `${otaDir()}${otaApkFileName(info.version, vc)}`;
}

function resolveApkUrl(info: AppVersionInfo): string {
  const url = info.apkUrl || '';
  if (!url) throw new Error('URL APK manquante sur le serveur');
  // Forcer HTTPS domaine prod
  if (url.startsWith('/')) {
    return `${getApiUrl()}${url}`;
  }
  return url;
}

async function openInstallPermissionSettings() {
  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: `package:${PKG}`,
    });
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        { data: `package:${PKG}` }
      );
    } catch {
      await Linking.openSettings();
    }
  }
}

async function launchApkInstaller(fileUri: string) {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: INSTALL_FLAGS,
      type: 'application/vnd.android.package-archive',
    });
    return;
  } catch {
    /* fallback */
  }
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: INSTALL_FLAGS,
      type: 'application/vnd.android.package-archive',
    });
    return;
  } catch (e) {
    await openInstallPermissionSettings();
    throw new Error(
      'Autorisez « Installer des apps inconnues » pour Hubera Fuel, puis relancez la mise à jour.'
    );
  }
}

async function probeOtaZip(uri: string): Promise<{
  exists: boolean;
  size: number | null;
  zipMagic: boolean;
  zipComplete: boolean;
  hasAndroidManifest: boolean;
}> {
  const empty = {
    exists: false,
    size: null as number | null,
    zipMagic: false,
    zipComplete: false,
    hasAndroidManifest: false,
  };
  const info = await FileSystem.getInfoAsync(uri).catch(() => ({ exists: false as const }));
  if (!info.exists || !('size' in info) || !info.size || info.size < 4) {
    return { ...empty, exists: !!info.exists, size: info.exists && 'size' in info ? info.size ?? null : null };
  }
  const size = info.size;
  const readBytes = async (position: number, length: number) => {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    return decodeBase64Bytes(b64);
  };
  try {
    const headLen = Math.min(size, 65536);
    const head = await readBytes(0, headLen);
    const zipMagic = apkZipMagicBytes(head);
    let hasAndroidManifest = bytesContainAscii(head, 'AndroidManifest.xml');
    const tailLen = Math.min(size, 65536);
    const tail =
      tailLen === size ? head : await readBytes(Math.max(0, size - tailLen), tailLen);
    if (!hasAndroidManifest) {
      hasAndroidManifest = bytesContainAscii(tail, 'AndroidManifest.xml');
    }
    return {
      exists: true,
      size,
      zipMagic,
      zipComplete: zipMagic && zipEndOfCentralDirectory(tail),
      hasAndroidManifest,
    };
  } catch {
    return { exists: true, size, zipMagic: false, zipComplete: false, hasAndroidManifest: false };
  }
}

let otaInFlight: Promise<void> | null = null;
let activeDownload: FileSystem.DownloadResumable | null = null;
let otaCancelled = false;

/** Annule un téléchargement OTA en cours pour ne plus bloquer l’app. */
export function cancelApkUpdate() {
  otaCancelled = true;
  const d = activeDownload;
  activeDownload = null;
  if (d) void d.pauseAsync().catch(() => undefined);
}

/**
 * OTA Android : cache interne (documentDirectory/ota, jamais Téléchargements).
 * Réutilise le fichier si déjà complet — un abandon du menu système ne relance pas 45 Mo.
 * Suppression seulement après que la nouvelle version tourne.
 */
export async function performSafeApkUpdate(
  info: AppVersionInfo,
  onProgress?: (p: UpdateProgress) => void
): Promise<void> {
  if (otaInFlight) {
    onProgress?.({
      phase: 'download',
      progress: 0.5,
      message: 'Mise à jour déjà en cours…',
    });
    return otaInFlight;
  }
  otaInFlight = performSafeApkUpdateInner(info, onProgress).finally(() => {
    otaInFlight = null;
  });
  return otaInFlight;
}

async function performSafeApkUpdateInner(
  info: AppVersionInfo,
  onProgress?: (p: UpdateProgress) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Mise à jour APK disponible uniquement sur Android');
  }
  otaCancelled = false;
  const apkUrl = resolveApkUrl(info);
  const remoteVc =
    info.versionCode != null && Number.isFinite(Number(info.versionCode))
      ? Number(info.versionCode)
      : 0;

  onProgress?.({
    phase: 'backup',
    progress: 0.02,
    message: 'Sauvegarde compte & données…',
  });
  const { cloudSynced } = await prepareDataForUpdate();
  await markUpdatePending(info.version, cloudSynced);
  onProgress?.({
    phase: 'backup',
    progress: 0.08,
    message: cloudSynced
      ? 'Session + cloud sauvegardés'
      : 'Session locale sauvegardée (cloud hors ligne)',
  });

  await FileSystem.makeDirectoryAsync(otaDir(), { intermediates: true }).catch(() => undefined);
  const dest = otaPathFor(info);

  const probe = await probeOtaZip(dest);
  const action: OtaCacheAction = decideOtaCache({
    exists: probe.exists,
    actualSize: probe.size,
    expectedSize: info.apkSize,
    zipMagic: probe.zipMagic,
    zipComplete: probe.zipComplete,
    hasAndroidManifest: probe.hasAndroidManifest,
    fileVersionCode: remoteVc,
    remoteVersionCode: remoteVc,
  });

  let uri = dest;
  if (action === 'reuse') {
    onProgress?.({
      phase: 'download',
      progress: 0.88,
      message: 'APK déjà téléchargée — ouverture de l’installateur…',
    });
  } else {
    let resumeData: string | undefined;
    if (action === 'discard' && probe.exists) {
      onProgress?.({
        phase: 'download',
        progress: 0.05,
        message: 'Le fichier en cache n’est pas une APK. Nouveau téléchargement.',
      });
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    } else if (action === 'resume' && probe.size && probe.size >= 100_000) {
      resumeData = String(probe.size);
      onProgress?.({
        phase: 'download',
        progress: 0.1,
        message: 'Reprise du téléchargement…',
      });
    } else {
      onProgress?.({
        phase: 'download',
        progress: 0.1,
        message: 'Téléchargement depuis le serveur…',
      });
    }

    const runDownload = (resumeFrom?: string) => {
      const download = FileSystem.createDownloadResumable(
        apkUrl,
        dest,
        {
          headers: {
            Accept: 'application/vnd.android.package-archive,*/*',
          },
        },
        (evt) => {
          if (otaCancelled) return;
          const total = evt.totalBytesExpectedToWrite || info.apkSize || 0;
          const written = evt.totalBytesWritten || 0;
          const pct = total > 0 ? written / total : 0;
          onProgress?.({
            phase: 'download',
            progress: 0.1 + pct * 0.75,
            message:
              total > 0
                ? `Téléchargement… ${Math.round(pct * 100)} %`
                : 'Téléchargement en cours…',
          });
        },
        resumeFrom
      );
      activeDownload = download;
      return download.downloadAsync();
    };

    let result = await runDownload(resumeData);
    activeDownload = null;
    if (otaCancelled) throw new Error('Mise à jour annulée.');
    if (resumeData && result?.status === 200) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
      onProgress?.({
        phase: 'download',
        progress: 0.1,
        message: 'Le serveur n’a pas repris le fichier. Téléchargement complet.',
      });
      result = await runDownload(undefined);
      activeDownload = null;
      if (otaCancelled) throw new Error('Mise à jour annulée.');
    }
    if (!result?.uri || (result.status !== 200 && result.status !== 206)) {
      throw new Error(
        result ? `Échec du téléchargement OTA (HTTP ${result.status})` : 'Échec du téléchargement OTA'
      );
    }
    uri = result.uri;
  }

  const checked = await probeOtaZip(uri);
  const ready = decideOtaCache({
    exists: checked.exists,
    actualSize: checked.size,
    expectedSize: info.apkSize,
    zipMagic: checked.zipMagic,
    zipComplete: checked.zipComplete,
    hasAndroidManifest: checked.hasAndroidManifest,
    fileVersionCode: remoteVc,
    remoteVersionCode: remoteVc,
  });
  if (ready !== 'reuse') {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    throw new Error(
      checked.zipMagic
        ? 'APK téléchargée invalide ou incomplète. Réessayez.'
        : 'Fichier téléchargé n’est pas une APK (réseau / cache).'
    );
  }

  onProgress?.({
    phase: 'install',
    progress: 0.92,
    message: 'Ouverture de l’installateur Android…',
  });

  try {
    await launchApkInstaller(uri);
  } catch (e) {
    throw new Error(
      (e instanceof Error ? e.message : 'Installation impossible') +
        ' Le fichier reste en cache interne : « Réessayer » n’aura pas à tout retélécharger. Si Android refuse le package : version trop ancienne ou installation annulée.'
    );
  }

  onProgress?.({
    phase: 'done',
    progress: 1,
    message: 'Validez l’installation. En cas d’annulation, réessayez sans nouveau téléchargement.',
  });
}

/** Supprime les APK OTA internes une fois l’app à jour (pas le dossier Téléchargements). */
export async function cleanupOtaApkIfUpdated(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const localVc = getLocalVersionCode();
  const dir = otaDir();
  try {
    const entries = await FileSystem.readDirectoryAsync(dir);
    for (const name of entries) {
      const m = /vc(\d+)\.apk$/i.exec(name);
      const cachedVc = m ? Number(m[1]) : 0;
      if (shouldDeleteOtaAfterInstall(localVc, cachedVc) || !m) {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => undefined);
      }
    }
  } catch {
    /* pas de dossier ota */
  }
}

/** Page d’install indépendante (APK dans Chrome). Android aussi — fallback si l’installateur in-app bloque. */
export async function openExternalDownload(info: AppVersionInfo) {
  const url =
    Platform.OS === 'ios'
      ? info.iosInstallUrl || info.downloadPage || info.installPage || 'https://fuel.hubera.cloud/install'
      : info.installPage || 'https://fuel.hubera.cloud/install';
  if (url) await Linking.openURL(url);
}

/**
 * Mise à jour web réelle : désinscrit le SW, vide les caches, force un reload
 * (sinon `location.reload()` recharge souvent le même shell en cache).
 */
export async function performWebHardReload(targetVersion?: string): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }

  const url = new URL(window.location.href);
  // Strip ancien bust pour éviter d’empiler ; force un nouveau fetch du shell
  url.searchParams.delete('_gt');
  url.searchParams.set('_gt', targetVersion || String(Date.now()));
  url.searchParams.set('_cb', String(Date.now()));
  window.location.replace(url.toString());
}

/** True si on a déjà tenté un hard-reload vers cette version (anti-boucle). */
export function webReloadAlreadyTried(targetVersion: string): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const gt = new URL(window.location.href).searchParams.get('_gt');
    return gt === targetVersion;
  } catch {
    return false;
  }
}

/** Ouvre les réglages d’autorisation d’installation (Android). */
export async function openAndroidInstallSettings() {
  if (Platform.OS === 'android') await openInstallPermissionSettings();
}
