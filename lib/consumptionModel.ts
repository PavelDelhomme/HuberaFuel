/**
 * Modèle de consommation :
 * - physique (forces → puissance → litres) quand tracé GPS dispo
 * - heuristique (facteurs L/100) en repli distance-only
 */
import type { Vehicle } from '@/types';
import {
  AIR_DENSITY,
  GRAVITY,
  resolveBaseConsumptionPer100,
  resolveVehiclePhysics,
} from '@/lib/vehiclePhysics';

export type PointLike = {
  latitude: number;
  longitude: number;
  timestamp: number;
  /** Altitude (m) si connue (GPS ou profil Open-Meteo). */
  altitude?: number | null;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export function vehicleAgeFactor(year: number, nowYear = new Date().getFullYear()): number {
  if (!year || year < 1970) return 1.04;
  const age = Math.max(0, nowYear - year);
  if (age <= 8) return 1;
  if (age <= 15) return 1 + (age - 8) * 0.005;
  if (age <= 25) return 1.035 + (age - 15) * 0.004;
  return Math.min(1.08, 1.075 + (age - 25) * 0.002);
}

/**
 * @deprecated Conservé pour compat tests / scripts.
 * La boîte n’applique plus de malus L/100 : seuls η_trans (physique) compte.
 * Modéliser rapports × vitesse limite n’est pas nécessaire sans OBD.
 */
export function transmissionFactor(_gears?: number | null): number {
  return 1;
}

/**
 * Intensité dénivelé (repli heuristique).
 * Basé sur m d’ascension / km (pas un forfait « par 10 km ») pour mieux
 * refléter une côte forte sur 50–100 m.
 */
export function elevationFactor(ascentM: number, distanceKm: number): number {
  if (ascentM <= 0 || distanceKm <= 0) return 1;
  const mPerKm = ascentM / Math.max(distanceKm, 0.05);
  return Math.min(1.55, 1 + (mPerKm / 80) * 0.4);
}

/**
 * Pics de pente sur fenêtres ~100 m (si profil altitude dispo).
 * Complète elevationFactor pour les dénivelés très localisés.
 */
export function gradeSpikeFactor(
  points: PointLike[],
  altitudes?: number[]
): number {
  if (points.length < 3) return 1;
  let maxAbsGrade = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dM = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
    if (dM < 8 || dM > 250) continue;
    const altA =
      altitudes?.[i - 1] != null ? altitudes[i - 1] : a.altitude != null ? a.altitude : null;
    const altB = altitudes?.[i] != null ? altitudes[i] : b.altitude != null ? b.altitude : null;
    if (altA == null || altB == null) continue;
    const grade = Math.abs((altB - altA) / dM);
    if (grade > maxAbsGrade) maxAbsGrade = grade;
  }
  if (maxAbsGrade < 0.04) return 1; // < 4 %
  // 8 % → ~+6 %, 15 % → ~+12 %
  return Math.min(1.18, 1 + (maxAbsGrade - 0.04) * 0.9);
}

export const REAL_WORLD_MARGIN = 1.04;

export type ConsumptionContext = {
  ascentM?: number;
  altitudes?: number[];
  gears?: number | null;
  learnedFactor?: number;
  avgSpeedKmh?: number;
  idleRatio?: number;
  /** Minutes passées quasi à l’arrêt (bouchon) — complète idleRatio. */
  idleMinutes?: number;
  accelFactor?: number;
  stopGoFactor?: number;
  points?: PointLike[];
  forceHeuristic?: boolean;
};

/** Surconso vs vitesse : ville lente / autoroute rapide. */
export function speedConsumptionFactor(avgKmh: number): number {
  if (!Number.isFinite(avgKmh) || avgKmh <= 0) return 1;
  if (avgKmh < 15) return 1.14;
  if (avgKmh < 35) return 1.08;
  if (avgKmh < 55) return 1.04;
  if (avgKmh < 95) return 1;
  if (avgKmh < 115) return 1.06;
  if (avgKmh < 130) return 1.12;
  return 1.16;
}

/** Surconso bouchon : ratio d’arrêt + durée absolue (long bouchon même à ratio moyen). */
export function trafficIdleFactor(idleRatio: number, idleMinutes = 0): number {
  if ((!Number.isFinite(idleRatio) || idleRatio <= 0) && idleMinutes <= 0) return 1;
  const r = Math.max(0, Math.min(0.85, idleRatio || 0));
  const mins = Math.max(0, idleMinutes);
  const fromRatio = r * 0.1;
  // +~1,5 % par 5 min d’arrêt cumulé, plafonné
  const fromTime = Math.min(0.22, (mins / 5) * 0.015);
  return 1 + fromRatio + fromTime;
}

export function accelAggressionFactor(points: PointLike[]): number {
  if (points.length < 3) return 1;
  let samples = 0;
  let harsh = 0;
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2];
    const b = points[i - 1];
    const c = points[i];
    const dt1 = b.timestamp - a.timestamp;
    const dt2 = c.timestamp - b.timestamp;
    if (dt1 <= 0 || dt1 > 30_000 || dt2 <= 0 || dt2 > 30_000) continue;
    const d1 = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const d2 = haversineKm(b.latitude, b.longitude, c.latitude, c.longitude);
    const v1 = d1 / (dt1 / 3_600_000);
    const v2 = d2 / (dt2 / 3_600_000);
    if (v1 > 130 || v2 > 130) continue;
    samples += 1;
    const dv = Math.abs(v2 - v1);
    if (dv >= 15 && Math.min(dt1, dt2) < 4000) harsh += 1;
  }
  if (samples < 8) return 1;
  const ratio = Math.min(0.45, harsh / samples);
  return 1 + ratio * 0.14;
}

export function stopAndGoFactor(points: PointLike[]): number {
  if (points.length < 4) return 1;
  let transitions = 0;
  let wasIdle = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.timestamp - a.timestamp;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180_000) continue;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const speedKmh = dKm / (dt / 3_600_000);
    const idle = speedKmh < 5;
    if (wasIdle && !idle) transitions += 1;
    wasIdle = idle;
  }
  const ratio = Math.min(0.5, transitions / Math.max(1, points.length / 4));
  return 1 + ratio * 0.2;
}

const IDLE_POWER_W_FALLBACK = 1750;

/**
 * Modèle physique : somme des débits L/s sur chaque segment GPS.
 * F = Fair + Froll + Fgrade + Finertia ; P_moteur = P_roues / η_trans (0 si frein moteur).
 * Ralenti : puissance × durée réelle (bouchons longs bien comptés).
 * Boîte : uniquement via η_trans (pas de carte rapports×vitesse).
 */
export function estimateTripFuelPhysics(
  vehicle: Vehicle,
  points: PointLike[],
  opts?: { altitudes?: number[]; learnedFactor?: number }
): number {
  if (points.length < 2) return 0;
  const phys = resolveVehiclePhysics(vehicle);
  const learned =
    opts?.learnedFactor && opts.learnedFactor > 0.5
      ? opts.learnedFactor
      : vehicle.consumptionLearnFactor && vehicle.consumptionLearnFactor > 0.5
        ? vehicle.consumptionLearnFactor
        : 1;

  const alts = opts?.altitudes;
  const idleW = phys.idlePowerW || IDLE_POWER_W_FALLBACK;
  let liters = 0;
  let prevV = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = (b.timestamp - a.timestamp) / 1000;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180) continue;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const dM = dKm * 1000;
    if (dM > 500) continue;
    const v = dM / dt;
    if (v > 50) continue;
    const accel = (v - prevV) / dt;
    prevV = v;

    let sinTheta = 0;
    let cosTheta = 1;
    const altA =
      alts && alts[i - 1] != null
        ? alts[i - 1]
        : a.altitude != null
          ? a.altitude
          : null;
    const altB =
      alts && alts[i] != null ? alts[i] : b.altitude != null ? b.altitude : null;
    if (altA != null && altB != null && dM > 0.5) {
      const rise = altB - altA;
      const ratio = Math.max(-0.35, Math.min(0.35, rise / dM));
      sinTheta = ratio;
      cosTheta = Math.sqrt(Math.max(0, 1 - ratio * ratio));
    }

    const vAir = Math.max(0, v);
    const fAir = 0.5 * AIR_DENSITY * phys.dragAreaScx * vAir * vAir;
    const fRoll = phys.rollingCr * phys.massKg * GRAVITY * cosTheta;
    const fGrade = phys.massKg * GRAVITY * sinTheta;
    const fInert = phys.massKg * Math.max(-6, Math.min(6, accel));
    const fTotal = fAir + fRoll + fGrade + fInert;

    let pMotor = 0;
    if (vAir < 2 / 3.6) {
      // Temps réel au ralenti (bouchon) — pas un simple ratio
      pMotor = idleW;
    } else if (fTotal > 0) {
      pMotor = (fTotal * vAir) / phys.etaTrans;
    }

    const denom = phys.etaEngine * phys.energyJPerL;
    if (denom <= 0) continue;
    liters += (pMotor / denom) * dt;
  }

  liters *= learned;
  return Math.round(Math.max(0, liters) * 100) / 100;
}

function estimateTripFuelHeuristic(
  vehicle: Vehicle,
  distanceKm: number,
  ctx: ConsumptionContext = {}
): number {
  if (distanceKm <= 0) return 0;
  const base = resolveBaseConsumptionPer100(vehicle);
  const age = vehicleAgeFactor(vehicle.year);
  // Boîte : plus de malus L/100 (η_trans seulement en mode physique)
  const learned =
    ctx.learnedFactor && ctx.learnedFactor > 0.5
      ? ctx.learnedFactor
      : vehicle.consumptionLearnFactor && vehicle.consumptionLearnFactor > 0.5
        ? vehicle.consumptionLearnFactor
        : 1;
  let elev = elevationFactor(ctx.ascentM ?? 0, distanceKm);
  if (ctx.points && ctx.points.length >= 3) {
    elev = Math.max(elev, gradeSpikeFactor(ctx.points, ctx.altitudes));
  }
  const speed = speedConsumptionFactor(ctx.avgSpeedKmh ?? 0);
  const traffic = trafficIdleFactor(ctx.idleRatio ?? 0, ctx.idleMinutes ?? 0);
  const accel = ctx.accelFactor && ctx.accelFactor > 0.9 ? ctx.accelFactor : 1;
  const stopGo = ctx.stopGoFactor && ctx.stopGoFactor > 0.9 ? ctx.stopGoFactor : 1;
  const situational = Math.min(1.15, speed * traffic * accel * stopGo);
  const l100 = base * age * REAL_WORLD_MARGIN * learned * elev * situational;
  return Math.round(((distanceKm * l100) / 100) * 100) / 100;
}

/**
 * Estimation litres pour un trajet.
 * Priorité : modèle physique si `ctx.points` (≥2) ; sinon heuristique L/100.
 */
export function estimateTripFuelLiters(
  vehicle: Vehicle,
  distanceKm: number,
  ctx: ConsumptionContext = {}
): number {
  if (distanceKm <= 0 && !(ctx.points && ctx.points.length >= 2)) return 0;
  if (!ctx.forceHeuristic && ctx.points && ctx.points.length >= 2) {
    const phys = estimateTripFuelPhysics(vehicle, ctx.points, {
      altitudes: ctx.altitudes,
      learnedFactor: ctx.learnedFactor,
    });
    if (phys > 0 || distanceKm <= 0.05) return phys;
  }
  return estimateTripFuelHeuristic(vehicle, distanceKm, ctx);
}

export function movingDurationMinutes(points: PointLike[]): number {
  if (points.length < 2) return 0;
  let ms = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.timestamp - a.timestamp;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180_000) continue;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const speedKmh = dKm / (dt / 3600000);
    if (speedKmh < 5) continue;
    ms += dt;
  }
  return ms / 60000;
}

export function averageMovingSpeedKmh(distanceKm: number, points: PointLike[]): number {
  const mins = movingDurationMinutes(points);
  if (mins <= 0 || distanceKm <= 0) return 0;
  return (distanceKm / mins) * 60;
}

export function idleRatioFromPoints(points: PointLike[]): number {
  if (points.length < 2) return 0;
  let totalMs = 0;
  let idleMs = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.timestamp - a.timestamp;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180_000) continue;
    totalMs += dt;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const speedKmh = dKm / (dt / 3600000);
    if (speedKmh < 5) idleMs += dt;
  }
  if (totalMs <= 0) return 0;
  return Math.min(0.9, idleMs / totalMs);
}

/** Minutes cumulées quasi à l’arrêt (v < 5 km/h) — pour bouchons longs. */
export function idleMinutesFromPoints(points: PointLike[]): number {
  if (points.length < 2) return 0;
  let idleMs = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.timestamp - a.timestamp;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180_000) continue;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const speedKmh = dKm / (dt / 3600000);
    if (speedKmh < 5) idleMs += dt;
  }
  return idleMs / 60000;
}

export type RouteSpeedStats = {
  avgKmh: number;
  maxKmh: number;
  minKmh: number;
  pointSpeedsKmh: number[];
};

export const MAX_PLAUSIBLE_SPEED_KMH = 130;

export function computeRouteSpeedStats(
  points: Array<PointLike & { speed?: number }>
): RouteSpeedStats {
  const pointSpeedsKmh: number[] = [0];
  const speeds: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = b.timestamp - a.timestamp;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 180_000) {
      pointSpeedsKmh.push(pointSpeedsKmh[pointSpeedsKmh.length - 1] || 0);
      continue;
    }
    const fromDevice = typeof b.speed === 'number' && b.speed >= 0 ? b.speed * 3.6 : null;
    const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    const fromGeo = dKm / (dt / 3_600_000);
    const v = fromDevice != null && fromDevice < MAX_PLAUSIBLE_SPEED_KMH ? fromDevice : fromGeo;
    if (v > 0.5 && v <= MAX_PLAUSIBLE_SPEED_KMH) speeds.push(v);
    pointSpeedsKmh.push(v > MAX_PLAUSIBLE_SPEED_KMH ? 0 : v);
  }
  if (!speeds.length) return { avgKmh: 0, maxKmh: 0, minKmh: 0, pointSpeedsKmh };
  return {
    avgKmh: speeds.reduce((s, x) => s + x, 0) / speeds.length,
    maxKmh: Math.max(...speeds),
    minKmh: Math.min(...speeds),
    pointSpeedsKmh,
  };
}

export function formatDurationMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

export async function fetchElevationAscentM(points: PointLike[]): Promise<number> {
  const profile = await fetchElevationProfile(points);
  if (profile.length < 2) return 0;
  let ascent = 0;
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i] - profile[i - 1];
    if (d > 1) ascent += d;
  }
  return Math.round(ascent);
}

/** Profil d’altitude (m) le long du tracé — densifié (~80–100 m), Open-Meteo. */
export async function fetchElevationProfile(points: PointLike[]): Promise<number[]> {
  if (points.length < 2) return [];

  // Échantillonnage par distance (~90 m) pour capter les côtes courtes, max ~90 points API
  const sampleIdx: number[] = [0];
  let accM = 0;
  const TARGET_STEP_M = 90;
  const MAX_SAMPLES = 90;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    accM += haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
    if (accM >= TARGET_STEP_M) {
      sampleIdx.push(i);
      accM = 0;
    }
  }
  if (sampleIdx[sampleIdx.length - 1] !== points.length - 1) {
    sampleIdx.push(points.length - 1);
  }
  // Si trop de points : sous-échantillonner régulièrement
  let idxs = sampleIdx;
  if (idxs.length > MAX_SAMPLES) {
    const step = Math.ceil(idxs.length / MAX_SAMPLES);
    idxs = idxs.filter((_, i) => i % step === 0 || i === idxs.length - 1);
  }

  const sample = idxs.map((i) => points[i]);
  const lats = sample.map((p) => p.latitude.toFixed(5)).join(',');
  const lons = sample.map((p) => p.longitude.toFixed(5)).join(',');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), 5000);
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'GasoilTracking/1.4' },
      signal: ctrl?.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { elevation?: number[] };
    const elev = data.elevation;
    if (!Array.isArray(elev) || elev.length !== sample.length) return [];
    const out = new Array(points.length).fill(elev[0]);
    for (let s = 0; s < idxs.length; s++) out[idxs[s]] = elev[s];
    for (let s = 0; s < idxs.length - 1; s++) {
      const i0 = idxs[s];
      const i1 = idxs[s + 1];
      const e0 = elev[s];
      const e1 = elev[s + 1];
      const span = i1 - i0;
      for (let i = i0 + 1; i < i1; i++) {
        const t = (i - i0) / span;
        out[i] = e0 + (e1 - e0) * t;
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function learnedFactorFromGauge(
  estimatedLitersBurned: number,
  gaugeDropLiters: number
): number {
  if (estimatedLitersBurned <= 0.2 || gaugeDropLiters <= 0) return 1;
  const raw = gaugeDropLiters / estimatedLitersBurned;
  return Math.min(1.55, Math.max(0.85, raw));
}

/** EMA du facteur par véhicule (jauge observée vs modèle). */
export function blendLearnFactor(prev: number, sample: number): number {
  const p = prev > 0.5 ? prev : 1;
  const s = Math.min(1.55, Math.max(0.65, sample));
  return Math.round((p * 0.72 + s * 0.28) * 1000) / 1000;
}

function saneLearnL100(lPer100: number, fuelType?: Vehicle['fuelType']): boolean {
  if (!Number.isFinite(lPer100) || lPer100 <= 0) return false;
  if (fuelType === 'electrique') return lPer100 >= 5 && lPer100 <= 40;
  return lPer100 >= 3 && lPer100 <= 18;
}

export type GaugeLearnSample = {
  previousLiters: number;
  currentLiters: number;
  tripKm: number;
  estimatedBurnLiters: number;
  prevL100: number;
  prevLearnFactor: number;
  fuelType?: Vehicle['fuelType'];
};

export type GaugeLearnUpdate = {
  observedBurn: number;
  sampleFactor: number;
  nextLearnFactor: number;
  measuredL100: number | null;
  nextL100: number;
  learned: boolean;
};

/**
 * Recalibre L/100 + facteur d’apprentissage à partir d’une saisie jauge.
 * Jauge qui monte (plein non saisi) : pas d’apprentissage (évite une fausse sous-conso).
 */
export function gaugeLearnUpdate(s: GaugeLearnSample): GaugeLearnUpdate | null {
  const prevL = s.previousLiters;
  const cur = s.currentLiters;
  if (!Number.isFinite(prevL) || !Number.isFinite(cur)) return null;
  const observedBurn = Math.round((prevL - cur) * 10) / 10;
  if (observedBurn < 0.05) return null;

  const tripKm = Number.isFinite(s.tripKm) ? s.tripKm : 0;
  const est = Number.isFinite(s.estimatedBurnLiters) ? s.estimatedBurnLiters : 0;
  if (tripKm < 1 && est < 0.15) return null;

  const prevL100 = s.prevL100 > 0.5 ? s.prevL100 : 6.5;
  const prevLearn = s.prevLearnFactor > 0.5 ? s.prevLearnFactor : 1;
  const sampleFactor = learnedFactorFromGauge(Math.max(est, 0.2), observedBurn);
  const nextLearnFactor = blendLearnFactor(prevLearn, sampleFactor);

  let measuredL100: number | null = null;
  let nextL100 = prevL100;
  if (tripKm >= 2 && observedBurn >= 0.1) {
    const measured = (observedBurn / tripKm) * 100;
    if (saneLearnL100(measured, s.fuelType)) {
      measuredL100 = Math.round(measured * 10) / 10;
      const maxCap = s.fuelType === 'diesel' ? 14 : 12;
      if (measured <= maxCap && measured <= prevL100 * 1.55) {
        nextL100 = Math.round((measured * 0.45 + prevL100 * 0.55) * 10) / 10;
      }
    }
  }

  return {
    observedBurn,
    sampleFactor,
    nextLearnFactor,
    measuredL100,
    nextL100,
    learned: true,
  };
}

export function learnFactorFromFullFillUps(
  fillUps: Array<{ liters: number; distanceSinceLastKm: number | null; isFull: boolean }>,
  catalogueL100: number
): number | null {
  const base = catalogueL100 > 0 ? catalogueL100 : 6.5;
  const ratios: number[] = [];
  for (const f of fillUps) {
    if (!f.isFull) continue;
    const d = f.distanceSinceLastKm;
    if (d == null || d < 40 || f.liters < 5) continue;
    const real = (f.liters / d) * 100;
    if (!Number.isFinite(real) || real < 2 || real > 25) continue;
    ratios.push(real / base);
  }
  if (ratios.length < 2) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.round(Math.min(1.55, Math.max(0.85, avg)) * 1000) / 1000;
}
