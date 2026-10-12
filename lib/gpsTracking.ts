/**
 * Filtrage + lissage GPS trajet : précision, sauts, jitter à l’arrêt.
 */
export type RoutePointLike = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Précision max acceptée (m).
 * 32 m était trop strict : le GPS Android en FGS / arrière-plan est souvent
 * à 40–80 m → tous les points rejetés, notif allumée, 0 km enregistrés.
 */
export const MAX_ACCURACY_M = 120;
export const MAX_ACCURACY_FIRST_M = 220;
/** Distance min entre 2 points (km). */
export const MIN_STEP_KM = 0.006; // 6 m
/** Vitesse max ~180 km/h + marge GPS. */
export const MAX_SPEED_MPS = 50;
export const MIN_DT_MS = 600;
/** Sous cette vitesse device (m/s), on ignore les micro-déplacements. */
export const STATIONARY_SPEED_MPS = 0.8;
/** Jitter à l’arrêt (pas un vrai déplacement urbain lent). */
export const STATIONARY_MAX_STEP_KM = 0.012; // 12 m

export type GpsSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number | null;
  speed?: number | null;
};

export type GpsFilterReason =
  | 'ok'
  | 'bad_coords'
  | 'bad_accuracy'
  | 'too_close'
  | 'too_fast'
  | 'too_soon'
  | 'stationary';

export type GpsFilterResult = {
  accept: boolean;
  reason: GpsFilterReason;
  distanceKm?: number;
  speedMps?: number;
  /** Point éventuellement lissé (à utiliser pour l’append). */
  sample?: GpsSample;
};

export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

/**
 * Lissage léger quand la précision est moyenne : réduit le zigzag sans
 * sous-estimer trop la distance (poids max 35 % vers le point précédent).
 */
export function smoothGpsSample(
  previous: RoutePointLike | null,
  sample: GpsSample
): GpsSample {
  if (!previous) return sample;
  const acc = sample.accuracy;
  if (acc == null || !Number.isFinite(acc) || acc <= 12) return sample;
  const w = Math.min(0.35, (acc - 12) / 90);
  return {
    ...sample,
    latitude: sample.latitude * (1 - w) + previous.latitude * w,
    longitude: sample.longitude * (1 - w) + previous.longitude * w,
  };
}

export function evaluateGpsSample(
  previous: RoutePointLike | null,
  raw: GpsSample,
  opts?: { isFirst?: boolean }
): GpsFilterResult {
  if (!isValidCoord(raw.latitude, raw.longitude)) {
    return { accept: false, reason: 'bad_coords' };
  }

  const sample = smoothGpsSample(previous, raw);
  const acc = sample.accuracy;
  const maxAcc = opts?.isFirst || !previous ? MAX_ACCURACY_FIRST_M : MAX_ACCURACY_M;
  if (acc != null && Number.isFinite(acc) && acc > maxAcc) {
    return { accept: false, reason: 'bad_accuracy', sample };
  }

  if (!previous) {
    return { accept: true, reason: 'ok', sample };
  }

  const dt = sample.timestamp - previous.timestamp;
  if (Number.isFinite(dt) && dt >= 0 && dt < MIN_DT_MS) {
    return { accept: false, reason: 'too_soon', sample };
  }

  const distanceKm = haversineKm(
    previous.latitude,
    previous.longitude,
    sample.latitude,
    sample.longitude
  );

  if (distanceKm < MIN_STEP_KM) {
    return { accept: false, reason: 'too_close', sample };
  }

  // Vitesse device < 0 = indisponible (convention Android). Si le capteur dit
  // 0 m/s mais le déplacement implique > ~8 km/h (fréquent en FGS), on accepte.
  const deviceSpeed =
    sample.speed != null && Number.isFinite(sample.speed) && sample.speed >= 0
      ? sample.speed
      : null;
  const impliedKmh = dt > 0 ? distanceKm / (dt / 3_600_000) : 0;
  if (
    deviceSpeed != null &&
    deviceSpeed < STATIONARY_SPEED_MPS &&
    distanceKm < STATIONARY_MAX_STEP_KM &&
    impliedKmh < 8
  ) {
    return { accept: false, reason: 'stationary', sample, distanceKm };
  }

  if (dt > 0) {
    const speedMps = (distanceKm * 1000) / (dt / 1000);
    if (speedMps > MAX_SPEED_MPS) {
      return { accept: false, reason: 'too_fast', distanceKm, speedMps, sample };
    }
    if (deviceSpeed != null && deviceSpeed > MAX_SPEED_MPS + 8) {
      return { accept: false, reason: 'too_fast', distanceKm, speedMps: deviceSpeed, sample };
    }
    return { accept: true, reason: 'ok', distanceKm, speedMps, sample };
  }

  if (distanceKm > 1.5) {
    return { accept: false, reason: 'too_fast', distanceKm, sample };
  }

  return { accept: true, reason: 'ok', distanceKm, sample };
}

/**
 * Pastille carte à l’arrêt (pas les km trajet) : un saut mock / labo
 * (Rennes → Saint-Jacques) recentre. `evaluateGpsSample` reste strict pour
 * ne pas ajouter des km fantômes.
 */
export function acceptMapDisplayFix(
  previous: RoutePointLike | null,
  raw: GpsSample & { mocked?: boolean | null }
): { latitude: number; longitude: number } | null {
  if (!isValidCoord(raw.latitude, raw.longitude)) return null;
  if (raw.mocked) {
    return { latitude: raw.latitude, longitude: raw.longitude };
  }
  const verdict = evaluateGpsSample(previous, raw, { isFirst: !previous });
  if (
    verdict.accept ||
    verdict.reason === 'too_close' ||
    verdict.reason === 'too_soon' ||
    verdict.reason === 'too_fast' ||
    verdict.reason === 'stationary'
  ) {
    return { latitude: raw.latitude, longitude: raw.longitude };
  }
  if (verdict.reason === 'bad_accuracy' && !previous) {
    return { latitude: raw.latitude, longitude: raw.longitude };
  }
  return null;
}

/** Distance en ignorant sauts / bruit (réparation a posteriori). */
export function calculateFilteredRouteDistance(points: RoutePointLike[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const r = evaluateGpsSample(last, {
      latitude: p.latitude,
      longitude: p.longitude,
      timestamp: p.timestamp,
      accuracy: p.accuracy,
    });
    if (
      !r.accept &&
      (r.reason === 'too_fast' ||
        r.reason === 'bad_accuracy' ||
        r.reason === 'bad_coords' ||
        r.reason === 'stationary')
    ) {
      continue;
    }
    if (!r.accept && (r.reason === 'too_close' || r.reason === 'too_soon')) {
      continue;
    }
    const use = r.sample || p;
    const d = haversineKm(last.latitude, last.longitude, use.latitude, use.longitude);
    if (d >= MIN_STEP_KM) {
      total += d;
      last = {
        latitude: use.latitude,
        longitude: use.longitude,
        timestamp: use.timestamp,
        accuracy: use.accuracy ?? undefined,
      };
    }
  }
  return Math.round(total * 1000) / 1000;
}
