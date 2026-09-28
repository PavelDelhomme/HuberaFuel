import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Pressable,
  Platform,
  AppState,
  RefreshControl,
  PanResponder,
  Alert,
  type AppStateStatus,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { TutorialAnchor } from '@/components/TutorialAnchor';
import { useToast } from '@/context/ToastContext';
import { Card, StatCard } from '@/components/Card';
import { Button } from '@/components/Button';
import TripMap from '@/components/TripMap';
import type { TripMapRef } from '@/components/TripMap.types';
import { PlaceSuggestField } from '@/components/PlaceSuggestField';
import type { Place, Trip } from '@/types';
import {
  createTrip,
  stopActiveTrips,
  updateTrip,
  addTrackedKm,
  getTrips,
  getPendingTrips,
  deleteTrip,
  getPlaces,
  getFillUps,
  updateVehicle,
  getVehicleById,
  purgeSimulatorTrips,
  getTripById,
  getActiveTripLite,
} from '@/lib/database';
import {
  startBackgroundTracking,
  stopBackgroundTracking,
  flushTripUpdates,
  persistLiveRoute,
  seedLivePointsCache,
  clearLivePointsAfterFinish,
  getCurrentLocation,
  openGoogleMapsSearch,
  peekLiveRouteTail,
  peekLiveTripId,
  appendForcedLocation,
} from '@/lib/locationService';
import {
  seedLiveTripBuffer,
  clearLiveTripBuffer,
  readLiveTripBuffer,
} from '@/lib/liveTripBuffer';
import { buildViaWaypoints, launchGoogleMapsNavigation, openGoogleMapsHere } from '@/lib/mapsNavigation';
import {
  appendRoutePoint,
  calculateRouteDistance,
  calculateTripStats,
  compactRoutePointsJson,
  estimateCost,
  formatEuro,
  formatDistance,
  formatSpeedKmh,
  getSinceLastFillStats,
  haversineDistance,
  parseRoutePoints,
} from '@/lib/calculations';
import {
  buildWorkCommuteRoundTrip,
  playCarSimulation,
  SIM_HOME,
  SIM_WORK,
} from '@/lib/gpsCarSimulator';
import { applyTripFuelBurn, fuelRemainingTone, fuelToneColor, setFuelLiters } from '@/lib/fuelLevel';
import { recordFuelGaugeReading } from '@/lib/fuelGaugeHistory';
import { checkNearestStationReach } from '@/lib/nearestStationReach';
import { askFuelGaugeApprox } from '@/lib/fuelGaugePrompt';
import { FuelGaugeSlider } from '@/components/FuelGaugeSlider';
import { SpeedDialFab } from '@/components/SpeedDialFab';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shouldDeleteShortTrip } from '@/lib/shortTrip';
import {
  estimateTripFuelLiters,
  fetchElevationProfile,
  averageMovingSpeedKmh,
  idleRatioFromPoints,
  idleMinutesFromPoints,
  accelAggressionFactor,
  stopAndGoFactor,
} from '@/lib/consumptionModel';
import {
  fetchDrivingRoute,
  fetchDrivingRouteAlternatives,
  type DrivingRoute,
} from '@/lib/roadDistance';
import { fetchSpeedLimitNear, type SpeedLimitInfo } from '@/lib/roadSpeedLimits';
import { forwardGeocode } from '@/lib/geocode';
import { notify, confirm } from '@/lib/notify';
import { TripHistoryCard } from '@/components/TripHistoryCard';
import { reverseGeocode, tripPlaceLabel } from '@/lib/geocode';
import { evaluateGpsSample } from '@/lib/gpsTracking';
import { currentMonthKey, formatDateSlash, formatRelativeDay, toLocalYmd } from '@/lib/dates';
import { TripHistoryCalendar } from '@/components/TripHistoryCalendar';
import {
  collectTripYmds,
  filterTripsByHistory,
  historyDateChipLabel,
  parseHistoryFilter,
  parseVehicleIdParam,
  parseYmdParam,
  type TripHistoryFilter,
} from '@/lib/tripHistoryNav';
import { downsampleRoute } from '@/lib/routeGeometry';
import {
  extendRecordedTripEnds,
  isResumableZombieTrip,
} from '@/lib/extendTripEnds';
import { preloadHistoryMaps } from '@/lib/tripMapCache';
import {
  getRecentDestinations,
  pushRecentDestination,
  type RecentDestination,
} from '@/lib/recentDestinations';
import { computeNavGuidance, headingFromTrail } from '@/lib/navGuidance';
import {
  computeDestinationHabitStats,
  type SimilarTripStats,
} from '@/lib/similarTrips';
import {
  commuteHintLabel,
  suggestTripsForNow,
  type SmartSuggestion,
} from '@/lib/smartSuggestions';
import type { SinceLastFillStats } from '@/types';
import type { RoutePoint } from '@/lib/calculations';
import {
  fetchCheapestStations,
  isFrenchFuelOpenDataAvailable,
} from '@/lib/fuelPrices';
import { rankStationsForDetour, pickCheapestReachableStations, estimatedRangeKm, stationSearchRadiusKm } from '@/lib/stationDetour';
import { useLocale } from '@/context/LocaleContext';
import type { Vehicle } from '@/types';

type StationOfferResult =
  | { action: 'continue' }
  | { action: 'abort' }
  | { action: 'station'; latitude: number; longitude: number; label: string };

/** Avant démarrage (libre ou destination) : jauge basse → station la moins chère encore joignable. */
async function offerDetourStations(opts: {
  vehicle: Vehicle;
  liters: number;
  origin: { latitude: number; longitude: number } | null;
  countryCode: string;
  destKm?: number | null;
}): Promise<StationOfferResult> {
  const tone = fuelRemainingTone({
    litersRemaining: opts.liters,
    tankCapacity: opts.vehicle.tankCapacity,
    lowLitersThreshold: opts.vehicle.lowFuelThresholdLiters,
    vehicle: opts.vehicle,
  });
  const rangeKm = estimatedRangeKm(opts.vehicle, opts.liters);
  const destTooFar =
    opts.destKm != null &&
    Number.isFinite(opts.destKm) &&
    opts.destKm > 0 &&
    opts.destKm * 1.1 > rangeKm;
  if (tone !== 'critical' && tone !== 'warn' && !destTooFar) {
    return { action: 'continue' };
  }
  if (!isFrenchFuelOpenDataAvailable(opts.countryCode) || !opts.origin) {
    return await new Promise<StationOfferResult>((resolve) => {
      confirm(
        'Niveau carburant bas',
        `Il reste ~${opts.liters.toFixed(1)} L (autonomie ~${rangeKm.toFixed(0)} km). Démarrer quand même ?`,
        () => resolve({ action: 'continue' }),
        'Démarrer',
        () => resolve({ action: 'abort' })
      );
    });
  }

  try {
    const stations = await fetchCheapestStations({
      latitude: opts.origin.latitude,
      longitude: opts.origin.longitude,
      radiusKm: stationSearchRadiusKm(rangeKm),
      fuel: opts.vehicle.fuelType,
      limit: 25,
      countryCode: opts.countryCode,
    });
    const reachable = pickCheapestReachableStations({
      stations,
      vehicle: opts.vehicle,
      litersRemaining: opts.liters,
      limit: 1,
    });
    const best = reachable[0];
    const destHint = destTooFar
      ? `\nLa destination (~${opts.destKm!.toFixed(0)} km) dépasse l’autonomie.`
      : '';

    if (!best) {
      return await new Promise<StationOfferResult>((resolve) => {
        Alert.alert(
          'Niveau carburant bas',
          `Il reste ~${opts.liters.toFixed(1)} L (~${rangeKm.toFixed(0)} km). Aucune station joignable avec cette réserve.${destHint}`,
          [
            { text: 'Annuler', style: 'cancel', onPress: () => resolve({ action: 'abort' }) },
            { text: 'Démarrer quand même', onPress: () => resolve({ action: 'continue' }) },
          ]
        );
      });
    }

    const grade =
      opts.vehicle.fuelType === 'essence' ? ` ${best.fuelKey.toUpperCase()}` : '';
    return await new Promise<StationOfferResult>((resolve) => {
      Alert.alert(
        'Niveau carburant bas',
        `Il reste ~${opts.liters.toFixed(1)} L (autonomie ~${rangeKm.toFixed(0)} km).${destHint}\n\nMoins chère encore joignable : ${best.name}${best.city ? ` (${best.city})` : ''} · ${best.pricePerL.toFixed(3)} €/L${grade} · ${best.distanceKm!.toFixed(1)} km (~${best.fuelToReachL.toFixed(1)} L pour y aller).`,
        [
          { text: 'Annuler', style: 'cancel', onPress: () => resolve({ action: 'abort' }) },
          { text: 'Démarrer sans station', onPress: () => resolve({ action: 'continue' }) },
          {
            text: `Aller à ${best.name}`.slice(0, 38),
            onPress: () =>
              resolve({
                action: 'station',
                latitude: best.latitude,
                longitude: best.longitude,
                label: best.name,
              }),
          },
        ]
      );
    });
  } catch {
    return { action: 'continue' };
  }
}
type TripTab = 'live' | 'history';
/** free = suivi GPS sans destination ; nav = avec destination */
type StartMode = 'free' | 'nav';

const START_MODE_KEY = 'gasoil_trip_start_mode';
const HISTORY_SCOPE_KEY = 'gasoil_history_vehicle_scope';
const SMART_DISMISS_KEY = 'gasoil_smart_dismiss_window';
function smartWindowKey(): string {
  const d = new Date();
  const h = d.getHours();
  const slot = h < 12 ? 'am' : h < 17 ? 'mid' : 'pm';
  return `${d.toISOString().slice(0, 10)}-${slot}`;
}

type GeoCoords = { latitude: number; longitude: number };

/** Via OSRM explicite / géométrie — seulement éco & alternatif (écart significatif). */
function mapsWaypointsForRoute(route: DrivingRoute | null | undefined): GeoCoords[] {
  if (!route) return [];
  return buildViaWaypoints(route.coordinates, route.via, { kind: route.kind });
}

export default function TripScreen() {
  const params = useLocalSearchParams<{
    mode?: string;
    dest?: string;
    destLat?: string;
    destLon?: string;
    autoStart?: string;
    prepare?: string;
    runSim?: string;
    runSimNonce?: string;
    /** live = rythme trajet (musique / PLM) ; fast = injection rapide (défaut historique) */
    simPace?: string;
    /** Accélération pour simPace=live (1 = temps réel, 2 = 2× plus vite). Défaut 2. */
    timeScale?: string;
    purgeSim?: string;
    purgeFirst?: string;
    tab?: string;
    filter?: string;
    from?: string;
    to?: string;
    vehicleId?: string;
    reset?: string;
    /** Nonce pour forcer un reset même si reset=1 inchangé (2ᵉ appui FAB Accueil). */
    r?: string;
  }>();
  const { activeVehicle, activeTrip, refresh, vehicles, selectVehicle } = useApp();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const { countryCode } = useLocale();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<TripMapRef>(null);
  const autoStartDone = useRef(false);
  const resetHandledRef = useRef<string | null>(null);
  const appliedVehicleParamRef = useRef<string | null>(null);
  const historyScopeReadyRef = useRef(false);
  const [tab, setTab] = useState<TripTab>('live');
  const [startMode, setStartMode] = useState<StartMode>('free');
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState<GeoCoords | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [plannedRoute, setPlannedRoute] = useState<GeoCoords[]>([]);
  const [routeOptions, setRouteOptions] = useState<DrivingRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [liveSpeedLimit, setLiveSpeedLimit] = useState<SpeedLimitInfo | null>(null);
  const [navSteps, setNavSteps] = useState<DrivingRoute['steps']>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  const [nearDestination, setNearDestination] = useState(false);
  const [smartDismissed, setSmartDismissed] = useState(false);
  const [mapCollapsed, setMapCollapsed] = useState(false);
  /** Remonte la WebView carte après fin de trajet (évite carte blanche). */
  const [mapRemountKey, setMapRemountKey] = useState(0);
  const [fuelStopVia, setFuelStopVia] = useState<GeoCoords | null>(null);
  const arrivalPromptedRef = useRef(false);
  const startingRef = useRef(false);
  /** Une alerte station mid-trajet par trajet (critique). */
  const criticalStationAlertedRef = useRef(false);
  const fittedTripIdRef = useRef<number | null>(null);
  /** Queue carte live (max ~80 pts) — ne jamais garder le JSON GPS complet en state React. */
  const [liveMapTail, setLiveMapTail] = useState<RoutePoint[]>([]);
  const [isStopping, setIsStopping] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [shortTripPrompt, setShortTripPrompt] = useState(false);
  const [tripStartFuelLiters, setTripStartFuelLiters] = useState<number | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState('');
  const simAbort = useRef({ aborted: false });

  const gpsSimEnabled = (() => {
    if (__DEV__) return true;
    const extra =
      (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ||
      ((Constants as { manifest?: { extra?: Record<string, unknown> } }).manifest?.extra) ||
      ((
        Constants as {
          manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown> } } };
        }
      ).manifest2?.extra?.expoClient?.extra) ||
      {};
    if (extra.enableGpsSimulator === true) return true;
    // Filet : flavors labo même si le bool n’est pas lu (Constants parfois incomplet en release)
    const flavor = String(extra.appFlavor || '');
    if (['preprod', 'dev', 'feat', 'qa'].includes(flavor)) return true;
    const pkg = String(
      Constants.expoConfig?.android?.package ||
        (Constants as { expoConfig?: { android?: { package?: string } } }).expoConfig?.android
          ?.package ||
        ''
    );
    if (/\.(qa|preprod|dev|feat)(\.|$)/.test(pkg) || pkg.endsWith('.qa') || pkg.endsWith('.preprod') || pkg.endsWith('.dev') || pkg.endsWith('.feat')) {
      return true;
    }
    if ((Constants.easConfig as { enableGpsSimulator?: boolean } | undefined)?.enableGpsSimulator) {
      return true;
    }
    return false;
  })();
  const [history, setHistory] = useState<Trip[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [pending, setPending] = useState<Trip[]>([]);
  const [sinceFill, setSinceFill] = useState<SinceLastFillStats | null>(null);
  const [historyFilter, setHistoryFilter] = useState<TripHistoryFilter>('all');
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const [historyTo, setHistoryTo] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [calMonth, setCalMonth] = useState(() => currentMonthKey());
  /** null = Toutes ; sinon filtre véhicule (indépendant du véhicule actif global) */
  const [historyAllVehicles, setHistoryAllVehicles] = useState(false);
  const [historyVehicleId, setHistoryVehicleId] = useState<number | null>(null);
  const [recentDests, setRecentDests] = useState<RecentDestination[]>([]);
  const [mapVisibleIds, setMapVisibleIds] = useState<Set<number>>(() => new Set());
  const onHistoryViewable = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: Trip; index: number | null }> }) => {
      const ids = new Set<number>();
      for (const v of viewableItems) {
        if (v.item?.id != null) ids.add(v.item.id);
      }
      // Toujours garder les 2 premiers (au-dessus du fold)
      setMapVisibleIds(ids);
    }
  ).current;
  const historyViewConfig = useRef({
    itemVisiblePercentThreshold: 12,
    minimumViewTime: 60,
  }).current;
  const [userLocation, setUserLocation] = useState<GeoCoords | null>(null);
  const [currentRegion, setCurrentRegion] = useState({
    latitude: 48.8566,
    longitude: 2.3522,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [liveOriginLabel, setLiveOriginLabel] = useState('');
  const [liveDestLabel, setLiveDestLabel] = useState('');
  const lastMapGps = useRef<RoutePoint | null>(null);
  const filteredHistory = useMemo(
    () =>
      filterTripsByHistory(history, {
        filter: historyFilter,
        fillDate: sinceFill?.lastFill?.date,
        from: historyFrom,
        to: historyTo,
      }),
    [history, historyFilter, sinceFill?.lastFill?.date, historyFrom, historyTo]
  );
  const historyTripYmds = useMemo(() => collectTripYmds(history), [history]);

  const isWeb = Platform.OS === 'web';

  const loadLists = useCallback(async () => {
    const scopeId = historyAllVehicles
      ? undefined
      : historyVehicleId ?? activeVehicle?.id ?? undefined;
    if (scopeId == null && !historyAllVehicles) {
      setHistory([]);
      setPending([]);
      setSinceFill(null);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
    const vehicleId = scopeId;
    const sinceVehicleId = historyVehicleId ?? activeVehicle?.id;
    const [trips, pend, since, pl] = await Promise.all([
      getTrips(historyAllVehicles ? undefined : vehicleId, { omitRoutePoints: true }),
      getPendingTrips(historyAllVehicles ? undefined : vehicleId),
      sinceVehicleId ? getSinceLastFillStats(sinceVehicleId) : Promise.resolve(null),
      getPlaces(),
    ]);
    const hist = trips.filter((t) => !t.isActive);
    setHistory(hist);
    setPending(pend);
    setSinceFill(since);
    setPlaces(pl);
    // Précharge géométrie + images mini-cartes (ne bloque pas l’UI)
    void preloadHistoryMaps(hist.slice(0, 2), pl, colors.accent);
    void (async () => {
      const stored = await getRecentDestinations(6);
      if (stored.length) {
        setRecentDests(stored);
        return;
      }
      // Amorçage depuis l’historique si rien en cache
      const fromHist: RecentDestination[] = [];
      const seen = new Set<string>();
      for (const t of hist) {
        const label = (t.destinationName || '').trim();
        if (label.length < 2) continue;
        const k = label.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        fromHist.push({ label, at: Date.now() });
        if (fromHist.length >= 6) break;
      }
      setRecentDests(fromHist);
    })();
    } finally {
      setHistoryLoading(false);
    }
  }, [activeVehicle, colors.accent, historyAllVehicles, historyVehicleId]);

  // Restaure le filtre véhicule historique (indépendant du véhicule actif)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(HISTORY_SCOPE_KEY);
        if (cancelled) return;
        if (raw === 'all') {
          setHistoryAllVehicles(true);
          setHistoryVehicleId(null);
        } else if (raw && /^\d+$/.test(raw)) {
          setHistoryAllVehicles(false);
          setHistoryVehicleId(Number(raw));
        } else if (activeVehicle?.id != null) {
          setHistoryAllVehicles(false);
          setHistoryVehicleId(activeVehicle.id);
        }
      } catch {
        if (!cancelled && activeVehicle?.id != null) {
          setHistoryVehicleId(activeVehicle.id);
        }
      } finally {
        if (!cancelled) historyScopeReadyRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, []);

  const persistHistoryScope = useCallback((all: boolean, vehicleId: number | null) => {
    const value = all ? 'all' : vehicleId != null ? String(vehicleId) : '';
    void AsyncStorage.setItem(HISTORY_SCOPE_KEY, value).catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadLists();
  }, [historyAllVehicles, historyVehicleId, activeVehicle?.id, loadLists]);

  // Si aucun filtre histo explicite après bootstrap, suivre le véhicule actif (1ʳᵉ fois)
  useEffect(() => {
    if (!historyScopeReadyRef.current) return;
    if (!historyAllVehicles && historyVehicleId == null && activeVehicle?.id != null) {
      setHistoryVehicleId(activeVehicle.id);
      persistHistoryScope(false, activeVehicle.id);
    }
  }, [activeVehicle?.id, historyAllVehicles, historyVehicleId, persistHistoryScope]);

  useEffect(() => {
    void (async () => {
      try {
        const mode = await AsyncStorage.getItem(START_MODE_KEY);
        if (mode === 'free' || mode === 'nav') setStartMode(mode);
        const dismissed = await AsyncStorage.getItem(SMART_DISMISS_KEY);
        setSmartDismissed(dismissed === smartWindowKey());
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /** Panneau maxspeed OSM (Overpass) dès qu'on a une position GPS (trajet ou pas). */
  useEffect(() => {
    if (!userLocation) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      const info = await fetchSpeedLimitNear(userLocation.latitude, userLocation.longitude);
      if (!cancelled && info) setLiveSpeedLimit(info);
    };
    void run();
    // Pendant un trajet actif, refresh plus fréquent (18s) ; sinon 30s
    const interval = activeTrip ? 18_000 : 30_000;
    const id = setInterval(() => void run(), interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTrip?.id, userLocation?.latitude, userLocation?.longitude]);

  const persistStartMode = useCallback((mode: StartMode) => {
    setStartMode(mode);
    void AsyncStorage.setItem(START_MODE_KEY, mode);
    if (mode === 'free') {
      setDestination('');
      setDestCoords(null);
      setPlannedRoute([]);
      setRouteOptions([]);
      setSelectedRouteId(null);
      setNearDestination(false);
    }
  }, []);

  const dismissSmartSuggestions = useCallback(() => {
    setSmartDismissed(true);
    void AsyncStorage.setItem(SMART_DISMISS_KEY, smartWindowKey());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLists();
      if (activeTrip && !activeTrip.isPaused) {
        void startBackgroundTracking();
      }
      const dest = typeof params.dest === 'string' ? params.dest.trim() : '';
      if (dest) {
        setDestination(dest);
        setStartMode('nav');
        setTab('live');
        const lat = params.destLat ? Number(params.destLat) : NaN;
        const lon = params.destLon ? Number(params.destLon) : NaN;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setDestCoords({ latitude: lat, longitude: lon });
        }
      }
      if (params.mode === 'nav') setStartMode('nav');
      if (params.tab === 'live' || params.tab === 'history') {
        setTab(params.tab);
      }
      const nextFilter = parseHistoryFilter(params.filter);
      if (nextFilter) setHistoryFilter(nextFilter);
      const fromYmd = parseYmdParam(params.from);
      const toYmd = parseYmdParam(params.to);
      if (fromYmd) setHistoryFrom(fromYmd);
      if (toYmd) setHistoryTo(toYmd);
      if (nextFilter === 'date' || nextFilter === 'range') {
        setCalendarOpen(true);
        setRangeMode(nextFilter === 'range');
        if (fromYmd) setCalMonth(fromYmd.slice(0, 7));
      }
      const rawVid = Array.isArray(params.vehicleId)
        ? params.vehicleId[0]
        : params.vehicleId;
      const vidKey = rawVid != null && String(rawVid).length ? String(rawVid) : null;
      const vid = parseVehicleIdParam(params.vehicleId);
      // N’applique vehicleId URL qu’une fois par valeur — sinon le focus écrase le chip
      if (vid != null && vidKey && appliedVehicleParamRef.current !== vidKey) {
        appliedVehicleParamRef.current = vidKey;
        setHistoryAllVehicles(false);
        setHistoryVehicleId(vid);
        persistHistoryScope(false, vid);
      }
      const resetFlag = Array.isArray(params.reset) ? params.reset[0] : params.reset;
      const resetNonce = Array.isArray(params.r) ? params.r[0] : params.r;
      if (resetFlag === '1') {
        const key = `${params.tab || ''}|${resetFlag}|${resetNonce || ''}|${params.dest || ''}`;
        if (resetHandledRef.current !== key) {
          resetHandledRef.current = key;
          setTab('live');
          setDestination('');
          setDestCoords(null);
          setPlannedRoute([]);
          setRouteOptions([]);
          setSelectedRouteId(null);
          setNearDestination(false);
          setStopConfirm(false);
          setShortTripPrompt(false);
          setStartMode('nav');
        }
      }
    }, [
      loadLists,
      activeTrip?.id,
      activeTrip?.isPaused,
      params.dest,
      params.mode,
      params.destLat,
      params.destLon,
      params.tab,
      params.filter,
      params.from,
      params.to,
      params.reset,
      params.r,
      params.vehicleId,
      persistHistoryScope,
    ])
  );

  useEffect(() => {
    let cancelled = false;
    let nativeSub: { remove: () => void } | null = null;
    let webWatch: number | null = null;

    const trackingLive = !!activeTrip && !activeTrip.isPaused;

    // Pendant un trajet : pas de 2e flux GPS (le FGS suffit). Sinon OOM/ANR.
    // Position UI = dernier point du tail local (chargé hors Context).
    if (trackingLive) {
      const last = liveMapTail.length > 0 ? liveMapTail[liveMapTail.length - 1] : null;
      if (last) {
        const coords = { latitude: last.latitude, longitude: last.longitude };
        setUserLocation(coords);
        setCurrentRegion((r) => ({ ...r, ...coords }));
      }
      return () => {
        cancelled = true;
      };
    }

    const acceptMapFix = (
      latitude: number,
      longitude: number,
      timestamp: number,
      accuracy?: number | null
    ) => {
      const sample = { latitude, longitude, timestamp, accuracy };
      const verdict = evaluateGpsSample(lastMapGps.current, sample, {
        isFirst: !lastMapGps.current,
      });
      if (!verdict.accept && verdict.reason === 'too_fast') return null;
      if (!verdict.accept && verdict.reason === 'bad_coords') return null;
      if (accuracy != null && accuracy > 80 && lastMapGps.current) {
        return null;
      }
      if (verdict.accept || verdict.reason === 'too_close' || verdict.reason === 'too_soon') {
        if (verdict.accept) {
          lastMapGps.current = {
            latitude,
            longitude,
            timestamp,
            ...(accuracy != null ? { accuracy } : {}),
          };
        }
        return { latitude, longitude };
      }
      if (verdict.reason === 'bad_accuracy' && !lastMapGps.current) {
        lastMapGps.current = { latitude, longitude, timestamp };
        return { latitude, longitude };
      }
      return null;
    };

    (async () => {
      const loc = await getCurrentLocation();
      if (loc && !cancelled) {
        const coords = acceptMapFix(
          loc.coords.latitude,
          loc.coords.longitude,
          loc.timestamp || Date.now(),
          loc.coords.accuracy
        );
        if (coords) {
          setUserLocation(coords);
          setCurrentRegion({ ...coords, latitudeDelta: 0.04, longitudeDelta: 0.04 });
        }
      }

      if (isWeb) {
        if (typeof navigator === 'undefined' || !navigator.geolocation) return;
        webWatch = navigator.geolocation.watchPosition(
          (pos) => {
            const coords = acceptMapFix(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.timestamp || Date.now(),
              pos.coords.accuracy
            );
            if (!coords) return;
            setUserLocation(coords);
            setCurrentRegion((r) => ({ ...r, ...coords }));
          },
          () => {},
          {
            enableHighAccuracy: false,
            maximumAge: 15000,
            timeout: 15000,
          }
        );
        return;
      }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        nativeSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 15000,
            distanceInterval: 40,
          },
          (pos) => {
            const coords = acceptMapFix(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.timestamp || Date.now(),
              pos.coords.accuracy
            );
            if (!coords) return;
            setUserLocation(coords);
            setCurrentRegion((r) => ({ ...r, ...coords }));
          }
        );
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      nativeSub?.remove();
      if (webWatch != null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(webWatch);
      }
    };
  }, [isWeb, activeTrip?.id, activeTrip?.isPaused, liveMapTail]);

  // Charge un tail court depuis la DB (pas via Context) pour la carte pendant le live.
  useEffect(() => {
    if (!activeTrip?.isActive || activeTrip.isPaused) {
      if (!activeTrip?.isActive) setLiveMapTail([]);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        // Préférer le cache FGS (pas de parse DB O(n) toutes les 10 s).
        if (peekLiveTripId() === activeTrip.id) {
          const tail = peekLiveRouteTail(80);
          if (tail && tail.length) {
            setLiveMapTail(tail);
            const last = tail[tail.length - 1];
            if (last) {
              setUserLocation({ latitude: last.latitude, longitude: last.longitude });
            }
            return;
          }
        }
        const buf = await readLiveTripBuffer();
        if (buf?.tripId === activeTrip.id) {
          const pts = parseRoutePoints(buf.routePoints || '[]');
          if (pts.length) {
            const tail = pts.length > 80 ? pts.slice(-80) : pts;
            setLiveMapTail(tail);
            const last = tail[tail.length - 1];
            if (last) {
              setUserLocation({ latitude: last.latitude, longitude: last.longitude });
            }
            return;
          }
        }
        const full = await getTripById(activeTrip.id);
        if (cancelled || !full) return;
        const pts = parseRoutePoints(full.routePoints || '[]');
        const tail = pts.length > 80 ? pts.slice(-80) : pts;
        setLiveMapTail(tail);
        const last = tail[tail.length - 1];
        if (last) {
          setUserLocation({ latitude: last.latitude, longitude: last.longitude });
        }
      } catch {
        /* ignore */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeTrip?.id, activeTrip?.isActive, activeTrip?.isPaused]);

  useEffect(() => {
    if (!activeTrip) {
      fittedTripIdRef.current = null;
      return;
    }
    // Fit une seule fois par trajet (évite caméra qui saute à chaque poll GPS).
    if (fittedTripIdRef.current === activeTrip.id) return;
    if (liveMapTail.length < 2) return;
    fittedTripIdRef.current = activeTrip.id;
    const fitPts = liveMapTail.length > 60 ? liveMapTail.slice(-60) : liveMapTail;
    mapRef.current?.fitToCoordinates(
      fitPts.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true }
    );
  }, [activeTrip?.id, liveMapTail]);

  useEffect(() => {
    if (!activeTrip) {
      setLiveOriginLabel('');
      setLiveDestLabel('');
      return;
    }
    const first = liveMapTail[0] || null;
    const last = liveMapTail.length > 1 ? liveMapTail[liveMapTail.length - 1] : userLocation;
    setLiveOriginLabel(tripPlaceLabel(activeTrip.originName, first, 'origin'));
    setLiveDestLabel(
      tripPlaceLabel(activeTrip.destinationName || destination, last, 'destination')
    );
  }, [
    activeTrip?.id,
    activeTrip?.originName,
    activeTrip?.destinationName,
    destination,
    liveMapTail,
    userLocation?.latitude,
    userLocation?.longitude,
  ]);

  const selectedRoute = useMemo(
    () => routeOptions.find((r) => r.id === selectedRouteId) || routeOptions[0] || null,
    [routeOptions, selectedRouteId]
  );

  const alternateMapRoutes = useMemo(() => {
    if (!routeOptions.length) return [];
    // Toutes les alternatives (hors sélection) — tracés visibles pour comparer.
    return routeOptions
      .filter((r) => r.id !== selectedRoute?.id)
      .map((r) => downsampleRoute(r.coordinates, 72));
  }, [routeOptions, selectedRoute?.id]);

  const applyRouteSelection = useCallback((route: DrivingRoute) => {
    try {
      setSelectedRouteId(route.id);
      setNavSteps(route.steps);
      const coords = downsampleRoute(route.coordinates, 120);
      const valid = coords.filter(
        (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      );
      if (valid.length < 2) {
        setPlannedRoute(coords);
        return;
      }
      setPlannedRoute(valid);
      mapRef.current?.fitToCoordinates(
        valid.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        { edgePadding: { top: 56, right: 40, bottom: 72, left: 40 }, animated: true }
      );
      const lats = valid.map((p) => p.latitude);
      const lons = valid.map((p) => p.longitude);
      const latMin = Math.min(...lats);
      const latMax = Math.max(...lats);
      const lonMin = Math.min(...lons);
      const lonMax = Math.max(...lons);
      if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite)) return;
      setCurrentRegion({
        latitude: (latMin + latMax) / 2,
        longitude: (lonMin + lonMax) / 2,
        latitudeDelta: Math.max((latMax - latMin) * 1.35, 0.04),
        longitudeDelta: Math.max((lonMax - lonMin) * 1.35, 0.04),
      });
    } catch {
      /* sélection invalide — ignore */
    }
  }, []);

  const fitOriginAndDest = useCallback((from: GeoCoords | null, to: GeoCoords) => {
    const pts = from
      ? [
          { latitude: from.latitude, longitude: from.longitude },
          { latitude: to.latitude, longitude: to.longitude },
        ]
      : [{ latitude: to.latitude, longitude: to.longitude }];
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 56, right: 40, bottom: 72, left: 40 },
      animated: true,
    });
    if (from) {
      const latMin = Math.min(from.latitude, to.latitude);
      const latMax = Math.max(from.latitude, to.latitude);
      const lonMin = Math.min(from.longitude, to.longitude);
      const lonMax = Math.max(from.longitude, to.longitude);
      setCurrentRegion({
        latitude: (latMin + latMax) / 2,
        longitude: (lonMin + lonMax) / 2,
        latitudeDelta: Math.max((latMax - latMin) * 1.6, 0.05),
        longitudeDelta: Math.max((lonMax - lonMin) * 1.6, 0.05),
      });
    } else {
      setCurrentRegion({
        latitude: to.latitude,
        longitude: to.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });
    }
  }, []);

  const loadRouteAlternatives = useCallback(
    async (from: GeoCoords, to: GeoCoords) => {
      setRoutesLoading(true);
      fitOriginAndDest(from, to);
      try {
        const alts = await fetchDrivingRouteAlternatives(from, to);
        setRouteOptions(alts);
        // Défaut = éco (conso Gasoil) ; l’utilisateur peut encore choisir rapide / alt.
        const prefer =
          alts.find((a) => a.kind === 'eco') ||
          alts.find((a) => a.kind === 'fastest') ||
          alts[0];
        if (prefer) applyRouteSelection(prefer);
        else {
          setSelectedRouteId(null);
          setPlannedRoute([from, to]);
        }
      } catch {
        setRouteOptions([]);
        setSelectedRouteId(null);
        try {
          const r = await fetchDrivingRoute(from, to);
          setPlannedRoute(r.coordinates);
        } catch {
          setPlannedRoute([from, to]);
        }
      } finally {
        setRoutesLoading(false);
      }
    },
    [applyRouteSelection, fitOriginAndDest]
  );

  const handleStartTrip = async (override?: {
    destinationLabel?: string;
    dest?: GeoCoords | null;
    mode?: StartMode;
  }) => {
    if (startingRef.current || isStarting) return;
    if (activeTrip?.isActive) {
      notify('Trajet', 'Un trajet est déjà en cours.');
      return;
    }
    if (!activeVehicle) {
      notify('Erreur', 'Sélectionnez un véhicule avant de démarrer un trajet.');
      return;
    }
    const mode = override?.mode ?? startMode;
    let destLabel =
      override?.destinationLabel?.trim() || destination.trim();
    const coordsOverride =
      override && 'dest' in override ? override.dest : destCoords;
    let effectiveMode: StartMode = mode;

    if (mode === 'nav' && !destLabel) {
      notify('Destination', 'Indiquez une destination, ou choisissez « Suivi libre ».');
      return;
    }

    if (mode === 'nav' && routesLoading) {
      notify('Itinéraire', 'Attendez le calcul des trajets, choisissez-en un, puis démarrez.');
      return;
    }

    if (mode === 'nav') persistStartMode('nav');

    startingRef.current = true;
    setIsStarting(true);
    // Capturer l’itinéraire choisi avant les await (évite state stale)
    let routeForNav: DrivingRoute | null =
      routeOptions.find((r) => r.id === selectedRouteId) || routeOptions[0] || null;
    let mapsDest: GeoCoords | null = coordsOverride ?? null;
    let mapsOrigin: GeoCoords | null = null;
    let mapsLabel = destLabel;
    let stationViaLocal: GeoCoords | null = fuelStopVia;
    let goStationFromFree = false;

    try {
      // Toujours valider la jauge (nav + suivi libre) — même demi-cercle qu’à l’accueil.
      let startFuel = activeVehicle.estimatedFuelLiters;
      const gauge = await askFuelGaugeApprox(
        activeVehicle,
        'Niveau de carburant au départ',
        'Réglez la jauge pour affiner la consommation estimée.',
        { softSkip: true }
      );
      startFuel = gauge.skipped ? activeVehicle.estimatedFuelLiters : gauge.liters;
      if (startFuel != null) {
        await setFuelLiters(activeVehicle, startFuel);
      }
      setTripStartFuelLiters(startFuel);
      criticalStationAlertedRef.current = false;

      await stopBackgroundTracking();
      const recent = await getTrips(activeVehicle.id, {
        includeRejected: true,
        omitRoutePoints: true,
      });
      const zombie = recent.find((t) => isResumableZombieTrip(t)) || null;
      if (!zombie) {
        await clearLiveTripBuffer();
        await stopActiveTrips();
      }
      const loc = await getCurrentLocation({ fresh: true });
      let startPoint = loc
        ? [
            {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              timestamp: Date.now(),
              accuracy: loc.coords.accuracy ?? undefined,
            },
          ]
        : [];

      if (loc) {
        mapsOrigin = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setUserLocation(mapsOrigin);
      }

      if (startFuel != null) {
        const destKm = routeForNav?.distanceKm ?? null;
        const stationChoice = await offerDetourStations({
          vehicle: activeVehicle,
          liters: startFuel,
          origin: mapsOrigin,
          countryCode,
          destKm: mode === 'nav' ? destKm : null,
        });
        if (stationChoice.action === 'abort') {
          startingRef.current = false;
          setIsStarting(false);
          return;
        }
        if (stationChoice.action === 'station') {
          const via = {
            latitude: stationChoice.latitude,
            longitude: stationChoice.longitude,
          };
          if (mode === 'free') {
            effectiveMode = 'nav';
            goStationFromFree = true;
            destLabel = stationChoice.label;
            mapsDest = via;
            mapsLabel = stationChoice.label;
            setDestination(stationChoice.label);
            setDestCoords(via);
            persistStartMode('nav');
          } else {
            stationViaLocal = via;
            setFuelStopVia(via);
          }
          notify('Station', stationChoice.label);
        }
      }

      let resolvedDest: GeoCoords | null = null;
      if (effectiveMode === 'nav') {
        resolvedDest = coordsOverride ?? mapsDest ?? null;
        if (!resolvedDest && destLabel) {
          const geo = await forwardGeocode(destLabel).catch(() => null);
          if (geo) {
            resolvedDest = { latitude: geo.latitude, longitude: geo.longitude };
          }
        }
        if (destLabel) setDestination(destLabel);
        if (resolvedDest) {
          setDestCoords(resolvedDest);
          mapsDest = resolvedDest;
        }
        mapsLabel = destLabel;

        if (loc && resolvedDest) {
          try {
            if (routeForNav && routeForNav.coordinates.length >= 2) {
              setPlannedRoute(downsampleRoute(routeForNav.coordinates, 120));
            } else {
              const alts = await fetchDrivingRouteAlternatives(
                { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
                resolvedDest
              );
              setRouteOptions(alts);
              if (alts.length === 0) {
                setPlannedRoute([
                  { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
                  resolvedDest,
                ]);
              } else if (alts.length === 1) {
                routeForNav = alts[0];
                setSelectedRouteId(routeForNav.id);
                setPlannedRoute(downsampleRoute(routeForNav.coordinates, 120));
              } else {
                const preferred =
                  alts.find((a) => a.id === selectedRouteId) ||
                  alts.find((a) => a.kind === 'eco') ||
                  alts.find((a) => a.kind === 'fastest') ||
                  alts[0];
                if (preferred) {
                  routeForNav = preferred;
                  setSelectedRouteId(preferred.id);
                  setNavSteps(preferred.steps);
                  setPlannedRoute(downsampleRoute(preferred.coordinates, 120));
                }
                if (!goStationFromFree) {
                  notify(
                    'Itinéraire',
                    'Plusieurs trajets possibles — choisissez éco / rapide / alternatif, puis Démarrer.'
                  );
                  startingRef.current = false;
                  setIsStarting(false);
                  return;
                }
              }
            }
          } catch {
            setPlannedRoute([
              { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              resolvedDest,
            ]);
          }
        }
      } else {
        // Suivi libre : nettoyer toute destination / itinéraire résiduel
        setDestination('');
        setDestCoords(null);
        setPlannedRoute([]);
        setRouteOptions([]);
        setSelectedRouteId(null);
        setNavSteps(undefined);
        mapsDest = null;
        mapsLabel = '';
      }

      const originName = loc
        ? (await reverseGeocode(loc.coords.latitude, loc.coords.longitude).catch(() => null)) ||
          'Position de départ'
        : undefined;

      const destName = effectiveMode === 'nav' ? destLabel : undefined;

      let tripId: number;
      if (zombie) {
        const full = await getTripById(zombie.id);
        const oldPts = parseRoutePoints(full?.routePoints || '[]');
        if (startPoint.length && oldPts.length) {
          const lastOld = oldPts[oldPts.length - 1];
          const extra = startPoint[0];
          const same =
            lastOld &&
            Math.abs(lastOld.latitude - extra.latitude) < 1e-5 &&
            Math.abs(lastOld.longitude - extra.longitude) < 1e-5;
          startPoint = same ? oldPts : [...oldPts, extra];
        } else if (oldPts.length) {
          startPoint = oldPts;
        }
        const cleaned = (full?.note || zombie.note || '')
          .replace(/\s*\[clôturé auto: zombie\]/gi, '')
          .trim();
        await updateTrip(zombie.id, {
          isActive: true,
          isPaused: false,
          status: 'confirmed',
          endTime: null,
          originName: full?.originName || originName,
          destinationName: destName || full?.destinationName || undefined,
          routePoints: JSON.stringify(startPoint),
          note: cleaned || undefined,
        });
        tripId = zombie.id;
      } else {
        tripId = await createTrip({
        vehicleId: activeVehicle.id,
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
        note: effectiveMode === 'free'
          ? isWeb
            ? 'Suivi GPS web (onglet ouvert)'
            : 'Suivi GPS libre (arrière-plan)'
          : [
              startFuel != null ? `Jauge départ ~${startFuel.toFixed(1)} L` : null,
              routeForNav ? `Itinéraire ${routeForNav.label}` : null,
              mapsLabel && mode === 'free' ? `Plein d’abord · ${mapsLabel}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
      });
      }

      if (startFuel != null) {
        await recordFuelGaugeReading({
          vehicleId: activeVehicle.id,
          liters: startFuel,
          source: 'trip_start',
          tripId,
        });
      }

      seedLivePointsCache(tripId, activeVehicle.id, startPoint);
      await seedLiveTripBuffer({
        tripId,
        vehicleId: activeVehicle.id,
        routePoints: JSON.stringify(startPoint),
      });

      if (originName) setLiveOriginLabel(originName);
      if (destName) setLiveDestLabel(destName);

      const trackingStarted = await startBackgroundTracking({ forceRestart: true });
      if (!trackingStarted) {
        notify(
          'Permission requise',
          isWeb
            ? 'Autorisez la localisation dans le navigateur (Safari / Chrome) pour enregistrer le trajet.'
            : 'Autorisez la localisation « toujours » / arrière-plan pour tracer même hors premier plan.'
        );
      }

      await refresh();
      await loadLists();
    } catch {
      notify('Erreur', 'Impossible de démarrer le trajet.');
      startingRef.current = false;
      setIsStarting(false);
      return;
    }

    // Maps APRÈS le suivi — hors du try principal (un échec Maps ne doit pas
    // faire croire que le trajet a échoué, ni tuer le GPS). Destination seule
    // : pas d’arrêt intermédiaire. Petit délai pour laisser l’UI se stabiliser.
    try {
      await new Promise((r) => setTimeout(r, 400));
      const tripIdForMaps = (await getActiveTripLite())?.id;
      if (effectiveMode === 'free') {
        const opened = await openGoogleMapsHere(mapsOrigin || userLocation || undefined);
        if (!opened) {
          notify(
            'Google Maps',
            'Impossible d’ouvrir Google Maps — le suivi GPS continue dans Fuel.'
          );
        }
      } else if (effectiveMode === 'nav' && mapsLabel && mapsDest) {
        void pushRecentDestination({
          label: mapsLabel,
          latitude: mapsDest.latitude,
          longitude: mapsDest.longitude,
        }).then(() => getRecentDestinations(6).then(setRecentDests));

        const routeVias = mapsWaypointsForRoute(routeForNav);
        const waypoints = [
          ...(stationViaLocal ? [stationViaLocal] : []),
          ...routeVias,
        ];
        const opened = await launchGoogleMapsNavigation({
          destination: mapsDest,
          origin: mapsOrigin,
          waypoints,
          label: mapsLabel,
          preferGoogle: true,
        });
        if (!opened) {
          notify(
            'Navigation',
            'Impossible d’ouvrir Google Maps. Le suivi GPS continue dans l’app.'
          );
        }
        setFuelStopVia(null);
      }
    } catch {
      notify(
        'Navigation',
        'Maps n’a pas pu s’ouvrir. Le suivi GPS continue dans l’app.'
      );
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  // Prépare destination + itinéraires (Accueil / suggestions) — ne démarre PAS.
  // Exception : autoStart=1 + mode=free → démarrage réel (effet suivant).
  useEffect(() => {
    if (params.autoStart === '1' && params.mode === 'free') return;
    const wantPrepare =
      params.prepare === '1' || params.autoStart === '1' || params.autoStart === 'prepare';
    if (!wantPrepare || autoStartDone.current) return;
    if (!activeVehicle || activeTrip) return;
    if (!destination.trim()) return;
    const lat = params.destLat ? Number(params.destLat) : NaN;
    const lon = params.destLon ? Number(params.destLon) : NaN;
    const hasParamCoords = Number.isFinite(lat) && Number.isFinite(lon);
    if (hasParamCoords && !destCoords) return;

    autoStartDone.current = true;
    persistStartMode('nav');
    setTab('live');
    showToast('Choisissez un itinéraire (éco / rapide), puis Démarrer');

    void (async () => {
      const to = destCoords;
      if (!to) return;
      let from = userLocation;
      if (!from) {
        const loc = await getCurrentLocation({ fresh: true });
        if (loc?.coords) {
          from = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(from);
        }
      }
      if (from) await loadRouteAlternatives(from, to);
    })();
  }, [
    params.prepare,
    params.autoStart,
    params.mode,
    params.destLat,
    params.destLon,
    destination,
    destCoords,
    activeVehicle?.id,
    activeTrip?.id,
    userLocation,
    loadRouteAlternatives,
    persistStartMode,
    showToast,
  ]);

  // Maps : démarrer vraiment le suivi libre (GPS + trajet actif)
  useEffect(() => {
    if (params.autoStart !== '1' || params.mode !== 'free') return;
    if (autoStartDone.current) return;
    if (!activeVehicle || activeTrip) return;
    autoStartDone.current = true;
    persistStartMode('free');
    setTab('live');
    const t = setTimeout(() => {
      void handleStartTrip({ mode: 'free' });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleStartTrip recreates each render
  }, [params.autoStart, params.mode, activeVehicle?.id, activeTrip?.id, persistStartMode]);

  const simAutoKey = useRef<string | null>(null);
  useEffect(() => {
    if (!gpsSimEnabled) return;
    const runSimRaw = params.runSim;
    const runSim = String(Array.isArray(runSimRaw) ? runSimRaw[0] : runSimRaw || '');
    if (runSim !== '1') return;
    if (!activeVehicle || simRunning) return;
    const nonceRaw = params.runSimNonce;
    const nonce = String(Array.isArray(nonceRaw) ? nonceRaw[0] : nonceRaw || '');
    const key = nonce || '__once__';
    if (simAutoKey.current === key) return;
    simAutoKey.current = key;
    setTab('live');
    const purgeRaw = params.purgeSim ?? params.purgeFirst;
    const purge = String(Array.isArray(purgeRaw) ? purgeRaw[0] : purgeRaw || '') === '1';
    const t = setTimeout(() => {
      void (async () => {
        try {
          if (purge) {
            await stopActiveTrips();
            await purgeSimulatorTrips(activeVehicle.id);
            await refresh();
            await loadLists();
          }
          await handleRunCarSimulator({ pace: 'fast' });
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Échec sim auto');
        }
      })();
    }, 700);
    return () => clearTimeout(t);
  }, [
    params.runSim,
    params.runSimNonce,
    params.purgeSim,
    params.purgeFirst,
    activeVehicle?.id,
    gpsSimEnabled,
  ]);

  const purgeAutoDone = useRef(false);
  useEffect(() => {
    // Si runSim est aussi demandé, la purge est faite dans l’effet sim (évite Alert/race)
    if (params.runSim === '1') return;
    if (params.purgeSim !== '1' || purgeAutoDone.current) return;
    purgeAutoDone.current = true;
    void (async () => {
      await stopActiveTrips();
      const n = await purgeSimulatorTrips(activeVehicle?.id);
      await refresh();
      await loadLists();
      showToast(
        n > 0 ? `${n} trajet(s) simulateur purgé(s)` : 'Aucun trajet simulateur'
      );
    })();
  }, [params.purgeSim, params.runSim, activeVehicle?.id]);

  const handlePause = async (withFillUp: boolean) => {
    if (!activeTrip) return;
    await stopBackgroundTracking();
    await updateTrip(activeTrip.id, { isPaused: true });
    await refresh();
    if (withFillUp) {
      router.push({
        pathname: '/fillup/add' as never,
        params: { tripId: String(activeTrip.id), fromTrip: '1' },
      });
    } else {
      notify('Pause', 'Suivi GPS en pause. Reprenez quand vous repartez.');
    }
  };

  const handleResume = async () => {
    if (!activeTrip) return;
    await updateTrip(activeTrip.id, { isPaused: false });
    const ok = await startBackgroundTracking({ forceRestart: true });
    await refresh();
    if (!ok) {
      notify('GPS', 'Vérifiez les permissions localisation.');
    }
  };

  const finishTripCore = useCallback(
    async (opts?: {
      openRecap?: boolean;
      skipGauge?: boolean;
      /** Après prompt trajet court : conserver malgré &lt; 0.5 km */
      keepShort?: boolean;
    }) => {
      if (!activeTrip) return;
      const finishedId = activeTrip.id;
      const vehicleSnapshot = activeVehicle;

      try {
        await stopBackgroundTracking();
      } catch {
        /* GPS déjà arrêté */
      }
      try {
        const loc = await getCurrentLocation({ fresh: true, timeoutMs: 8000 });
        if (loc) await appendForcedLocation(finishedId, loc);
      } catch {
        /* dernier fix optionnel */
      }
      try {
        await persistLiveRoute(finishedId);
        await flushTripUpdates();
      } catch {
        /* ignore */
      }

      // Toujours lire la DB + tampon après drain GPS — le state React peut être en retard.
      const fresh = await getTripById(finishedId).catch(() => null);
      const buf = await readLiveTripBuffer().catch(() => null);
      let trip = fresh || activeTrip;
      if (buf && buf.tripId === finishedId) {
        const bufPts = parseRoutePoints(buf.routePoints || '[]');
        const dbPts = parseRoutePoints(trip.routePoints || '[]');
        if (bufPts.length > dbPts.length || buf.distanceKm > (trip.distanceKm || 0)) {
          trip = {
            ...trip,
            routePoints: buf.routePoints,
            distanceKm: Math.max(trip.distanceKm || 0, buf.distanceKm),
            estimatedFuelUsed: buf.estimatedFuelUsed ?? trip.estimatedFuelUsed,
            estimatedCost: buf.estimatedCost ?? trip.estimatedCost,
          };
        }
      }

      const durationMinutes =
        (Date.now() - new Date(trip.startTime).getTime()) / 60000;
      if (shouldDeleteShortTrip(trip.distanceKm, durationMinutes) && !opts?.keepShort) {
        setShortTripPrompt(true);
        setStopConfirm(false);
        return;
      }
      setShortTripPrompt(false);

      let pts = parseRoutePoints(compactRoutePointsJson(trip.routePoints || '[]'));
      try {
        const places = await getPlaces();
        const ext = await extendRecordedTripEnds({
          points: pts,
          places,
          fetchRoute: async (from, to) => {
            const r = await fetchDrivingRoute(from, to);
            return r?.coordinates?.length ? { coordinates: r.coordinates } : null;
          },
        });
        if (ext.prepended || ext.appended) {
          pts = ext.points;
          const routeJson = JSON.stringify(pts);
          trip = {
            ...trip,
            routePoints: routeJson,
            distanceKm: calculateRouteDistance(routeJson),
            originName: ext.originName || trip.originName,
            destinationName: ext.destName || trip.destinationName,
          };
        }
      } catch {
        /* GPS brut conservé */
      }
      const last = pts.length > 0 ? pts[pts.length - 1] : userLocation;

      let destName = trip.destinationName?.trim();
      if (!destName && last) {
        destName =
          (await reverseGeocode(last.latitude, last.longitude).catch(() => null)) ||
          'Lieu d’arrivée';
      }
      if (!destName) destName = 'Lieu d’arrivée';

      let originName = trip.originName?.trim();
      if (!originName && pts[0]) {
        originName =
          (await reverseGeocode(pts[0].latitude, pts[0].longitude).catch(() => null)) ||
          'Lieu de départ';
      }

      const vehicle =
        (vehicleSnapshot && (await getVehicleById(vehicleSnapshot.id).catch(() => null))) ||
        vehicleSnapshot;
      const altitudes = await fetchElevationProfile(pts).catch(() => [] as number[]);
      let ascentM = 0;
      for (let i = 1; i < altitudes.length; i++) {
        const d = altitudes[i] - altitudes[i - 1];
        if (d > 1) ascentM += d;
      }
      ascentM = Math.round(ascentM);
      const avgSpeedKmh = averageMovingSpeedKmh(trip.distanceKm, pts);
      const idleRatio = idleRatioFromPoints(pts);
      const idleMinutes = idleMinutesFromPoints(pts);
      const accelFactor = accelAggressionFactor(pts);
      const stopGoFactor = stopAndGoFactor(pts);
      const fuelUsed = vehicle
        ? estimateTripFuelLiters(vehicle, trip.distanceKm, {
            ascentM,
            altitudes: altitudes.length >= 2 ? altitudes : undefined,
            points: pts,
            learnedFactor: vehicle.consumptionLearnFactor,
            avgSpeedKmh,
            idleRatio,
            idleMinutes,
            accelFactor,
            stopGoFactor,
          })
        : trip.estimatedFuelUsed;
      const fills = vehicle ? await getFillUps(vehicle.id).catch(() => []) : [];
      const lastFill = [...fills].sort((a, b) => b.date.localeCompare(a.date))[0];
      const priceAtTrip =
        lastFill?.pricePerLiter && lastFill.pricePerLiter > 0
          ? lastFill.pricePerLiter
          : vehicle?.defaultFuelPrice || 0;
      const cost = estimateCost(fuelUsed, priceAtTrip);

      const liveStats = vehicle
        ? calculateTripStats(
            vehicle,
            trip.distanceKm,
            trip.startTime,
            new Date().toISOString(),
            trip.routePoints
          )
        : null;
      const speed =
        liveStats && liveStats.movingSpeedKmh > 0
          ? liveStats.movingSpeedKmh
          : liveStats
            ? (trip.distanceKm / Math.max(liveStats.durationMinutes, 0.01)) * 60
            : 0;

      if (vehicle && trip.distanceKm > 0) {
        // Jamais de modal jauge pendant Terminer (Alert/Modal + GPS/WebView = crash Android).
        await applyTripFuelBurn(vehicle, trip.distanceKm, ascentM, {
          avgSpeedKmh,
          idleRatio,
          tripId: finishedId,
        }).catch(() => null);
        const after = await getVehicleById(vehicle.id).catch(() => null);
        const endLiters = after?.estimatedFuelLiters ?? vehicle.estimatedFuelLiters;
        if (endLiters != null) {
          await recordFuelGaugeReading({
            vehicleId: vehicle.id,
            liters: endLiters,
            source: 'trip_end',
            tripId: finishedId,
          });
        }
      }

      const noteParts = [
        trip.note,
        speed > 0 ? `Vitesse moy. ${formatSpeedKmh(speed)}` : null,
        ascentM > 20 ? `D+ ${ascentM} m` : null,
        priceAtTrip > 0
          ? `${
              vehicleSnapshot?.fuelType === 'diesel'
                ? 'Gasoil'
                : vehicleSnapshot?.fuelType === 'gpl'
                  ? 'GPL'
                  : vehicleSnapshot?.fuelType === 'electrique'
                    ? 'Élec.'
                    : 'Essence'
            } ~${priceAtTrip.toFixed(3)} €/L · ${formatEuro(cost)}`
          : null,
      ].filter(Boolean);

      await updateTrip(finishedId, {
        isActive: false,
        isPaused: false,
        endTime: new Date().toISOString(),
        status: 'confirmed',
        originName: originName || trip.originName,
        destinationName: destName,
        estimatedFuelUsed: fuelUsed,
        estimatedCost: cost,
        routePoints: compactRoutePointsJson(trip.routePoints || '[]'),
        note: noteParts.join(' · ') || undefined,
      });
      if (trip.distanceKm > 0) {
        await addTrackedKm(trip.vehicleId, trip.distanceKm).catch(() => undefined);
      }
      await clearLiveTripBuffer();
      clearLivePointsAfterFinish();
      setLiveOriginLabel('');
      setLiveDestLabel('');
      setDestination('');
      setDestCoords(null);
      setPlannedRoute([]);
      setRouteOptions([]);
      setSelectedRouteId(null);
      setTripStartFuelLiters(null);
      setNearDestination(false);
      setStopConfirm(false);
      arrivalPromptedRef.current = false;
      setMapCollapsed(false);
      setMapRemountKey((k) => k + 1);
      await refresh();
      await loadLists();

      if (opts?.openRecap !== false) {
        setTimeout(() => {
          // Retour « arrière » depuis le récap → Maps (hub), pas l’écran trajet vide
          router.replace('/(tabs)/maps' as never);
          setTimeout(() => {
            router.push(`/trip/${finishedId}` as never);
          }, 40);
        }, 80);
      } else {
        setTab('history');
        showToast(
          `Trajet terminé · ${formatDistance(trip.distanceKm)} · ~${fuelUsed.toFixed(1)} L`
        );
      }
    },
    [
      activeTrip,
      activeVehicle,
      userLocation,
      tripStartFuelLiters,
      refresh,
      loadLists,
      showToast,
    ]
  );

  const handleStopTrip = async (opts?: { fromArrival?: boolean }) => {
    if (!activeTrip) return;
    if (isStopping) return;

    setIsStopping(true);

    // Arrivée : 1 geste → récap (sans double confirm / jauge)
    if (opts?.fromArrival) {
      try {
        await finishTripCore({ openRecap: true, skipGauge: true });
      } catch (e) {
        notify('Erreur', e instanceof Error ? e.message : 'Impossible de terminer le trajet.');
      } finally {
        setIsStopping(false);
        setStopConfirm(false);
      }
      return;
    }

    // Confirmation in-app (pas d’Alert Android : elle plante avec la jauge / le GPS).
    setStopConfirm(true);
    setIsStopping(false);
  };

  const confirmStopTrip = async () => {
    if (!activeTrip || isStopping) return;
    setIsStopping(true);
    setStopConfirm(false);
    try {
      await finishTripCore({ openRecap: true, skipGauge: true });
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Impossible de terminer le trajet.');
    } finally {
      setIsStopping(false);
    }
  };

  const deleteShortTrip = async () => {
    if (!activeTrip || isStopping) return;
    setIsStopping(true);
    setShortTripPrompt(false);
    const id = activeTrip.id;
    try {
      try {
        await stopBackgroundTracking();
      } catch {
        /* ignore */
      }
      try {
        await flushTripUpdates();
      } catch {
        /* ignore */
      }
      await deleteTrip(id);
      await clearLiveTripBuffer();
      clearLivePointsAfterFinish();
      setLiveOriginLabel('');
      setLiveDestLabel('');
      setDestination('');
      setDestCoords(null);
      setPlannedRoute([]);
      setRouteOptions([]);
      setSelectedRouteId(null);
      setTripStartFuelLiters(null);
      setNearDestination(false);
      setStopConfirm(false);
      arrivalPromptedRef.current = false;
      await refresh();
      await loadLists();
      showToast('Trajet court supprimé');
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer le trajet.');
    } finally {
      setIsStopping(false);
    }
  };

  const keepShortTrip = async () => {
    if (!activeTrip || isStopping) return;
    setIsStopping(true);
    setShortTripPrompt(false);
    try {
      await finishTripCore({ openRecap: true, skipGauge: true, keepShort: true });
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Impossible de terminer le trajet.');
    } finally {
      setIsStopping(false);
    }
  };

  /** Proximité destination pendant un trajet avec nav. */
  const checkArrivalProximity = useCallback(async () => {
    if (!activeTrip || activeTrip.isPaused || isStopping) return;
    // Suivi libre / pas de destination réelle → ne jamais auto-terminer.
    if (!activeTrip.destinationName?.trim()) return;
    let target = destCoords;
    if (!target && plannedRoute.length > 1) {
      const last = plannedRoute[plannedRoute.length - 1];
      target = { latitude: last.latitude, longitude: last.longitude };
    }
    if (!target) return;

    let loc = userLocation;
    // Préférer le dernier point du trajet (FGS) plutôt qu’un GPS High frais toutes les 20 s.
    const lastPt = liveMapTail.length > 0 ? liveMapTail[liveMapTail.length - 1] : null;
    if (lastPt) {
      loc = { latitude: lastPt.latitude, longitude: lastPt.longitude };
    } else if (!loc) {
      try {
        const fresh = await getCurrentLocation({ fresh: true });
        if (fresh?.coords) {
          loc = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
          setUserLocation(loc);
        }
      } catch {
        /* keep */
      }
    }
    if (!loc) return;

    const distKm = haversineDistance(
      loc.latitude,
      loc.longitude,
      target.latitude,
      target.longitude
    );
    const near = distKm < 0.22;
    setNearDestination(near);

    if (near && activeTrip.distanceKm >= 0.8 && !arrivalPromptedRef.current) {
      arrivalPromptedRef.current = true;
      setIsStopping(true);
      void (async () => {
        try {
          await finishTripCore({ openRecap: true, skipGauge: true });
        } catch (e) {
          notify(
            'Erreur',
            e instanceof Error ? e.message : 'Impossible de terminer le trajet.'
          );
          arrivalPromptedRef.current = false;
        } finally {
          setIsStopping(false);
        }
      })();
    }
  }, [
    activeTrip?.id,
    activeTrip?.isPaused,
    activeTrip?.distanceKm,
    activeTrip?.destinationName,
    destCoords,
    plannedRoute,
    userLocation?.latitude,
    userLocation?.longitude,
    liveMapTail,
    isStopping,
    finishTripCore,
  ]);

  useEffect(() => {
    if (!activeTrip?.id) {
      arrivalPromptedRef.current = false;
      criticalStationAlertedRef.current = false;
      setNearDestination(false);
      return;
    }
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && activeTrip && !activeTrip.isPaused) {
        // Reprend le FGS si l’OS l’a coupé (Freecess Samsung / doze) — critique aussi Nothing
        void startBackgroundTracking();
        void checkArrivalProximity();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [activeTrip?.id, activeTrip?.isPaused, checkArrivalProximity]);

  // Pendant trajet : alerte une fois si réservoir critique → station proche / moins chère
  useEffect(() => {
    if (!activeTrip?.isActive || activeTrip.isPaused || !activeVehicle) return;
    if (criticalStationAlertedRef.current) return;

    const burned =
      activeTrip.estimatedFuelUsed > 0.01
        ? activeTrip.estimatedFuelUsed
        : estimateTripFuelLiters(activeVehicle, activeTrip.distanceKm, {
            learnedFactor: activeVehicle.consumptionLearnFactor,
          });
    const remaining = Math.max(
      0,
      (tripStartFuelLiters ??
        activeVehicle.estimatedFuelLiters ??
        activeVehicle.tankCapacity) - burned
    );
    const tone = fuelRemainingTone({
      litersRemaining: remaining,
      tankCapacity: activeVehicle.tankCapacity,
      lowLitersThreshold: activeVehicle.lowFuelThresholdLiters,
      vehicle: activeVehicle,
    });
    if (tone !== 'critical') return;
    criticalStationAlertedRef.current = true;
    void (async () => {
      const origin =
        userLocation ||
        (await getCurrentLocation()
          .then((l) =>
            l
              ? { latitude: l.coords.latitude, longitude: l.coords.longitude }
              : null
          )
          .catch(() => null));
      if (!origin || !isFrenchFuelOpenDataAvailable(countryCode)) {
        Alert.alert(
          'Réservoir critique',
          `Il reste ~${remaining.toFixed(1)} L — trouvez une station rapidement.`,
          [{ text: 'OK' }]
        );
        return;
      }
      try {
        const stations = await fetchCheapestStations({
          latitude: origin.latitude,
          longitude: origin.longitude,
          radiusKm: 18,
          fuel: activeVehicle.fuelType,
          limit: 20,
          countryCode,
        });
        const res = await checkNearestStationReach({
          vehicle: activeVehicle,
          litersRemaining: remaining,
          latitude: origin.latitude,
          longitude: origin.longitude,
          countryCode,
        });
        const ranked = rankStationsForDetour({
          stations,
          vehicle: activeVehicle,
          litersRemaining: remaining,
          limit: 3,
        });
        const lines = [
          `Il reste ~${remaining.toFixed(1)} L — allez à une station.`,
          res ? res.message : null,
          ranked[0]
            ? `Moins chère à portée : ${ranked[0].name} · ${ranked[0].pricePerL.toFixed(3)} €/L · ${ranked[0].detourKm.toFixed(1)} km`
            : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        Alert.alert('Attention — carburant critique', lines, [
          { text: 'Plus tard', style: 'cancel' },
          ...(ranked[0]
            ? [
                {
                  text: 'Via cette station',
                  onPress: () => {
                    setFuelStopVia({
                      latitude: ranked[0].latitude,
                      longitude: ranked[0].longitude,
                    });
                    notify('Détour station', ranked[0].name);
                  },
                },
              ]
            : []),
          {
            text: 'Nouveau plein',
            onPress: () => router.push('/fillup/add' as never),
          },
        ]);
      } catch {
        Alert.alert(
          'Réservoir critique',
          `Il reste ~${remaining.toFixed(1)} L — trouvez une station.`,
          [{ text: 'OK' }]
        );
      }
    })();
  }, [
    activeTrip?.id,
    activeTrip?.isActive,
    activeTrip?.isPaused,
    activeTrip?.distanceKm,
    activeTrip?.estimatedFuelUsed,
    activeVehicle?.id,
    activeVehicle?.estimatedFuelLiters,
    tripStartFuelLiters,
    userLocation?.latitude,
    userLocation?.longitude,
    countryCode,
  ]);

  // Pendant trajet : vérifier proximité périodiquement
  useEffect(() => {
    if (!activeTrip || activeTrip.isPaused || !destCoords) return;
    const t = setInterval(() => {
      void checkArrivalProximity();
    }, 20000);
    return () => clearInterval(t);
  }, [activeTrip?.id, activeTrip?.isPaused, destCoords, checkArrivalProximity]);

  const handleOpenGoogleMaps = async () => {
    // Suivi libre / pas de destination réelle → jamais d’itinéraire fantôme (~4 min)
    const inFree =
      startMode === 'free' ||
      Boolean(activeTrip && !activeTrip.destinationName?.trim());
    const label =
      (inFree
        ? activeTrip?.destinationName?.trim() || ''
        : destination.trim() ||
          activeTrip?.destinationName?.trim() ||
          liveDestLabel?.trim() ||
          '') || '';
    const coordsForNav = inFree ? null : destCoords;

    if (inFree || (!coordsForNav && !label)) {
      const openedHere = await openGoogleMapsHere(userLocation || undefined);
      if (!openedHere) {
        notify(
          'Google Maps',
          'Impossible d’ouvrir Google Maps. Le suivi GPS reste dans l’app.'
        );
      }
      return;
    }

    let opened = false;
    try {
      if (coordsForNav) {
        opened = await launchGoogleMapsNavigation({
          destination: coordsForNav,
          origin: userLocation,
          waypoints: mapsWaypointsForRoute(selectedRoute),
          label: label || 'Destination',
        });
      } else if (label) {
        await Linking.openURL(openGoogleMapsSearch(label));
        opened = true;
      }
    } catch {
      opened = false;
    }
    if (!opened) {
      notify('Google Maps', 'Impossible d’ouvrir Maps. Vérifiez qu’il est installé.');
    }
  };

  /** Simulateur voiture (tests).
   * - fast (défaut) : injection synchrone — évite Freecess Samsung
   * - live : rythme trajet (timeScale 1–3) pour cohabitation PLM / musique */
  const handleRunCarSimulator = async (opts?: { pace?: 'fast' | 'live'; timeScale?: number }) => {
    if (!activeVehicle || simRunning) return;
    const pace =
      opts?.pace ??
      (String(params.simPace || '').toLowerCase() === 'live' ? 'live' : 'fast');
    const timeScale = Math.max(
      1,
      opts?.timeScale ??
        (Number(params.timeScale) > 0 ? Number(params.timeScale) : pace === 'live' ? 2 : 25)
    );
    simAbort.current.aborted = false;
    setSimRunning(true);
    setSimProgress(
      pace === 'live'
        ? `Sim live ×${timeScale} — laissez PLM jouer…`
        : 'Démarrage sim commute (rapide)…'
    );
    let tripId: number | null = null;
    try {
      await stopBackgroundTracking();
      await purgeSimulatorTrips(activeVehicle.id);
      await stopActiveTrips();

      const points = buildWorkCommuteRoundTrip({
        stepMeters: pace === 'live' ? 180 : 120,
        trafficLightsEveryKm: 6.5,
        workPauseMs: pace === 'live' ? 3 * 60 * 1000 : 6 * 60 * 1000,
      });
      const simMs = Math.max(
        0,
        (points[points.length - 1]?.timestamp ?? 0) - (points[0]?.timestamp ?? 0)
      );
      const wallMin = Math.round(simMs / timeScale / 60000);
      setDestCoords(SIM_WORK);
      setDestination('Travail puis retour domicile (sim)');
      setPlannedRoute(
        points
          .filter((_, i) => i % 8 === 0 || i === points.length - 1)
          .map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
      );
      setUserLocation(SIM_HOME);
      setCurrentRegion({
        latitude: SIM_HOME.latitude,
        longitude: SIM_HOME.longitude,
        latitudeDelta: 0.45,
        longitudeDelta: 0.45,
      });

      const first = points[0];
      tripId = await createTrip({
        vehicleId: activeVehicle.id,
        startTime: new Date(first.timestamp).toISOString(),
        endTime: null,
        distanceKm: 0,
        estimatedFuelUsed: 0,
        estimatedCost: 0,
        routePoints: JSON.stringify([
          {
            latitude: first.latitude,
            longitude: first.longitude,
            timestamp: first.timestamp,
          },
        ]),
        originName: 'Domicile (sim)',
        destinationName: 'Travail A/R (sim)',
        isActive: true,
        isPaused: false,
        status: 'confirmed',
        source: 'gps',
        fillUpId: null,
        note:
          pace === 'live'
            ? `SIMULATEUR LIVE ×${timeScale} (~${wallMin} min mur) — cohabitation PLM`
            : 'SIMULATEUR — ne pas compter comme trajet réel',
      });
      if (activeVehicle.estimatedFuelLiters != null) {
        await recordFuelGaugeReading({
          vehicleId: activeVehicle.id,
          liters: activeVehicle.estimatedFuelLiters,
          source: 'trip_start',
          tripId,
        });
      }
      await refresh();

      let routeJson = JSON.stringify([
        {
          latitude: first.latitude,
          longitude: first.longitude,
          timestamp: first.timestamp,
        },
      ]);

      const persistPartial = async (idx: number) => {
        const dist = calculateRouteDistance(routeJson);
        const fuel = estimateTripFuelLiters(activeVehicle, dist, {
          learnedFactor: activeVehicle.consumptionLearnFactor,
        });
        const cost = estimateCost(fuel, activeVehicle.defaultFuelPrice);
        await updateTrip(tripId!, {
          routePoints: routeJson,
          distanceKm: dist,
          estimatedFuelUsed: fuel,
          estimatedCost: cost,
          isActive: true,
        });
        setUserLocation({
          latitude: points[idx].latitude,
          longitude: points[idx].longitude,
        });
        setSimProgress(
          pace === 'live'
            ? `Live ${idx + 1}/${points.length} · ${formatDistance(dist)} · ~${wallMin} min`
            : `Sim ${idx + 1}/${points.length} · ${formatDistance(dist)}`
        );
        await refresh();
      };

      if (pace === 'live') {
        showToast(`Sim live démarrée (~${wallMin} min) — musique PLM OK en fond`);
        await playCarSimulation(
          points,
          async ({ index, point }) => {
            if (index === 0) return;
            routeJson = appendRoutePoint(routeJson, {
              latitude: point.latitude,
              longitude: point.longitude,
              timestamp: point.timestamp,
              accuracy: point.accuracy ?? 8,
              speed: point.speed ?? 20,
            });
            if (index % 8 === 0 || index === points.length - 1) {
              await persistPartial(index);
            } else {
              setUserLocation({ latitude: point.latitude, longitude: point.longitude });
            }
          },
          {
            timeScale,
            signal: simAbort.current,
            maxWaitMs: Number.POSITIVE_INFINITY,
          }
        );
      } else {
        setSimProgress(`Injection GPS 0/${points.length}…`);
        for (let i = 1; i < points.length; i++) {
          if (simAbort.current.aborted) break;
          const point = points[i];
          routeJson = appendRoutePoint(routeJson, {
            latitude: point.latitude,
            longitude: point.longitude,
            timestamp: point.timestamp,
            accuracy: point.accuracy ?? 8,
            speed: point.speed ?? 20,
          });
          if (i % 80 === 0 || i === points.length - 1) {
            await persistPartial(i);
            await new Promise((r) => setTimeout(r, 16));
          }
        }
      }

      routeJson = compactRoutePointsJson(routeJson);
      const distanceKm = calculateRouteDistance(routeJson);
      const pts = JSON.parse(routeJson) as {
        latitude: number;
        longitude: number;
        timestamp: number;
      }[];
      const idleRatio = idleRatioFromPoints(pts);
      const accelFactor = accelAggressionFactor(pts);
      const stopGoFactor = stopAndGoFactor(pts);
      const fuelUsed = estimateTripFuelLiters(activeVehicle, distanceKm, {
        idleRatio,
        accelFactor,
        stopGoFactor,
        learnedFactor: activeVehicle.consumptionLearnFactor,
      });
      const cost = estimateCost(fuelUsed, activeVehicle.defaultFuelPrice);
      const stats = calculateTripStats(
        activeVehicle,
        distanceKm,
        new Date(first.timestamp).toISOString(),
        new Date().toISOString(),
        routeJson
      );

      await updateTrip(tripId, {
        routePoints: routeJson,
        distanceKm,
        estimatedFuelUsed: fuelUsed,
        estimatedCost: cost,
        isActive: false,
        isPaused: false,
        endTime: new Date().toISOString(),
        originName: 'Domicile (sim)',
        destinationName: 'Travail A/R (sim)',
        note: simAbort.current.aborted
          ? `SIMULATEUR (interrompu) · ${formatDistance(distanceKm)} · ~${fuelUsed.toFixed(1)} L`
          : `SIMULATEUR ${pace === 'live' ? `LIVE×${timeScale}` : 'commute'} · ${formatDistance(distanceKm)} · ${formatSpeedKmh(stats.movingSpeedKmh)} moy. · idle ${(idleRatio * 100).toFixed(0)}% · ~${fuelUsed.toFixed(1)} L`,
      });
      // Même burn que Terminer GPS réel — sinon la jauge Accueil ne bouge pas.
      if (distanceKm > 0 && !simAbort.current.aborted) {
        await applyTripFuelBurn(activeVehicle, distanceKm, 0, {
          avgSpeedKmh: stats.movingSpeedKmh > 0 ? stats.movingSpeedKmh : undefined,
          idleRatio,
          tripId,
        }).catch(() => null);
        await addTrackedKm(activeVehicle.id, distanceKm).catch(() => null);
        const after = await getVehicleById(activeVehicle.id).catch(() => null);
        const endLiters = after?.estimatedFuelLiters ?? activeVehicle.estimatedFuelLiters;
        if (endLiters != null) {
          await recordFuelGaugeReading({
            vehicleId: activeVehicle.id,
            liters: endLiters,
            source: 'trip_end',
            tripId,
          });
        }
      }
      setUserLocation({
        latitude: points[points.length - 1].latitude,
        longitude: points[points.length - 1].longitude,
      });
      setSimProgress('');
      await refresh();
      await loadLists();
      setTab('history');
      if (simAbort.current.aborted) {
        showToast(
          `Sim interrompue · ${formatDistance(distanceKm)} · ~${fuelUsed.toFixed(1)} L`
        );
      } else {
        showToast(
          `Sim OK · ${formatDistance(distanceKm)} · ~${fuelUsed.toFixed(1)} L · ${formatEuro(cost)}`
        );
      }
    } catch (e) {
      if (tripId != null) {
        try {
          await updateTrip(tripId, {
            isActive: false,
            isPaused: false,
            endTime: new Date().toISOString(),
            note: 'SIMULATEUR — erreur / finalisé auto',
          });
        } catch {
          /* ignore */
        }
      }
      showToast(e instanceof Error ? e.message : 'Échec simulateur');
    } finally {
      setSimRunning(false);
      setSimProgress('');
    }
  };

  const validateTrip = async (trip: Trip, status: 'confirmed' | 'rejected') => {
    await updateTrip(trip.id, { status });
    if (status === 'confirmed' && trip.distanceKm > 0) {
      await addTrackedKm(trip.vehicleId, trip.distanceKm);
    }
    await refresh();
    await loadLists();
  };

  const handleDeleteTrip = (trip: Trip) => {
    const pts = parseRoutePoints(trip.routePoints);
    const o = tripPlaceLabel(trip.originName, pts[0], 'origin');
    const d = tripPlaceLabel(
      trip.destinationName,
      pts.length > 1 ? pts[pts.length - 1] : null,
      'destination'
    );
    confirm(
      'Supprimer le trajet',
      `${o} → ${d}`,
      async () => {
        await deleteTrip(trip.id);
        await refresh();
        await loadLists();
        notify('Supprimé', 'Trajet retiré.');
      },
      'Supprimer'
    );
  };

  const openDetail = (trip: Trip) => router.push(`/trip/${trip.id}` as never);

  // Stats live : colonnes numériques déjà à jour par le FGS — pas de parse JSON O(n).
  const tripStats = useMemo(() => {
    if (!activeTrip || !activeVehicle) return null;
    const startMs = Date.parse(activeTrip.startTime);
    const durationMinutes = Number.isFinite(startMs)
      ? Math.max(0, (Date.now() - startMs) / 60000)
      : 0;
    const movingSpeedKmh =
      durationMinutes > 0.5 ? (activeTrip.distanceKm / durationMinutes) * 60 : 0;
    return {
      fuelUsed: activeTrip.estimatedFuelUsed,
      cost: activeTrip.estimatedCost,
      durationMinutes,
      movingSpeedKmh,
    };
  }, [
    activeTrip?.id,
    activeTrip?.distanceKm,
    activeTrip?.estimatedFuelUsed,
    activeTrip?.estimatedCost,
    activeTrip?.startTime,
    activeVehicle?.id,
  ]);
  const avgSpeed =
    activeTrip && tripStats
      ? tripStats.movingSpeedKmh > 0
        ? tripStats.movingSpeedKmh
        : (activeTrip.distanceKm / Math.max(tripStats.durationMinutes, 0.01)) * 60
      : 0;

  const liveActiveFuel =
    activeTrip && activeVehicle
      ? activeTrip.estimatedFuelUsed > 0.05
        ? activeTrip.estimatedFuelUsed
        : estimateTripFuelLiters(activeVehicle, activeTrip.distanceKm, {
            learnedFactor: activeVehicle.consumptionLearnFactor,
          })
      : 0;
  const liveActiveCost =
    activeTrip && activeVehicle
      ? activeTrip.estimatedCost > 0.05
        ? activeTrip.estimatedCost
        : estimateCost(liveActiveFuel, activeVehicle.defaultFuelPrice)
      : 0;
  const liveFuelRemaining =
    activeTrip && activeVehicle
      ? Math.max(
          0,
          (tripStartFuelLiters ?? activeVehicle.estimatedFuelLiters ?? activeVehicle.tankCapacity) -
            liveActiveFuel
        )
      : null;

  const routePoints = liveMapTail;
  const paused = Boolean(activeTrip?.isPaused);
  const isFreeDrive = Boolean(activeTrip && !activeTrip.destinationName);
  const liveFuelTone =
    liveFuelRemaining != null && activeVehicle
      ? fuelRemainingTone({
          litersRemaining: liveFuelRemaining,
          tankCapacity: activeVehicle.tankCapacity,
          lowLitersThreshold: activeVehicle.lowFuelThresholdLiters,
          vehicle: activeVehicle,
        })
      : 'ok';
  const liveFuelColor = fuelToneColor(liveFuelTone, colors);
  /** Pendant trajet : derniers points GPS ; sinon itinéraire prévu */
  const mapRoute =
    routePoints.length > 1
      ? routePoints
      : plannedRoute.length > 0
        ? plannedRoute
        : routePoints;

  const liveHeading = useMemo(
    () => headingFromTrail(routePoints.length ? routePoints : userLocation ? [userLocation] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveMapTail, userLocation?.latitude, userLocation?.longitude]
  );

  const navGuidance = useMemo(() => {
    if (!activeTrip || !activeTrip.destinationName) return null;
    return computeNavGuidance({
      user: userLocation,
      destination: destCoords,
      destinationLabel: activeTrip.destinationName || liveDestLabel,
      route: plannedRoute.length > 1 ? plannedRoute : mapRoute,
      headingDeg: liveHeading,
      steps: navSteps ?? selectedRoute?.steps ?? null,
    });
  }, [
    activeTrip,
    userLocation,
    destCoords,
    liveDestLabel,
    plannedRoute,
    mapRoute,
    liveHeading,
    navSteps,
    selectedRoute?.steps,
  ]);

  const quickPlaces = useMemo(() => {
    const home = places.find((p) => p.kind === 'home');
    const work = places.find((p) => p.kind === 'work');
    return [home, work].filter(Boolean) as Place[];
  }, [places]);

  const applyDestination = useCallback(
    (label: string, lat?: number | null, lon?: number | null) => {
      persistStartMode('nav');
      setDestination(label);
      if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
        const coords = { latitude: lat, longitude: lon };
        setDestCoords(coords);
        fitOriginAndDest(userLocation, coords);
        if (userLocation) {
          void loadRouteAlternatives(userLocation, coords);
        } else {
          setPlannedRoute([]);
          setRouteOptions([]);
        }
      } else {
        setDestCoords(null);
        setRouteOptions([]);
        void forwardGeocode(label).then((g) => {
          if (!g) return;
          const coords = { latitude: g.latitude, longitude: g.longitude };
          setDestCoords(coords);
          fitOriginAndDest(userLocation, coords);
          if (userLocation) void loadRouteAlternatives(userLocation, coords);
        });
      }
    },
    [userLocation, loadRouteAlternatives, persistStartMode, fitOriginAndDest]
  );

  const isActiveDestChip = useCallback(
    (label: string, lat?: number | null, lon?: number | null) => {
      if (
        destCoords &&
        lat != null &&
        lon != null &&
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        return (
          Math.abs(destCoords.latitude - lat) < 0.00035 &&
          Math.abs(destCoords.longitude - lon) < 0.00035
        );
      }
      const a = destination.trim().toLowerCase();
      const b = label.trim().toLowerCase();
      if (!a || !b) return false;
      return a === b || a.includes(b) || b.includes(a);
    },
    [destination, destCoords]
  );

  const destinationHabit = useMemo((): SimilarTripStats | null => {
    if (!destination.trim() || history.length < 1) return null;
    return computeDestinationHabitStats(history, destination.trim(), destCoords);
  }, [destination, destCoords, history]);

  const smartSuggestions = useMemo((): SmartSuggestion[] => {
    if (activeTrip || smartDismissed) return [];
    return suggestTripsForNow({
      places,
      trips: history,
      userLocation,
    });
  }, [activeTrip, smartDismissed, places, history, userLocation]);

  const smartHint = useMemo(() => commuteHintLabel(), [tab, activeTrip?.id]);

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const tabSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (
          _e: GestureResponderEvent,
          g: PanResponderGestureState
        ) => Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < 56) return;
          if (g.dx < 0 && tabRef.current === 'live') setTab('history');
          else if (g.dx > 0 && tabRef.current === 'history') setTab('live');
        },
      }),
    []
  );

  // Quand la position arrive après le choix d’une destination
  useEffect(() => {
    if (activeTrip || !destCoords || !userLocation) return;
    if (routeOptions.length > 0 || routesLoading) return;
    void loadRouteAlternatives(userLocation, destCoords);
  }, [
    activeTrip,
    destCoords,
    userLocation,
    routeOptions.length,
    routesLoading,
    loadRouteAlternatives,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {tab === 'history' ? (
        <TutorialAnchor id="trip-history-list">
        <View style={[styles.historyHead, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => {
              setTab('live');
              router.setParams({ tab: 'live' } as never);
            }}
            hitSlop={10}
            style={styles.historyBack}
          >
            <Ionicons name="arrow-back" size={20} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '700', marginLeft: 6 }}>Trajet</Text>
          </Pressable>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>Historique</Text>
          <View style={{ width: 72 }} />
        </View>
        </TutorialAnchor>
      ) : null}

      {tab === 'live' ? (
        <>
          <TutorialAnchor id="trip-live-panel" style={{ flex: 1 }}>
          <View style={[styles.map, mapCollapsed ? styles.mapCollapsed : null]}>
            <TripMap
              key={`trip-map-${mapRemountKey}`}
              ref={mapRef}
              region={currentRegion}
              routePoints={mapRoute}
              accentColor={colors.accent}
              userLocation={userLocation}
              paused={paused}
              plannedRoute={activeTrip && routePoints.length > 1 ? [] : plannedRoute}
              alternateRoutes={
                activeTrip && routePoints.length > 1 ? [] : alternateMapRoutes
              }
              destination={destCoords}
            />
            <Pressable
              onPress={() => setMapCollapsed((v) => !v)}
              style={styles.mapCollapseBtn}
              accessibilityRole="button"
              accessibilityLabel={mapCollapsed ? 'Agrandir la carte' : 'Réduire la carte'}
            >
              <Ionicons
                name={mapCollapsed ? 'chevron-down' : 'chevron-up'}
                size={18}
                color="#fff"
              />
            </Pressable>
            {/* HUD limite vitesse + carburant : visible dès qu'on a une position (trajet ou pas) */}
            {(activeTrip || userLocation) ? (
              <View style={styles.mapTopHud} pointerEvents="box-none">
                {(isFreeDrive || !activeTrip) ? (
                  <View style={styles.mapHudRow}>
                    {liveSpeedLimit ? (
                      <View
                        style={styles.speedLimitSign}
                        accessibilityLabel={`Limitation ${liveSpeedLimit.limitKmh} km/h`}
                      >
                        <Text style={styles.speedLimitValue}>{liveSpeedLimit.limitKmh}</Text>
                      </View>
                    ) : null}
                    {activeTrip && liveFuelRemaining != null ? (
                      <View
                        style={[
                          styles.fuelHudChip,
                          { borderColor: liveFuelColor, backgroundColor: 'rgba(15,23,42,0.9)' },
                        ]}
                      >
                        <Text style={{ color: liveFuelColor, fontWeight: '900', fontSize: 15 }}>
                          {liveFuelRemaining.toFixed(1)} L
                        </Text>
                        <Text style={{ color: '#94a3b8', fontWeight: '700', fontSize: 11 }}>
                          {Math.round(
                            (liveFuelRemaining / Math.max(1, activeVehicle?.tankCapacity || 50)) * 100
                          )}
                          %
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.mapHudRow}>
                    {navGuidance ? (
                      <Pressable
                        onPress={() => {
                          if (activeTrip.destinationName) void handleOpenGoogleMaps();
                        }}
                        style={[
                          styles.navHudChip,
                          {
                            borderColor: paused ? colors.warning : colors.accent,
                            backgroundColor: 'rgba(15,23,42,0.92)',
                          },
                        ]}
                      >
                        <Ionicons
                          name="navigate"
                          size={16}
                          color={paused ? colors.warning : colors.accent}
                          style={{ transform: [{ rotate: `${navGuidance.arrowRotateDeg}deg` }] }}
                        />
                        <View style={{ flexShrink: 1, maxWidth: 160 }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }} numberOfLines={1}>
                            {navGuidance.title}
                          </Text>
                          <Text style={{ color: '#94a3b8', fontSize: 10 }} numberOfLines={1}>
                            {navGuidance.distanceLabel}
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                    {liveSpeedLimit ? (
                      <View
                        style={styles.speedLimitSign}
                        accessibilityLabel={`Limitation ${liveSpeedLimit.limitKmh} km/h`}
                      >
                        <Text style={styles.speedLimitValue}>{liveSpeedLimit.limitKmh}</Text>
                      </View>
                    ) : null}
                    {liveFuelRemaining != null &&
                    (liveFuelTone === 'warn' || liveFuelTone === 'critical') ? (
                      <View
                        style={[
                          styles.fuelHudChip,
                          { borderColor: liveFuelColor, backgroundColor: 'rgba(15,23,42,0.9)' },
                        ]}
                      >
                        <Text style={{ color: liveFuelColor, fontWeight: '900', fontSize: 15 }}>
                          {liveFuelRemaining.toFixed(1)} L
                        </Text>
                        <Text style={{ color: '#94a3b8', fontWeight: '700', fontSize: 11 }}>
                          {Math.round(
                            (liveFuelRemaining / Math.max(1, activeVehicle?.tankCapacity || 50)) *
                              100
                          )}
                          %
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
            {!userLocation && (
              <View style={styles.mapHint} pointerEvents="none">
                <Text style={styles.mapHintText}>Localisation…</Text>
              </View>
            )}
            {!activeTrip && routeOptions.length > 0 && (
              <View style={styles.routePicker} pointerEvents="box-none">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.routePickerInner}
                >
                  {routeOptions.map((r) => {
                    const selected = r.id === selectedRoute?.id;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => applyRouteSelection(r)}
                        style={[
                          styles.routeChip,
                          {
                            borderColor: selected ? colors.accent : 'rgba(255,255,255,0.35)',
                            backgroundColor: selected
                              ? colors.accent
                              : 'rgba(15,23,42,0.88)',
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? '#fff' : '#e2e8f0',
                            fontWeight: '800',
                            fontSize: 12,
                          }}
                        >
                          {r.kind === 'eco'
                            ? 'Éco'
                            : r.kind === 'fastest'
                              ? 'Rapide'
                              : r.label}
                          {r.kind === 'eco' || r.kind === 'fastest' ? ` · ${r.label}` : ''}
                        </Text>
                        <Text
                          style={{
                            color: selected ? 'rgba(255,255,255,0.9)' : '#94a3b8',
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          {r.distanceKm.toFixed(1)} km
                          {r.durationMinutes != null ? ` · ${r.durationMinutes} min` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {routesLoading ? (
                  <Text style={styles.routePickerHint}>Calcul des itinéraires…</Text>
                ) : null}
              </View>
            )}
          </View>

          <ScrollView
            style={styles.panel}
            contentContainerStyle={[
              styles.panelContent,
              !activeTrip && activeVehicle ? { paddingBottom: 120 + insets.bottom } : null,
            ]}
          >
            {activeTrip && nearDestination && (
              <Pressable
                onPress={() => void handleStopTrip({ fromArrival: true })}
                style={[
                  styles.arrivalBanner,
                  { backgroundColor: colors.success + '22', borderColor: colors.success },
                ]}
              >
                <Ionicons name="flag" size={20} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Arrivé ?</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    Terminer maintenant et voir le récap
                  </Text>
                </View>
                <Text style={{ color: colors.success, fontWeight: '800' }}>Terminer</Text>
              </Pressable>
            )}

            {!activeVehicle ? (
              <Card>
                <Text style={[styles.warning, { color: colors.warning }]}>
                  Sélectionnez un véhicule pour démarrer un trajet.
                </Text>
                <Button
                  title="Aller aux véhicules"
                  onPress={() => router.push('/(tabs)/vehicles' as never)}
                  style={{ marginTop: 12 }}
                />
              </Card>
            ) : activeTrip ? (
              <>
                {shortTripPrompt ? (
                  <Card
                    style={{
                      marginBottom: 8,
                      borderColor: colors.warning,
                      borderWidth: 1,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 6 }}>
                      Peu ou pas d’avancée
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
                      Moins de 500 m enregistrés. Supprimer ce trajet ou le conserver ?
                    </Text>
                    <Button
                      title={isStopping ? '…' : 'Supprimer'}
                      variant="danger"
                      onPress={() => void deleteShortTrip()}
                      disabled={isStopping}
                      style={{ marginBottom: 8 }}
                    />
                    <Button
                      title="Conserver"
                      variant="outline"
                      onPress={() => void keepShortTrip()}
                      disabled={isStopping}
                    />
                  </Card>
                ) : stopConfirm ? (
                  <Card
                    style={{
                      marginBottom: 8,
                      borderColor: colors.danger,
                      borderWidth: 1,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 6 }}>
                      Terminer ce trajet ?
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
                      Le suivi GPS s’arrête et le récap s’affiche. Fonctionne aussi en suivi libre.
                    </Text>
                    <Button
                      title={isStopping ? 'Arrêt…' : 'Oui, terminer'}
                      variant="danger"
                      onPress={() => void confirmStopTrip()}
                      disabled={isStopping}
                      style={{ marginBottom: 8 }}
                    />
                    <Button
                      title="Continuer le suivi"
                      variant="outline"
                      onPress={() => setStopConfirm(false)}
                      disabled={isStopping}
                    />
                  </Card>
                ) : (
                  <View style={styles.activeBtnRow}>
                    {paused ? (
                      <>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/fillup/add' as never,
                              params: { tripId: String(activeTrip.id), fromTrip: '1' },
                            })
                          }
                          style={[
                            styles.activeBtn,
                            { borderColor: colors.border, backgroundColor: colors.card },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Plein"
                        >
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                            Plein
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handleResume()}
                          style={[
                            styles.activeBtn,
                            {
                              borderColor: colors.accent,
                              backgroundColor: colors.accent + '22',
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Reprendre"
                        >
                          <Text
                            style={{
                              color: colors.accent,
                              fontWeight: '800',
                              fontSize: 13,
                            }}
                          >
                            Reprendre
                          </Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        onPress={() => void handlePause(false)}
                        style={[
                          styles.activeBtn,
                          { borderColor: colors.border, backgroundColor: colors.card },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Pause"
                      >
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                          Pause
                        </Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => void handleStopTrip()}
                      disabled={isStopping}
                      style={[
                        styles.activeBtn,
                        {
                          borderColor: colors.danger,
                          backgroundColor: colors.danger + '18',
                          opacity: isStopping ? 0.5 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Terminer trajet"
                    >
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>
                        Terminer trajet
                      </Text>
                    </Pressable>
                  </View>
                )}

                <View style={styles.statsRow}>
                  <StatCard label="Distance" value={formatDistance(activeTrip.distanceKm)} />
                  <StatCard
                    label="Vitesse moy."
                    value={avgSpeed > 0 ? formatSpeedKmh(avgSpeed) : '—'}
                  />
                </View>
                <View style={styles.statsRow}>
                  <StatCard
                    label="Carburant est."
                    value={`${liveActiveFuel.toFixed(2)} L`}
                  />
                  <StatCard label="Coût est." value={formatEuro(liveActiveCost)} />
                </View>
                <Text style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 13 }}>
                  Durée : {Math.floor(tripStats?.durationMinutes ?? 0)} min
                </Text>

                <Card
                  style={{
                    ...styles.activeTrip,
                    borderColor: paused ? colors.warning : colors.accent,
                  }}
                >
                  <View style={styles.tripActiveHeader}>
                    <Ionicons
                      name={paused ? 'pause-circle' : 'radio-button-on'}
                      size={16}
                      color={paused ? colors.warning : colors.accent}
                    />
                    <Text
                      style={[
                        styles.tripActiveTitle,
                        { color: paused ? colors.warning : colors.accent },
                      ]}
                    >
                      {paused ? 'En pause' : 'Suivi en cours'}
                    </Text>
                  </View>
                  <Text style={[styles.placeLine, { color: colors.success }]}>
                    Départ : {liveOriginLabel || '…'}
                  </Text>
                  <Text style={[styles.placeLine, { color: colors.accent }]}>
                    Arrivée :{' '}
                    {activeTrip.destinationName
                      ? liveDestLabel
                      : 'Suivi libre (sans destination fixe)'}
                  </Text>
                </Card>
              </>
            ) : (
              <>
                {smartSuggestions.length > 0 && (
                  <Card style={{ marginBottom: 10 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                        {smartHint || 'Suggestion du moment'}
                      </Text>
                      <Pressable onPress={dismissSmartSuggestions} hitSlop={10}>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Plus tard</Text>
                      </Pressable>
                    </View>
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        marginBottom: 10,
                        lineHeight: 17,
                      }}
                    >
                      Selon l’heure et vos trajets — choisissez un lieu, l’itinéraire, puis Démarrer.
                    </Text>
                    {smartSuggestions.map((s) => (
                      <View
                        key={s.id}
                        style={[
                          styles.smartRow,
                          {
                            borderColor: colors.accent,
                            backgroundColor: colors.accent + '14',
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            s.kind === 'commute_to_home'
                              ? 'home'
                              : s.kind === 'commute_to_work'
                                ? 'briefcase'
                                : 'navigate'
                          }
                          size={20}
                          color={colors.accent}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: colors.text, fontWeight: '800' }} numberOfLines={1}>
                            {s.title}
                          </Text>
                          <Text
                            style={{ color: colors.textSecondary, fontSize: 12 }}
                            numberOfLines={1}
                          >
                            {s.subtitle}
                            {s.habitCount > 0 ? ` · ${s.habitCount} trajets` : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            dismissSmartSuggestions();
                            applyDestination(s.label, s.latitude, s.longitude);
                            showToast('Choisissez un itinéraire, puis Démarrer');
                          }}
                          style={{
                            backgroundColor: colors.accent,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            borderRadius: 10,
                          }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                            Choisir
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </Card>
                )}

                <Card>
                  <Text style={[styles.description, { color: colors.textSecondary }]}>
                    Le suivi GPS continue en arrière-plan (notification).
                  </Text>

                  <Pressable
                    onPress={() => persistStartMode('free')}
                    style={[
                      styles.modeCard,
                      {
                        borderColor: startMode === 'free' ? colors.accent : colors.border,
                        backgroundColor: colors.card,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
                      Suivi libre
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                      Pas de destination obligatoire — trace km, vitesse moyenne et conso estimée
                      même hors premier plan.
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => persistStartMode('nav')}
                    style={[
                      styles.modeCard,
                      {
                        borderColor: startMode === 'nav' ? colors.accent : colors.border,
                        backgroundColor: colors.card,
                        marginTop: 10,
                      },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontWeight: '800' }}>
                      Avec destination / navigation
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                      Indiquez une arrivée ; ouvre Maps pour naviguer + suit le GPS dans l’app.
                    </Text>
                  </Pressable>

                  {startMode === 'nav' && (
                    <View style={{ marginTop: 12 }}>
                      <PlaceSuggestField
                        label="Destination"
                        placeholder="Maison, adresse, contact…"
                        value={destination}
                        onChangeText={(t) => {
                          setDestination(t);
                          setDestCoords(null);
                          setRouteOptions([]);
                          setSelectedRouteId(null);
                          setPlannedRoute([]);
                        }}
                        places={places}
                        onPickPlace={(p) => {
                          if (p.latitude != null && p.longitude != null) {
                            const coords = { latitude: p.latitude, longitude: p.longitude };
                            setDestCoords(coords);
                            fitOriginAndDest(userLocation, coords);
                            if (userLocation) {
                              void loadRouteAlternatives(userLocation, coords);
                            }
                          }
                        }}
                        onPickCoords={(c) => {
                          if (Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
                            const coords = { latitude: c.latitude, longitude: c.longitude };
                            setDestCoords(coords);
                            fitOriginAndDest(userLocation, coords);
                            if (userLocation) {
                              void loadRouteAlternatives(userLocation, coords);
                            }
                          } else if (c.label) {
                            setDestination(c.label);
                            void forwardGeocode(c.label).then((g) => {
                              if (!g) return;
                              const coords = { latitude: g.latitude, longitude: g.longitude };
                              setDestCoords(coords);
                              fitOriginAndDest(userLocation, coords);
                              if (userLocation) {
                                void loadRouteAlternatives(userLocation, coords);
                              }
                            });
                          }
                        }}
                      />
                      {(quickPlaces.length > 0 || recentDests.length > 0) && (
                        <View style={{ marginTop: 10 }}>
                          <Text
                            style={{
                              color: colors.textSecondary,
                              fontSize: 12,
                              fontWeight: '700',
                              marginBottom: 8,
                            }}
                          >
                            Lieux & récents
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {quickPlaces.map((p) => {
                              const chipLabel = p.address?.trim() || p.name;
                              const active = isActiveDestChip(chipLabel, p.latitude, p.longitude);
                              return (
                              <Pressable
                                key={`place-${p.id}`}
                                onPress={() =>
                                  applyDestination(
                                    chipLabel,
                                    p.latitude,
                                    p.longitude
                                  )
                                }
                                style={[
                                  styles.destChip,
                                  {
                                    borderColor: active ? colors.accent : colors.border,
                                    backgroundColor: active
                                      ? colors.accent + '18'
                                      : colors.background,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={p.kind === 'home' ? 'home' : 'briefcase'}
                                  size={14}
                                  color={active ? colors.accent : colors.textSecondary}
                                />
                                <Text
                                  style={{
                                    color: active ? colors.accent : colors.text,
                                    fontWeight: '700',
                                    fontSize: 13,
                                  }}
                                >
                                  {p.kind === 'home'
                                    ? 'Domicile'
                                    : p.kind === 'work'
                                      ? 'Travail'
                                      : p.name}
                                </Text>
                              </Pressable>
                              );
                            })}
                            {recentDests.map((r) => {
                              const active = isActiveDestChip(r.label, r.latitude, r.longitude);
                              return (
                              <Pressable
                                key={`recent-${r.label}-${r.at}`}
                                onPress={() => applyDestination(r.label, r.latitude, r.longitude)}
                                style={[
                                  styles.destChip,
                                  {
                                    borderColor: active ? colors.accent : colors.border,
                                    backgroundColor: active
                                      ? colors.accent + '18'
                                      : colors.background,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name="time-outline"
                                  size={14}
                                  color={active ? colors.accent : colors.textSecondary}
                                />
                                <Text
                                  style={{
                                    color: active ? colors.accent : colors.text,
                                    fontWeight: active ? '700' : '600',
                                    fontSize: 13,
                                    maxWidth: 160,
                                  }}
                                  numberOfLines={1}
                                >
                                  {r.label}
                                </Text>
                              </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </Card>

                {startMode === 'nav' && destinationHabit && destinationHabit.count >= 1 && (
                  <Card style={{ marginBottom: 10 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700' }}>
                      HABITUDE
                      {selectedRoute ? ` · ${selectedRoute.label}` : ' SUR CE TRAJET'}
                      {' · '}
                      {destinationHabit.count}×
                    </Text>
                    <View style={styles.habitStatsRow}>
                      <View style={styles.habitStat}>
                        <Text style={[styles.habitStatVal, { color: colors.text }]}>
                          {destinationHabit.avgDistanceKm.toFixed(1)}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 10 }}>km</Text>
                      </View>
                      <View style={styles.habitStat}>
                        <Text style={[styles.habitStatVal, { color: colors.text }]}>
                          {destinationHabit.avgFuelL.toFixed(1)}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 10 }}>L</Text>
                      </View>
                      <View style={styles.habitStat}>
                        <Text style={[styles.habitStatVal, { color: colors.text }]}>
                          {formatEuro(destinationHabit.avgCost)}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 10 }}>coût</Text>
                      </View>
                      {destinationHabit.avgDurationMin > 0 && (
                        <View style={styles.habitStat}>
                          <Text style={[styles.habitStatVal, { color: colors.text }]}>
                            {destinationHabit.avgDurationMin}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 10 }}>min</Text>
                        </View>
                      )}
                      {destinationHabit.avgL100 > 0 && (
                        <View style={styles.habitStat}>
                          <Text style={[styles.habitStatVal, { color: colors.accent }]}>
                            {destinationHabit.avgL100.toFixed(1)}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 10 }}>L/100</Text>
                        </View>
                      )}
                    </View>
                    {destinationHabit.avgL100 > 0 && (
                      <View
                        style={[
                          styles.habitBadge,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            marginTop: 8,
                          },
                        ]}
                      >
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                          Référence conso : {destinationHabit.avgL100.toFixed(1)} L/100 km sur ce
                          parcours
                        </Text>
                      </View>
                    )}
                  </Card>
                )}

                {startMode === 'nav' && (destination.trim() || destCoords) && (
                  <Button
                    title="Programmer dans le calendrier"
                    variant="outline"
                    onPress={() => {
                      const title = encodeURIComponent(`Trajet · ${destination.trim() || 'Navigation'}`);
                      const details = encodeURIComponent(
                        `Ouvrir Hubera Fuel puis Maps\ngasoiltracking://trip?dest=${encodeURIComponent(destination.trim())}`
                      );
                      const start = new Date();
                      start.setMinutes(0, 0, 0);
                      start.setHours(start.getHours() + 1);
                      const end = new Date(start.getTime() + 45 * 60_000);
                      const fmt = (d: Date) =>
                        d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
                      const url =
                        `https://calendar.google.com/calendar/render?action=TEMPLATE` +
                        `&text=${title}&details=${details}` +
                        `&dates=${fmt(start)}/${fmt(end)}`;
                      void Linking.openURL(url).catch(() =>
                        notify('Calendrier', 'Impossible d’ouvrir le calendrier.')
                      );
                    }}
                    style={{ marginBottom: 8 }}
                  />
                )}

                {gpsSimEnabled && (
                  <>
                    <Button
                      title={
                        simRunning
                          ? simProgress || 'Simulation en cours…'
                          : 'Sim rapide (injection)'
                      }
                      variant="outline"
                      onPress={() => void handleRunCarSimulator({ pace: 'fast' })}
                      loading={simRunning}
                      disabled={simRunning || isStarting}
                      style={{ marginTop: 12 }}
                      accessibilityLabel="Sim rapide injection"
                    />
                    <Button
                      title="Sim live ×2 (~45 min)"
                      variant="outline"
                      onPress={() => void handleRunCarSimulator({ pace: 'live', timeScale: 2 })}
                      disabled={simRunning || isStarting}
                      style={{ marginTop: 8 }}
                    />
                    <Button
                      title="Sim live trajet + musique (×1 réel)"
                      variant="outline"
                      onPress={() => void handleRunCarSimulator({ pace: 'live', timeScale: 1 })}
                      disabled={simRunning || isStarting}
                      style={{ marginTop: 8 }}
                    />
                  </>
                )}
              </>
            )}
          </ScrollView>

          {!activeTrip && activeVehicle ? (
            <View
              style={[
                styles.stickyStart,
                {
                  paddingBottom: Math.max(10, insets.bottom + 4),
                  paddingRight: 16,
                  backgroundColor: colors.background,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Button
                title={
                  startMode === 'free'
                    ? 'Démarrer le suivi GPS libre'
                    : routesLoading
                      ? 'Calcul des itinéraires…'
                      : selectedRoute
                        ? `Démarrer · ${selectedRoute.label}`
                        : destination.trim()
                          ? 'Choisissez un itinéraire'
                          : 'Démarrer + Maps'
                }
                onPress={handleStartTrip}
                loading={isStarting}
                disabled={
                  startMode === 'nav' &&
                  (!!destination.trim() || !!destCoords) &&
                  (routesLoading || (routeOptions.length > 1 && !selectedRouteId))
                }
              />
            </View>
          ) : null}

          {!activeTrip ? (
            <SpeedDialFab
              fan
              anchor="content"
              extraBottom={activeVehicle ? 62 : 0}
              actions={[
                ...(startMode === 'nav' && (destination.trim() || destCoords)
                  ? [
                      {
                        key: 'maps',
                        label: 'Ouvrir Maps',
                        icon: 'map' as const,
                        onPress: () => void handleOpenGoogleMaps(),
                      },
                    ]
                  : [
                      {
                        key: 'maps-hub',
                        label: 'Google Maps',
                        icon: 'map' as const,
                        onPress: () => void handleOpenGoogleMaps(),
                      },
                    ]),
                {
                  key: 'manual',
                  label: 'Saisie manuelle',
                  icon: 'create-outline',
                  onPress: () => router.push('/trip/add' as never),
                },
                {
                  key: 'import',
                  label: 'Importer',
                  icon: 'download-outline',
                  onPress: () => router.push('/trip/import' as never),
                },
              ]}
            />
          ) : null}
          </TutorialAnchor>
        </>
      ) : !historyAllVehicles && historyVehicleId == null && !activeVehicle ? (
        <View style={[styles.panel, styles.panelContent]}>
          <Card>
            <Text style={[styles.warning, { color: colors.warning }]}>
              Sélectionnez un véhicule pour l’historique.
            </Text>
            <Button
              title="Aller aux véhicules"
              onPress={() => router.push('/(tabs)/vehicles' as never)}
              style={{ marginTop: 12 }}
            />
          </Card>
        </View>
      ) : (
        <FlatList
          style={styles.panel}
          contentContainerStyle={styles.panelContent}
          {...tabSwipe.panHandlers}
          data={filteredHistory}
          keyExtractor={(t) => String(t.id)}
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          onViewableItemsChanged={onHistoryViewable}
          viewabilityConfig={historyViewConfig}
          refreshControl={
            <RefreshControl
              refreshing={historyRefreshing}
              onRefresh={() => {
                void (async () => {
                  setHistoryRefreshing(true);
                  try {
                    await loadLists();
                  } finally {
                    setHistoryRefreshing(false);
                  }
                })();
              }}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <>
              {vehicles.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, marginBottom: 12, paddingRight: 8 }}
                >
                  <Pressable
                    onPress={() => {
                      setHistoryAllVehicles(true);
                      setHistoryVehicleId(null);
                      persistHistoryScope(true, null);
                    }}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: historyAllVehicles ? colors.accent : colors.border,
                        backgroundColor: historyAllVehicles
                          ? colors.accent + '22'
                          : colors.card,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: historyAllVehicles ? colors.accent : colors.text,
                        fontWeight: '700',
                        fontSize: 13,
                      }}
                    >
                      Toutes
                    </Text>
                  </Pressable>
                  {vehicles.map((v) => {
                    const selected = !historyAllVehicles && historyVehicleId === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => {
                          setHistoryAllVehicles(false);
                          setHistoryVehicleId(v.id);
                          persistHistoryScope(false, v.id);
                        }}
                        style={[
                          styles.filterChip,
                          {
                            borderColor: selected ? colors.accent : colors.border,
                            backgroundColor: selected ? colors.accent + '22' : colors.card,
                            maxWidth: 140,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected ? colors.accent : colors.text,
                            fontWeight: '700',
                            fontSize: 13,
                          }}
                          numberOfLines={1}
                        >
                          {v.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              {pending.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    À valider ({pending.length})
                  </Text>
                  {pending.map((t) => {
                    const pts = parseRoutePoints(t.routePoints);
                    const o = tripPlaceLabel(t.originName, pts[0], 'origin');
                    const d = tripPlaceLabel(
                      t.destinationName,
                      pts.length > 1 ? pts[pts.length - 1] : null,
                      'destination'
                    );
                    let when = '';
                    try {
                      const dt = new Date(t.startTime);
                      when = `${formatRelativeDay(t.startTime)} · ${dt.toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`;
                    } catch {
                      when = formatRelativeDay(t.startTime);
                    }
                    return (
                      <Card key={t.id} style={{ marginTop: 10 }}>
                        <TouchableOpacity onPress={() => openDetail(t)}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>
                            {o} → {d}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                            {when}
                          </Text>
                          <Text style={{ color: colors.accent, fontWeight: '700', marginTop: 6 }}>
                            {formatDistance(t.distanceKm)} · {formatEuro(t.estimatedCost)}
                            {t.estimatedFuelUsed > 0
                              ? ` · ${t.estimatedFuelUsed.toFixed(1)} L`
                              : ''}
                          </Text>
                        </TouchableOpacity>
                        <View style={styles.pendingActions}>
                          <Button
                            title="Valider"
                            onPress={() => validateTrip(t, 'confirmed')}
                            style={{ flex: 1, paddingVertical: 10 }}
                          />
                          <Button
                            title="Ignorer"
                            variant="outline"
                            onPress={() => validateTrip(t, 'rejected')}
                            style={{ flex: 1, paddingVertical: 10 }}
                          />
                        </View>
                      </Card>
                    );
                  })}
                </View>
              )}

              {sinceFill?.lastFill && activeVehicle && !historyAllVehicles && (
                <Card
                  style={{
                    marginBottom: 14,
                    borderColor: colors.border,
                    borderWidth: 1,
                  }}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 4 }]}>
                    Depuis le dernier plein · {activeVehicle.name}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
                    {formatDateSlash(sinceFill.lastFill.date)} ·{' '}
                    {formatEuro(sinceFill.lastFill.totalCost)}
                    {sinceFill.lastFill.isFull ? ' · quasi-plein' : ''}
                  </Text>
                  {(() => {
                    const tank = activeVehicle?.tankCapacity || 50;
                    const rem =
                      activeVehicle?.estimatedFuelLiters != null
                        ? activeVehicle.estimatedFuelLiters
                        : sinceFill.fuelRemainingEst;
                    const tone = fuelRemainingTone({
                      litersRemaining: rem,
                      tankCapacity: tank,
                      lowLitersThreshold: activeVehicle?.lowFuelThresholdLiters,
                      rangeKm: sinceFill.rangeKm,
                      vehicle: activeVehicle,
                    });
                    const toneColor = fuelToneColor(tone, colors);
                    return (
                      <View style={{ marginBottom: 10 }}>
                        <FuelGaugeSlider
                          compact
                          requireConfirm
                          tankCapacity={tank}
                          liters={rem}
                          accentColor={toneColor}
                          onChange={() => undefined}
                          onChangeEnd={async (L) => {
                            if (!activeVehicle) return;
                            const adj = await setFuelLiters(activeVehicle, L);
                            await refresh();
                            notify(
                              'Réservoir',
                              adj.tripsAdjusted > 0
                                ? `${adj.liters.toFixed(1)} L · ${adj.tripsAdjusted} trajet(s) réajustés`
                                : `${adj.liters.toFixed(1)} L enregistrés`
                            );
                          }}
                        />
                        <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                          {tone === 'critical'
                            ? 'Réservoir bas — pensez à faire le plein'
                            : tone === 'warn'
                              ? 'Niveau moyen — surveillez l’autonomie'
                              : 'Niveau confortable'}
                        </Text>
                      </View>
                    );
                  })()}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {formatDistance(sinceFill.tripKm)}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {sinceFill.tripCount} trajet{sinceFill.tripCount > 1 ? 's' : ''}
                    </Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      ~{formatEuro(sinceFill.costEst)}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>
                      ~{sinceFill.fuelUsedEst.toFixed(1)} L consommés
                    </Text>
                  </View>
                </Card>
              )}

              <Text style={[styles.sectionTitle, { color: colors.text }]}>Trajets réalisés</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {(
                  [
                    { id: 'today' as const, label: 'Aujourd’hui' },
                    { id: 'sinceFill' as const, label: 'Depuis le dernier plein' },
                    { id: 'all' as const, label: 'Tout' },
                  ] as const
                ).map((chip) => {
                  const on = historyFilter === chip.id;
                  return (
                    <Pressable
                      key={chip.id}
                      onPress={() => {
                        setHistoryFilter(chip.id);
                        setCalendarOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Filtrer ${chip.label}`}
                      style={[
                        styles.filterChip,
                        {
                          borderColor: on ? colors.accent : colors.border,
                          backgroundColor: on ? colors.accent + '22' : colors.card,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: on ? colors.accent : colors.text,
                          fontWeight: '700',
                          fontSize: 13,
                        }}
                      >
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {(() => {
                  const on = historyFilter === 'date' || historyFilter === 'range';
                  const label = historyDateChipLabel(historyFrom, historyTo);
                  return (
                    <Pressable
                      onPress={() => {
                        setCalendarOpen((v) => !v);
                        if (!historyFrom) {
                          const today = toLocalYmd(new Date());
                          setHistoryFrom(today);
                          setHistoryTo(today);
                          setHistoryFilter('date');
                          setCalMonth(today.slice(0, 7));
                        } else if (!on) {
                          setHistoryFilter(historyFrom !== historyTo ? 'range' : 'date');
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel="Filtrer par date sélectionnée"
                      style={[
                        styles.filterChip,
                        {
                          borderColor: on ? colors.accent : colors.border,
                          backgroundColor: on ? colors.accent + '22' : colors.card,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: on ? colors.accent : colors.text,
                          fontWeight: '700',
                          fontSize: 13,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })()}
              </View>
              {calendarOpen ? (
                <TripHistoryCalendar
                  monthYm={calMonth}
                  onMonthChange={setCalMonth}
                  tripYmds={historyTripYmds}
                  from={historyFrom}
                  to={historyTo}
                  rangeMode={rangeMode}
                  onRangeModeChange={setRangeMode}
                  onSelect={(next) => {
                    setHistoryFrom(next.from);
                    setHistoryTo(next.to);
                    setHistoryFilter(next.filter);
                  }}
                />
              ) : null}
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Adresses · durée · touchez pour le détail (carte + vitesses).
              </Text>
              {historyLoading && filteredHistory.length === 0 && (
                <Card style={{ marginTop: 12 }}>
                  <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
                    Chargement de l’historique…
                  </Text>
                </Card>
              )}
              {!historyLoading && filteredHistory.length === 0 && (
                <Card style={{ marginTop: 12 }}>
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: 12 }}>
                    {historyFilter === 'today'
                      ? 'Aucun trajet aujourd’hui.'
                      : historyFilter === 'sinceFill'
                      ? 'Aucun trajet depuis le dernier plein.'
                      : historyFilter === 'date'
                      ? 'Aucun trajet ce jour-là.'
                      : historyFilter === 'range'
                      ? 'Aucun trajet sur cette plage.'
                      : 'Aucun trajet terminé.'}
                  </Text>
                  <Button title="Démarrer un trajet" onPress={() => setTab('live')} />
                </Card>
              )}
            </>
          }
          renderItem={({ item: t, index }) => (
            <TripHistoryCard
              trip={t}
              onPress={openDetail}
              onDelete={handleDeleteTrip}
              showMap={mapVisibleIds.has(t.id) || index < 2}
              allTrips={history}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  segments: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  map: { height: '38%', minHeight: 200, maxHeight: 360, position: 'relative' },
  mapCollapsed: { height: 132, minHeight: 132, maxHeight: 132 },
  mapCollapseBtn: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
  mapHint: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  mapHintText: { color: '#fff', fontSize: 12 },
  arrivalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  habitBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  habitStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  habitStat: { minWidth: 52, alignItems: 'center' },
  habitStatVal: { fontSize: 15, fontWeight: '800' },
  smartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  routePicker: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    paddingHorizontal: 8,
  },
  routePickerInner: {
    gap: 8,
    paddingHorizontal: 4,
    alignItems: 'stretch',
  },
  routeChip: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 108,
  },
  routePickerHint: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  panel: { flex: 1 },
  panelContent: { padding: 16, paddingBottom: 100 },
  stickyStart: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 30,
  },
  vehicleFloat: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    maxWidth: '70%',
    zIndex: 20,
  },
  mapTopHud: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 22,
    alignItems: 'flex-end',
  },
  mapHudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  vehicleHudChip: {
    backgroundColor: 'rgba(15,23,42,0.88)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: 140,
  },
  navHudChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 200,
  },
  fuelHudChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyBack: { flexDirection: 'row', alignItems: 'center', width: 72 },
  vehicleFloatText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  activeBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  activeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1.5,
    minHeight: 46,
  },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  speedLimitSign: {
    width: 56,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#dc2626',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  speedLimitValue: {
    color: '#0f172a',
    fontWeight: '900',
    fontSize: 22,
    lineHeight: 26,
  },
  navArrowWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  description: { fontSize: 14, marginBottom: 12, lineHeight: 20 },
  modeCard: { borderWidth: 2, borderRadius: 14, padding: 14 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  activeTrip: { marginBottom: 12, borderWidth: 2 },
  tripActiveHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tripActiveTitle: { fontSize: 16, fontWeight: '700' },
  placeLine: { fontSize: 14, fontWeight: '600', marginTop: 4, lineHeight: 20 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  warning: { fontSize: 15, textAlign: 'center' },
  pendingActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
});
