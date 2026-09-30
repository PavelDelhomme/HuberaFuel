import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  compareVersions,
  fetchAppVersion,
  getLocalAppVersion,
  getLocalVersionCode,
  type AppVersionInfo,
} from '@/lib/api';
import { followsProductionOta } from '@/lib/appFlavor';
import { openExternalDownload, performSafeApkUpdate, performWebHardReload, webReloadAlreadyTried, cleanupOtaApkIfUpdated, cancelApkUpdate, type UpdateProgress } from '@/lib/appUpdate';
import { isMapsSilentHop } from '@/lib/mapsSilent';

const SNOOZE_KEY = 'gasoil_update_snooze_v1';
/** Soft prompt : reporter longtemps (répétable). */
const SNOOZE_MS = 6 * 60 * 60 * 1000; // 6 h
/** Force update : reporter plusieurs fois sans bloquer (trajet, sync…). */
const FORCE_SNOOZE_MS = 4 * 60 * 60 * 1000; // 4 h
/** Web : si le bundle n’a pas bougé après hard-reload, ne pas rebloquer tout de suite. */
const WEB_DEPLOY_SNOOZE_MS = 60 * 60 * 1000; // 1 h

type Snooze = { version: string; until: number };

type AppUpdateContextType = {
  info: AppVersionInfo | null;
  visible: boolean;
  force: boolean;
  busy: boolean;
  progress: UpdateProgress | null;
  error: string | null;
  updateAvailable: boolean;
  checkNow: (opts?: { ignoreSnooze?: boolean }) => Promise<boolean>;
  startUpdate: () => Promise<void>;
  snoozeLater: () => Promise<void>;
  dismiss: () => void;
  openManualInstall: () => Promise<void>;
};

const AppUpdateContext = createContext<AppUpdateContextType | null>(null);

async function readSnooze(): Promise<Snooze | null> {
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Snooze) : null;
  } catch {
    return null;
  }
}

async function writeSnooze(s: Snooze | null) {
  if (!s) await AsyncStorage.removeItem(SNOOZE_KEY);
  else await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<AppVersionInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const evaluate = useCallback(async (remote: AppVersionInfo, ignoreSnooze = false) => {
    const local = getLocalAppVersion();
    const localVc = getLocalVersionCode();
    const remoteVc =
      remote.versionCode != null && Number.isFinite(Number(remote.versionCode))
        ? Number(remote.versionCode)
        : null;
    // Priorité versionCode (évite faux « à jour » ou OTA avec semver égal mais code Android bas).
    const newerByCode = remoteVc != null && localVc > 0 && remoteVc > localVc;
    const newerBySemver = compareVersions(remote.version, local) > 0;
    const newer = newerByCode || (remoteVc == null && newerBySemver);
    setUpdateAvailable(newer);
    if (!newer) {
      setVisible(false);
      setForce(false);
      await writeSnooze(null);
      return false;
    }

    // Web : forceUpdate API = canal Android. Bloquant web seulement si sous minVersion.
    // Sinon soft prompt (snooze OK) — évite la boucle quand le bundle Docker n’est pas rebuild.
    const belowMin = compareVersions(local, remote.minVersion) < 0;
    const must =
      Platform.OS === 'web'
        ? belowMin
        : remote.forceUpdate || belowMin;

    // Anti-boucle : déjà rechargé vers cette version mais shell toujours ancien
    if (
      Platform.OS === 'web' &&
      webReloadAlreadyTried(remote.version) &&
      newer
    ) {
      if (!ignoreSnooze) {
        const snooze = await readSnooze();
        if (snooze && snooze.version === remote.version && snooze.until > Date.now()) {
          setForce(false);
          setVisible(false);
          return false;
        }
      }
      // Auto-snooze + masquer : sinon la modale se rouvre en boucle après hard-reload.
      await writeSnooze({
        version: remote.version,
        until: Date.now() + WEB_DEPLOY_SNOOZE_MS,
      });
      setForce(false);
      setVisible(false);
      setError(
        `La version web ${remote.version} n’est pas encore en ligne. Réessayez un peu plus tard.`
      );
      return false;
    }

    setForce(must);
    if (must) {
      // Même en force : respect du snooze court (finir un trajet, etc.)
      if (!ignoreSnooze) {
        const snooze = await readSnooze();
        if (snooze && snooze.version === remote.version && snooze.until > Date.now()) {
          setVisible(false);
          return false;
        }
      }
      setVisible(true);
      return true;
    }
    if (!ignoreSnooze) {
      const snooze = await readSnooze();
      if (snooze && snooze.version === remote.version && snooze.until > Date.now()) {
        setVisible(false);
        return false;
      }
    }
    setVisible(true);
    return true;
  }, []);

  const checkNow = useCallback(
    async (opts?: { ignoreSnooze?: boolean }) => {
      try {
        if (isMapsSilentHop() && opts?.ignoreSnooze !== true) {
          setVisible(false);
          return false;
        }
        void cleanupOtaApkIfUpdated();
        // Variantes qa/admin/dev/preprod/feat : packages distincts — ne pas forcer
        // l’APK prod utilisateurs (mauvais applicationId).
        if (!followsProductionOta() && opts?.ignoreSnooze !== true) {
          const remote = await fetchAppVersion().catch(() => null);
          if (remote) setInfo(remote);
          setUpdateAvailable(false);
          setVisible(false);
          setForce(false);
          return false;
        }
        const remote = await fetchAppVersion();
        setInfo(remote);
        return evaluate(remote, opts?.ignoreSnooze === true);
      } catch {
        return false;
      }
    },
    [evaluate]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      void checkNow();
    }, 4000);
    return () => clearTimeout(t);
  }, [checkNow]);

  useEffect(() => {
    const launchedAt = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (isMapsSilentHop()) return;
        if (Date.now() - launchedAt < 20000) return;
        void checkNow();
      }
    });
    return () => sub.remove();
  }, [checkNow]);

  const startUpdate = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const remote = (await fetchAppVersion().catch(() => null)) || info;
      if (!remote) {
        setError('Impossible de joindre le serveur de mise à jour.');
        return;
      }
      setInfo(remote);
      await writeSnooze(null);
      const local = getLocalAppVersion();
      const localVc = getLocalVersionCode();
      const remoteVc =
        remote.versionCode != null && Number.isFinite(Number(remote.versionCode))
          ? Number(remote.versionCode)
          : null;
      const newer =
        (remoteVc != null && localVc > 0 && remoteVc > localVc) ||
        (remoteVc == null && compareVersions(remote.version, local) > 0);
      if (!newer) {
        setUpdateAvailable(false);
        setVisible(false);
        setProgress({
          phase: 'done',
          progress: 1,
          message: `Déjà à jour (v${local}).`,
        });
        return;
      }
      setUpdateAvailable(true);
      setVisible(true);
      if (Platform.OS === 'android') {
        await performSafeApkUpdate(remote, setProgress);
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (webReloadAlreadyTried(remote.version)) {
          setError(
            `Le bundle web est encore en v${local}. Rebuild Docker « web » requis côté serveur — snooze 30 min.`
          );
          await writeSnooze({
            version: remote.version,
            until: Date.now() + WEB_DEPLOY_SNOOZE_MS,
          });
          setForce(false);
          setVisible(false);
          return;
        }
        setProgress({
          phase: 'download',
          progress: 0.6,
          message: 'Vidage cache & rechargement…',
        });
        await performWebHardReload(remote.version);
      } else {
        await openExternalDownload(remote);
        setVisible(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setProgress({ phase: 'error', progress: 0, message: msg });
    } finally {
      setBusy(false);
    }
  }, [info]);

  const snoozeLater = useCallback(async () => {
    cancelApkUpdate();
    setBusy(false);
    setProgress(null);
    const version = info?.version || getLocalAppVersion();
    const ms = force ? FORCE_SNOOZE_MS : SNOOZE_MS;
    await writeSnooze({ version, until: Date.now() + ms });
    setVisible(false);
  }, [force, info?.version]);

  const dismiss = useCallback(() => {
    void snoozeLater();
  }, [snoozeLater]);

  const openManualInstall = useCallback(async () => {
    cancelApkUpdate();
    setBusy(false);
    const remote = info || (await fetchAppVersion().catch(() => null));
    if (remote) {
      setInfo(remote);
      try {
        await openExternalDownload(remote);
        setVisible(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [info]);

  const value = useMemo(
    () => ({
      info,
      visible,
      force,
      busy,
      progress,
      error,
      updateAvailable,
      checkNow,
      startUpdate,
      snoozeLater,
      dismiss,
      openManualInstall,
    }),
    [
      info,
      visible,
      force,
      busy,
      progress,
      error,
      updateAvailable,
      checkNow,
      startUpdate,
      snoozeLater,
      dismiss,
      openManualInstall,
    ]
  );

  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const ctx = useContext(AppUpdateContext);
  if (!ctx) throw new Error('useAppUpdate must be used within AppUpdateProvider');
  return ctx;
}
