/** Combien d’allers-retours habituels restent avec le niveau actuel. */

import type { Place, Trip, Vehicle } from '@/types';
import { haversineDistance } from '@/lib/geoMath';
import { estimateTripFuelLiters } from '@/lib/consumptionModel';

export type CommuteRange = {
  label: string;
  oneWayKm: number;
  litersPerRound: number;
  roundTrips: number;
  oneWays: number;
  corridor: string;
};

function endsOf(t: Trip): {
  oLat?: number;
  oLon?: number;
  dLat?: number;
  dLon?: number;
} {
  try {
    const pts = JSON.parse(t.routePoints || '[]');
    if (!Array.isArray(pts) || pts.length < 2) return {};
    const s = pts[0];
    const e = pts[pts.length - 1];
    return {
      oLat: s?.latitude,
      oLon: s?.longitude,
      dLat: e?.latitude,
      dLon: e?.longitude,
    };
  } catch {
    return {};
  }
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function corridorKm(
  trips: Trip[],
  a: Place,
  b: Place
): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  const samples: number[] = [];
  for (const t of trips) {
    if (t.isActive || t.status === 'rejected' || !(t.distanceKm > 1.5)) continue;
    const ends = endsOf(t);
    if (ends.oLat == null || ends.dLat == null || ends.oLon == null || ends.dLon == null) {
      continue;
    }
    const fromA = haversineDistance(ends.oLat, ends.oLon, a.latitude, a.longitude) < 3;
    const toB = haversineDistance(ends.dLat, ends.dLon, b.latitude, b.longitude) < 3;
    const fromB = haversineDistance(ends.oLat, ends.oLon, b.latitude, b.longitude) < 3;
    const toA = haversineDistance(ends.dLat, ends.dLon, a.latitude, a.longitude) < 3;
    if ((fromA && toB) || (fromB && toA)) samples.push(t.distanceKm);
  }
  if (samples.length >= 2) return median(samples);
  if (samples.length === 1) return samples[0];
  const bird = haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
  if (bird < 0.4) return null;
  return bird * 1.35;
}

export function estimateCommutesRemaining(opts: {
  vehicle: Pick<Vehicle, 'consumptionPer100' | 'consumptionLearnFactor' | 'fuelType' | 'name'>;
  litersRemaining: number;
  places: Place[];
  trips: Trip[];
}): CommuteRange | null {
  const { vehicle, litersRemaining, places, trips } = opts;
  if (vehicle.fuelType === 'electrique') return null;
  if (!(litersRemaining > 0.2)) return null;

  const home = places.find((p) => p.kind === 'home' && p.latitude != null && p.longitude != null);
  const work = places.find((p) => p.kind === 'work' && p.latitude != null && p.longitude != null);
  if (!home || !work) return null;

  const oneWayKm = corridorKm(trips, home, work);
  if (oneWayKm == null || oneWayKm < 0.8) return null;

  const asVehicle = vehicle as Vehicle;
  const litersOneWay = estimateTripFuelLiters(asVehicle, oneWayKm, {
    learnedFactor: vehicle.consumptionLearnFactor,
  });
  const litersPerRound = Math.max(0.2, litersOneWay * 2);
  const oneWays = litersRemaining / Math.max(0.1, litersOneWay);
  const roundTrips = litersRemaining / litersPerRound;
  const corridor = `${home.name || 'Domicile'} ↔ ${work.name || 'Travail'}`;
  const r = Math.floor(roundTrips + 1e-6);
  const o = Math.floor(oneWays + 1e-6);
  let label: string;
  if (r >= 1) {
    label = `Encore ~${r} aller-retour${r > 1 ? 's' : ''} ${corridor}`;
  } else if (o >= 1) {
    label = `Encore ~${o} trajet${o > 1 ? 's' : ''} ${corridor} (plus assez pour un aller-retour)`;
  } else {
    label = `Plus assez pour un trajet ${corridor} (~${oneWayKm.toFixed(0)} km)`;
  }
  return {
    label,
    oneWayKm: Math.round(oneWayKm * 10) / 10,
    litersPerRound: Math.round(litersPerRound * 10) / 10,
    roundTrips: Math.round(roundTrips * 10) / 10,
    oneWays: Math.round(oneWays * 10) / 10,
    corridor,
  };
}
