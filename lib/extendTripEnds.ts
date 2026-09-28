/**
 * Rallonge un tracé GPS coupé aux extrémités vers les lieux enregistrés
 * (domicile / travail), et détecte un trajet zombie à reprendre.
 */
import type { Place } from '@/types';

export const SNAP_END_MAX_KM = 2.5;
export const SNAP_END_MIN_KM = 0.04;
export const PREPEND_MIN_KM = 0.4;
export const PREPEND_MAX_KM = 35;
export const CORRIDOR_SLACK = 1.35;
export const ZOMBIE_RESUME_MAX_MS = 25 * 60 * 1000;

export type LatLng = { latitude: number; longitude: number };

export type RoutePoint = LatLng & { timestamp: number; speed?: number };

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export type SavedPlaceHit = {
  place: Place;
  km: number;
};

export function placeLabel(place: Place): string {
  const name = (place.name || '').trim();
  const addr = (place.address || '').trim();
  if (name && addr && !name.toLowerCase().includes(addr.slice(0, 12).toLowerCase())) {
    return `${name} — ${addr}`;
  }
  return name || addr || 'Lieu';
}

export function nearestSavedPlace(
  point: LatLng,
  places: Place[],
  maxKm: number,
  kinds?: Place['kind'][]
): SavedPlaceHit | null {
  let best: SavedPlaceHit | null = null;
  for (const place of places) {
    if (place.latitude == null || place.longitude == null) continue;
    if (kinds && kinds.length && !kinds.includes(place.kind)) continue;
    const km = haversineKm(point, {
      latitude: place.latitude,
      longitude: place.longitude,
    });
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

/** Vrai si `mid` est à peu près sur le chemin a → b (pas un détour absurde). */
export function isOnCorridor(
  a: LatLng,
  mid: LatLng,
  b: LatLng,
  slack = CORRIDOR_SLACK
): boolean {
  const direct = haversineKm(a, b);
  if (direct < 0.2) return false;
  const via = haversineKm(a, mid) + haversineKm(mid, b);
  return via <= direct * slack + 1.5;
}

export function stampCoords(
  coords: LatLng[],
  t0: number,
  t1: number
): RoutePoint[] {
  if (coords.length === 0) return [];
  const n = Math.max(coords.length - 1, 1);
  const start = Number.isFinite(t0) ? t0 : Date.now();
  const end = Number.isFinite(t1) && t1 > start ? t1 : start + n * 4000;
  return coords.map((c, i) => ({
    latitude: Math.round(c.latitude * 1e6) / 1e6,
    longitude: Math.round(c.longitude * 1e6) / 1e6,
    timestamp: Math.round(start + ((end - start) * i) / n),
  }));
}

function dropOverlap(segment: RoutePoint[], join: RoutePoint, fromEnd: boolean): RoutePoint[] {
  if (segment.length === 0) return segment;
  const other = fromEnd ? segment[segment.length - 1] : segment[0];
  const d = haversineKm(other, join);
  if (d < 0.04) {
    return fromEnd ? segment.slice(0, -1) : segment.slice(1);
  }
  return segment;
}

export function mergeRouteSegments(
  prefix: RoutePoint[],
  recorded: RoutePoint[],
  suffix: RoutePoint[]
): RoutePoint[] {
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  let pre = prefix;
  let suf = suffix;
  if (first && pre.length) pre = dropOverlap(pre, first, true);
  if (last && suf.length) suf = dropOverlap(suf, last, false);
  return [...pre, ...recorded, ...suf];
}

export function isResumableZombieTrip(
  trip: {
    note?: string | null;
    distanceKm?: number;
    endTime?: string | null;
    isActive?: boolean;
  },
  now = Date.now(),
  maxAgeMs = ZOMBIE_RESUME_MAX_MS
): boolean {
  if (trip.isActive) return false;
  if ((trip.distanceKm || 0) >= 0.5) return false;
  if (!/zombie/i.test(trip.note || '')) return false;
  const end = Date.parse(trip.endTime || '');
  if (!Number.isFinite(end)) return false;
  const age = now - end;
  return age >= 0 && age <= maxAgeMs;
}

export type ExtendTripResult = {
  points: RoutePoint[];
  originName?: string;
  destName?: string;
  prepended: boolean;
  appended: boolean;
};

export type RouteFetcher = (
  from: LatLng,
  to: LatLng
) => Promise<{ coordinates: LatLng[] } | null>;

/**
 * Préfixe depuis le lieu de départ (travail) si le GPS a raté le début,
 * suffixe jusqu’au lieu d’arrivée (domicile) si Terminer a coupé trop tôt.
 */
export async function extendRecordedTripEnds(opts: {
  points: RoutePoint[];
  places: Place[];
  fetchRoute: RouteFetcher;
  now?: number;
}): Promise<ExtendTripResult> {
  const points = opts.points || [];
  const empty: ExtendTripResult = {
    points,
    prepended: false,
    appended: false,
  };
  if (points.length < 2) return empty;

  const first = points[0];
  const last = points[points.length - 1];
  const saved = (opts.places || []).filter(
    (p) => p.kind === 'home' || p.kind === 'work'
  );

  const nearStart = nearestSavedPlace(first, saved, SNAP_END_MIN_KM);
  const startAnchor = nearestSavedPlace(first, saved, PREPEND_MAX_KM);
  const endAnchor = nearestSavedPlace(last, saved, SNAP_END_MAX_KM);

  let prefix: RoutePoint[] = [];
  let suffix: RoutePoint[] = [];
  let originName: string | undefined;
  let destName: string | undefined;

  const canPrepend =
    !nearStart &&
    startAnchor &&
    startAnchor.km >= PREPEND_MIN_KM &&
    endAnchor &&
    endAnchor.place.id !== startAnchor.place.id &&
    isOnCorridor(
      {
        latitude: startAnchor.place.latitude!,
        longitude: startAnchor.place.longitude!,
      },
      first,
      last
    );

  if (canPrepend && startAnchor) {
    const from = {
      latitude: startAnchor.place.latitude!,
      longitude: startAnchor.place.longitude!,
    };
    const route = await opts.fetchRoute(from, first).catch(() => null);
    const coords = route?.coordinates || [];
    if (coords.length >= 2) {
      const dtMin = Math.max(4, Math.round((startAnchor.km / 70) * 60));
      const t1 = first.timestamp;
      const t0 = t1 - dtMin * 60_000;
      prefix = stampCoords(coords, t0, t1);
      originName = placeLabel(startAnchor.place);
    }
  }

  if (endAnchor && endAnchor.km >= SNAP_END_MIN_KM && endAnchor.km <= SNAP_END_MAX_KM) {
    const to = {
      latitude: endAnchor.place.latitude!,
      longitude: endAnchor.place.longitude!,
    };
    const route = await opts.fetchRoute(last, to).catch(() => null);
    const coords = route?.coordinates || [];
    if (coords.length >= 2) {
      const t0 = last.timestamp;
      const t1 = t0 + Math.max(20_000, Math.round((endAnchor.km / 30) * 3_600_000));
      suffix = stampCoords(coords, t0, t1);
      destName = placeLabel(endAnchor.place);
    }
  }

  if (!prefix.length && !suffix.length) return empty;

  return {
    points: mergeRouteSegments(prefix, points, suffix),
    originName,
    destName,
    prepended: prefix.length > 0,
    appended: suffix.length > 0,
  };
}
