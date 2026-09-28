/**
 * GPS web / iOS PWA : suivi au premier plan (onglet ouvert).
 * Pas d’arrière-plan navigateur — garde l’app ouverte pendant le trajet.
 */
import type * as Location from 'expo-location';
import {
  getActiveTrip,
  getVehicleById,
  updateTrip,
} from '@/lib/database';
import {
  appendRoutePoint,
  calculateRouteDistance,
  compactRoutePointsJson,
  estimateCost,
  parseRoutePoints,
} from '@/lib/calculations';
import {
  averageMovingSpeedKmh,
  accelAggressionFactor,
  estimateTripFuelLiters,
  idleRatioFromPoints,
  idleMinutesFromPoints,
  stopAndGoFactor,
} from '@/lib/consumptionModel';
import { buildGoogleMapsDirUrl } from '@/lib/mapsNavigation';

let watchId: number | null = null;
let applying = false;
const pending: GeolocationPosition[] = [];

function toLocationObject(pos: GeolocationPosition): Location.LocationObject {
  return {
    coords: {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitude: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      altitudeAccuracy: pos.coords.altitudeAccuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
    },
    timestamp: pos.timestamp,
  } as Location.LocationObject;
}

async function flushPending() {
  if (applying) return;
  applying = true;
  try {
    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      const trip = await getActiveTrip();
      if (!trip || trip.isPaused || !trip.isActive) continue;

      const vehicle = await getVehicleById(trip.vehicleId).catch(() => null);

      let routePoints = trip.routePoints;
      for (const pos of batch) {
        routePoints = appendRoutePoint(routePoints, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timestamp: pos.timestamp || Date.now(),
          accuracy: pos.coords.accuracy ?? undefined,
          speed: pos.coords.speed ?? undefined,
          altitude:
            pos.coords.altitude != null &&
            Number.isFinite(pos.coords.altitude) &&
            (pos.coords.altitudeAccuracy == null || pos.coords.altitudeAccuracy < 40)
              ? pos.coords.altitude
              : undefined,
        });
      }

      routePoints = compactRoutePointsJson(routePoints);
      const distanceKm = calculateRouteDistance(routePoints);
      const pts = parseRoutePoints(routePoints);
      let fuelUsed = trip.estimatedFuelUsed || 0;
      let cost = trip.estimatedCost || 0;
      if (vehicle) {
        fuelUsed = estimateTripFuelLiters(vehicle, distanceKm, {
          learnedFactor: vehicle.consumptionLearnFactor,
          points: pts,
          avgSpeedKmh: averageMovingSpeedKmh(distanceKm, pts),
          idleRatio: idleRatioFromPoints(pts),
          idleMinutes: idleMinutesFromPoints(pts),
          accelFactor: accelAggressionFactor(pts),
          stopGoFactor: stopAndGoFactor(pts),
        });
        cost = estimateCost(fuelUsed, vehicle.defaultFuelPrice);
      }

      await updateTrip(trip.id, {
        routePoints,
        distanceKm,
        estimatedFuelUsed: fuelUsed,
        estimatedCost: cost,
      });
    }
  } catch (e) {
    console.warn('[web-gps] apply', e);
  } finally {
    applying = false;
    if (pending.length > 0) {
      void flushPending();
    }
  }
}

function enqueuePosition(pos: GeolocationPosition) {
  pending.push(pos);
  // Cap mémoire : garde les 40 derniers si le flush est lent
  if (pending.length > 40) {
    pending.splice(0, pending.length - 40);
  }
  void flushPending();
}

export async function requestLocationPermissions(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export async function startBackgroundTracking(_opts?: {
  forceRestart?: boolean;
}): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  const ok = await requestLocationPermissions();
  if (!ok) return false;

  // Déjà en cours : ne pas clearWatch (évite trou de suivi)
  if (watchId != null) {
    return true;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      enqueuePosition(pos);
    },
    (err) => {
      console.warn('[web-gps]', err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 15000,
    }
  );

  return true;
}

export async function stopBackgroundTracking(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.geolocation && watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  pending.length = 0;
}

/** Compat native : drain de la file d’écritures GPS. */
export async function flushTripUpdates(): Promise<void> {
  await flushPending();
}

export async function persistLiveRoute(_tripId?: number): Promise<void> {
  await flushPending();
}

export async function isBackgroundTrackingLive(): Promise<boolean> {
  return watchId != null;
}

export async function appendForcedLocation(
  _tripId: number,
  _loc: Location.LocationObject
): Promise<void> {
  await flushPending();
}

export function seedLivePointsCache(
  _tripId: number,
  _vehicleId: number,
  _points: { latitude: number; longitude: number; timestamp: number }[]
): void {
  /* web : pas de cache RAM FGS */
}

export function clearLivePointsAfterFinish(): void {
  /* no-op */
}

export function peekLiveRouteTail(_max = 80): null {
  return null;
}

export function peekLiveTripId(): null {
  return null;
}

export async function ensureLocationEnabled(): Promise<boolean> {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
}

export async function getCurrentLocation(opts?: {
  fresh?: boolean;
}): Promise<Location.LocationObject | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toLocationObject(pos)),
      () => resolve(null),
      {
        enableHighAccuracy: !!opts?.fresh,
        timeout: opts?.fresh ? 15000 : 8000,
        maximumAge: opts?.fresh ? 0 : 60_000,
      }
    );
  });
}

export function openGoogleMapsNavigation(
  destinationLat: number,
  destinationLng: number,
  _destinationName?: string,
  opts?: {
    origin?: { latitude: number; longitude: number };
    waypoints?: { latitude: number; longitude: number }[];
  }
): string {
  return buildGoogleMapsDirUrl({
    destination: { latitude: destinationLat, longitude: destinationLng },
    origin: opts?.origin,
    waypoints: opts?.waypoints,
    navigate: true,
  });
}

export function openGoogleMapsSearch(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export async function fetchRouteDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
): Promise<{ distanceKm: number; durationMinutes: number; polyline: string } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=driving&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== 'OK' || !data.routes?.[0]) return null;
    const route = data.routes[0];
    const leg = route.legs[0];
    return {
      distanceKm: leg.distance.value / 1000,
      durationMinutes: leg.duration.value / 60,
      polyline: route.overview_polyline.points,
    };
  } catch {
    return null;
  }
}

export function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}
