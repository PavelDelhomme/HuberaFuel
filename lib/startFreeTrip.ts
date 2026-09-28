/**
 * Démarrage / pause GPS depuis Maps — sans passer par l’onglet Trajet
 * (onglet masqué : router.push n’affiche souvent que la notif FGS).
 */
import { Platform } from 'react-native';
import type { Vehicle } from '@/types';
import {
  addTrackedKm,
  createTrip,
  getActiveTrip,
  getActiveTripLite,
  getPlaces,
  getTripById,
  getVehicleById,
  updateTrip,
} from '@/lib/database';
import { clearLiveTripBuffer, seedLiveTripBuffer } from '@/lib/liveTripBuffer';
import {
  calculateRouteDistance,
  estimateCost,
  parseRoutePoints,
} from '@/lib/calculations';
import { estimateTripFuelLiters } from '@/lib/consumptionModel';
import { applyTripFuelBurn, setFuelLiters } from '@/lib/fuelLevel';
import { recordFuelGaugeReading } from '@/lib/fuelGaugeHistory';
import { askFuelGaugeApprox } from '@/lib/fuelGaugePrompt';
import {
  flushTripUpdates,
  getCurrentLocation,
  persistLiveRoute,
  seedLivePointsCache,
  startBackgroundTracking,
  stopBackgroundTracking,
  clearLivePointsAfterFinish,
} from '@/lib/locationService';
import { freeTripNote } from '@/lib/startFreeTripNote';
import {
  disambiguateSameEndpoints,
  resolveTripEndpointLabel,
} from '@/lib/placeLabels';

export type GpsTripStartResult =
  | { ok: true; tripId: number; trackingStarted: boolean }
  | { ok: false; error: string };

let inFlight = false;
/** Anti multi-tap : un 2ᵉ démarrage à chaud tuait le 1ᵉr trajet → 0 km. */
let lastStartAt = 0;
const START_COOLDOWN_MS = 4000;

/**
 * Clôture propre d’un trajet actif avant un nouveau départ
 * (persist GPS + distance + conso — jamais un wipe silencieux via stopActiveTrips).
 */
async function closeActiveTripSafely(tripId: number): Promise<void> {
  try {
    await flushTripUpdates();
  } catch {
    /* ignore */
  }
  try {
    await stopBackgroundTracking();
  } catch {
    /* ignore */
  }
  try {
    await persistLiveRoute(tripId);
  } catch {
    /* ignore */
  }

  const trip = await getTripById(tripId);
  if (!trip) return;

  const routeJson = trip.routePoints || '[]';
  const pts = parseRoutePoints(routeJson);
  const distanceKm =
    pts.length >= 2
      ? Math.round(calculateRouteDistance(routeJson) * 1000) / 1000
      : Number(trip.distanceKm) || 0;

  let estimatedFuelUsed = Number(trip.estimatedFuelUsed) || 0;
  let estimatedCostVal = Number(trip.estimatedCost) || 0;
  try {
    const vehicle = await getVehicleById(trip.vehicleId);
    if (vehicle && distanceKm > 0) {
      estimatedFuelUsed = estimateTripFuelLiters(vehicle, distanceKm, { points: pts });
      estimatedCostVal = estimateCost(estimatedFuelUsed, vehicle.defaultFuelPrice);
      await applyTripFuelBurn(vehicle, distanceKm, 0, { tripId });
      const after = await getVehicleById(trip.vehicleId).catch(() => vehicle);
      const endLiters = after?.estimatedFuelLiters ?? vehicle.estimatedFuelLiters;
      if (endLiters != null) {
        await recordFuelGaugeReading({
          vehicleId: trip.vehicleId,
          liters: endLiters,
          source: 'trip_end',
          tripId,
        });
      }
    }
  } catch {
    /* ignore conso */
  }

  const tiny = distanceKm < 0.25;
  await updateTrip(tripId, {
    isActive: false,
    isPaused: false,
    endTime: new Date().toISOString(),
    distanceKm,
    estimatedFuelUsed,
    estimatedCost: estimatedCostVal,
    status: tiny ? 'rejected' : 'confirmed',
    note: tiny
      ? [trip.note?.trim(), '[clôturé: redémarrage trop tôt / 0 km]'].filter(Boolean).join(' ')
      : trip.note,
  });
  if (!tiny && distanceKm > 0) {
    await addTrackedKm(trip.vehicleId, distanceKm).catch(() => undefined);
  }
  await clearLiveTripBuffer();
  clearLivePointsAfterFinish();
}

export async function startGpsTrip(opts: {
  vehicle: Vehicle;
  refresh?: () => Promise<void>;
  destinationName?: string;
  /** Maps silent : pas de modal jauge (on reste dans Maps). */
  skipGauge?: boolean;
}): Promise<GpsTripStartResult> {
  if (inFlight) return { ok: false, error: 'Démarrage déjà en cours' };
  if (Date.now() - lastStartAt < START_COOLDOWN_MS) {
    return { ok: false, error: 'Attendez 2–3 s — un suivi vient d’être lancé' };
  }
  inFlight = true;
  try {
    const live = await getActiveTripLite();
    if (live?.isActive) {
      const ageMs = Date.now() - (Date.parse(live.startTime) || 0);
      // Trajet tout juste créé (< 2 min, quasi 0 km) → reprendre le FGS, ne pas créer un 2ᵉ
      if ((live.distanceKm || 0) < 0.3 && ageMs < 120_000) {
        const trackingStarted = await startBackgroundTracking({ forceRestart: true });
        const ok =
          trackingStarted || (await startBackgroundTracking({ forceRestart: true }));
        lastStartAt = Date.now();
        await opts.refresh?.();
        return { ok: true, tripId: live.id, trackingStarted: ok };
      }
      return { ok: false, error: 'Un trajet est déjà en cours — terminez-le d’abord' };
    }

    // Zombie actif non vu par lite : clôture propre (jamais stopActiveTrips nu)
    try {
      const full = await getActiveTrip();
      if (full?.isActive) {
        await closeActiveTripSafely(full.id);
      }
    } catch {
      /* ignore */
    }

    await stopBackgroundTracking();
    await clearLiveTripBuffer();

    if (!opts.skipGauge) {
      try {
        const gauge = await askFuelGaugeApprox(
          opts.vehicle,
          'Niveau de carburant au départ',
          'Réglez la jauge pour affiner la consommation estimée.',
          { softSkip: true }
        );
        if (!gauge.skipped) {
          await setFuelLiters(opts.vehicle, gauge.liters);
        }
      } catch {
        /* ne bloque pas le départ GPS */
      }
    }

    const loc = await getCurrentLocation({
      fresh: true,
      timeoutMs: opts.skipGauge ? 2800 : 7000,
    });
    const startPoint = loc
      ? [
          {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            timestamp: Date.now(),
            accuracy: loc.coords.accuracy ?? undefined,
          },
        ]
      : [];

    // Places + reverse géocode court — ne bloque pas hors-ligne / réseau pourri
    let originName = 'Position de départ';
    try {
      const places = await getPlaces().catch(() => []);
      const origin = await resolveTripEndpointLabel({
        places,
        coords: loc
          ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          : null,
        role: 'origin',
        geocodeTimeoutMs: opts.skipGauge ? 1 : 2000,
      });
      originName = origin.displayName;
    } catch {
      /* offline OK */
    }

    const isWeb = Platform.OS === 'web';
    const destName = opts.destinationName?.trim() || undefined;
    const tripId = await createTrip({
      vehicleId: opts.vehicle.id,
      startTime: new Date().toISOString(),
      endTime: null,
      distanceKm: 0,
      estimatedFuelUsed: 0,
      estimatedCost: 0,
      routePoints: JSON.stringify(startPoint),
      originName,
      destinationName: destName,
      isActive: true,
      isPaused: false,
      status: 'confirmed',
      source: 'gps',
      fillUpId: null,
      note: destName ? undefined : freeTripNote(isWeb),
    });

    if (opts.vehicle.estimatedFuelLiters != null) {
      const v = await getVehicleById(opts.vehicle.id).catch(() => opts.vehicle);
      const liters = v?.estimatedFuelLiters ?? opts.vehicle.estimatedFuelLiters;
      if (liters != null) {
        await recordFuelGaugeReading({
          vehicleId: opts.vehicle.id,
          liters,
          source: 'trip_start',
          tripId,
        });
      }
    }

    seedLivePointsCache(tripId, opts.vehicle.id, startPoint);
    await seedLiveTripBuffer({
      tripId,
      vehicleId: opts.vehicle.id,
      routePoints: JSON.stringify(startPoint),
    });

    const trackingStarted = await startBackgroundTracking({ forceRestart: true });
    const ok =
      trackingStarted || (await startBackgroundTracking({ forceRestart: true }));
    lastStartAt = Date.now();
    await opts.refresh?.();

    return { ok: true, tripId, trackingStarted: ok };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Impossible de démarrer le trajet',
    };
  } finally {
    inFlight = false;
  }
}

/** Alias historique (suivi libre sans destination). */
export function startFreeGpsTrip(opts: {
  vehicle: Vehicle;
  refresh?: () => Promise<void>;
}): Promise<GpsTripStartResult> {
  return startGpsTrip(opts);
}

export async function pauseGpsTrip(
  tripId: number,
  refresh?: () => Promise<void>
): Promise<void> {
  await stopBackgroundTracking();
  await updateTrip(tripId, { isPaused: true });
  await refresh?.();
}

export async function resumeGpsTrip(
  tripId: number,
  refresh?: () => Promise<void>
): Promise<boolean> {
  await updateTrip(tripId, { isPaused: false });
  const ok = await startBackgroundTracking({ forceRestart: true });
  await refresh?.();
  return ok;
}

/** Clôture légère depuis Maps (sans écran récap Trajet). */
export async function stopGpsTripLite(opts: {
  tripId: number;
  vehicleId: number;
  distanceKm: number;
  refresh?: () => Promise<void>;
}): Promise<void> {
  try {
    await flushTripUpdates();
  } catch {
    /* ignore */
  }
  try {
    await stopBackgroundTracking();
  } catch {
    /* déjà arrêté */
  }
  try {
    await persistLiveRoute(opts.tripId);
  } catch {
    /* ignore */
  }

  const trip = await getTripById(opts.tripId);
  const routeJson = trip?.routePoints || '[]';
  const pts = parseRoutePoints(routeJson);
  const fromPts =
    pts.length >= 2 ? Math.round(calculateRouteDistance(routeJson) * 1000) / 1000 : 0;
  const distanceKm = Math.max(Number(opts.distanceKm) || 0, fromPts);

  let estimatedFuelUsed = 0;
  let estimatedCostVal = 0;
  const tiny = distanceKm < 0.25;
  // Ne pas brûler la jauge sur un trajet rejeté / bruit GPS (sinon −plusieurs L pour 0 m UI).
  if (!tiny && distanceKm > 0) {
    try {
      const vehicle = await getVehicleById(opts.vehicleId);
      if (vehicle) {
        estimatedFuelUsed = estimateTripFuelLiters(vehicle, distanceKm, { points: pts });
        estimatedCostVal = estimateCost(estimatedFuelUsed, vehicle.defaultFuelPrice);
        await applyTripFuelBurn(vehicle, distanceKm, 0, { tripId: opts.tripId });
        const after = await getVehicleById(opts.vehicleId).catch(() => vehicle);
        const endLiters = after?.estimatedFuelLiters ?? vehicle.estimatedFuelLiters;
        if (endLiters != null) {
          await recordFuelGaugeReading({
            vehicleId: opts.vehicleId,
            liters: endLiters,
            source: 'trip_end',
            tripId: opts.tripId,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Libellés : places enregistrées > reverse geocode (timeout court = offline OK)
  let originName = trip?.originName || null;
  let destinationName = trip?.destinationName || null;
  let noteExtra: string | null = null;
  try {
    const places = await getPlaces().catch(() => []);
    const startPt = pts[0] || null;
    const endPt = pts.length > 1 ? pts[pts.length - 1] : startPt;
    let origin = await resolveTripEndpointLabel({
      places,
      coords: startPt,
      existingName: originName,
      role: 'origin',
      geocodeTimeoutMs: 2500,
    });
    let destination = await resolveTripEndpointLabel({
      places,
      coords: endPt,
      existingName: destinationName,
      role: 'destination',
      geocodeTimeoutMs: 2500,
    });
    ({ origin, destination } = disambiguateSameEndpoints(origin, destination, distanceKm));
    originName = origin.displayName;
    destinationName = destination.displayName;
    const details = [origin.detailAddress, destination.detailAddress]
      .filter(Boolean)
      .filter((a, i, arr) => arr.indexOf(a) === i);
    if (details.length) {
      noteExtra = `Adresses : ${details.join(' → ')}`;
    }
  } catch {
    /* ignore naming */
  }

  const mergedNote = [trip?.note, noteExtra].filter(Boolean).join('\n') || undefined;

  await updateTrip(opts.tripId, {
    isActive: false,
    isPaused: false,
    endTime: new Date().toISOString(),
    distanceKm: tiny ? 0 : distanceKm,
    estimatedFuelUsed,
    estimatedCost: estimatedCostVal,
    status: tiny ? 'rejected' : 'confirmed',
    originName: originName || trip?.originName || undefined,
    destinationName: destinationName || trip?.destinationName || undefined,
    note: mergedNote,
  });
  if (!tiny && distanceKm > 0) {
    await addTrackedKm(opts.vehicleId, distanceKm).catch(() => undefined);
  }
  await clearLiveTripBuffer();
  clearLivePointsAfterFinish();
  await opts.refresh?.();
}

/** Tests / reset interne. */
export function resetGpsTripInFlight(): void {
  inFlight = false;
  lastStartAt = 0;
}

export function resetFreeTripInFlight(): void {
  resetGpsTripInFlight();
}
