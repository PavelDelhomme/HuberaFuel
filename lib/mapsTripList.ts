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
