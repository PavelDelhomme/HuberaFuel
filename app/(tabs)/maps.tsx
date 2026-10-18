/**
 * Onglet Maps : recherche adresse, suivi libre / A→B sur place (HUD live).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
} from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import TripMap from '@/components/TripMap';
import type { TripMapRef } from '@/components/TripMap.types';
import { getCurrentLocation, gpsMissText, locationReadiness, peekLiveRouteTail, peekLiveTripId } from '@/lib/locationService';
import { subscribeNativeFixes } from '@/lib/nativeLocation';
import { fetchSpeedLimitNear, type SpeedLimitInfo } from '@/lib/roadSpeedLimits';
import { forwardGeocode } from '@/lib/geocode';
import { formatDistance, formatSpeedKmh, parseRoutePoints, calculateRouteDistance, type RoutePoint } from '@/lib/calculations';
import { Button } from '@/components/Button';
import { DrawerMenuButton } from '@/components/DrawerMenuButton';
import { HeaderActions } from '@/components/HeaderActions';
import { TutorialAnchor } from '@/components/TutorialAnchor';
import { getPlaces, getTripById, updatePlace } from '@/lib/database';
import {
  getRecentDestinations,
  type RecentDestination,
} from '@/lib/recentDestinations';
import { searchAddressSuggestions, type SuggestHit } from '@/lib/placeSuggest';
import { getAppFlavor } from '@/lib/appFlavor';
import { tripHistoryNav } from '@/lib/tripHistoryNav';
import { startGpsTrip, pauseGpsTrip, resumeGpsTrip, stopGpsTripLite } from '@/lib/startFreeTrip';
import { launchGoogleMapsNavigation, openGoogleMapsHere } from '@/lib/mapsNavigation';
import { formatDurationMin, liveTripHudStats } from '@/lib/liveTripHud';
import {
  fetchDrivingRouteAlternatives,
  type DrivingRoute,
} from '@/lib/roadDistance';
import { downsampleRoute } from '@/lib/routeGeometry';
import { readLiveTripBuffer } from '@/lib/liveTripBuffer';
import type { Place } from '@/types';

const PARIS_CENTER = { latitude: 48.8566, longitude: 2.3522 };

type PendingDest = { label: string; latitude: number; longitude: number };

export default function MapsScreen() {
  const { colors } = useTheme();
  const { activeTrip, activeVehicle, vehicles, selectVehicle, refresh } = useApp();
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const labGpsSim = ['preprod', 'dev', 'feat', 'qa'].includes(getAppFlavor().key);
  const mapRef = useRef<TripMapRef>(null);
  const activeTripRef = useRef(activeTrip);
  activeTripRef.current = activeTrip;
  const [user, setUser] = useState<{ latitude: number; longitude: number } | null>(null);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [limit, setLimit] = useState<SpeedLimitInfo | null>(null);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHits, setSearchHits] = useState<SuggestHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [recentDests, setRecentDests] = useState<RecentDestination[]>([]);
  const [liveTail, setLiveTail] = useState<RoutePoint[]>([]);
  const [pendingDest, setPendingDest] = useState<PendingDest | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeOptions, setRouteOptions] = useState<DrivingRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  /** UI live même si le Context met 1 frame à voir le trajet actif (notif FGS déjà là). */
  const [sessionTracking, setSessionTracking] = useState(false);
  const [sessionTripId, setSessionTripId] = useState<number | null>(null);
  /** Empêche le dropdown « Lieux / Adresses » après un chip carnet / récent. */
  const [suggestLocked, setSuggestLocked] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopInFlight = useRef(false);
  const didCenterOnUser = useRef(false);

  const tracking = Boolean(activeTrip?.isActive) || sessionTracking;
  const paused = Boolean(activeTrip?.isPaused);
  const hudBase = liveTripHudStats(activeTrip, nowMs);
  const liveTailKm = useMemo(() => {
    if (liveTail.length < 2) return 0;
    try {
      return Math.round(calculateRouteDistance(JSON.stringify(liveTail)) * 1000) / 1000;
    } catch {
      return 0;
    }
  }, [liveTail]);
  const hud = hudBase
    ? {
        ...hudBase,
        distanceKm: Math.max(hudBase.distanceKm, liveTailKm),
      }
    : hudBase;

  useEffect(() => {
    if (activeTrip?.isActive) {
      setSessionTracking(true);
      setSessionTripId(activeTrip.id);
      return;
    }
    if (starting || busy) return;
    // FGS / buffer encore vivant alors que le Context a perdu le trajet
    // (ex. sync qui tuait les tiny) → garder Pause / Terminer.
    const liveId = peekLiveTripId();
    if (liveId != null) {
      setSessionTracking(true);
      setSessionTripId(liveId);
      return;
    }
    setSessionTracking(false);
    setSessionTripId(null);
  }, [activeTrip?.isActive, activeTrip?.id, starting, busy]);

  const refreshLoc = useCallback(async () => {
    // Last-known rapide pour afficher le point tout de suite, puis fix plus frais.
    const apply = (loc: Awaited<ReturnType<typeof getCurrentLocation>>) => {
      if (!loc?.coords) return null;
      const next = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUser(next);
      const sp = loc.coords.speed;
      if (sp != null && sp >= 0) setSpeedKmh(sp * 3.6);
      return next;
    };
    const quick = await getCurrentLocation({ fresh: false, timeoutMs: 2500 });
    apply(quick);
    const loc = await getCurrentLocation({ fresh: true, timeoutMs: 8000 });
    return apply(loc) || (quick?.coords
      ? { latitude: quick.coords.latitude, longitude: quick.coords.longitude }
      : null);
  }, []);

  /** Premier GPS (ou retour focus) : zoom sur la position, hors suivi / destination. */
  useEffect(() => {
    if (!user) return;
    if (tracking || pendingDest) return;
    if (didCenterOnUser.current) return;
    didCenterOnUser.current = true;
    mapRef.current?.setCenter?.(user.latitude, user.longitude, 15);
  }, [user, tracking, pendingDest]);

  const reloadPlaces = useCallback(async () => {
    const [p, r] = await Promise.all([getPlaces(), getRecentDestinations(8)]);
    setPlaces(p);
    setRecentDests(r);
  }, []);

  useFocusEffect(
    useCallback(() => {
      didCenterOnUser.current = false;
      void (async () => {
        const u = await refreshLoc();
        if (u && !pendingDest && !(activeTripRef.current?.isActive)) {
          didCenterOnUser.current = true;
          mapRef.current?.setCenter?.(u.latitude, u.longitude, 15);
        }
      })();
      void reloadPlaces();
      let nativeSub: Location.LocationSubscription | null = null;
      let webWatch: number | null = null;
      void (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
          webWatch = navigator.geolocation.watchPosition(
            (pos) => {
              const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
              setUser(next);
              if (pos.coords.speed != null && pos.coords.speed >= 0) {
                setSpeedKmh(pos.coords.speed * 3.6);
              }
              const live = activeTripRef.current;
              if (live?.isActive && !live.isPaused) {
                setLiveTail((prev) => {
                  const last = prev[prev.length - 1];
                  if (
                    last &&
                    Math.abs(last.latitude - next.latitude) < 0.00004 &&
                    Math.abs(last.longitude - next.longitude) < 0.00004
                  ) {
                    return prev;
                  }
                  const pt: RoutePoint = {
                    latitude: next.latitude,
                    longitude: next.longitude,
                    timestamp: pos.timestamp || Date.now(),
                  };
                  return prev.length > 80 ? [...prev.slice(-79), pt] : [...prev, pt];
                });
              }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 4000 }
          );
        } else {
          nativeSub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              timeInterval: 1200,
              distanceInterval: 4,
            },
            (pos) => {
              const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
              setUser(next);
              if (pos.mocked) {
                mapRef.current?.setCenter?.(next.latitude, next.longitude, 15);
              }
              if (pos.coords.speed != null && pos.coords.speed >= 0) {
                setSpeedKmh(pos.coords.speed * 3.6);
              }
            }
          );
        }
      })();
      const unsubNative = subscribeNativeFixes((fix) => {
        const next = { latitude: fix.latitude, longitude: fix.longitude };
        setUser(next);
        if (fix.mocked) {
          mapRef.current?.setCenter?.(next.latitude, next.longitude, 15);
        }
      });
      return () => {
        unsubNative();
        nativeSub?.remove();
        if (webWatch != null && typeof navigator !== 'undefined') {
          navigator.geolocation.clearWatch(webWatch);
        }
      };
    }, [refreshLoc, reloadPlaces])
  );

  useEffect(() => {
    if (!tracking || paused) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [tracking, paused, activeTrip?.id]);

  useEffect(() => {
    if (!tracking) {
      setLiveTail([]);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        if (activeTrip && peekLiveTripId() === activeTrip.id) {
          const tail = peekLiveRouteTail(120);
          if (tail && tail.length) {
            if (!cancelled) setLiveTail(tail);
            const last = tail[tail.length - 1];
            if (last) setUser({ latitude: last.latitude, longitude: last.longitude });
            return;
          }
        }
        const buf = await readLiveTripBuffer();
        if (buf && activeTrip && buf.tripId === activeTrip.id) {
          const pts = parseRoutePoints(buf.routePoints || '[]');
          if (pts.length) {
            const tail = pts.length > 120 ? pts.slice(-120) : pts;
            if (!cancelled) setLiveTail(tail);
            const last = tail[tail.length - 1];
            if (last) setUser({ latitude: last.latitude, longitude: last.longitude });
            return;
          }
        }
        if (!activeTrip) return;
        const full = await getTripById(activeTrip.id);
        if (cancelled || !full) return;
        const pts = parseRoutePoints(full.routePoints || '[]');
        const tail = pts.length > 120 ? pts.slice(-120) : pts;
        setLiveTail(tail);
        const last = tail[tail.length - 1];
        if (last) setUser({ latitude: last.latitude, longitude: last.longitude });
      } catch {
        /* ignore */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tracking, paused, activeTrip?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      const info = await fetchSpeedLimitNear(user.latitude, user.longitude);
      if (!cancelled) setLimit(info);
    };
    void run();
    const id = setInterval(() => void run(), tracking ? 12_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user?.latitude, user?.longitude, tracking]);

  const applyRouteChoice = useCallback((route: DrivingRoute) => {
    setSelectedRouteId(route.id);
    setPlannedRoute(downsampleRoute(route.coordinates, 120));
  }, []);

  const loadPlanned = useCallback(
    async (dest: PendingDest, from?: { latitude: number; longitude: number } | null) => {
      setRoutesLoading(true);
      setRouteOptions([]);
      setSelectedRouteId(null);
      let origin = from || user;
      if (!origin) {
        const loc = await getCurrentLocation({ fresh: true });
        if (loc?.coords) {
          origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUser(origin);
        }
      }
      if (!origin) {
        setPlannedRoute([dest]);
        setRoutesLoading(false);
        mapRef.current?.fitToCoordinates([dest], {
          edgePadding: { top: 60, right: 40, bottom: 120, left: 40 },
          animated: true,
        });
        return;
      }
      try {
        const alts = await fetchDrivingRouteAlternatives(origin, dest);
        setRouteOptions(alts);
        const prefer =
          alts.find((a) => a.kind === 'eco') ||
          alts.find((a) => a.kind === 'fastest') ||
          alts[0];
        if (prefer) {
          applyRouteChoice(prefer);
          const fitPts =
            prefer.coordinates.length > 1
              ? downsampleRoute(prefer.coordinates, 40)
              : [origin, dest];
          mapRef.current?.fitToCoordinates(fitPts, {
            edgePadding: { top: 70, right: 40, bottom: 160, left: 40 },
            animated: true,
          });
        } else {
          setPlannedRoute([origin, dest]);
          mapRef.current?.fitToCoordinates([origin, dest], {
            edgePadding: { top: 60, right: 40, bottom: 120, left: 40 },
            animated: true,
          });
        }
      } catch {
        setRouteOptions([]);
        setPlannedRoute([origin, dest]);
        mapRef.current?.fitToCoordinates([origin, dest], {
          edgePadding: { top: 60, right: 40, bottom: 120, left: 40 },
          animated: true,
        });
      } finally {
        setRoutesLoading(false);
      }
    },
    [user, applyRouteChoice]
  );

  const setDestinationOnMap = useCallback(
    (label: string, lat: number, lon: number) => {
      const dest = { label, latitude: lat, longitude: lon };
      setPendingDest(dest);
      setQuery(label);
      setSuggestLocked(true);
      setSearchHits([]);
      setSearchFocused(false);
      setSearchError(null);
      setRouteOptions([]);
      setSelectedRouteId(null);
      setPlannedRoute([]);
      Keyboard.dismiss();
      void loadPlanned(dest);
    },
    [loadPlanned]
  );

  const clearDestination = useCallback(() => {
    setPendingDest(null);
    setPlannedRoute([]);
    setRouteOptions([]);
    setSelectedRouteId(null);
    setQuery('');
    setSearchHits([]);
    setSuggestLocked(false);
    setSearchError(null);
    // Recentrer sur la position actuelle (plus de tracé fantôme)
    if (user) {
      mapRef.current?.fitToCoordinates([user], {
        edgePadding: { top: 80, right: 60, bottom: 120, left: 60 },
        animated: true,
      });
      mapRef.current?.setCenter?.(user.latitude, user.longitude, 15);
    } else {
      void getCurrentLocation({ fresh: true }).then((loc) => {
        if (!loc?.coords) return;
        const u = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUser(u);
        mapRef.current?.setCenter?.(u.latitude, u.longitude, 15);
      });
    }
  }, [user]);

  const alternateRoutes = useMemo(() => {
    if (!routeOptions.length || !selectedRouteId) return [];
    return routeOptions
      .filter((r) => r.id !== selectedRouteId)
      .map((r) => r.coordinates);
  }, [routeOptions, selectedRouteId]);

  const selectedRoute = useMemo(
    () => routeOptions.find((r) => r.id === selectedRouteId) || routeOptions[0] || null,
    [routeOptions, selectedRouteId]
  );

  const goSearch = useCallback(async (raw?: string) => {
    const q = (raw ?? query).trim();
    if (q.length < 2) {
      setSearchError('Indiquez une adresse ou un lieu');
      return;
    }
    setSearching(true);
    setSearchError(null);
    Keyboard.dismiss();
    try {
      const hit = await forwardGeocode(q);
      if (!hit) {
        setSearchError('Lieu introuvable');
        return;
      }
      setDestinationOnMap(hit.label || q, hit.latitude, hit.longitude);
    } catch {
      setSearchError('Recherche indisponible');
    } finally {
      setSearching(false);
    }
  }, [query, setDestinationOnMap]);

  useEffect(() => {
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    // Destination déjà choisie (chip carnet / récent) : pas de liste « Lieux / Adresses »
    if (suggestLocked || pendingDest) {
      setSearchHits([]);
      return;
    }
    const q = query.trim();
    if (q.length < 2 || !searchFocused) {
      setSearchHits([]);
      return;
    }
    suggestDebounce.current = setTimeout(() => {
      void (async () => {
        // Uniquement suggestions d’adresses (Nominatim) — pas de doublons « Lieu » carnet
        const geo = await searchAddressSuggestions(q, 6);
        const qn = q.toLowerCase();
        const recentHits: SuggestHit[] = recentDests
          .filter((r) => r.label.toLowerCase().includes(qn))
          .slice(0, 3)
          .map((r, i) => ({
            id: `recent-${i}-${r.label}`,
            label: r.label,
            source: 'place' as const,
            latitude: r.latitude ?? undefined,
            longitude: r.longitude ?? undefined,
            subtitle: 'Récent',
          }));
        setSearchHits([...recentHits, ...geo].slice(0, 8));
      })();
    }, 320);
    return () => {
      if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    };
  }, [query, places, recentDests, suggestLocked, pendingDest, searchFocused]);

  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <View
          style={{
            paddingTop: insets.top,
            backgroundColor: colors.background,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              height: 44,
              paddingLeft: 2,
              paddingRight: 4,
              gap: 4,
            }}
          >
            <DrawerMenuButton />
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                height: 32,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
                backgroundColor: colors.card,
                borderRadius: 8,
                paddingHorizontal: 8,
              }}
            >
              <Ionicons name="search" size={14} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={(t) => {
                  setQuery(t);
                  setSuggestLocked(false);
                  if (pendingDest) {
                    // Édition manuelle = on quitte la préselection (sinon suggestions + tracé fantômes)
                    setPendingDest(null);
                    setPlannedRoute([]);
                    setRouteOptions([]);
                    setSelectedRouteId(null);
                  }
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
                placeholder="Tapez une adresse…"
                placeholderTextColor={colors.textSecondary}
                editable={!tracking}
                style={{
                  flex: 1,
                  color: colors.text,
                  paddingVertical: 0,
                  paddingHorizontal: 6,
                  fontSize: 13,
                  height: 30,
                  ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
                }}
                returnKeyType="search"
                onSubmitEditing={() => void goSearch()}
              />
              {searching ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : query.trim().length >= 2 && !tracking ? (
                <Pressable onPress={() => void goSearch()} hitSlop={8}>
                  <Ionicons name="arrow-forward-circle" size={20} color={colors.accent} />
                </Pressable>
              ) : null}
            </View>
            <HeaderActions />
          </View>
        </View>
      ),
    });
  }, [navigation, colors, query, searching, goSearch, insets.top, tracking]);

  const startOnMaps = useCallback(
    async (dest?: PendingDest | null) => {
      if (!activeVehicle) {
        router.push('/(tabs)/vehicles');
        return;
      }
      if (starting) return;
      setStarting(true);
      try {
        const r = await startGpsTrip({
          vehicle: activeVehicle,
          refresh,
          destinationName: dest?.label,
        });
        if (!r.ok) {
          showToast(r.error);
          return;
        }
        // Affiche tout de suite Pause / Terminer (évite l’écran « lieux » alors que FGS tourne)
        setSessionTracking(true);
        setSessionTripId(r.tripId);
        setSuggestLocked(true);
        setSearchHits([]);
        await refresh();
        if (!r.trackingStarted) {
          showToast(gpsMissText(await locationReadiness(), 'trace'));
        } else {
          showToast(
            dest
              ? `Guidage vers ${dest.label} — suivi Fuel + Google Maps.`
              : 'Suivi GPS démarré — ouverture Google Maps.'
          );
        }
        const opened = dest
          ? await launchGoogleMapsNavigation({
              destination: { latitude: dest.latitude, longitude: dest.longitude },
              origin: user,
              label: dest.label,
              preferGoogle: true,
            })
          : await openGoogleMapsHere(user || undefined);
        if (!opened) {
          showToast('Impossible d’ouvrir Google Maps — le suivi continue ici.');
        }
      } finally {
        setStarting(false);
      }
    },
    [activeVehicle, refresh, showToast, starting, user]
  );

  const goFreeTrack = () => {
    void startOnMaps(null);
  };

  /** Chip carnet : toujours l’adresse (pas le seul nom « Parent » → Clermont). */
  const selectSavedPlace = useCallback(
    async (p: Place) => {
      if (tracking) {
        showToast('Terminez le trajet en cours avant de choisir une destination.');
        return;
      }
      const label = (p.address?.trim() || p.name).trim();
      if (p.latitude != null && p.longitude != null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
        setDestinationOnMap(label, p.latitude, p.longitude);
        return;
      }
      setSearching(true);
      try {
        const hit = await forwardGeocode(p.address?.trim() || `${p.name}, France`);
        if (!hit) {
          setSearchError('Adresse du lieu introuvable');
          return;
        }
        setDestinationOnMap(label, hit.latitude, hit.longitude);
        void updatePlace(p.id, { latitude: hit.latitude, longitude: hit.longitude }).then(() =>
          reloadPlaces()
        );
      } catch {
        setSearchError('Géocodage indisponible');
      } finally {
        setSearching(false);
      }
    },
    [tracking, showToast, setDestinationOnMap, reloadPlaces]
  );

  const goToPlace = (label: string, lat?: number | null, lon?: number | null) => {
    if (tracking) {
      showToast('Terminez le trajet en cours avant de choisir une destination.');
      return;
    }
    if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      setDestinationOnMap(label, lat, lon);
    } else {
      // Géocode l’adresse complète, jamais un libellé court ambigu (« Parent »)
      setSuggestLocked(true);
      setSearchHits([]);
      void (async () => {
        setSearching(true);
        try {
          const hit = await forwardGeocode(label);
          if (!hit) {
            setSearchError('Lieu introuvable');
            return;
          }
          setDestinationOnMap(hit.label || label, hit.latitude, hit.longitude);
        } catch {
          setSearchError('Recherche indisponible');
        } finally {
          setSearching(false);
        }
      })();
    }
  };

  const onPauseResume = async () => {
    const tripId = activeTrip?.id ?? sessionTripId;
    if (!tripId) return;
    setBusy(true);
    try {
      if (paused) {
        const ok = await resumeGpsTrip(tripId, refresh);
        showToast(ok ? 'Suivi repris' : gpsMissText(await locationReadiness(), 'resume'));
      } else {
        await pauseGpsTrip(tripId, refresh);
        showToast('Pause — Reprendre ou enregistrer un plein.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onFillUpDuringTrip = async () => {
    const tripId = activeTrip?.id ?? sessionTripId;
    if (!tripId) return;
    setBusy(true);
    try {
      if (!paused) {
        await pauseGpsTrip(tripId, refresh);
      }
      router.push({
        pathname: '/fillup/add' as never,
        params: { tripId: String(tripId), fromTrip: '1' },
      });
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    const tripId = activeTrip?.id ?? sessionTripId;
    const vehicleId = activeTrip?.vehicleId ?? activeVehicle?.id;
    if (!tripId || vehicleId == null) return;
    if (busy || stopInFlight.current || !tracking) return; // anti double-tap
    stopInFlight.current = true;
    setBusy(true);
    // Couper l’UI tout de suite — sinon peekLiveTripId ressuscite Pause/Terminer.
    setSessionTracking(false);
    setSessionTripId(null);
    setLiveTail([]);
    try {
      const tailKm =
        liveTail.length >= 2
          ? Math.round(calculateRouteDistance(JSON.stringify(liveTail)) * 1000) / 1000
          : 0;
      const hudKm = hud?.distanceKm ?? 0;
      const rawKm = Math.max(activeTrip?.distanceKm ?? 0, hudKm, tailKm);
      // Plafond de sécurité : éviter un burn absurde si buffer GPS pollué
      const startedAt = activeTrip?.startTime ? Date.parse(activeTrip.startTime) : NaN;
      const ageMin = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 60000 : 0;
      const maxPlausibleKm = Math.max(2, ageMin * 2.5); // ~150 km/h plafond
      const distanceKm = Math.min(rawKm, maxPlausibleKm);
      await stopGpsTripLite({
        tripId,
        vehicleId,
        distanceKm,
        refresh,
      });
      setPendingDest(null);
      setPlannedRoute([]);
      setRouteOptions([]);
      setSelectedRouteId(null);
      setSuggestLocked(false);
      setQuery('');
      setSearchHits([]);
      showToast(
        distanceKm > 0.05
          ? `Trajet terminé · ${formatDistance(distanceKm)}`
          : 'Trajet terminé'
      );
      if (user) {
        mapRef.current?.setCenter?.(user.latitude, user.longitude, 15);
      }
    } catch {
      showToast('Impossible de terminer le trajet');
      // Si échec, retenter l’affichage suivi si le trajet est encore actif
      if (activeTrip?.isActive) {
        setSessionTracking(true);
        setSessionTripId(activeTrip.id);
      }
    } finally {
      stopInFlight.current = false;
      setBusy(false);
    }
  };

  const quickPlaces = places.filter((p) => p.kind === 'home' || p.kind === 'work');
  const otherPlaces = places.filter((p) => p.kind !== 'home' && p.kind !== 'work').slice(0, 6);

  const destForMap = pendingDest
    || (activeTrip?.destinationName && plannedRoute.length
      ? plannedRoute[plannedRoute.length - 1]
      : null);

  const mapRoute = useMemo(() => {
    if (liveTail.length > 1) return liveTail;
    if (plannedRoute.length > 1) return plannedRoute;
    return liveTail;
  }, [liveTail, plannedRoute]);

  const region = {
    latitude: user?.latitude ?? PARIS_CENTER.latitude,
    longitude: user?.longitude ?? PARIS_CENTER.longitude,
    latitudeDelta: tracking ? 0.02 : 0.04,
    longitudeDelta: tracking ? 0.02 : 0.04,
  };

  const destShort = pendingDest?.label
    ? pendingDest.label.length > 28
      ? pendingDest.label.slice(0, 26) + '…'
      : pendingDest.label
    : activeTrip?.destinationName || null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.mapWrap}>
        <TripMap
          ref={mapRef}
          region={region}
          routePoints={mapRoute}
          accentColor={colors.accent}
          userLocation={user}
          followUser={tracking && !paused}
          paused={paused}
          plannedRoute={plannedRoute}
          alternateRoutes={tracking ? [] : alternateRoutes}
          destination={destForMap}
        />
        {!tracking && pendingDest && (routeOptions.length > 0 || routesLoading) ? (
          <View style={styles.routePicker} pointerEvents="box-none">
            {routesLoading && routeOptions.length === 0 ? (
              <View style={[styles.routeChipLoading, { backgroundColor: 'rgba(15,23,42,0.9)', borderColor: 'rgba(255,255,255,0.25)' }]}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 12, marginLeft: 8 }}>
                  Calcul des itinéraires…
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.routePickerInner}
              >
                {routeOptions.map((r) => {
                  const selected = r.id === selectedRoute?.id;
                  const kindLabel =
                    r.kind === 'eco' ? 'Éco' : r.kind === 'fastest' ? 'Rapide' : r.label;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        applyRouteChoice(r);
                        if (r.coordinates.length > 1) {
                          mapRef.current?.fitToCoordinates(downsampleRoute(r.coordinates, 40), {
                            edgePadding: { top: 70, right: 40, bottom: 160, left: 40 },
                            animated: true,
                          });
                        }
                      }}
                      style={[
                        styles.routeChip,
                        {
                          borderColor: selected ? colors.accent : 'rgba(255,255,255,0.35)',
                          backgroundColor: selected ? colors.accent : 'rgba(15,23,42,0.9)',
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
                        {kindLabel}
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
            )}
          </View>
        ) : null}
        <View style={[styles.hud, { top: 12 }]} pointerEvents="box-none">
          <View style={styles.hudLeft}>
            {tracking && hud ? (
              <View
                style={[styles.statsCard, { backgroundColor: colors.card + 'F2', borderColor: colors.border }]}
              >
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {formatDistance(hud.distanceKm)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Parcouru</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {hud.avgKmh > 0.5 ? formatSpeedKmh(hud.avgKmh) : '—'}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Moyenne</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {formatDurationMin(hud.durationMinutes)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Durée</Text>
                </View>
              </View>
            ) : null}
          </View>
          <View style={styles.hudRight}>
            <View
              style={[styles.speedChip, { backgroundColor: colors.card + 'EE', borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                {speedKmh > 0.5 ? formatSpeedKmh(speedKmh) : '—'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                {paused ? 'Pause' : 'GPS'}
              </Text>
            </View>
            {limit ? (
              <View style={styles.limitSign} accessibilityLabel={`Limitation ${limit.limitKmh} km/h`}>
                <Text style={styles.limitValue}>{limit.limitKmh}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => {
            void (async () => {
              const u = (await refreshLoc()) || user;
              if (!u) {
                showToast(gpsMissText(await locationReadiness(), 'here'));
                return;
              }
              mapRef.current?.setCenter?.(u.latitude, u.longitude, 16);
            })();
          }}
          style={[styles.locateFab, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityLabel="Recentrer sur ma position"
          accessibilityRole="button"
        >
          <Ionicons name="locate" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <TutorialAnchor id="maps-search">
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            paddingBottom: 12 + insets.bottom,
          },
        ]}
      >
        {searchError ? (
          <Text style={{ color: colors.warning, fontSize: 12, marginBottom: 6 }}>{searchError}</Text>
        ) : null}

        {!tracking && !pendingDest && (searchFocused || query.trim().length >= 2) && searchHits.length > 0 ? (
          <View style={{ marginBottom: 10, maxHeight: 180 }}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {searchHits.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={() => {
                    setSuggestLocked(true);
                    setSearchHits([]);
                    setSearchFocused(false);
                    if (h.latitude != null && h.longitude != null) {
                      goToPlace(h.label, h.latitude, h.longitude);
                    } else {
                      void goSearch(h.label);
                    }
                  }}
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.accent, fontSize: 10, fontWeight: '800' }}>
                    {h.subtitle === 'Récent' ? 'Récent' : 'Adresse'}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    {h.label}
                  </Text>
                  {!!h.subtitle && h.subtitle !== 'Récent' ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
                      {h.subtitle}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {tracking ? (
          <View
            style={[
              styles.activeBanner,
              { borderColor: paused ? colors.warning : colors.accent, backgroundColor: (paused ? colors.warning : colors.accent) + '18' },
            ]}
          >
            <Ionicons name={paused ? 'pause' : 'navigate'} size={18} color={paused ? colors.warning : colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>
                {paused ? 'Suivi en pause' : destShort ? `Vers ${destShort}` : 'Suivi libre'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                Position, tracé, limite et moyenne restent sur Maps.
              </Text>
            </View>
          </View>
        ) : pendingDest ? (
          <View
            style={[
              styles.activeBanner,
              { borderColor: colors.accent, backgroundColor: colors.accent + '14' },
            ]}
          >
            <Ionicons name="flag" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800' }} numberOfLines={1}>
                {pendingDest.label}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {routesLoading
                  ? 'Calcul Éco / Rapide…'
                  : selectedRoute
                    ? `${selectedRoute.kind === 'eco' ? 'Éco' : selectedRoute.kind === 'fastest' ? 'Rapide' : selectedRoute.label} · ${selectedRoute.distanceKm.toFixed(1)} km — choisissez un type puis démarrez`
                    : 'Choisissez un type d’itinéraire, puis démarrez'}
              </Text>
            </View>
            <Pressable onPress={clearDestination} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        {!tracking && !pendingDest ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Lieux & récents</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 10 }}
            >
              {quickPlaces.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => void selectSavedPlace(p)}
                  style={[styles.chip, { borderColor: colors.accent, backgroundColor: colors.accent + '14' }]}
                >
                  <Ionicons
                    name={p.kind === 'home' ? 'home' : 'briefcase'}
                    size={14}
                    color={colors.accent}
                  />
                  <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>{p.name}</Text>
                </Pressable>
              ))}
              {otherPlaces.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => void selectSavedPlace(p)}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{p.name}</Text>
                </Pressable>
              ))}
              {recentDests.map((r, i) => (
                <Pressable
                  key={`${r.label}-${i}`}
                  onPress={() => goToPlace(r.label, r.latitude, r.longitude)}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
              {!quickPlaces.length && !otherPlaces.length && !recentDests.length ? (
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                  Aucun lieu — ajoutez Maison / Travail dans Budget, ou cherchez une adresse.
                </Text>
              ) : null}
            </ScrollView>
          </>
        ) : null}

        <View style={styles.actions}>
          {tracking ? (
            paused ? (
              <>
                <Button
                  title="Reprendre"
                  variant="outline"
                  onPress={() => void onPauseResume()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Plein"
                  onPress={() => void onFillUpDuringTrip()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Terminer"
                  variant="danger"
                  onPress={() => void onStop()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </>
            ) : (
              <>
                <Button
                  title="Pause"
                  variant="outline"
                  onPress={() => void onPauseResume()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Terminer"
                  variant="danger"
                  onPress={() => void onStop()}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </>
            )
          ) : (
            <>
              {/* Sélecteur de véhicule */}
              {vehicles.length > 0 && (
                <Pressable
                  style={[
                    styles.vehicleSelector,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  onPress={() => setShowVehiclePicker(!showVehiclePicker)}
                >
                  <Ionicons name="car-sport" size={18} color={colors.accent} />
                  <Text style={[styles.vehicleSelectorText, { color: colors.text }]} numberOfLines={1}>
                    {activeVehicle?.name || 'Sélectionner un véhicule'}
                  </Text>
                  <Ionicons
                    name={showVehiclePicker ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </Pressable>
              )}
              {showVehiclePicker && vehicles.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.vehiclePickerScroll}
                  contentContainerStyle={styles.vehiclePickerContent}
                >
                  {vehicles.map((v) => (
                    <Pressable
                      key={v.id}
                      style={[
                        styles.vehicleChip,
                        {
                          backgroundColor: activeVehicle?.id === v.id ? colors.accent : colors.card,
                          borderColor: activeVehicle?.id === v.id ? colors.accent : colors.border,
                        },
                      ]}
                      onPress={async () => {
                        await selectVehicle(v.id);
                        setShowVehiclePicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.vehicleChipText,
                          { color: activeVehicle?.id === v.id ? '#fff' : colors.text },
                        ]}
                        numberOfLines={1}
                      >
                        {v.name}
                      </Text>
                      {v.consumptionPer100 ? (
                        <Text
                          style={[
                            styles.vehicleChipSub,
                            { color: activeVehicle?.id === v.id ? 'rgba(255,255,255,0.8)' : colors.textSecondary },
                          ]}
                        >
                          {v.consumptionPer100.toFixed(1)} L/100
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              <Button
                title={
                  !activeVehicle
                    ? 'Choisir un véhicule'
                    : starting
                      ? 'Démarrage…'
                      : pendingDest
                        ? `Démarrer vers ${pendingDest.label.split(',')[0]}`
                        : 'Démarrer suivi libre'
                }
                onPress={() => {
                  if (!activeVehicle) {
                    router.push('/(tabs)/vehicles');
                    return;
                  }
                  void startOnMaps(pendingDest);
                }}
                loading={starting}
                disabled={starting}
                style={{ flex: 1 }}
              />
              <Button
                title="Historique"
                variant="outline"
                onPress={() =>
                  router.push(
                    tripHistoryNav({
                      filter: 'today',
                      vehicleId: activeVehicle?.id,
                    }) as never
                  )
                }
                style={{ flex: 1 }}
              />
              {labGpsSim ? (
                <Button
                  title="Sim labo"
                  variant="outline"
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/trip' as never,
                      params: {
                        tab: 'live',
                        runSim: '1',
                        simPace: 'fast',
                        runSimNonce: String(Date.now()),
                      },
                    })
                  }
                  style={{ flex: 1 }}
                  accessibilityLabel="Sim labo injection rapide"
                />
              ) : null}
            </>
          )}
        </View>
      </View>
      </TutorialAnchor>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: { flex: 1, minHeight: 220 },
  locateFab: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  routePicker: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 10,
  },
  routePickerInner: {
    gap: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  routeChip: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 4,
  },
  routeChipLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hud: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  hudLeft: { flex: 1, minWidth: 0 },
  hudRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statsCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  statCell: { flex: 1, minWidth: 0, alignItems: 'center' },
  statValue: { fontWeight: '800', fontSize: 12 },
  statLabel: { fontSize: 10, fontWeight: '600' },
  limitSign: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#dc2626',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValue: { color: '#0f172a', fontWeight: '900', fontSize: 20 },
  speedChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
  },
  sheet: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 180,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  vehicleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  vehicleSelectorText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  vehiclePickerScroll: {
    marginBottom: 8,
    maxHeight: 70,
  },
  vehiclePickerContent: {
    gap: 8,
    paddingHorizontal: 2,
  },
  vehicleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    minWidth: 80,
  },
  vehicleChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  vehicleChipSub: {
    fontSize: 10,
    marginTop: 2,
  },
});
