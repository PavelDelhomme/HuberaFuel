import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { TripMiniMap } from '@/components/TripMiniMap';
import { useTheme } from '@/hooks/useTheme';
import { formatDistance, formatEuro, parseRoutePoints } from '@/lib/calculations';
import { formatDurationMinutes } from '@/lib/consumptionModel';
import { formatDateSlash, formatRelativeDay } from '@/lib/dates';
import { tripPlaceLabel, tripSourceLabel } from '@/lib/geocode';
import { getPlaces, getTripById, getTripGaugeReadings } from '@/lib/database';
import { getCachedTripRoute, resolveTripRouteCached, setCachedTripRoute } from '@/lib/tripMapCache';
import { computeSimilarTripStats } from '@/lib/similarTrips';
import type { FuelGaugeReading, Place, Trip } from '@/types';
import type { RouteCoord } from '@/components/TripMap.types';

type Props = {
  trip: Trip;
  onPress: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  /** Afficher la mini-carte (désactiver hors viewport pour fluidité) */
  showMap?: boolean;
  /** Tous les trajets pour moyennes / comparaison */
  allTrips?: Trip[];
  /** Si fournis, pas de SQL jauge supplémentaire. */
  startLiters?: number;
  endLiters?: number;
  /** Même libellé que la liste des véhicules (année, carburant, n°). */
  vehicleHint?: string;
};

let placesCache: { at: number; places: Place[] } | null = null;
async function getPlacesCached(): Promise<Place[]> {
  if (placesCache && Date.now() - placesCache.at < 60_000) return placesCache.places;
  const places = await getPlaces();
  placesCache = { at: Date.now(), places };
  return places;
}

function tripDurationMinutes(trip: Trip): number {
  if (!trip.endTime) return 0;
  const ms = new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / 60000;
}

/** Carte historique : mini-carte du trajet réalisé + adresses. */
function TripHistoryCardInner({
  trip,
  onPress,
  onDelete,
  showMap = true,
  allTrips = [],
  startLiters,
  endLiters,
  vehicleHint,
}: Props) {
  const { colors } = useTheme();
  const stored = useMemo(() => parseRoutePoints(trip.routePoints), [trip.routePoints]);
  const cached = getCachedTripRoute(trip.id);
  const [displayPts, setDisplayPts] = useState<RouteCoord[]>(
    cached && cached.length ? cached : stored
  );
  const [gaugeReadings, setGaugeReadings] = useState<FuelGaugeReading[]>([]);

  const similar = useMemo(
    () => (allTrips.length ? computeSimilarTripStats(allTrips, trip, { excludeId: trip.id }) : null),
    [allTrips, trip]
  );

  const tripL100 =
    trip.distanceKm >= 0.5 && trip.estimatedFuelUsed > 0
      ? (trip.estimatedFuelUsed / trip.distanceKm) * 100
      : 0;

  const start = displayPts[0] || stored[0] || null;
  const end =
    displayPts.length > 1
      ? displayPts[displayPts.length - 1]
      : stored.length > 1
        ? stored[stored.length - 1]
        : null;

  const origin = tripPlaceLabel(trip.originName, start, 'origin');
  const dest = tripPlaceLabel(trip.destinationName, end, 'destination');
  const durationMin = tripDurationMinutes(trip);

  useEffect(() => {
    if (startLiters != null && endLiters != null && Number.isFinite(startLiters) && Number.isFinite(endLiters)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await getTripGaugeReadings(trip.id);
        if (!cancelled) setGaugeReadings(rows);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.id, startLiters, endLiters]);

  useEffect(() => {
    if (!showMap) return;
    let cancelled = false;
    (async () => {
      try {
        // GPS déjà dense → garder le tracé réel (boucles / embouteillages),
        // ne pas remplacer par un OSRM A→B qui efface l’aller-retour.
        let raw = parseRoutePoints(trip.routePoints);
        // Listes perf : omitRoutePoints → recharger le tracé à la demande
        if (raw.length < 2) {
          const full = await getTripById(trip.id);
          if (full?.routePoints) raw = parseRoutePoints(full.routePoints);
        }
        if (raw.length >= 2) {
          const pts = raw.map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
          }));
          if (!cancelled) setDisplayPts(pts);
          setCachedTripRoute(trip.id, pts);
          return;
        }
        const places = await getPlacesCached();
        const pts = await resolveTripRouteCached(trip, places);
        if (cancelled || !pts.length) return;
        setDisplayPts(pts);
      } catch {
        /* keep stored / cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showMap, trip.id, trip.routePoints, trip.originName, trip.destinationName]);

  const timeLabel = (() => {
    try {
      const d = new Date(trip.startTime);
      const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `${formatRelativeDay(trip.startTime)} · ${hm}`;
    } catch {
      return formatRelativeDay(trip.startTime);
    }
  })();

  const sourceFr = tripSourceLabel(trip.source);

  const gaugeChip = (() => {
    if (
      startLiters != null &&
      endLiters != null &&
      Number.isFinite(startLiters) &&
      Number.isFinite(endLiters)
    ) {
      const a = Math.round(startLiters);
      const b = Math.round(endLiters);
      return a === b ? `${a} L` : `${a} L → ${b} L`;
    }
    if (!gaugeReadings.length) return null;
    const chrono = [...gaugeReadings].sort((a, b) =>
      String(a.recordedAt).localeCompare(String(b.recordedAt))
    );
    const start =
      chrono.find((r) => r.source === 'trip_start') || chrono[0];
    const end =
      [...chrono].reverse().find((r) => r.source === 'trip_end') ||
      chrono[chrono.length - 1];
    if (!start) return null;
    const a = Math.round(start.liters);
    const b = Math.round(end.liters);
    return a === b ? `${a} L` : `${a} L → ${b} L`;
  })();

  return (
    <Pressable
      onPress={() => onPress(trip)}
      accessibilityRole="button"
      accessibilityLabel={`Trajet ${origin} vers ${dest}, ${timeLabel}`}
    >
      <Card style={styles.card}>
        {showMap ? (
          <TripMiniMap
            routePoints={displayPts}
            originName={origin}
            destinationName={dest}
            accentColor={colors.accent}
            height={148}
          />
        ) : (
          <View style={[styles.mapPlaceholder, { backgroundColor: colors.background }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Carte…</Text>
          </View>
        )}

        {vehicleHint ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
            {vehicleHint}
          </Text>
        ) : null}
        <View style={styles.ends}>
          <View style={styles.endCol}>
            <Text style={[styles.endLabel, { color: colors.success }]}>Départ</Text>
            <Text style={[styles.endValue, { color: colors.text }]} numberOfLines={2}>
              {origin}
            </Text>
          </View>
          <Ionicons
            name="arrow-forward"
            size={16}
            color={colors.textSecondary}
            style={{ marginTop: 14 }}
          />
          <View style={styles.endCol}>
            <Text style={[styles.endLabel, { color: colors.accent }]}>Arrivée</Text>
            <Text style={[styles.endValue, { color: colors.text }]} numberOfLines={2}>
              {dest}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }} numberOfLines={1}>
            {timeLabel}
            {sourceFr ? ` · ${sourceFr}` : ''}
            {trip.status === 'pending' ? ' · en attente' : ''}
          </Text>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onDelete(trip);
            }}
            hitSlop={10}
            style={[styles.deleteBtn, { borderColor: colors.danger }]}
            accessibilityLabel="Supprimer ce trajet"
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>

        <View style={styles.chips}>
          <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
              {formatDistance(trip.distanceKm)}
            </Text>
          </View>
          <View style={[styles.chip, { backgroundColor: colors.accent + '18', borderColor: colors.accent }]}>
            <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 13 }}>
              {formatEuro(trip.estimatedCost)}
            </Text>
          </View>
          {trip.estimatedFuelUsed > 0 && (
            <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12 }}>
                {trip.estimatedFuelUsed.toFixed(1)} L
              </Text>
            </View>
          )}
          {durationMin > 0 && (
            <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12 }}>
                {formatDurationMinutes(durationMin)}
              </Text>
            </View>
          )}
          {tripL100 > 0 && (
            <View style={[styles.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 11 }}>
                {tripL100.toFixed(1)} L/100
              </Text>
            </View>
          )}
          {gaugeChip ? (
            <View style={[styles.chip, { backgroundColor: colors.accent + '18', borderColor: colors.accent }]}>
              <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 12 }}>
                {gaugeChip}
              </Text>
            </View>
          ) : null}
        </View>

        {similar && similar.count >= 1 && (
          <View
            style={[
              styles.compareBox,
              { borderColor: colors.border, backgroundColor: colors.background },
            ]}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16 }}>
              Moy. similaires ({similar.count}) : {similar.avgDistanceKm.toFixed(1)} km ·{' '}
              {similar.avgFuelL.toFixed(1)} L · {formatEuro(similar.avgCost)}
              {similar.avgDurationMin > 0 ? ` · ${similar.avgDurationMin} min` : ''}
              {similar.avgL100 > 0 ? ` · ${similar.avgL100.toFixed(1)} L/100` : ''}
            </Text>
            {similar.vsHabitLabel ? (
              <Text
                style={{
                  color:
                    similar.deltaL100 != null && similar.deltaL100 > 0.3
                      ? colors.warning
                      : similar.deltaL100 != null && similar.deltaL100 < -0.3
                        ? colors.success
                        : colors.text,
                  fontSize: 12,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                {similar.vsHabitLabel}
              </Text>
            ) : null}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

export const TripHistoryCard = React.memo(TripHistoryCardInner);

const styles = StyleSheet.create({
  card: { marginTop: 12, overflow: 'hidden' },
  mapPlaceholder: {
    height: 56,
    borderRadius: 12,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ends: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
  },
  endCol: { flex: 1 },
  endLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 2 },
  endValue: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  deleteBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
  },
  compareBox: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
