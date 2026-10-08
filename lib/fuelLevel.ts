/** Helpers niveau carburant estimé par véhicule (multi-voitures). */

import type { FillUp, FuelGaugeSource, Vehicle } from '@/types';
import {
  getActiveTripLite,
  getFillUps,
  getFuelGaugeReadings,
  getTrips,
  getVehicleById,
  updateTrip,
  updateVehicle,
} from '@/lib/database';
import { blendLearnFactor, estimateTripFuelLiters, gaugeLearnUpdate } from '@/lib/consumptionModel';
import { recordFuelGaugeReading } from '@/lib/fuelGaugeHistory';

export type FillFuelPreview = {
  beforeLiters: number | null;
  afterLiters: number;
  mode: 'full' | 'add' | 'replace_unknown';
  summary: string;
};

/**
 * Aperçu avant enregistrement :
 * - plein complet → réservoir = capacité (le reste précédent est « complété »)
 * - partiel + niveau connu → reste + litres ajoutés (plafonné capacité)
 * - partiel + niveau inconnu → seulement les litres saisis
 */
export function previewFillUpFuel(
  vehicle: Vehicle,
  fill: Pick<FillUp, 'liters' | 'isFull'>
): FillFuelPreview {
  const before = vehicle.estimatedFuelLiters;
  if (fill.isFull) {
    return {
      beforeLiters: before,
      afterLiters: vehicle.tankCapacity,
      mode: 'full',
      summary:
        before != null
          ? `Avant ~${before.toFixed(1)} L → plein = ${vehicle.tankCapacity} L (capacité)`
          : `Plein complet → ${vehicle.tankCapacity} L (capacité du réservoir)`,
    };
  }
  if (before != null) {
    const after = Math.min(vehicle.tankCapacity, before + fill.liters);
    return {
      beforeLiters: before,
      afterLiters: Math.round(after * 10) / 10,
      mode: 'add',
      summary: `Avant ~${before.toFixed(1)} L + ${fill.liters.toFixed(1)} L → ~${after.toFixed(1)} L`,
    };
  }
  const after = Math.min(vehicle.tankCapacity, fill.liters);
  return {
    beforeLiters: null,
    afterLiters: Math.round(after * 10) / 10,
    mode: 'replace_unknown',
    summary: `Niveau inconnu → estime ~${after.toFixed(1)} L (litres de ce plein seulement)`,
  };
}

/**
 * Rejoue le niveau depuis le dernier plein chronologique :
 * niveau au plein − Σ conso des trajets postérieurs.
 * Corrige les « plein fantômes » et les pleins antidatés.
 */
export async function recomputeFuelFromLastFill(vehicleId: number): Promise<number | null> {
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle || vehicle.fuelType === 'electrique') {
    return vehicle?.estimatedFuelLiters ?? null;
  }
  const fills = await getFillUps(vehicleId);
  if (!fills.length) return vehicle.estimatedFuelLiters;

  const last = [...fills].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const trips = await getTrips(vehicleId, { omitRoutePoints: true });
  const since = trips.filter(
    (t) =>
      !t.isActive &&
      t.status !== 'rejected' &&
      String(t.startTime) > String(last.date)
  );

  const atFill = last.isFull
    ? vehicle.tankCapacity
    : (() => {
        // Partiel : niveau juste après le plein ≈ stock actuel + déjà brûlé depuis
        // (évite d’écraser un adjust manuel s’il n’y a pas encore de trajets).
        if (since.length === 0) return vehicle.estimatedFuelLiters ?? Math.min(vehicle.tankCapacity, last.liters);
        let burnedProbe = 0;
        for (const t of since) {
          if ((t.estimatedFuelUsed || 0) > 0) burnedProbe += t.estimatedFuelUsed;
          else if ((t.distanceKm || 0) > 0) burnedProbe += estimateTripFuelLiters(vehicle, t.distanceKm);
        }
        const inferred =
          (vehicle.estimatedFuelLiters ?? Math.min(vehicle.tankCapacity, last.liters)) + burnedProbe;
        return Math.min(vehicle.tankCapacity, Math.max(last.liters, inferred));
      })();

  if (!last.isFull && since.length === 0 && vehicle.estimatedFuelLiters != null) {
    return vehicle.estimatedFuelLiters;
  }

  let burned = 0;
  for (const t of since) {
    const km = t.distanceKm || 0;
    if (km <= 0) continue;
    // Toujours le modèle distance : estimatedFuelUsed peut être 0 (trajets Maps / GPS mal clos).
    const model = estimateTripFuelLiters(vehicle, km);
    const stored = t.estimatedFuelUsed || 0;
    burned += Math.max(model, stored);
  }
  const next = Math.max(0, Math.round((atFill - burned) * 10) / 10);
  if (vehicle.estimatedFuelLiters == null || Math.abs(vehicle.estimatedFuelLiters - next) > 0.05) {
    await updateVehicle(vehicleId, { estimatedFuelLiters: next });
    await recordFuelGaugeReading({
      vehicleId,
      liters: next,
      source: 'recompute',
    });
  }
  return next;
}

/** Applique un plein puis rejoue les trajets postérieurs (antidatés OK). */
export async function applyFillUpToFuelEstimate(
  vehicle: Vehicle,
  fill: Pick<FillUp, 'liters' | 'isFull'> & { id?: number | null }
): Promise<number> {
  const preview = previewFillUpFuel(vehicle, fill);
  await updateVehicle(vehicle.id, { estimatedFuelLiters: preview.afterLiters });
  await recordFuelGaugeReading({
    vehicleId: vehicle.id,
    liters: preview.afterLiters,
    source: 'fill_up',
    fillUpId: fill.id ?? null,
  });
  const recomputed = await recomputeFuelFromLastFill(vehicle.id);
  return recomputed ?? preview.afterLiters;
}

/**
 * Après modification d’un plein : rejoue depuis le dernier plein (plus fiable qu’un undo litres).
 */
export async function reapplyFillUpFuelEstimate(
  vehicle: Vehicle,
  _previous: Pick<FillUp, 'liters' | 'isFull'>,
  _nextFill: Pick<FillUp, 'liters' | 'isFull'>
): Promise<number | null> {
  return recomputeFuelFromLastFill(vehicle.id);
}

/**
 * Jauge manuelle = ancre : recalibre L/100 + redistribue conso/coût des trajets
 * depuis le dernier plein (complet ou partiel).
 */
export async function recalibrateFromManualGauge(
  vehicleId: number,
  currentLiters: number,
  opts?: { previousLiters?: number | null }
): Promise<{
  measuredL100: number | null;
  nextL100: number;
  tripsAdjusted: number;
  learnFactor: number;
} | null> {
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle || vehicle.fuelType === 'electrique') return null;
  if (vehicle.consumptionAutoAdapt === false) return null;

  const [fills, trips, readings, live] = await Promise.all([
    getFillUps(vehicleId),
    getTrips(vehicleId, { omitRoutePoints: true }),
    getFuelGaugeReadings(vehicleId, { limit: 8 }).catch(() => []),
    getActiveTripLite().catch(() => null),
  ]);
  const last = fills.length
    ? [...fills].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
    : null;
  const prevReading = (readings || []).find(
    (r) =>
      r.source !== 'model_burn' &&
      Math.abs((r.liters || 0) - currentLiters) > 0.08
  );
  const sinceTime = last?.date || prevReading?.recordedAt || null;

  const confirmedSince = trips.filter((t) => {
    if (t.isActive || t.status === 'rejected' || !(t.distanceKm > 0)) return false;
    if (sinceTime && String(t.startTime) <= String(sinceTime)) return false;
    return true;
  });

  let tripKm = confirmedSince.reduce((s, t) => s + (t.distanceKm || 0), 0);
  let estTotal = confirmedSince.reduce((s, t) => s + (t.estimatedFuelUsed || 0), 0);
  if (live && live.vehicleId === vehicleId && (live.distanceKm || 0) > 0) {
    tripKm += live.distanceKm || 0;
    estTotal += live.estimatedFuelUsed || estimateTripFuelLiters(vehicle, live.distanceKm || 0);
  }
  if (estTotal < 0.15 && tripKm > 0) {
    estTotal = confirmedSince.reduce(
      (s, t) => s + estimateTripFuelLiters(vehicle, t.distanceKm || 0),
      0
    );
    if (live && live.vehicleId === vehicleId && (live.distanceKm || 0) > 0) {
      estTotal += estimateTripFuelLiters(vehicle, live.distanceKm || 0);
    }
  }

  const prevL =
    opts?.previousLiters != null && Number.isFinite(opts.previousLiters)
      ? opts.previousLiters
      : prevReading?.liters ?? vehicle.estimatedFuelLiters;
  if (prevL == null || !Number.isFinite(prevL)) return null;

  const atFill = last
    ? last.isFull
      ? vehicle.tankCapacity
      : Math.min(
          vehicle.tankCapacity,
          Math.max(last.liters, prevL + Math.max(estTotal, 0))
        )
    : prevL;
  const learned = gaugeLearnUpdate({
    previousLiters: atFill,
    currentLiters,
    tripKm,
    estimatedBurnLiters: estTotal,
    prevL100: vehicle.consumptionPer100,
    prevLearnFactor: vehicle.consumptionLearnFactor ?? 1,
    fuelType: vehicle.fuelType,
  });
  if (!learned) return null;

  await updateVehicle(vehicleId, {
    consumptionPer100: learned.nextL100,
    consumptionLearnFactor: learned.nextLearnFactor,
  });

  let tripsAdjusted = 0;
  if (last && confirmedSince.length > 0 && estTotal >= 0.15 && learned.observedBurn >= 0.1) {
    const factor = learned.observedBurn / estTotal;
    const price =
      last.pricePerLiter > 0
        ? last.pricePerLiter
        : vehicle.defaultFuelPrice > 0
          ? vehicle.defaultFuelPrice
          : 0;
    for (const t of confirmedSince) {
      const base =
        (t.estimatedFuelUsed || 0) > 0
          ? t.estimatedFuelUsed
          : estimateTripFuelLiters(vehicle, t.distanceKm || 0);
      const fuel = Math.round(base * factor * 100) / 100;
      const cost = price > 0 ? Math.round(fuel * price * 100) / 100 : t.estimatedCost;
      await updateTrip(t.id, { estimatedFuelUsed: fuel, estimatedCost: cost });
      tripsAdjusted += 1;
    }
  }

  return {
    measuredL100: learned.measuredL100,
    nextL100: learned.nextL100,
    tripsAdjusted,
    learnFactor: learned.nextLearnFactor,
  };
}

/** Décrémente le niveau après un trajet (modèle conso réaliste). */
export async function applyTripFuelBurn(
  vehicle: Vehicle,
  distanceKm: number,
  ascentM = 0,
  opts?: { avgSpeedKmh?: number; idleRatio?: number; tripId?: number | null }
): Promise<number | null> {
  if (vehicle.estimatedFuelLiters == null || distanceKm <= 0) return vehicle.estimatedFuelLiters;
  const burned = estimateTripFuelLiters(vehicle, distanceKm, {
    ascentM,
    learnedFactor: vehicle.consumptionLearnFactor,
    avgSpeedKmh: opts?.avgSpeedKmh,
    idleRatio: opts?.idleRatio,
  });
  const next = Math.max(0, Math.round((vehicle.estimatedFuelLiters - burned) * 10) / 10);
  await updateVehicle(vehicle.id, { estimatedFuelLiters: next });
  await recordFuelGaugeReading({
    vehicleId: vehicle.id,
    liters: next,
    source: 'model_burn',
    tripId: opts?.tripId ?? null,
  });
  return next;
}

/** Fixe un niveau approximatif (fraction 0–1 du réservoir). */
export async function setFuelFraction(vehicle: Vehicle, fraction: number): Promise<number> {
  const f = Math.max(0, Math.min(1, fraction));
  const next = Math.round(vehicle.tankCapacity * f * 10) / 10;
  await updateVehicle(vehicle.id, { estimatedFuelLiters: next });
  return next;
}

export type SetFuelLitersResult = {
  liters: number;
  tripsAdjusted: number;
  measuredL100: number | null;
  nextL100: number | null;
  learnFactor: number | null;
};

export function fuelGaugeSaveSummary(adj: SetFuelLitersResult): string {
  const bits = [`${adj.liters.toFixed(1)} L`];
  if (adj.tripsAdjusted > 0) bits.push(`${adj.tripsAdjusted} trajet(s) réajustés`);
  if (adj.measuredL100 != null) bits.push(`~${adj.measuredL100.toFixed(1)} L/100`);
  else if (adj.learnFactor != null) bits.push('modèle conso mis à jour');
  return bits.join(' · ');
}

/** Fixe un niveau en litres + redistribue conso/coûts des trajets depuis le dernier plein. */
export async function setFuelLiters(
  vehicle: Vehicle,
  liters: number,
  meta?: { source?: FuelGaugeSource; tripId?: number | null; fillUpId?: number | null }
): Promise<SetFuelLitersResult> {
  const next = Math.min(
    vehicle.tankCapacity,
    Math.max(0, Math.round(liters * 10) / 10)
  );
  const previousLiters = vehicle.estimatedFuelLiters;
  await updateVehicle(vehicle.id, { estimatedFuelLiters: next });
  await recordFuelGaugeReading({
    vehicleId: vehicle.id,
    liters: next,
    source: meta?.source || 'manual',
    tripId: meta?.tripId ?? null,
    fillUpId: meta?.fillUpId ?? null,
  });
  let tripsAdjusted = 0;
  let measuredL100: number | null = null;
  let nextL100: number | null = null;
  let learnFactor: number | null = null;
  try {
    const r = await recalibrateFromManualGauge(vehicle.id, next, { previousLiters });
    if (r) {
      tripsAdjusted = r.tripsAdjusted;
      measuredL100 = r.measuredL100;
      nextL100 = r.nextL100;
      learnFactor = r.learnFactor;
    }
  } catch {
    /* jauge seule suffit */
  }
  return { liters: next, tripsAdjusted, measuredL100, nextL100, learnFactor };
}

/**
 * Met à jour le facteur d’apprentissage (EMA) après saisie jauge début/fin.
 */
export async function blendConsumptionLearnFactor(
  vehicle: Vehicle,
  sampleFactor: number
): Promise<number> {
  const next = blendLearnFactor(vehicle.consumptionLearnFactor ?? 1, sampleFactor);
  await updateVehicle(vehicle.id, { consumptionLearnFactor: next });
  return next;
}

export function fuelLevelLabel(vehicle: Vehicle): string {
  if (vehicle.estimatedFuelLiters == null) return 'Niveau inconnu';
  const pct = fuelLevelPercent(vehicle);
  return `${vehicle.estimatedFuelLiters.toFixed(1)} L (~${pct.toFixed(0)} %)`;
}

/** 0–100, ou 0 si inconnu. */
export function fuelLevelPercent(vehicle: Vehicle): number {
  if (vehicle.estimatedFuelLiters == null || vehicle.tankCapacity <= 0) return 0;
  return Math.min(100, Math.max(0, (vehicle.estimatedFuelLiters / vehicle.tankCapacity) * 100));
}

export type FuelTone = 'ok' | 'warn' | 'critical' | 'unknown';

/** Autonomie basse ≈ ⅓ réservoir. */
export const FUEL_WARN_FRACTION = 1 / 3;
/**
 * Critique ≈ moitié du quart (1/8).
 * Exception 806 (jauge / réservoir trompeur) : dès le quart (1/4) = quasiment vide.
 */
export const FUEL_CRITICAL_FRACTION = 1 / 8;
export const FUEL_CRITICAL_FRACTION_UNRELIABLE_TANK = 1 / 4;

/** 806 : la jauge « quart » correspond déjà à un réservoir quasi vide. */
export function vehicleHasUnreliableFuelGauge(vehicle: {
  name?: string;
  model?: string;
  brand?: string;
}): boolean {
  const blob = `${vehicle.name || ''} ${vehicle.model || ''} ${vehicle.brand || ''}`;
  return /\b806\b/i.test(blob);
}

export function criticalFuelFraction(vehicle?: {
  name?: string;
  model?: string;
  brand?: string;
} | null): number {
  if (vehicle && vehicleHasUnreliableFuelGauge(vehicle)) {
    return FUEL_CRITICAL_FRACTION_UNRELIABLE_TANK;
  }
  return FUEL_CRITICAL_FRACTION;
}

export function fuelRemainingTone(opts: {
  litersRemaining: number | null | undefined;
  tankCapacity: number;
  lowLitersThreshold?: number | null;
  rangeKm?: number | null;
  /** Pour seuils 806 (quart) vs standard (½ quart). */
  vehicle?: { name?: string; model?: string; brand?: string } | null;
}): FuelTone {
  const { litersRemaining, tankCapacity, lowLitersThreshold, rangeKm, vehicle } = opts;
  if (litersRemaining == null || !Number.isFinite(litersRemaining) || tankCapacity <= 0) {
    return 'unknown';
  }
  const critFrac = criticalFuelFraction(vehicle);
  const pct = (litersRemaining / tankCapacity) * 100;
  const warnLiters =
    lowLitersThreshold != null && lowLitersThreshold > 0
      ? lowLitersThreshold
      : tankCapacity * FUEL_WARN_FRACTION;
  const criticalLiters = Math.min(warnLiters * 0.85, tankCapacity * critFrac);

  // Seuils km (approx) — conso typique ~8 L/100
  const criticalKm = tankCapacity * critFrac * (100 / 8);
  const warnKm = tankCapacity * FUEL_WARN_FRACTION * (100 / 8);

  if (
    litersRemaining <= criticalLiters ||
    pct <= critFrac * 100 ||
    (rangeKm != null && rangeKm > 0 && rangeKm < criticalKm)
  ) {
    return 'critical';
  }
  if (
    litersRemaining <= warnLiters ||
    pct <= FUEL_WARN_FRACTION * 100 ||
    (rangeKm != null && rangeKm > 0 && rangeKm < warnKm)
  ) {
    return 'warn';
  }
  return 'ok';
}

export function fuelToneColor(
  tone: FuelTone,
  colors: { success: string; warning: string; danger: string; text: string }
): string {
  switch (tone) {
    case 'critical':
      return colors.danger;
    case 'warn':
      return colors.warning;
    case 'ok':
      return colors.success;
    default:
      return colors.text;
  }
}
