import type {
  Budget,
  BudgetStatus,
  ConsumptionStats,
  FillUp,
  MonthFillStats,
  SinceLastFillStats,
  Vehicle,
} from '@/types';
import {
  getFillUps,
  getTrips,
  getBudgets,
  createBudget,
  updateBudget,
  updateBudgetSpent,
  updateVehicle,
  getVehicleById,
  deactivateVehicleScopedBudgets,
} from './database';
import { monthKeyFromDate, toLocalYmd } from './dates';
import {
  calculateFilteredRouteDistance,
  evaluateGpsSample,
} from '@/lib/gpsTracking';
import {
  averageMovingSpeedKmh,
  accelAggressionFactor,
  estimateTripFuelLiters,
  idleRatioFromPoints,
  idleMinutesFromPoints,
  movingDurationMinutes,
  stopAndGoFactor,
} from '@/lib/consumptionModel';
import { resolveFillUpDistanceKm } from '@/lib/fillUpDistance';

export { resolveFillUpDistanceKm, sumTripKmBetween } from '@/lib/fillUpDistance';

/** Calcule la distance entre deux points GPS (formule Haversine) en km */
export function haversineDistance(
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

/** Estime le carburant consommé pour une distance donnée */
export function estimateFuelUsed(distanceKm: number, consumptionPer100: number): number {
  return (distanceKm * consumptionPer100) / 100;
}

/** Estime le coût du carburant */
export function estimateCost(fuelLiters: number, pricePerLiter: number): number {
  return fuelLiters * pricePerLiter;
}

/** Calcule la consommation réelle entre deux pleins complets */
export function calculateRealConsumption(
  previousFillUp: FillUp,
  currentFillUp: FillUp,
  fuelType?: Vehicle['fuelType']
): number | null {
  if (!currentFillUp.isFull || !previousFillUp.isFull) return null;
  let distance: number | null = null;
  if (
    currentFillUp.odometer != null &&
    previousFillUp.odometer != null &&
    currentFillUp.odometer > previousFillUp.odometer
  ) {
    distance = currentFillUp.odometer - previousFillUp.odometer;
  } else if (currentFillUp.distanceSinceLastKm != null && currentFillUp.distanceSinceLastKm > 0) {
    distance = currentFillUp.distanceSinceLastKm;
  }
  if (!distance || distance <= 0) return null;
  const c = (currentFillUp.liters / distance) * 100;
  return isSaneConsumptionSample(c, fuelType) ? c : null;
}

/**
 * Conso L/100 affichable depuis litres + distance.
 * Retourne null si absurde (ex. 39 L / 34 km → 113 L/100 = km GPS incomplets).
 */
export function consumptionFromLitersAndDistance(
  liters: number,
  distanceKm: number | null | undefined,
  fuelType?: Vehicle['fuelType']
): number | null {
  if (!(liters > 0) || !(distanceKm != null && distanceKm > 0)) return null;
  const c = (liters / distanceKm) * 100;
  return isSaneConsumptionSample(c, fuelType) ? c : null;
}

/** Écarte les L/100 absurdes (saisie km / litres incohérente). */
export function isSaneConsumptionSample(lPer100: number, fuelType?: Vehicle['fuelType']): boolean {
  if (!Number.isFinite(lPer100) || lPer100 <= 0) return false;
  if (fuelType === 'electrique') return lPer100 >= 5 && lPer100 <= 40;
  return lPer100 >= 3 && lPer100 <= 18;
}

/** Statistiques de consommation pour un véhicule (compteur OU km GPS/manuel) */
export async function getConsumptionStats(vehicleId: number): Promise<ConsumptionStats> {
  const [fillUps, trips, vehicle] = await Promise.all([
    getFillUps(vehicleId),
    getTrips(vehicleId, { omitRoutePoints: true }),
    getVehicleById(vehicleId),
  ]);
  const ordered = [...fillUps].sort((a, b) => a.date.localeCompare(b.date));
  const fullFillUps = ordered.filter((f) => f.isFull);

  let totalDistance = 0;
  let totalFuel = 0;
  const consumptions: number[] = [];

  for (let i = 1; i < fullFillUps.length; i++) {
    const prev = fullFillUps[i - 1];
    const curr = fullFillUps[i];
    const distance = resolveFillUpDistanceKm(prev, curr, trips);
    if (distance && distance > 0 && curr.liters > 0) {
      totalDistance += distance;
      totalFuel += curr.liters;
      consumptions.push((curr.liters / distance) * 100);
    }
  }

  // Tout plein avec km saisis depuis le précédent (complet ou partiel)
  for (const f of ordered) {
    if (f.distanceSinceLastKm && f.distanceSinceLastKm > 0 && f.liters > 0) {
      const c = (f.liters / f.distanceSinceLastKm) * 100;
      if (!isSaneConsumptionSample(c, vehicle?.fuelType)) continue;
      if (!consumptions.some((x) => Math.abs(x - c) < 0.05)) {
        consumptions.push(c);
        totalDistance += f.distanceSinceLastKm;
        totalFuel += f.liters;
      }
    }
  }

  const tripKm = trips
    .filter((t) => !t.isActive && t.status !== 'rejected' && t.distanceKm > 0)
    .reduce((s, t) => s + t.distanceKm, 0);
  if (tripKm > totalDistance) {
    totalDistance = Math.round(tripKm * 10) / 10;
  }

  const totalCost = fillUps.reduce((sum, f) => sum + f.totalCost, 0);
  const sane = consumptions.filter((c) => isSaneConsumptionSample(c, vehicle?.fuelType));

  return {
    averageConsumption:
      sane.length > 0 ? sane.reduce((a, b) => a + b, 0) / sane.length : 0,
    totalDistance,
    totalFuel,
    totalCost,
    fillUpCount: fillUps.length,
  };
}

/** Agrégats pleins pour un mois (AAAA-MM) */
export function getMonthFillStats(
  fillUps: FillUp[],
  monthKey: string,
  fuelType?: Vehicle['fuelType']
): MonthFillStats {
  const monthFills = fillUps.filter((f) => monthKeyFromDate(f.date) === monthKey);
  const totalCost = monthFills.reduce((s, f) => s + f.totalCost, 0);
  const totalLiters = monthFills.reduce((s, f) => s + f.liters, 0);
  let totalDistanceKm = 0;
  const consumptions: number[] = [];
  for (const f of monthFills) {
    if (f.distanceSinceLastKm && f.distanceSinceLastKm > 0 && f.liters > 0) {
      const c = (f.liters / f.distanceSinceLastKm) * 100;
      // Ignore km GPS partiels qui donnent une conso absurde
      if (!isSaneConsumptionSample(c, fuelType)) continue;
      totalDistanceKm += f.distanceSinceLastKm;
      consumptions.push(c);
    }
  }
  return {
    monthKey,
    count: monthFills.length,
    totalCost,
    totalLiters,
    avgPricePerLiter: totalLiters > 0 ? totalCost / totalLiters : 0,
    avgConsumption:
      consumptions.length > 0
        ? consumptions.reduce((a, b) => a + b, 0) / consumptions.length
        : null,
    totalDistanceKm,
  };
}

export type MonthFillCompare = {
  current: MonthFillStats;
  previous: MonthFillStats;
  deltaCost: number;
  deltaLiters: number;
  deltaCostPct: number | null;
  deltaConsumption: number | null;
};

/** Comparatif mois N vs N-1 (coût, litres, L/100). */
export function compareMonthFillStats(
  fillUps: FillUp[],
  currentMonthKey: string,
  previousMonthKey: string,
  fuelType?: Vehicle['fuelType']
): MonthFillCompare {
  const current = getMonthFillStats(fillUps, currentMonthKey, fuelType);
  const previous = getMonthFillStats(fillUps, previousMonthKey, fuelType);
  const deltaCost = Math.round((current.totalCost - previous.totalCost) * 100) / 100;
  const deltaLiters = Math.round((current.totalLiters - previous.totalLiters) * 100) / 100;
  const deltaCostPct =
    previous.totalCost > 0
      ? Math.round(((current.totalCost - previous.totalCost) / previous.totalCost) * 1000) / 10
      : null;
  // L/100 seulement si les deux moyennes sont saines (déjà filtrées)
  const deltaConsumption =
    current.avgConsumption != null && previous.avgConsumption != null
      ? Math.round((current.avgConsumption - previous.avgConsumption) * 10) / 10
      : null;
  return { current, previous, deltaCost, deltaLiters, deltaCostPct, deltaConsumption };
}

/**
 * Autonomie restante estimée à partir des trajets depuis le dernier plein
 * (pas un demi-réservoir théorique).
 */
export async function getSinceLastFillStats(vehicleId: number): Promise<SinceLastFillStats> {
  const [vehicle, fillUps, trips] = await Promise.all([
    getVehicleById(vehicleId),
    getFillUps(vehicleId),
    getTrips(vehicleId, { omitRoutePoints: true }),
  ]);
  const empty: SinceLastFillStats = {
    lastFill: null,
    tripKm: 0,
    tripCount: 0,
    fuelUsedEst: 0,
    costEst: 0,
    fuelRemainingEst: 0,
    rangeKm: 0,
  };
  if (!vehicle) return empty;

  const rangeFromLiters = (liters: number, lPer100: number) =>
    lPer100 > 0 ? Math.round((Math.max(0, liters) / lPer100) * 1000) / 10 : 0;

  // Pas encore de plein : autonomie jauge + km déjà parcourus (pour 1er plein)
  if (!fillUps.length) {
    const allTrips = trips.filter(
      (t) => !t.isActive && t.status !== 'rejected' && t.distanceKm > 0
    );
    const tripKm = Math.round(allTrips.reduce((s, t) => s + t.distanceKm, 0) * 10) / 10;
    if (vehicle.estimatedFuelLiters == null && tripKm <= 0) return empty;
    const fuelRemainingEst =
      vehicle.estimatedFuelLiters == null
        ? 0
        : Math.max(0, Math.round(vehicle.estimatedFuelLiters * 100) / 100);
    const l100 = estimateTripFuelLiters(vehicle, 100);
    return {
      ...empty,
      tripKm,
      tripCount: allTrips.length,
      fuelRemainingEst,
      rangeKm: rangeFromLiters(fuelRemainingEst, l100),
    };
  }

  const lastFill = [...fillUps].sort((a, b) => b.date.localeCompare(a.date))[0];
  const since = trips.filter(
    (t) =>
      !t.isActive &&
      t.status !== 'rejected' &&
      t.distanceKm > 0 &&
      t.startTime >= lastFill.date
  );
  const tripKm = Math.round(since.reduce((s, t) => s + t.distanceKm, 0) * 10) / 10;
  const fuelUsedEst = Math.round(estimateTripFuelLiters(vehicle, tripKm) * 100) / 100;
  const price =
    lastFill.pricePerLiter > 0
      ? lastFill.pricePerLiter
      : vehicle.defaultFuelPrice > 0
        ? vehicle.defaultFuelPrice
        : 0;
  const costFromTrips = since.reduce((s, t) => s + (t.estimatedCost || 0), 0);
  const costEst =
    Math.round((costFromTrips > 0 ? costFromTrips : fuelUsedEst * price) * 100) / 100;
  const startFuel = lastFill.isFull
    ? vehicle.tankCapacity
    : vehicle.estimatedFuelLiters != null
      ? vehicle.estimatedFuelLiters + fuelUsedEst
      : Math.min(vehicle.tankCapacity, lastFill.liters);
  const fuelRemainingEst =
    vehicle.estimatedFuelLiters != null
      ? Math.max(0, Math.round(vehicle.estimatedFuelLiters * 100) / 100)
      : Math.max(0, Math.round((startFuel - fuelUsedEst) * 100) / 100);
  const effectiveL100 =
    tripKm > 0 ? (fuelUsedEst / tripKm) * 100 : estimateTripFuelLiters(vehicle, 100);
  const rangeKm = rangeFromLiters(fuelRemainingEst, effectiveL100);

  return {
    lastFill,
    tripKm,
    tripCount: since.length,
    fuelUsedEst,
    costEst,
    fuelRemainingEst,
    rangeKm,
  };
}

/**
 * Adapte la conso du véhicule aux pleins de CET utilisateur.
 * Priorité forte au dernier plein (surtout complet) — lissage léger, pas de plafond trop serré.
 */
export async function adaptVehicleConsumption(
  vehicleId: number
): Promise<{ previous: number; next: number; measured: number; samples: number } | null> {
  const vehicle = await getVehicleById(vehicleId);
  if (!vehicle) return null;
  if (vehicle.consumptionAutoAdapt === false) return null;
  if (vehicle.fuelType === 'electrique') return null;

  const [fillUps, trips] = await Promise.all([
    getFillUps(vehicleId),
    getTrips(vehicleId, { omitRoutePoints: true }),
  ]);
  const ordered = [...fillUps].sort((a, b) => a.date.localeCompare(b.date));
  const samples: number[] = [];
  const seen = new Set<string>();

  const pushSample = (liters: number, distance: number) => {
    if (!(liters > 0) || !(distance >= 20)) return;
    const c = (liters / distance) * 100;
    if (!isSaneConsumptionSample(c, vehicle.fuelType)) return;
    const key = `${distance.toFixed(1)}:${liters.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push(c);
  };

  // Plein → plein : compteur, km saisis, ou trajets GPS du même véhicule
  const fulls = ordered.filter((f) => f.isFull);
  for (let i = 1; i < fulls.length; i++) {
    const distance = resolveFillUpDistanceKm(fulls[i - 1], fulls[i], trips);
    if (distance) pushSample(fulls[i].liters, distance);
  }

  // Tout plein avec km depuis le précédent (complet ou partiel)
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    if (f.distanceSinceLastKm && f.distanceSinceLastKm >= 20 && f.liters > 0) {
      pushSample(f.liters, f.distanceSinceLastKm);
      continue;
    }
    // Repli trajets : même véhicule, entre ce plein et le précédent
    const prev = i > 0 ? ordered[i - 1] : null;
    const tripKm = resolveFillUpDistanceKm(prev, f, trips);
    if (tripKm) pushSample(f.liters, tripKm);
  }

  const sane = samples.filter((c) => isSaneConsumptionSample(c, vehicle.fuelType));
  if (sane.length === 0) return null;

  // Dernières mesures : poids croissant (le dernier plein compte le plus)
  const recent = sane.slice(-6);
  let wSum = 0;
  let cSum = 0;
  recent.forEach((c, i) => {
    const w = (i + 1) * (i + 1); // 1,4,9… — très orienté récent
    wSum += w;
    cSum += c * w;
  });
  const measured = cSum / wSum;
  const prev = vehicle.consumptionPer100 > 0 ? vehicle.consumptionPer100 : measured;
  // 1er échantillon : coller fort à la mesure (pleins réels du véhicule)
  const measureWeight = sane.length === 1 ? 0.9 : 0.75;
  let next = measured * measureWeight + prev * (1 - measureWeight);
  const maxDelta = Math.max(1.2, prev * 0.35);
  next = Math.min(prev + maxDelta, Math.max(prev - maxDelta, next));
  next = Math.round(next * 10) / 10;

  if (Math.abs(next - prev) < 0.05) {
    return {
      previous: prev,
      next: prev,
      measured: Math.round(measured * 10) / 10,
      samples: sane.length,
    };
  }

  // La conso catalogue est maintenant à jour → reset le facteur d’apprentissage
  // pour éviter de re-multiplier (double peine vers 7–8 L/100).
  await updateVehicle(vehicleId, {
    consumptionPer100: next,
    consumptionLearnFactor: 1,
  });
  return {
    previous: prev,
    next,
    measured: Math.round(measured * 10) / 10,
    samples: sane.length,
  };
}

/** Calcule le statut d'un budget avec dépenses dynamiques (pleins uniquement). */
export async function getBudgetStatus(
  budget: Budget,
  vehicleId?: number
): Promise<BudgetStatus> {
  const targetVehicleId = budget.vehicleId ?? vehicleId;
  let spent = 0;

  if (targetVehicleId) {
    const fillUps = await getFillUps(targetVehicleId);
    spent += fillUps
      .filter((f) => f.date >= budget.startDate && f.date <= budget.endDate)
      .reduce((sum, f) => sum + f.totalCost, 0);
  } else {
    const fillUps = await getFillUps();
    spent += fillUps
      .filter((f) => f.date >= budget.startDate && f.date <= budget.endDate)
      .reduce((sum, f) => sum + f.totalCost, 0);
  }

  await updateBudgetSpent(budget.id, spent);

  const remaining = Math.max(0, budget.amount - spent);
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

  const start = new Date(budget.startDate);
  const end = new Date(budget.endDate);
  const now = new Date();
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const elapsedDays = Math.max(0, (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dailyRate = elapsedDays > 0 ? spent / elapsedDays : 0;
  const remainingDays = Math.max(0, (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const projectedEndOfPeriod = spent + dailyRate * remainingDays;

  return {
    budget: { ...budget, spent },
    spent,
    remaining,
    percentUsed,
    projectedEndOfPeriod,
  };
}

/** Met à jour tous les budgets actifs pour un véhicule */
export async function refreshBudgets(vehicleId?: number): Promise<BudgetStatus[]> {
  const budgets = await getBudgets(vehicleId);
  const statuses: BudgetStatus[] = [];
  for (const budget of budgets) {
    statuses.push(await getBudgetStatus(budget, vehicleId));
  }
  return statuses;
}

/** Uniquement l’enveloppe globale (tous véhicules cumulés). */
export async function refreshAllBudgets(): Promise<BudgetStatus[]> {
  const budgets = await getBudgets();
  const statuses: BudgetStatus[] = [];
  for (const budget of budgets) {
    if (budget.vehicleId != null) continue;
    statuses.push(await getBudgetStatus(budget, undefined));
  }
  return statuses;
}

/** Enveloppe mensuelle unique (tous véhicules cumulés). */
export const DEFAULT_GLOBAL_BUDGET = 250;

/**
 * Crée l’enveloppe globale mensuelle si absente (250 € max, 806 + Touran + 206 cumulés).
 * Ne crée plus de budgets par véhicule automatiquement (évite le double compteur).
 */
export async function ensureDefaultBudgets(_vehicles: Vehicle[]): Promise<void> {
  await deactivateVehicleScopedBudgets();
  const all = await getBudgets();
  const { startDate, endDate } = getBudgetPeriodDates('monthly');

  const globals = all.filter((b) => b.vehicleId == null && b.period === 'monthly' && b.isActive);
  for (const extra of globals.slice(1)) {
    await updateBudget(extra.id, { isActive: false });
  }
  const global = globals[0];
  if (!global) {
    await createBudget({
      vehicleId: null,
      name: 'Carburant total',
      amount: DEFAULT_GLOBAL_BUDGET,
      period: 'monthly',
      startDate,
      endDate,
      isActive: true,
    });
  } else {
    const patch: Partial<{ startDate: string; endDate: string }> = {};
    // Ne force plus amount/name à chaque boot (enveloppe perso possible).
    const endMs = Date.parse(global.endDate);
    if (!Number.isFinite(endMs) || endMs < Date.now()) {
      patch.startDate = startDate;
      patch.endDate = endDate;
    }
    if (Object.keys(patch).length > 0) {
      await updateBudget(global.id, patch);
    }
  }

  // Rollover de tous les budgets mensuels actifs dont la période est expirée
  const refreshed = await getBudgets();
  for (const b of refreshed) {
    if (!b.isActive || b.period !== 'monthly') continue;
    const endMs = Date.parse(b.endDate);
    if (Number.isFinite(endMs) && endMs >= Date.now()) continue;
    await updateBudget(b.id, { startDate, endDate });
  }
}

/** Montant alloué du budget mensuel actif (global prioritaire). */
export function getActiveMonthlyAllocation(
  statuses: BudgetStatus[],
  vehicleId?: number
): number {
  const global = statuses.find(
    (s) => s.budget.vehicleId == null && s.budget.period === 'monthly'
  );
  if (global) return global.budget.amount;
  const vehicle = statuses.find(
    (s) => s.budget.vehicleId === vehicleId && s.budget.period === 'monthly'
  );
  return vehicle?.budget.amount ?? 0;
}

/** Calcule les stats en temps réel d'un trajet actif */
export function calculateTripStats(
  vehicle: Vehicle,
  distanceKm: number,
  startTime: string,
  endTime?: string | null,
  routePointsJson?: string
): { fuelUsed: number; cost: number; durationMinutes: number; movingSpeedKmh: number } {
  const points = routePointsJson ? parseRoutePoints(routePointsJson) : [];
  const fuelUsed = estimateTripFuelLiters(vehicle, distanceKm, {
    learnedFactor: vehicle.consumptionLearnFactor,
    points: points.length >= 2 ? points : undefined,
    avgSpeedKmh: points.length >= 2 ? averageMovingSpeedKmh(distanceKm, points) : undefined,
    idleRatio: idleRatioFromPoints(points),
    idleMinutes: idleMinutesFromPoints(points),
    accelFactor: accelAggressionFactor(points),
    stopGoFactor: stopAndGoFactor(points),
  });
  const cost = estimateCost(fuelUsed, vehicle.defaultFuelPrice);
  const endMs = endTime ? new Date(endTime).getTime() : Date.now();
  const wallMinutes = Math.max(0, (endMs - new Date(startTime).getTime()) / (1000 * 60));
  const movingMins = movingDurationMinutes(points);
  const durationMinutes = movingMins > 0.5 ? movingMins : wallMinutes;
  const movingSpeedKmh =
    points.length >= 2
      ? averageMovingSpeedKmh(distanceKm, points)
      : averageSpeedKmh(distanceKm, durationMinutes);
  return { fuelUsed, cost, durationMinutes, movingSpeedKmh };
}

/** Autonomie restante estimée en km (conso adaptée si fournie) */
export function estimateRange(
  vehicle: Vehicle,
  currentFuelLevel?: number,
  consumptionPer100?: number
): number {
  const fuelInTank = currentFuelLevel ?? vehicle.tankCapacity * 0.5;
  const conso = consumptionPer100 && consumptionPer100 > 0
    ? consumptionPer100
    : vehicle.consumptionPer100;
  if (conso <= 0) return 0;
  return (fuelInTank / conso) * 100;
}

/** Vitesse moyenne km/h depuis distance et durée (durée = en mouvement de préférence) */
export function averageSpeedKmh(distanceKm: number, durationMinutes: number): number {
  if (durationMinutes <= 0 || distanceKm <= 0) return 0;
  return (distanceKm / durationMinutes) * 60;
}

/** Formate un montant (devise selon le pays choisi) */
let moneyFormatter: (amount: number) => string = (amount) => `${amount.toFixed(2)} €`;

export function setMoneyFormatter(fn: (amount: number) => string) {
  moneyFormatter = fn;
}

export function formatEuro(amount: number): string {
  return moneyFormatter(amount);
}

/** Formate une consommation */
export function formatConsumption(value: number, fuelType: Vehicle['fuelType']): string {
  const unit = fuelType === 'electrique' ? 'kWh/100km' : 'L/100km';
  return `${value.toFixed(1)} ${unit}`;
}

/** Formate une distance */
export function formatDistance(km: number): string {
  return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`;
}

/** Affichage vitesse km/h — max 2 décimales (calculs restent précis). */
export function formatSpeedKmh(kmh: number): string {
  if (!Number.isFinite(kmh) || kmh <= 0) return '—';
  return `${kmh.toFixed(2)} km/h`;
}

/**
 * Compteur affiché = kilométrage de base (saisi) + km des trajets suivis.
 * Multi-voitures : indiquer le compteur à la prise en main, puis le GPS s’ajoute.
 */
export function displayOdometerKm(vehicle: {
  currentOdometer?: number | null;
  trackedKm?: number | null;
}): number {
  const base = Number(vehicle.currentOdometer) || 0;
  const tracked = Number(vehicle.trackedKm) || 0;
  return Math.round(base + tracked);
}

/** Dates de début/fin pour un budget mensuel ou annuel (calendrier local). */
export function getBudgetPeriodDates(period: Budget['period']): { startDate: string; endDate: string } {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (period === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (period === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return {
    // ISO depuis minuit/fin de journée *locale* — string-compare OK avec les fill.date ISO
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

/** Clé de période budget stable (jour local), pas le slice UTC de toISOString. */
export function budgetPeriodKey(budgetId: number, startDate: string): string {
  const d = new Date(startDate);
  const ymd = Number.isNaN(d.getTime()) ? startDate.slice(0, 10) : toLocalYmd(d);
  return `${budgetId}:${ymd}`;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  /** Précision GPS en mètres (optionnel) */
  accuracy?: number;
  /** Vitesse device m/s (optionnel) */
  speed?: number;
  /** Altitude GPS (m) si fiable — pente live sans attendre Open-Meteo */
  altitude?: number;
}

export function parseRoutePoints(routePoints: string): RoutePoint[] {
  try {
    const parsed = JSON.parse(routePoints);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendRoutePoint(
  routePoints: string,
  point: RoutePoint & {
    accuracy?: number | null;
    speed?: number | null;
    altitude?: number | null;
  }
): string {
  const points = parseRoutePoints(routePoints);
  const prev = points.length > 0 ? points[points.length - 1] : null;
  const verdict = evaluateGpsSample(prev, point, { isFirst: points.length === 0 });
  if (!verdict.accept) return routePoints;

  const use = verdict.sample || point;
  // Ne pas stocker accuracy sur chaque point (JSON trop gros → OOM sur longs trajets)
  // Vitesse device (m/s) arrondie — utile pour min/max sur le détail
  const entry: RoutePoint = {
    latitude: Math.round(use.latitude * 1e6) / 1e6,
    longitude: Math.round(use.longitude * 1e6) / 1e6,
    timestamp: use.timestamp,
  };
  if (use.speed != null && Number.isFinite(use.speed) && use.speed >= 0) {
    entry.speed = Math.round(use.speed * 10) / 10;
  }
  const alt =
    'altitude' in use && typeof (use as { altitude?: number }).altitude === 'number'
      ? (use as { altitude?: number }).altitude
      : (point as { altitude?: number | null }).altitude;
  if (alt != null && Number.isFinite(alt) && Math.abs(alt) < 9000) {
    entry.altitude = Math.round(alt);
  }
  points.push(entry);
  return JSON.stringify(points);
}

/** Plafond de points GPS stockés (évite OOM / ANR). Conserve début + fin. */
export const MAX_STORED_ROUTE_POINTS = 600;

export function compactRoutePoints(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= MAX_STORED_ROUTE_POINTS) return points;
  const keepEnds = 40;
  const budget = MAX_STORED_ROUTE_POINTS - keepEnds * 2;
  const mid = points.slice(keepEnds, points.length - keepEnds);
  const step = Math.ceil(mid.length / Math.max(1, budget));
  const sampled: RoutePoint[] = [];
  for (let i = 0; i < mid.length; i += step) {
    sampled.push(mid[i]);
  }
  return [
    ...points.slice(0, keepEnds),
    ...sampled.slice(0, budget),
    ...points.slice(points.length - keepEnds),
  ];
}

export function compactRoutePointsJson(routePoints: string): string {
  const points = compactRoutePoints(parseRoutePoints(routePoints));
  return JSON.stringify(points);
}

export function calculateRouteDistance(routePoints: string): number {
  return calculateFilteredRouteDistance(parseRoutePoints(routePoints));
}
