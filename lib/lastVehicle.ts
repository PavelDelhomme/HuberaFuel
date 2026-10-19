/**
 * Dernier véhicule choisi.
 * Fuel écrit `gasoil_last_vehicle_id`. Maps mémorise le même id sous
 * `hubera-maps-fuel-veh`. On lit la clé Fuel d'abord, puis la clé Maps.
 */
export const LAST_VEHICLE_STORAGE_KEY = 'gasoil_last_vehicle_id';
export const MAPS_FUEL_VEHICLE_KEY = 'hubera-maps-fuel-veh';

export function parseStoredVehicleId(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const id = Number(String(raw).trim());
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}

/** Id mémorisé s'il est dans la liste. Sinon null : l'appelant retombe sur la liste. */
export function preferStoredVehicleId(
  raw: string | null | undefined,
  vehicleIds: readonly number[]
): number | null {
  const id = parseStoredVehicleId(raw);
  if (id == null) return null;
  return vehicleIds.includes(id) ? id : null;
}

/** Clé Fuel d'abord, clé partagée Maps ensuite. */
export function firstStoredVehicleRaw(
  primary: string | null | undefined,
  mapsShared: string | null | undefined
): string | null {
  if (parseStoredVehicleId(primary) != null) return String(primary).trim();
  if (parseStoredVehicleId(mapsShared) != null) return String(mapsShared).trim();
  return null;
}

/**
 * Choisit l'id actif.
 * Un id mémorisé (Fuel ou Maps) ne réécrit jamais la voiture déjà active en base.
 * Sinon l'autre 206, encore en mémoire, reprend les trajets et la jauge.
 * Un choix explicite dans le garage passe par setActiveVehicle, qui aligne
 * la base et la mémoire : les deux ids coïncident, le choix est conservé.
 * lastTripAtByVehicle reste dans la signature pour les appelants ; il ne départage plus.
 */
export function resolveActiveVehicleId(opts: {
  storedId: number | null;
  dbActiveIds: readonly number[];
  lastTripAtByVehicle?: Readonly<Record<number, number>>;
  vehicleIds: readonly number[];
}): number | null {
  const known = new Set(opts.vehicleIds.map((id) => Number(id)));
  const stored =
    opts.storedId != null && known.has(Number(opts.storedId)) ? Number(opts.storedId) : null;
  const dbActive = opts.dbActiveIds
    .map((id) => Number(id))
    .filter((id) => known.has(id));
  const uniqueDb = dbActive.length === 1 ? dbActive[0] : null;

  if (uniqueDb != null) return uniqueDb;
  const lastTrip = latestTripVehicleId(opts.lastTripAtByVehicle, known);
  if (lastTrip != null) return lastTrip;
  if (stored != null) return stored;
  return null;
}

function latestTripVehicleId(
  map: Readonly<Record<number, number>> | undefined,
  known: Set<number>
): number | null {
  if (!map) return null;
  let bestId: number | null = null;
  let bestAt = -1;
  for (const [key, at] of Object.entries(map)) {
    const id = Number(key);
    const ms = Number(at);
    if (!known.has(id) || !Number.isFinite(ms)) continue;
    if (ms >= bestAt) {
      bestAt = ms;
      bestId = id;
    }
  }
  return bestId;
}
