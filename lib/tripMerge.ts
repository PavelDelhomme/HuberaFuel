/**
 * Pull cloud (`replaceAllData`) : conserve les trajets terminés localement qui ne sont
 * pas encore dans le snapshot distant (jamais poussés — hors-ligne, app quittée, sync
 * bloquée par un trajet actif…). Sans ça, un seul trajet < 40 km était effacé dès que
 * le cloud avait bougé depuis le dernier push.
 */

export type TripLike = {
  id: number;
  vehicleId: number;
  startTime: string;
  endTime?: string | null;
  isActive?: boolean;
  fillUpId?: number | null;
};

/** `datetime('now')` SQLite = UTC sans suffixe → on force Z pour éviter un décalage local. */
export function parseTripTimeMs(raw?: string | null): number {
  if (!raw) return 0;
  const s = String(raw).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function tripFingerprint(t: { vehicleId?: number | null; startTime?: string | null }): string {
  const sec = Math.round(parseTripTimeMs(t.startTime) / 1000);
  return `${Number(t.vehicleId) || 0}|${sec}`;
}

export function mergeUnsyncedLocalTrips<T extends TripLike>(
  local: T[] | null | undefined,
  remote: T[] | null | undefined,
  opts: {
    /** Dernier push / pull réussi (ms). Seuls les trajets plus récents sont « non synchronisés ». */
    sinceMs: number;
    /** Véhicules présents dans le snapshot distant (pas d’orphelin). */
    remoteVehicleIds: Set<number>;
  }
): { trips: T[]; added: number } {
  const remoteList = Array.isArray(remote) ? remote.slice() : [];
  const seen = new Set(remoteList.map((t) => tripFingerprint(t)));
  let maxId = remoteList.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
  // Marge d’horloge : un trajet fini juste avant le dernier push reste candidat (dédoublonné par empreinte).
  const floor = Math.max(0, opts.sinceMs - 10 * 60 * 1000);
  const extra: T[] = [];
  for (const t of local || []) {
    if (!t || t.isActive) continue;
    if (!opts.remoteVehicleIds.has(Number(t.vehicleId))) continue;
    const fp = tripFingerprint(t);
    if (seen.has(fp)) continue;
    const at = Math.max(parseTripTimeMs(t.endTime), parseTripTimeMs(t.startTime));
    if (at < floor) continue;
    seen.add(fp);
    maxId += 1;
    // Les ids de pleins peuvent être renumérotés par la fusion → on coupe le lien plutôt que de mentir.
    extra.push({ ...t, id: maxId, fillUpId: null });
  }
  return { trips: extra.length ? remoteList.concat(extra) : remoteList, added: extra.length };
}
