import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { BACKGROUND_LOCATION_TASK } from '@/constants/Colors';
import {
  getActiveTripLite,
  getTripById,
  getVehicleById,
  updateTrip,
} from '@/lib/database';
import {
  calculateRouteDistance,
  compactRoutePoints,
  estimateCost,
  parseRoutePoints,
  type RoutePoint,
} from '@/lib/calculations';
import { estimateTripFuelLiters, accelAggressionFactor, stopAndGoFactor, idleRatioFromPoints, idleMinutesFromPoints, averageMovingSpeedKmh } from '@/lib/consumptionModel';
import { evaluateGpsSample, type GpsSample } from '@/lib/gpsTracking';
import { buildGoogleMapsDirUrl } from '@/lib/mapsNavigation';
import {
  readLiveTripBuffer,
  writeLiveTripBuffer,
  type LiveTripBuffer,
} from '@/lib/liveTripBuffer';

interface LocationTaskData {
  locations: Location.LocationObject[];
}

type LiveMeta = { id: number; vehicleId: number; isPaused: boolean; isActive: boolean };

/** Sérialise les mises à jour trajet (évite last-write-wins). */
let tripWriteChain: Promise<void> = Promise.resolve();
/** Empêche plusieurs startLocationUpdatesAsync en parallèle (crash LocationTaskService). */
let startInFlight: Promise<boolean> | null = null;
/** Cache RAM des points live — évite parse/stringify O(n) à chaque fix GPS. */
let livePointsCache: { tripId: number; vehicleId: number; points: RoutePoint[] } | null = null;
/** Watch premier plan : certains OEM n’envoient pas les callbacks FGS si l’app est ouverte. */
let foregroundWatch: Location.LocationSubscription | null = null;

function enqueueTripUpdate(fn: () => Promise<void>): Promise<void> {
  tripWriteChain = tripWriteChain.then(fn, fn);
  return tripWriteChain;
}

/** Attend la fin de toutes les écritures GPS en file (avant clôture trajet). */
export async function flushTripUpdates(): Promise<void> {
  await tripWriteChain;
}

function clearLivePointsCache() {
  livePointsCache = null;
}

/** Tail RAM du trajet live (pour la carte UI — sans re-lire/parser toute la DB). */
export function peekLiveRouteTail(max = 80): RoutePoint[] | null {
  if (!livePointsCache?.points?.length) return null;
  const pts = livePointsCache.points;
  return pts.length > max ? pts.slice(-max) : pts.slice();
}

export function peekLiveTripId(): number | null {
  return livePointsCache?.tripId ?? null;
}

/** Amorce le cache dès createTrip (avant le 1er fix FGS). */
export function seedLivePointsCache(
  tripId: number,
  vehicleId: number,
  points: RoutePoint[]
): void {
  livePointsCache = { tripId, vehicleId, points: points.slice() };
}

function pointFromLocation(loc: Location.LocationObject, prev: RoutePoint | null): RoutePoint | null {
  const sample: GpsSample = {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    timestamp: loc.timestamp || Date.now(),
    accuracy: loc.coords.accuracy ?? undefined,
    speed: loc.coords.speed ?? undefined,
  };
  const verdict = evaluateGpsSample(prev, sample, { isFirst: !prev });
  if (!verdict.accept) return null;
  const use = verdict.sample || sample;
  const entry: RoutePoint = {
    latitude: Math.round(use.latitude * 1e6) / 1e6,
    longitude: Math.round(use.longitude * 1e6) / 1e6,
    timestamp: use.timestamp,
  };
  if (use.speed != null && Number.isFinite(use.speed) && use.speed >= 0) {
    entry.speed = Math.round(use.speed * 10) / 10;
  }
  const alt = loc.coords.altitude;
  const altAcc = loc.coords.altitudeAccuracy;
  if (
    alt != null &&
    Number.isFinite(alt) &&
    Math.abs(alt) < 9000 &&
    (altAcc == null || altAcc < 40)
  ) {
    entry.altitude = Math.round(alt);
  }
  return entry;
}

async function resolveLiveMeta(): Promise<LiveMeta | null> {
  try {
    const lite = await getActiveTripLite();
    if (lite?.isActive && !lite.isPaused) {
      return {
        id: lite.id,
        vehicleId: lite.vehicleId,
        isPaused: false,
        isActive: true,
      };
    }
    if (lite && !lite.isActive) return null;
  } catch (e) {
    console.warn('[gps] getActiveTripLite failed', e);
  }

  const buf = await readLiveTripBuffer();
  if (!buf) return null;
  try {
    const byId = await getTripById(buf.tripId);
    if (byId && !byId.isActive) return null;
    if (byId?.isActive && !byId.isPaused) {
      return { id: byId.id, vehicleId: byId.vehicleId, isPaused: false, isActive: true };
    }
  } catch {
    /* SQLite headless indisponible */
  }
  return { id: buf.tripId, vehicleId: buf.vehicleId, isPaused: false, isActive: true };
}

async function loadLivePoints(tripId: number): Promise<RoutePoint[]> {
  if (livePointsCache?.tripId === tripId) return livePointsCache.points;
  let fromDb: RoutePoint[] = [];
  try {
    const full = await getTripById(tripId);
    fromDb = parseRoutePoints(full?.routePoints || '[]');
  } catch {
    /* ignore */
  }
  const buf = await readLiveTripBuffer();
  const fromBuf = buf?.tripId === tripId ? parseRoutePoints(buf.routePoints) : [];
  return fromBuf.length > fromDb.length ? fromBuf : fromDb;
}

async function persistLivePoints(
  tripId: number,
  vehicleId: number,
  points: RoutePoint[]
): Promise<void> {
  const compacted = compactRoutePoints(points);
  livePointsCache = { tripId, vehicleId, points: compacted };
  const routePoints = JSON.stringify(compacted);
  const distanceKm = calculateRouteDistance(routePoints);

  let fuelUsed = 0;
  let cost = 0;
  try {
    const vehicle = vehicleId ? await getVehicleById(vehicleId) : null;
    if (vehicle) {
      fuelUsed = estimateTripFuelLiters(vehicle, distanceKm, {
        learnedFactor: vehicle.consumptionLearnFactor,
        points: compacted,
        avgSpeedKmh: averageMovingSpeedKmh(distanceKm, compacted),
        idleRatio: idleRatioFromPoints(compacted),
        idleMinutes: idleMinutesFromPoints(compacted),
        accelFactor: accelAggressionFactor(compacted),
        stopGoFactor: stopAndGoFactor(compacted),
      });
      cost = estimateCost(fuelUsed, vehicle.defaultFuelPrice);
    }
  } catch {
    /* conso optionnelle — ne pas bloquer le tracé */
  }

  const nextBuf: LiveTripBuffer = {
    tripId,
    vehicleId,
    routePoints,
    distanceKm,
    estimatedFuelUsed: fuelUsed,
    estimatedCost: cost,
    updatedAt: Date.now(),
    lastFixAt: Date.now(),
    acceptedFixes: compacted.length,
  };
  try {
    await writeLiveTripBuffer(nextBuf);
  } catch (e) {
    console.warn('[gps] buffer write failed', e);
  }
  try {
    await updateTrip(tripId, {
      routePoints,
      distanceKm,
      estimatedFuelUsed: fuelUsed,
      estimatedCost: cost,
    });
  } catch (e) {
    console.warn('[gps] sqlite update failed — tampon conservé', e);
  }
}

async function applyGpsLocations(locations: Location.LocationObject[]): Promise<void> {
  const batch = locations.length > 16 ? locations.slice(-16) : locations;
  const meta = await resolveLiveMeta();
  if (!meta || meta.isPaused || !meta.isActive) {
    if (!meta) clearLivePointsCache();
    return;
  }

  const points = await loadLivePoints(meta.id);
  let changed = false;
  for (const loc of batch) {
    const prev = points.length > 0 ? points[points.length - 1] : null;
    const entry = pointFromLocation(loc, prev);
    if (!entry) continue;
    points.push(entry);
    changed = true;
  }

  livePointsCache = { tripId: meta.id, vehicleId: meta.vehicleId, points };
  if (!changed) return;
  await persistLivePoints(meta.id, meta.vehicleId, points);
}

/** Recopie cache RAM + tampon AsyncStorage vers SQLite (clôture trajet). */
export async function persistLiveRoute(tripId?: number): Promise<void> {
  await tripWriteChain;
  const cache = livePointsCache;
  const buf = await readLiveTripBuffer();
  const id = tripId ?? cache?.tripId ?? buf?.tripId;
  if (!id) return;

  const cachePts = cache?.tripId === id ? cache.points : [];
  const bufPts = buf?.tripId === id ? parseRoutePoints(buf.routePoints) : [];
  let dbPts: RoutePoint[] = [];
  try {
    const full = await getTripById(id);
    dbPts = parseRoutePoints(full?.routePoints || '[]');
  } catch {
    /* ignore */
  }
  const richest =
    cachePts.length >= bufPts.length && cachePts.length >= dbPts.length
      ? cachePts
      : bufPts.length >= dbPts.length
        ? bufPts
        : dbPts;
  if (richest.length === 0) return;
  const vehicleId = cache?.vehicleId ?? buf?.vehicleId ?? 0;
  await persistLivePoints(id, vehicleId, richest);
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[gps-bg] task error', error);
    return;
  }

  const { locations } = (data || {}) as LocationTaskData;
  if (!locations || locations.length === 0) return;

  await enqueueTripUpdate(async () => {
    try {
      await applyGpsLocations(locations);
    } catch (e) {
      console.warn('[gps-bg] update failed', e);
    }
  });
});

export async function requestLocationPermissions(): Promise<boolean> {
  const { status: foreground } = await Location.requestForegroundPermissionsAsync();
  if (foreground !== 'granted') return false;

  if (Platform.OS === 'web') return true;

  // Android 13+ : sans POST_NOTIFICATIONS la FGS tourne parfois sans notif visible.
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    /* iOS / web / module absent */
  }

  const { status: background } = await Location.requestBackgroundPermissionsAsync();
  return background === 'granted';
}

async function hasOsLocationUpdates(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function isBackgroundTrackingLive(): Promise<boolean> {
  return hasOsLocationUpdates();
}

/** Dernier fix même filtré (Terminer) — évite de couper l’arrivée. */
export async function appendForcedLocation(
  tripId: number,
  loc: Location.LocationObject
): Promise<void> {
  const lat = loc.coords.latitude;
  const lon = loc.coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  let vehicleId =
    livePointsCache?.tripId === tripId ? livePointsCache.vehicleId : 0;
  const points = await loadLivePoints(tripId);
  if (!vehicleId) {
    try {
      const t = await getTripById(tripId);
      vehicleId = t?.vehicleId || 0;
    } catch {
      vehicleId = 0;
    }
  }
  const entry: RoutePoint = {
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
    timestamp: loc.timestamp || Date.now(),
  };
  const spd = loc.coords.speed;
  if (spd != null && Number.isFinite(spd) && spd >= 0) {
    entry.speed = Math.round(spd * 10) / 10;
  }
  const last = points[points.length - 1];
  if (
    last &&
    last.latitude === entry.latitude &&
    last.longitude === entry.longitude
  ) {
    last.timestamp = entry.timestamp;
    if (entry.speed != null) last.speed = entry.speed;
  } else {
    points.push(entry);
  }
  await persistLivePoints(tripId, vehicleId, points);
}

async function ensureForegroundWatch(): Promise<void> {
  if (Platform.OS === 'web' || foregroundWatch) return;
  try {
    foregroundWatch = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 4000,
        distanceInterval: 12,
      },
      (pos) => {
        void enqueueTripUpdate(async () => {
          try {
            await applyGpsLocations([pos]);
          } catch (e) {
            console.warn('[gps-fg] apply failed', e);
          }
        });
      }
    );
  } catch (e) {
    console.warn('[gps-fg] watch failed', e);
  }
}

async function stopForegroundWatch(): Promise<void> {
  try {
    foregroundWatch?.remove();
  } catch {
    /* ignore */
  }
  foregroundWatch = null;
}

/**
 * Démarre le suivi (FGS + watch premier plan).
 * Ne pas se fier à isTaskRegisteredAsync : defineTask l’enregistre au boot
 * même si le FGS n’a jamais démarré → notif orpheline / 0 km.
 */
export async function startBackgroundTracking(opts?: {
  forceRestart?: boolean;
}): Promise<boolean> {
  if (startInFlight) return startInFlight;

  startInFlight = (async () => {
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) return false;

      if (opts?.forceRestart) {
        try {
          if (await hasOsLocationUpdates()) {
            await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
          }
        } catch {
          /* ignore */
        }
        await stopForegroundWatch();
      }

      if (!(await hasOsLocationUpdates())) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
          distanceInterval: 12,
          deferredUpdatesInterval: 4000,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Hubera Fuel — suivi en cours',
            notificationBody: 'Trajet GPS en arrière-plan · ouvrez l’app pour Terminer',
            notificationColor: '#e94560',
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
        });
      }

      await ensureForegroundWatch();
      return true;
    } catch (e) {
      console.warn('[gps-bg] start failed', e);
      try {
        if (await hasOsLocationUpdates()) {
          await ensureForegroundWatch();
          return true;
        }
      } catch {
        /* ignore */
      }
      return false;
    } finally {
      startInFlight = null;
    }
  })();

  return startInFlight;
}

export async function stopBackgroundTracking(): Promise<void> {
  await stopForegroundWatch();
  try {
    if (await hasOsLocationUpdates()) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (e) {
    console.warn('[gps-bg] stop failed', e);
  }
  try {
    await persistLiveRoute();
  } catch (e) {
    console.warn('[gps-bg] persist on stop failed', e);
  } finally {
    // Ne pas vider le cache ici : finishTripCore relit encore peek/persist.
    // Le cache est vidé après flush explicite (clearLivePointsAfterFinish).
  }
}

export function clearLivePointsAfterFinish(): void {
  clearLivePointsCache();
}

export async function ensureLocationEnabled(): Promise<boolean> {
  try {
    if (await Location.hasServicesEnabledAsync()) return true;
  } catch {
    /* ignore */
  }
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    /* dialogue Android annulé ou indisponible */
  }
  try {
    if (await Location.hasServicesEnabledAsync()) return true;
  } catch {
    /* ignore */
  }
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS,
      );
    } catch {
      /* OEM sans écran réglages, ou utilisateur a annulé */
    }
  }
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

export async function getCurrentLocation(opts?: {
  /** Pour démarrer un trajet : frais + précis, pas last-known lâche. */
  fresh?: boolean;
  /** Timeout ms (faible réseau / GPS lent) — fallback last-known. */
  timeoutMs?: number;
}): Promise<Location.LocationObject | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  await ensureLocationEnabled();

  const readLast = async (maxAge: number, accuracy: number) => {
    try {
      return await Location.getLastKnownPositionAsync({
        maxAge,
        requiredAccuracy: accuracy,
      });
    } catch {
      return null;
    }
  };

  if (!opts?.fresh) {
    const last = await readLast(30 * 60_000, 500);
    if (last) return last;
  } else {
    const last = await readLast(120_000, 250);
    if (last && (last.coords.accuracy == null || last.coords.accuracy <= 150)) {
      // On continue quand même vers un fix frais, mais on a un fallback.
      const timeoutMs = opts?.timeoutMs ?? 8000;
      try {
        const fix = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            mayShowUserSettingsDialog: true,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        if (fix) return fix;
      } catch {
        /* ignore */
      }
      return last;
    }
  }

  const timeoutMs = opts?.timeoutMs ?? (opts?.fresh ? 10_000 : 12_000);
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: opts?.fresh ? Location.Accuracy.High : Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (fix) return fix;
  } catch {
    /* ignore */
  }
  return readLast(opts?.fresh ? 10 * 60_000 : 45 * 60_000, 800);
}

/** Ouvre Google Maps pour la navigation vers une destination */
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

/** Ouvre Google Maps avec une recherche */
export function openGoogleMapsSearch(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Récupère l'itinéraire via Google Directions API (nécessite une clé API) */
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

/** Décode une polyline Google Maps en coordonnées */
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
