import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import type { AppVersionInfo } from '@/lib/api';
import { getApiUrl, getLocalVersionCode } from '@/lib/api';
import { markUpdatePending, prepareDataForUpdate } from '@/lib/backup';
import {
  isOtaFileComplete,
  otaApkFileName,
  shouldDeleteOtaAfterInstall,
  shouldReuseOtaFile,
} from '@/lib/otaApk';

export type UpdateProgress = {
  phase: 'backup' | 'permission' | 'download' | 'install' | 'done' | 'error';
  progress: number;
  message: string;
};

const PKG = Constants.expoConfig?.android?.package || 'com.gasoiltracking.app';
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

  const existing = await FileSystem.getInfoAsync(dest).catch(() => ({ exists: false as const }));
  const reuse = shouldReuseOtaFile({
    exists: !!existing.exists,
    actualSize: existing.exists ? existing.size : null,
    expectedSize: info.apkSize,
    fileVersionCode: remoteVc,
    remoteVersionCode: remoteVc,
  });

  let uri = dest;
  if (reuse) {
    onProgress?.({
      phase: 'download',
      progress: 0.88,
      message: 'APK déjà téléchargée — ouverture de l’installateur…',
    });
  } else {
    if (existing.exists) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    }
    onProgress?.({
      phase: 'download',
      progress: 0.1,
      message: 'Téléchargement depuis le serveur…',
    });

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
      }
    );
    activeDownload = download;

    const result = await download.downloadAsync();
    activeDownload = null;
    if (otaCancelled) {
      throw new Error('Mise à jour annulée.');
    }
    if (!result?.uri) {
      throw new Error('Échec du téléchargement OTA');
    }
    uri = result.uri;
  }

  const infoFile = await FileSystem.getInfoAsync(uri);
  if (!isOtaFileComplete(infoFile.exists ? infoFile.size : null, info.apkSize)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    throw new Error('APK téléchargée invalide ou incomplète. Réessayez.');
  }

  try {
    const head = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64' as FileSystem.EncodingType,
      length: 4,
      position: 0,
    });
    if (!head.startsWith('UEs')) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      throw new Error('Fichier téléchargé n’est pas un APK (réseau / cache).');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('APK')) throw e;
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
