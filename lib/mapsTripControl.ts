/**
 * Commandes trajet / plein reçues depuis Hubera Maps (sans rester sur l’UI Fuel).
 */
import { getActiveTripLite, getActiveVehicle, getTripById, createFillUp, getTrips } from '@/lib/database';
import { peekLiveRouteTail } from '@/lib/locationService';
import { calculateRouteDistance } from '@/lib/calculations';
import { applyFillUpToFuelEstimate } from '@/lib/fuelLevel';
import { encodeMapsTripPack } from '@/lib/mapsTripList';
import { pauseGpsTrip, resumeGpsTrip, startGpsTrip, stopGpsTripLite } from '@/lib/startFreeTrip';

export type MapsTripControlInput = {
  action?: string;
  tripId?: string;
  liters?: string;
  total?: string;
  station?: string;
  dest?: string;
};

export type MapsTripControlResult = {
  ok: boolean;
  message: string;
  tripId?: number;
  /** Pack compact pour l’onglet Trajets de Maps. */
  trips?: string;
  trackingStarted?: boolean;
  km?: number;
};

async function packRecentTrips(): Promise<string> {
  const trips = await getTrips(undefined, { omitRoutePoints: true });
  return encodeMapsTripPack(trips);
}

function num(v: string | undefined): number {
  const n = Number(String(v || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export async function runMapsTripControl(
  input: MapsTripControlInput,
  refresh?: () => Promise<void>
): Promise<MapsTripControlResult> {
  const action = String(input.action || '').toLowerCase();
  const live = await getActiveTripLite();
  const vehicle = await getActiveVehicle();
  const asked = num(input.tripId);
  const tripId = asked > 0 ? asked : live?.id;
  const vehicleId = vehicle?.id ?? live?.vehicleId ?? 0;

  if (action === 'history') {
    const trips = await packRecentTrips();
    return {
      ok: true,
      message: 'Historique Fuel',
      tripId: live?.id,
      trips,
    };
  }

  if (action === 'start') {
    if (!vehicle) return { ok: false, message: 'Aucun véhicule Fuel actif.' };
    if (live) {
      if (live.isPaused) {
        await resumeGpsTrip(live.id, refresh).catch(() => undefined);
      }
      return {
        ok: true,
        message: 'Suivi Fuel déjà en cours.',
        tripId: live.id,
        trips: await packRecentTrips(),
        trackingStarted: true,
      };
    }
    const started = await startGpsTrip({
      vehicle,
      refresh,
      destinationName: input.dest?.trim() || undefined,
      skipGauge: true,
    });
    if (!started.ok) return { ok: false, message: started.error };
    return {
      ok: true,
      message: started.trackingStarted ? 'Suivi Fuel démarré.' : 'Trajet créé — GPS Fuel pas encore actif.',
      tripId: started.tripId,
      trips: await packRecentTrips(),
      trackingStarted: started.trackingStarted,
    };
  }

  if (action === 'fill') {
    if (!vehicle) return { ok: false, message: 'Aucun véhicule Fuel actif.' };
    const liters = num(input.liters);
    const total = num(input.total);
    if (liters <= 0 && total <= 0) {
      return { ok: false, message: 'Indique litres ou montant.' };
    }
    const L = liters > 0 ? liters : total / (vehicle.defaultFuelPrice || 1.7);
    const cost = total > 0 ? total : L * (vehicle.defaultFuelPrice || 1.7);
    const ppl = L > 0 ? cost / L : vehicle.defaultFuelPrice;
    const station = input.station?.trim();
    const fillId = await createFillUp({
      vehicleId: vehicle.id,
      date: new Date().toISOString(),
      liters: Math.round(L * 100) / 100,
      pricePerLiter: Math.round(ppl * 1000) / 1000,
      totalCost: Math.round(cost * 100) / 100,
      odometer: vehicle.hasOdometer ? vehicle.currentOdometer : null,
      distanceSinceLastKm: null,
      isFull: true,
      note: station ? `Maps · ${station}` : 'Plein depuis Hubera Maps',
      tripId: tripId || null,
    });
    await applyFillUpToFuelEstimate(vehicle, { liters: L, isFull: true, id: fillId });
    if (tripId) {
      await pauseGpsTrip(tripId, refresh).catch(() => undefined);
    } else {
      await refresh?.();
    }
    return { ok: true, message: 'Plein enregistré dans Fuel.', tripId, trips: await packRecentTrips() };
  }

  if (!tripId) return { ok: false, message: 'Aucun trajet Fuel actif.' };

  if (action === 'pause') {
    await pauseGpsTrip(tripId, refresh);
    return { ok: true, message: 'Suivi Fuel en pause.', tripId };
  }
  if (action === 'resume') {
    const ok = await resumeGpsTrip(tripId, refresh);
    return {
      ok,
      message: ok ? 'Suivi Fuel repris.' : 'Localisation refusée — suivi non repris.',
      tripId,
    };
  }
  if (action === 'stop') {
    const tail = peekLiveRouteTail() || [];
    const km = tail.length >= 2 ? calculateRouteDistance(JSON.stringify(tail)) : 0;
    const trip = await getTripById(tripId);
    await stopGpsTripLite({
      tripId,
      vehicleId: vehicleId || trip?.vehicleId || 0,
      distanceKm: km,
      refresh,
    });
    return { ok: true, message: 'Trajet Fuel terminé.', tripId, trips: await packRecentTrips(), km };
  }

  return { ok: false, message: 'Action Maps inconnue.' };
}
