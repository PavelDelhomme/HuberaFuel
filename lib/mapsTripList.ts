/**
 * Pack compact des derniers trajets Fuel, pour l’URL de retour Maps
 * (hubera-maps://fuel?trips=). Pas de JSON : trop fragile dans un query string.
 *
 * Format : id~km~iso~origin~dest~flags séparés par |
 * flags : a = actif, p = pause
 */
export type MapsTripPackItem = {
  id: number;
  km: number;
  start: string;
  origin: string;
  dest: string;
  active: boolean;
  paused: boolean;
};

const FIELD = '~';
const ROW = '|';
const MAX_TRIPS = 20;
const LABEL = 42;

function clip(s: string | null | undefined): string {
  return String(s || '')
    .replace(/[~|\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LABEL);
}

export function encodeMapsTripPack(
  trips: Array<{
    id: number;
    distanceKm?: number;
    startTime?: string;
    originName?: string | null;
    destinationName?: string | null;
    isActive?: boolean;
    isPaused?: boolean;
    status?: string;
  }>
): string {
  return trips
    .filter((t) => t.status !== 'rejected')
    .slice(0, MAX_TRIPS)
    .map((t) =>
      [
        t.id,
        Math.round((Number(t.distanceKm) || 0) * 10) / 10,
        t.startTime || '',
        clip(t.originName),
        clip(t.destinationName),
        `${t.isActive ? 'a' : ''}${t.isPaused ? 'p' : ''}`,
      ].join(FIELD)
    )
    .join(ROW);
}

/** Jauge / garage / pleins / budget pour l’onglet Fuel de Maps. */
export function encodeMapsFuelSnap(opts: {
  vehicles: Array<{
    id: number;
    name?: string;
    brand?: string;
    model?: string;
    isActive?: boolean;
    tankCapacity?: number;
    estimatedFuelLiters?: number | null;
    consumptionPer100?: number | null;
  }>;
  fills: Array<{ date?: string; liters?: number; totalCost?: number; note?: string | null }>;
  budget?: { amount?: number; spent?: number; name?: string } | null;
}): string {
  const veh = (opts.vehicles || []).slice(0, 8).map((v) => {
    const tank = Number(v.tankCapacity) || 0;
    const L = v.estimatedFuelLiters;
    const pct =
      L != null && tank > 0 ? Math.max(0, Math.min(100, Math.round((L / tank) * 100))) : -1;
    const name = clip(v.name || `${v.brand || ''} ${v.model || ''}`.trim() || `Véhicule ${v.id}`);
    const liters = L != null && Number.isFinite(L) ? Math.round(L * 10) / 10 : -1;
    const l100 =
      v.consumptionPer100 != null && v.consumptionPer100 > 0
        ? Math.round(v.consumptionPer100 * 10) / 10
        : 0;
    return [v.id, name, pct, v.isActive ? 1 : 0, tank || 0, liters, l100].join(FIELD);
  });
  const fills = (opts.fills || []).slice(0, 8).map((f) =>
    [
      String(f.date || '').slice(0, 16),
      Math.round((Number(f.liters) || 0) * 10) / 10,
      Math.round((Number(f.totalCost) || 0) * 100) / 100,
      clip(String(f.note || '').replace(/^Maps · /, '')),
    ].join(FIELD)
  );
  const b = opts.budget;
  const bud = b
    ? [Math.round(Number(b.amount) || 0), Math.round(Number(b.spent) || 0), clip(b.name)].join(FIELD)
    : '';
  return ['V', veh.join(ROW), 'F', fills.join(ROW), 'B', bud].join('||');
}

export function decodeMapsTripPack(raw: string | null | undefined): MapsTripPackItem[] {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out: MapsTripPackItem[] = [];
  for (const row of s.split(ROW)) {
    if (!row) continue;
    const [idRaw, kmRaw, start, origin, dest, flags] = row.split(FIELD);
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) continue;
    const km = Number(kmRaw);
    out.push({
      id,
      km: Number.isFinite(km) ? km : 0,
      start: start || '',
      origin: origin || '',
      dest: dest || '',
      active: (flags || '').includes('a'),
      paused: (flags || '').includes('p'),
    });
  }
  return out;
}
