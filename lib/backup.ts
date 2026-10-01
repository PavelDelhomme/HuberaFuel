import { getToken, isPayloadTooLargeError, pushSync, fetchSync } from '@/lib/api';
import {
  applySnapshot,
  collectSnapshot,
  hasLocalUserData,
  normalizeSnapshot,
  type AppDataSnapshot,
} from '@/lib/dataSnapshot';
import { repairFillUpVehiclesAndBudgets } from '@/lib/repairFillUpVehicles';
import { prepareSnapshotForPush, slimSnapshotAggressive, snapshotContentHash } from '@/lib/syncPayload';
import { getActiveTripLite, stopActiveTrips } from '@/lib/database';
import { finalizeStaleActiveTrip } from '@/lib/finalizeStaleTrip';
import { decideSyncAction } from '@/lib/syncDecision';
import { mergeUniqueFillUps } from '@/lib/fillUpMerge';
import { isBackgroundTrackingLive, stopBackgroundTracking } from '@/lib/locationService';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ne tue un trajet actif que s’il est vraiment zombie (tiny + vieux, ou > 90 min).
 * Un suivi tout juste démarré (0 km) ou en pause doit rester actif + FGS.
 * @returns true si un trajet live bloque encore la sync
 */
async function resolveActiveTripForSync(opts?: {
  /** Pull explicite : ne jamais tuer un trajet récent */
  neverKillRecent?: boolean;
}): Promise<boolean> {
  let trackingLive = false;
  try {
    trackingLive = await isBackgroundTrackingLive();
  } catch {
    trackingLive = false;
  }
  await finalizeStaleActiveTrip({ trackingLive });
  let live = await getActiveTripLite();
  if (!live?.isActive) return false;

  const startMs = Date.parse(live.startTime || '');
  const ageMs = Number.isFinite(startMs) ? Date.now() - startMs : 0;
  const tiny = (live.distanceKm || 0) < 0.5;
  const staleTiny = tiny && ageMs > 45 * 60 * 1000;
  const oldGhost = ageMs > 90 * 60 * 1000;

  if (trackingLive && tiny && !oldGhost) {
    return true;
  }

  if (!opts?.neverKillRecent && (staleTiny || oldGhost)) {
    await stopActiveTrips();
    try {
      await stopBackgroundTracking();
    } catch {
      /* web / non dispo */
    }
    live = await getActiveTripLite();
    return !!live?.isActive;
  }

  return true;
}

const BACKUP_KEY = 'gasoil_local_backup_v1';
const PENDING_UPDATE_KEY = 'gasoil_pending_update_v1';
const SYNC_META_KEY = 'gasoil_sync_meta_v1';

type SyncMeta = {
  lastPushedAt: number;
  lastPulledServerAt: number;
  lastRemoteHash: string;
};

async function readSyncMeta(): Promise<SyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_META_KEY);
    if (!raw) return { lastPushedAt: 0, lastPulledServerAt: 0, lastRemoteHash: '' };
    const p = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      lastPushedAt: Number(p.lastPushedAt) || 0,
      lastPulledServerAt: Number(p.lastPulledServerAt) || 0,
      lastRemoteHash: typeof p.lastRemoteHash === 'string' ? p.lastRemoteHash : '',
    };
  } catch {
    return { lastPushedAt: 0, lastPulledServerAt: 0, lastRemoteHash: '' };
  }
}

async function writeSyncMeta(patch: Partial<SyncMeta>): Promise<void> {
  const cur = await readSyncMeta();
  await AsyncStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...cur, ...patch }));
}

export type PendingUpdateMeta = {
  targetVersion: string;
  savedAt: string;
  cloudSynced: boolean;
};

/** Sauvegarde locale AsyncStorage (survit à une MAJ APK ; filet si wipe). */
export async function saveLocalBackup(snapshot?: AppDataSnapshot): Promise<AppDataSnapshot> {
  const snap = snapshot || (await collectSnapshot());
  await AsyncStorage.setItem(BACKUP_KEY, JSON.stringify(snap));
  return snap;
}

export async function loadLocalBackup(): Promise<AppDataSnapshot | null> {
  const raw = await AsyncStorage.getItem(BACKUP_KEY);
  if (!raw) return null;
  try {
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Avant install : backup local + push cloud si compte connecté. */
export async function prepareDataForUpdate(): Promise<{
  snapshot: AppDataSnapshot;
  cloudSynced: boolean;
}> {
  try {
    const blocked = await resolveActiveTripForSync();
    if (blocked) {
      throw new Error(
        'Terminez le trajet en cours avant la mise à jour (ou reportez la MAJ).'
      );
    }
  } catch (e) {
    if (e instanceof Error && /Terminez le trajet/.test(e.message)) throw e;
  }
  const snapshot = await saveLocalBackup();
  let cloudSynced = false;
  const token = await getToken();
  if (token) {
    try {
      await pushSyncSafe(snapshot);
      cloudSynced = true;
    } catch {
      cloudSynced = false;
    }
  }
  return { snapshot, cloudSynced };
}

export async function markUpdatePending(targetVersion: string, cloudSynced: boolean) {
  const meta: PendingUpdateMeta = {
    targetVersion,
    savedAt: new Date().toISOString(),
    cloudSynced,
  };
  await AsyncStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify(meta));
}

export async function clearUpdatePending() {
  await AsyncStorage.removeItem(PENDING_UPDATE_KEY);
}

export async function getUpdatePending(): Promise<PendingUpdateMeta | null> {
  const raw = await AsyncStorage.getItem(PENDING_UPDATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingUpdateMeta;
  } catch {
    return null;
  }
}

/**
 * Après démarrage / MAJ : si la base est vide, restaure backup local puis cloud.
 * Si la base est intacte (cas normal d’une MAJ APK), ne touche à rien.
 */
export async function recoverDataAfterUpdateIfNeeded(): Promise<'ok' | 'restored-local' | 'restored-cloud' | 'empty'> {
  const pending = await getUpdatePending();
  const hasData = await hasLocalUserData();

  if (hasData) {
    if (pending) await clearUpdatePending();
    // Compte connecté : privilégier le cloud s’il est plus récent (évite d’écraser une correction serveur)
    const token = await getToken();
    if (token) {
      try {
        await syncPreferNewer();
      } catch {
        /* offline */
      }
    }
    return 'ok';
  }

  const local = await loadLocalBackup();
  if (local) {
    await applySnapshot(local, 'replace');
    if (pending) await clearUpdatePending();
    return 'restored-local';
  }

  const token = await getToken();
  if (token) {
    try {
      const remote = await fetchSync();
      const snap = normalizeSnapshot(remote?.data);
      if (snap) {
        await applySnapshot(snap, 'replace');
        await saveLocalBackup(snap);
        if (pending) await clearUpdatePending();
        return 'restored-cloud';
      }
    } catch {
      /* offline */
    }
  }

  if (pending) await clearUpdatePending();
  return 'empty';
}

/** Pousse le snapshot en compactant les tracés GPS (évite HTTP 413). */
async function pushSyncSafe(snapshot: AppDataSnapshot): Promise<void> {
  const prepared = prepareSnapshotForPush(snapshot);
  try {
    await pushSync(prepared);
  } catch (e) {
    if (!isPayloadTooLargeError(e)) throw e;
    await pushSync(slimSnapshotAggressive(prepared));
  }
  await writeSyncMeta({
    lastPushedAt: Date.now(),
    lastRemoteHash: snapshotContentHash(snapshot),
  });
}

/** Sync cloud complète (tous les objets) + backup local. */
export async function syncFullBackup(): Promise<boolean> {
  const token = await getToken();
  const snap = await saveLocalBackup();
  if (!token) return false;
  await pushSyncSafe(snap);
  return true;
}

/**
 * Tire les données cloud du compte connecté et remplace le local.
 * Utile après une correction côté serveur / autre appareil.
 */
export async function refreshFromCloud(): Promise<{
  ok: boolean;
  reason: 'no-auth' | 'empty' | 'applied' | 'active-trip';
  updatedAt?: string | null;
}> {
  const token = await getToken();
  if (!token) return { ok: false, reason: 'no-auth' };
  try {
    const blocked = await resolveActiveTripForSync({ neverKillRecent: true });
    if (blocked) return { ok: false, reason: 'active-trip' };
  } catch {
    /* continue */
  }
  const remote = await fetchSync();
  const snap = normalizeSnapshot(remote?.data);
  if (!snap) return { ok: false, reason: 'empty', updatedAt: remote?.updatedAt ?? null };
  try {
    const local = await collectSnapshot();
    const mergedFills = mergeUniqueFillUps(local.fillUps || [], snap.fillUps || []);
    if (mergedFills.added > 0) snap.fillUps = mergedFills.fills;
  } catch {
    /* local illisible */
  }
  await applySnapshot(snap, 'replace');
  await saveLocalBackup(snap);
  const serverAt = remote?.updatedAt ? Date.parse(remote.updatedAt) || Date.now() : Date.now();
  await writeSyncMeta({
    lastPulledServerAt: serverAt,
    lastRemoteHash: snapshotContentHash(snap),
    // Pull explicite : cloud = source — évite un re-push immédiat de l’ancien local.
    lastPushedAt: serverAt,
  });
  return { ok: true, reason: 'applied', updatedAt: remote?.updatedAt ?? null };
}

function snapshotWeight(snap: {
  vehicles: unknown[];
  fillUps: unknown[];
  trips: unknown[];
  places: unknown[];
  budgets: unknown[];
  recurringRoutes: unknown[];
} | null): number {
  if (!snap) return 0;
  return (
    snap.vehicles.length * 10 +
    snap.fillUps.length * 5 +
    snap.trips.length * 2 +
    snap.places.length * 3 +
    snap.budgets.length +
    snap.recurringRoutes.length * 4
  );
}

/**
 * Activité métier (trajets / pleins) — ignore `exportedAt` (souvent tamponné à now
 * par collectSnapshot → fausse « nouveauté » locale).
 */
function snapshotActivityAt(snap: {
  exportedAt?: string;
  trips?: { startTime?: string; endTime?: string | null }[];
  fillUps?: { date?: string }[];
  vehicles?: { estimatedFuelLiters?: number | null; currentOdometer?: number | null; trackedKm?: number | null }[];
} | null): number {
  if (!snap) return 0;
  let max = 0;
  for (const t of snap.trips || []) {
    const a = Date.parse(t.endTime || t.startTime || '') || 0;
    if (a > max) max = a;
  }
  for (const f of snap.fillUps || []) {
    const a = Date.parse(f.date || '') || 0;
    if (a > max) max = a;
  }
  return max;
}

/** Somme des km de trajets confirmés — signal fort que le local a « vécu » plus que le cloud. */
function snapshotTripKm(snap: { trips?: { distanceKm?: number; isActive?: boolean; status?: string }[] } | null): number {
  if (!snap?.trips) return 0;
  return snap.trips
    .filter((t) => !t.isActive && t.status !== 'rejected')
    .reduce((acc, t) => acc + (Number(t.distanceKm) || 0), 0);
}

/**
 * Avant un push : si le cloud a été corrigé après notre dernier push
 * (jauge / conso / compteur), on reprend ces champs pour ne pas les écraser
 * avec l’ancien local téléphone (cas Nothing → 8,3 L qui tuait 12,5 L cloud).
 */
function mergeVehicleCorrectionsFromCloud(
  local: AppDataSnapshot,
  remote: AppDataSnapshot | null | undefined
): number {
  if (!remote?.vehicles?.length || !local.vehicles?.length) return 0;
  let n = 0;
  for (const lv of local.vehicles) {
    const rv = remote.vehicles.find((v) => v.id === lv.id);
    if (!rv) continue;
    let touched = false;
    if (
      rv.estimatedFuelLiters != null &&
      (lv.estimatedFuelLiters == null ||
        Math.abs((lv.estimatedFuelLiters ?? 0) - rv.estimatedFuelLiters) > 0.05)
    ) {
      // Ne pas écraser une jauge locale crédible par un cloud « vide » (0 L) :
      // cas QA / téléphone qui vient de régler ½, cloud encore à 0 après ajout véhicule.
      const cloudEmpty = rv.estimatedFuelLiters < 0.2;
      const localHasFuel = (lv.estimatedFuelLiters ?? 0) > 1;
      if (!(cloudEmpty && localHasFuel)) {
        lv.estimatedFuelLiters = rv.estimatedFuelLiters;
        touched = true;
      }
    }
    if (
      Number.isFinite(rv.consumptionPer100) &&
      rv.consumptionPer100 > 0 &&
      Math.abs((lv.consumptionPer100 || 0) - rv.consumptionPer100) > 0.05
    ) {
      lv.consumptionPer100 = rv.consumptionPer100;
      if (rv.consumptionLearnFactor != null) {
        lv.consumptionLearnFactor = rv.consumptionLearnFactor;
      }
      touched = true;
    }
    if (
      Number.isFinite(rv.currentOdometer) &&
      Number.isFinite(lv.currentOdometer)
    ) {
      const best = Math.max(rv.currentOdometer || 0, lv.currentOdometer || 0);
      if (Math.abs((lv.currentOdometer || 0) - best) > 0.5) {
        lv.currentOdometer = best;
        touched = true;
      }
    } else if (
      Number.isFinite(rv.currentOdometer) &&
      rv.currentOdometer > (lv.currentOdometer || 0) + 0.5
    ) {
      lv.currentOdometer = rv.currentOdometer;
      touched = true;
    }
    if (touched) n += 1;
  }
  return n;
}

/**
 * Avant un pull : ne pas perdre une jauge locale connue si le cloud est encore
 * null/vide (réglage téléphone non poussé, ou force-stop avant fin de sync).
 */
function preserveLocalFuelOnPull(local: AppDataSnapshot, remote: AppDataSnapshot): number {
  if (!remote.vehicles?.length || !local.vehicles?.length) return 0;
  let n = 0;
  for (const rv of remote.vehicles) {
    const lv = local.vehicles.find((v) => v.id === rv.id);
    if (!lv) continue;
    const localL = lv.estimatedFuelLiters;
    const remoteL = rv.estimatedFuelLiters;
    if (localL == null || !Number.isFinite(localL)) continue;
    if (remoteL == null || remoteL < 0.2) {
      if (localL >= 0.2 || remoteL == null) {
        rv.estimatedFuelLiters = localL;
        n += 1;
      }
    }
  }
  return n;
}

/**
 * Si le cloud est plus récent, tire ; sinon pousse.
 * Ne tire jamais un cloud « pauvre » (ex. 1 véhicule fantôme) par-dessus un local riche.
 * Privilégie le téléphone s’il a plus d’activité trajet / km (source de vérité terrain).
 *
 * Retours :
 * - up-to-date : hash local ≡ remote (rien à faire)
 * - blocked-trip : vrai trajet actif récent (ne pas sync)
 * - skipped : pas de session / rien à sync
 */
export type SyncPreferResult =
  | 'pulled'
  | 'pushed'
  | 'up-to-date'
  | 'blocked-trip'
  | 'skipped';

export async function syncPreferNewer(): Promise<SyncPreferResult> {
  const token = await getToken();
  if (!token) return 'skipped';
  try {
    const blocked = await resolveActiveTripForSync();
    if (blocked) return 'blocked-trip';
  } catch {
    /* continue */
  }
  try {
    await repairFillUpVehiclesAndBudgets();
  } catch {
    /* ignore */
  }
  const remote = await fetchSync();
  const remoteSnap = normalizeSnapshot(remote?.data);
  const local = await collectSnapshot();
  const localHash = snapshotContentHash(local);
  const remoteHash = snapshotContentHash(remoteSnap);
  const meta = await readSyncMeta();
  const remoteServerAt = remote?.updatedAt ? Date.parse(remote.updatedAt) || 0 : 0;

  // Identiques (hors exportedAt / tracés GPS) → pas de push cosmétique.
  if (remoteSnap && localHash && localHash === remoteHash) {
    await writeSyncMeta({
      lastRemoteHash: remoteHash,
      lastPulledServerAt: Math.max(meta.lastPulledServerAt, remoteServerAt),
    });
    return 'up-to-date';
  }

  const remoteW = snapshotWeight(remoteSnap);
  const action = decideSyncAction({
    localHash,
    remoteHash,
    remoteServerAt,
    lastPushedAt: meta.lastPushedAt,
    lastPulledServerAt: meta.lastPulledServerAt,
    localW: (local.vehicles?.length || 0) === 0 ? 0 : snapshotWeight(local),
    remoteW: remoteSnap && (remoteSnap.vehicles?.length || 0) > 0 ? remoteW : 0,
    localKm: snapshotTripKm(local),
    remoteKm: snapshotTripKm(remoteSnap),
    localTripCount: local.trips?.length || 0,
    remoteTripCount: remoteSnap?.trips?.length || 0,
    localActivityAt: snapshotActivityAt(local),
    remoteActivityAt: snapshotActivityAt(remoteSnap),
  });

  if (action === 'skip' || !remoteSnap) {
    if (action === 'skip') return 'up-to-date';
    // Pas de remote → pousser si on a du local
    if ((local.vehicles?.length || 0) > 0) {
      await pushSyncSafe(local);
      await saveLocalBackup(local);
      return 'pushed';
    }
    return 'skipped';
  }

  if (action === 'pull') {
    preserveLocalFuelOnPull(local, remoteSnap);
    const mergedFills = mergeUniqueFillUps(local.fillUps || [], remoteSnap.fillUps || []);
    if (mergedFills.added > 0) {
      remoteSnap.fillUps = mergedFills.fills;
    }
    await applySnapshot(remoteSnap, 'replace');
    try {
      await repairFillUpVehiclesAndBudgets();
    } catch {
      /* ignore */
    }
    await saveLocalBackup(await collectSnapshot());
    await writeSyncMeta({
      lastPulledServerAt: remoteServerAt || Date.now(),
      lastRemoteHash: remoteHash,
      lastPushedAt: remoteServerAt || Date.now(),
    });
    if (mergedFills.added > 0) {
      await pushSyncSafe(await collectSnapshot());
    }
    return 'pulled';
  }

  // Push : fusionner jauge/conso/compteur cloud si correction serveur récente
  if (remoteServerAt > meta.lastPushedAt + 1500) {
    mergeVehicleCorrectionsFromCloud(local, remoteSnap);
  }
  await pushSyncSafe(local);
  await saveLocalBackup(local);
  return 'pushed';
}

/** Pousse le local vers le cloud sans jamais tirer (Nothing / appareil source de vérité). */
export async function forcePushLocalToCloud(): Promise<{ ok: boolean; reason: string }> {
  const token = await getToken();
  if (!token) return { ok: false, reason: 'no-auth' };
  try {
    const blocked = await resolveActiveTripForSync();
    if (blocked) return { ok: false, reason: 'active-trip' };
  } catch {
    /* continue */
  }
  try {
    await repairFillUpVehiclesAndBudgets();
  } catch {
    /* ignore */
  }
  const local = await collectSnapshot();
  // Garde-fou : ne jamais écraser un cloud riche avec un local vide/pauvre
  try {
    const remote = await fetchSync();
    const remoteSnap = normalizeSnapshot(remote?.data);
    const localW = snapshotWeight(local);
    const remoteW = snapshotWeight(remoteSnap);
    const localEmptyish = localW < 5 || (local.vehicles?.length || 0) === 0;
    const remoteHasData = !!remoteSnap && remoteW >= 5 && (remoteSnap.vehicles?.length || 0) > 0;
    if (localEmptyish && remoteHasData) {
      return { ok: false, reason: 'local-empty' };
    }
    if (remoteSnap && remoteW > localW + 15 && (remoteSnap.trips?.length || 0) > (local.trips?.length || 0) + 3) {
      return { ok: false, reason: 'cloud-richer' };
    }
  } catch {
    /* offline : on pousse quand même si on a du local */
  }
  local.exportedAt = new Date().toISOString();
  await pushSyncSafe(local);
  await saveLocalBackup(local);
  return { ok: true, reason: 'pushed' };
}
