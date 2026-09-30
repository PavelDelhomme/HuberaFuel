/**
 * Stats moyennes / comparaison pour trajets similaires (même corridor).
 */
import { haversineDistance, parseRoutePoints } from '@/lib/calculations';
import type { Trip } from '@/types';

function normLabel(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelsClose(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(' ').filter((w) => w.length > 3));
  const tb = b.split(' ').filter((w) => w.length > 3);
  if (!ta.size || !tb.length) return false;
  const hit = tb.filter((w) => ta.has(w)).length;
  return hit >= Math.min(2, tb.length);
}

function tripEnds(trip: Trip): {
  oLat?: number;
  oLon?: number;
  dLat?: number;
  dLon?: number;
} {
  const pts = parseRoutePoints(trip.routePoints);
  const start = pts[0];
  const end = pts.length > 1 ? pts[pts.length - 1] : undefined;
  return {
    oLat: start?.latitude,
    oLon: start?.longitude,
    dLat: end?.latitude,
    dLon: end?.longitude,
  };
}

function endpointsMatch(
  a: ReturnType<typeof tripEnds>,
  b: ReturnType<typeof tripEnds>,
  maxKm = 2.5
): boolean {
  if (
    a.oLat == null ||
    a.oLon == null ||
    a.dLat == null ||
    a.dLon == null ||
    b.oLat == null ||
    b.oLon == null ||
    b.dLat == null ||
    b.dLon == null
  ) {
    return false;
  }
  const sameWay =
    haversineDistance(a.oLat, a.oLon, b.oLat, b.oLon) <= maxKm &&
    haversineDistance(a.dLat, a.dLon, b.dLat, b.dLon) <= maxKm;
  const reverse =
    haversineDistance(a.oLat, a.oLon, b.dLat, b.dLon) <= maxKm &&
    haversineDistance(a.dLat, a.dLon, b.oLat, b.oLon) <= maxKm;
  return sameWay || reverse;
}

function sampleRoute(trip: Trip, n = 8): { latitude: number; longitude: number }[] {
  const pts = parseRoutePoints(trip.routePoints);
  if (pts.length < 2) return pts;
  if (pts.length <= n) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (pts.length - 1)) / (n - 1));
    out.push(pts[idx]);
  }
  return out;
}

function pathOverlap(a: Trip, b: Trip, maxKm = 1.6): boolean {
  const sa = sampleRoute(a);
  const sb = sampleRoute(b);
  if (sa.length < 3 || sb.length < 3) return false;
  let hit = 0;
  for (const p of sa) {
    const ok = sb.some(
      (q) => haversineDistance(p.latitude, p.longitude, q.latitude, q.longitude) <= maxKm
    );
    if (ok) hit += 1;
  }
  return hit / sa.length >= 0.65;
}

export function isSimilarTrip(a: Trip, b: Trip): boolean {
  if (a.id === b.id) return false;
  if (a.distanceKm < 0.5 || b.distanceKm < 0.5) return false;
  const ratio =
    Math.max(a.distanceKm, b.distanceKm) / Math.max(0.01, Math.min(a.distanceKm, b.distanceKm));
  if (ratio > 1.4) return false;

  const laO = normLabel(a.originName);
  const laD = normLabel(a.destinationName);
  const lbO = normLabel(b.originName);
  const lbD = normLabel(b.destinationName);
  const labelHit =
    (labelsClose(laO, lbO) && labelsClose(laD, lbD)) ||
    (labelsClose(laO, lbD) && labelsClose(laD, lbO)) ||
    (labelsClose(laD, lbD) && (!laO || !lbO || labelsClose(laO, lbO)));

  if (labelHit) return true;
  if (endpointsMatch(tripEnds(a), tripEnds(b))) return true;
  return pathOverlap(a, b);
}

export type SimilarTripStats = {
  count: number;
  avgDistanceKm: number;
  avgFuelL: number;
  avgCost: number;
  avgDurationMin: number;
  avgL100: number;
  /** L/100 du trajet courant vs moyenne (négatif = mieux) */
  deltaL100?: number;
  /** Message court FR */
  vsHabitLabel?: string;
};

function durationMin(t: Trip): number {
  if (!t.endTime) return 0;
  const ms = new Date(t.endTime).getTime() - new Date(t.startTime).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 60000 : 0;
}

function l100(t: Trip): number | null {
  if (t.distanceKm < 0.5 || t.estimatedFuelUsed <= 0) return null;
  return (t.estimatedFuelUsed / t.distanceKm) * 100;
}

/** Moyennes des trajets similaires (exclut le trajet courant si fourni). */
export function computeSimilarTripStats(
  trips: Trip[],
  reference: Trip | { originName?: string | null; destinationName?: string | null; distanceKm?: number; id?: number; routePoints?: string; estimatedFuelUsed?: number },
  opts?: { excludeId?: number }
): SimilarTripStats | null {
  const refTrip = {
    id: reference.id ?? -1,
    vehicleId: 0,
    startTime: '',
    endTime: null as string | null,
    distanceKm: reference.distanceKm ?? 0,
    estimatedFuelUsed: reference.estimatedFuelUsed ?? 0,
    estimatedCost: 0,
    routePoints: reference.routePoints ?? '[]',
    originName: reference.originName ?? undefined,
    destinationName: reference.destinationName ?? undefined,
    isActive: false,
    isPaused: false,
    status: 'confirmed' as const,
    source: 'gps' as const,
    fillUpId: null as number | null,
    note: undefined as string | undefined,
  } as Trip;

  const peers = trips.filter((t) => {
    if (t.isActive) return false;
    if (opts?.excludeId != null && t.id === opts.excludeId) return false;
    if (t.id === refTrip.id) return false;
    if (t.distanceKm < 0.5) return false;
    return isSimilarTrip(refTrip, t);
  });

  if (peers.length < 1) return null;

  const n = peers.length;
  const avgDistanceKm = peers.reduce((s, t) => s + t.distanceKm, 0) / n;
  const avgFuelL = peers.reduce((s, t) => s + t.estimatedFuelUsed, 0) / n;
  const avgCost = peers.reduce((s, t) => s + t.estimatedCost, 0) / n;
  const durs = peers.map(durationMin).filter((d) => d > 0);
  const avgDurationMin = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
  const l100s = peers.map(l100).filter((x): x is number => x != null && x > 0 && x < 40);
  const avgL100 = l100s.length ? l100s.reduce((a, b) => a + b, 0) / l100s.length : 0;

  let deltaL100: number | undefined;
  let vsHabitLabel: string | undefined;
  const cur = reference.id != null && reference.id > 0 ? l100(reference as Trip) : null;
  if (cur != null && avgL100 > 0) {
    deltaL100 = Math.round((cur - avgL100) * 10) / 10;
    if (Math.abs(deltaL100) < 0.3) {
      vsHabitLabel = 'Conso dans la moyenne habituelle';
    } else if (deltaL100 < 0) {
      vsHabitLabel = `${Math.abs(deltaL100).toFixed(1)} L/100 de moins qu’à l’habitude`;
    } else {
      vsHabitLabel = `+${deltaL100.toFixed(1)} L/100 vs habitude`;
    }
  }

  return {
    count: n,
    avgDistanceKm: Math.round(avgDistanceKm * 10) / 10,
    avgFuelL: Math.round(avgFuelL * 100) / 100,
    avgCost: Math.round(avgCost * 100) / 100,
    avgDurationMin: Math.round(avgDurationMin),
    avgL100: Math.round(avgL100 * 10) / 10,
    deltaL100,
    vsHabitLabel,
  };
}

/** Stats pour une destination fréquente (label / coords). */
export function computeDestinationHabitStats(
  trips: Trip[],
  destLabel: string,
  destCoords?: { latitude: number; longitude: number } | null
): SimilarTripStats | null {
  const label = normLabel(destLabel);
  const peers = trips.filter((t) => {
    if (t.isActive || t.distanceKm < 0.5) return false;
    const d = normLabel(t.destinationName);
    const o = normLabel(t.originName);
    if (labelsClose(d, label) || labelsClose(o, label)) return true;
    if (destCoords) {
      const ends = tripEnds(t);
      if (ends.dLat != null && ends.dLon != null) {
        if (haversineDistance(ends.dLat, ends.dLon, destCoords.latitude, destCoords.longitude) < 2.5)
          return true;
      }
      if (ends.oLat != null && ends.oLon != null) {
        if (haversineDistance(ends.oLat, ends.oLon, destCoords.latitude, destCoords.longitude) < 2.5)
          return true;
      }
    }
    return false;
  });
  if (!peers.length) return null;
  // Utilise le peer le plus récent comme référence de corridor
  const newest = [...peers].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
  return computeSimilarTripStats(peers, newest);
}
